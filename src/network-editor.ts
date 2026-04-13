// ── Network editor ───────────────────────────────────────────────────────────
// Handles interaction modes (select / station / line) and wires UI events.

import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
import { Network } from './network';
import type { Station, NetworkData } from './network';
import type { LinePathCoordinate } from './network';
import { NetworkRenderer } from './network-renderer';
import { ExistingTrackRouter } from './track-router';

export type EditorMode = 'select' | 'station' | 'line';

export interface EditorState {
  mode: EditorMode;
  /** The line currently being built / edited, or null. */
  activeLineId: string | null;
  /** The station currently selected (in select mode). */
  selectedStationId: string | null;
  /** Whether the current line endpoint can snap onto existing track. */
  snapToExistingAvailable: boolean;
  /** Human-readable availability message for the snap toggle. */
  snapToExistingReason: string | null;
  /** True while the editor is checking or resolving a snapped route. */
  snapToExistingBusy: boolean;
}

export type EditorStateCallback = (state: EditorState) => void;

/** NaPTAN source layers to hit-test for real-world station snapping. */
const NAPTAN_HIT_LAYERS = [
  'naptan-station-mainline',
  'naptan-station-metro',
] as const;

/** Hit-test padding in pixels for NaPTAN station targets. */
const NAPTAN_HIT_PADDING = 10;

interface NaptanHit {
  name: string;
  atco: string;
  crs: string;
  lng: number;
  lat: number;
}

export class NetworkEditor {
  readonly network: Network;
  private readonly map: MaplibreMap;
  private readonly renderer: NetworkRenderer;
  private mode: EditorMode = 'select';
  private activeLineId: string | null = null;
  private selectedStationId: string | null = null;
  private onStateChange?: EditorStateCallback;
  private readonly trackRouter = new ExistingTrackRouter();
  private snapToExistingAvailable = true;
  private snapToExistingReason: string | null = null;
  private snapToExistingBusy = false;
  private snapAvailabilityToken = 0;
  private _simMode = false;

  constructor(map: MaplibreMap, onStateChange?: EditorStateCallback) {
    this.map = map;
    this.network = new Network();
    this.network.load();
    this.renderer = new NetworkRenderer(map, this.network);

    this.onStateChange = onStateChange;
    this.network.onChange(() => {
      this.renderer.update();
      void this._refreshSnapAvailability();
      this._emit();
    });

    // Map click handler
    this.map.on('click', this._onMapClick);

    // Cursor feedback: user-placed network stations
    this.map.on('mouseenter', 'network-station-outer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'network-station-outer', () => {
      this._updateCursor();
    });

    this.map.on('mouseenter', 'network-line-hit', () => {
      if (!this._simMode && this.mode === 'select') {
        this.map.getCanvas().style.cursor = 'pointer';
      }
    });
    this.map.on('mouseleave', 'network-line-hit', () => {
      this._updateCursor();
    });

    // Cursor feedback: real-world NaPTAN stations (show pointer when in an
    // active placement mode so the user knows snapping is available)
    for (const layer of NAPTAN_HIT_LAYERS) {
      this.map.on('mouseenter', layer, () => {
        if (!this._simMode && (this.mode === 'select' || this.mode === 'station' || this.mode === 'line')) {
          this.map.getCanvas().style.cursor = 'pointer';
        }
      });
      this.map.on('mouseleave', layer, () => {
        this._updateCursor();
      });
    }

    // NOTE: no _emit() here — caller must invoke syncUI() after construction
    // so that any UI callbacks that reference this editor can safely do so.
  }

  /** Trigger an initial UI sync. Call once after construction is complete. */
  syncUI(): void {
    void this._refreshSnapAvailability();
    this._emit();
  }

  /** Set sim mode — when true, suppress all plan-mode click interactions. */
  setSimMode(active: boolean): void {
    this._simMode = active;
    if (active) {
      this.map.getCanvas().style.cursor = '';
    } else {
      this._updateCursor();
    }
  }

  getState(): EditorState {
    return {
      mode: this.mode,
      activeLineId: this.activeLineId,
      selectedStationId: this.selectedStationId,
      snapToExistingAvailable: this.snapToExistingAvailable,
      snapToExistingReason: this.snapToExistingReason,
      snapToExistingBusy: this.snapToExistingBusy,
    };
  }

  // ── Mode switching ─────────────────────────────────────────────────────────

  setMode(mode: EditorMode): void {
    this.mode = mode;
    if (mode !== 'select') {
      this.selectedStationId = null;
      this.renderer.setSelectedStation(null);
    }
    if (mode !== 'line') {
      this.activeLineId = null;
    }
    this._updateCursor();
    void this._refreshSnapAvailability();
    this._emit();
  }

  // ── Line management ────────────────────────────────────────────────────────

  createLine(name: string, color: string, snapToExisting = false): void {
    const line = this.network.addLine(name, color, snapToExisting);
    this.activeLineId = line.id;
    this.mode = 'line';
    this._updateCursor();
    void this._refreshSnapAvailability();
    this._emit();
  }

  setActiveLine(id: string | null): void {
    this.activeLineId = id;
    if (id) this.mode = 'line';
    this._updateCursor();
    void this._refreshSnapAvailability();
    this._emit();
  }

  setActiveLineSnapToExisting(enabled: boolean): void {
    if (!this.activeLineId) return;
    this.network.setLineSnapToExisting(this.activeLineId, enabled);
    void this._refreshSnapAvailability();
  }

  deleteLine(id: string): void {
    this.network.removeLine(id);
    if (this.activeLineId === id) {
      this.activeLineId = null;
      this.mode = 'select';
    }
    this._updateCursor();
    void this._refreshSnapAvailability();
    this._emit();
  }

  // ── Station management ─────────────────────────────────────────────────────

  deleteSelectedStation(): void {
    if (!this.selectedStationId) return;
    this.network.removeStation(this.selectedStationId);
    this.selectedStationId = null;
    this.renderer.setSelectedStation(null);
    this._emit();
  }

  renameSelectedStation(name: string): void {
    if (!this.selectedStationId) return;
    this.network.renameStation(this.selectedStationId, name);
  }

  deselectStation(): void {
    if (this.selectedStationId === null) return;
    this.selectedStationId = null;
    this.renderer.setSelectedStation(null);
    this._emit();
  }

  /** Programmatically select a station (e.g. from Line Manager stop list click). */
  selectStation(id: string): void {
    const station = this.network.getStation(id);
    if (!station) return;
    this.selectedStationId = id;
    this.renderer.setSelectedStation(id);
    if (this.mode !== 'select') {
      this.mode = 'select';
      this._updateCursor();
    }
    this._emit();
  }

  clearNetwork(): void {
    this.network.clear();
    this.activeLineId = null;
    this.selectedStationId = null;
    this.renderer.setSelectedStation(null);
    this.mode = 'select';
    this._updateCursor();
    void this._refreshSnapAvailability();
    this._emit();
  }

  /**
   * Import a validated network payload.
   * merge=false replaces everything; merge=true appends on top of existing data.
   */
  importNetwork(data: NetworkData, merge: boolean): void {
    this.network.importNetwork(data, merge);
    this.activeLineId = null;
    this.selectedStationId = null;
    this.renderer.setSelectedStation(null);
    this.mode = 'select';
    this._updateCursor();
    void this._refreshSnapAvailability();
    this._emit();
  }

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  canUndo(): boolean { return this.network.canUndo(); }
  canRedo(): boolean { return this.network.canRedo(); }

  undo(): void {
    this.network.undo();
    this._sanitizeEditorState();
    void this._refreshSnapAvailability();
    this._emit();
  }

  redo(): void {
    this.network.redo();
    this._sanitizeEditorState();
    void this._refreshSnapAvailability();
    this._emit();
  }

  /** Drop references to stations/lines that no longer exist after undo/redo. */
  private _sanitizeEditorState(): void {
    if (this.selectedStationId && !this.network.getStation(this.selectedStationId)) {
      this.selectedStationId = null;
      this.renderer.setSelectedStation(null);
    }
    if (this.activeLineId && !this.network.getLine(this.activeLineId)) {
      this.activeLineId = null;
      if (this.mode === 'line') {
        this.mode = 'select';
        this._updateCursor();
      }
    }
  }

  private _setSnapAvailability(available: boolean, busy: boolean, reason: string | null): void {
    this.snapToExistingAvailable = available;
    this.snapToExistingBusy = busy;
    this.snapToExistingReason = reason;
  }

  private async _refreshSnapAvailability(): Promise<void> {
    const token = ++this.snapAvailabilityToken;
    const lineId = this.activeLineId;

    if (this.mode !== 'line' || !lineId) {
      this._setSnapAvailability(true, false, null);
      this._emit();
      return;
    }

    const line = this.network.getLine(lineId);
    if (!line || line.stationIds.length === 0) {
      this._setSnapAvailability(true, false, null);
      this._emit();
      return;
    }

    const lastStationId = line.stationIds[line.stationIds.length - 1];
    const lastStation = lastStationId ? this.network.getStation(lastStationId) : undefined;
    if (!lastStation) {
      this._setSnapAvailability(false, false, 'No existing route is available from the current endpoint.');
      this._emit();
      return;
    }

    this._setSnapAvailability(this.snapToExistingAvailable, true, 'Checking nearby tracks…');
    this._emit();

    const canSnap = await this.trackRouter.canSnapFrom(this.network, [lastStation.lng, lastStation.lat]);
    if (token !== this.snapAvailabilityToken) return;

    this._setSnapAvailability(
      canSnap,
      false,
      canSnap ? null : 'No existing route is available from the current endpoint.',
    );
    if (!canSnap && line.snapToExisting) {
      this.network.setLineSnapToExisting(line.id, false);
      return;
    }
    this._emit();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Query NaPTAN layers at the given screen point. Returns the closest
   * real-world station hit, or null if none within the hit padding.
   */
  private _hitTestNaptan(point: [number, number]): NaptanHit | null {
    const p = point[0];
    const q = point[1];
    const pad = NAPTAN_HIT_PADDING;
    const bbox: [[number, number], [number, number]] = [
      [p - pad, q - pad],
      [p + pad, q + pad],
    ];

    // Only query layers that are actually present in the current style
    const layers = NAPTAN_HIT_LAYERS.filter((id) => !!this.map.getLayer(id));
    if (layers.length === 0) return null;

    const features = this.map.queryRenderedFeatures(bbox, { layers });
    if (features.length === 0) return null;

    const feature = features[0];
    const props = feature.properties;
    if (!props) return null;

    const geom = feature.geometry;
    if (geom.type !== 'Point') return null;

    const name = (props['name'] as string | undefined) ?? 'Station';
    const atco = (props['atco'] as string | undefined) ?? '';

    // Derive CRS/TIPLOC from ATCO — rail stations have '9100' prefix
    let crs = '';
    if (atco.startsWith('9100') && atco.length > 4) {
      crs = atco.slice(4);
    }

    return { name, atco, crs, lng: geom.coordinates[0], lat: geom.coordinates[1] };
  }

  /**
   * Find an existing network station that represents the given NaPTAN hit,
   * or create a new one snapped to the real station's coordinates.
   * Uses atco for deduplication when available.
   */
  private _getOrImportStation(hit: NaptanHit): Station {
    // 1. Dedup by ATCO code
    if (hit.atco) {
      const existing = this.network.findByAtco(hit.atco);
      if (existing) return existing;
    }
    // 2. Create a new station snapped to the NaPTAN coordinates + name
    return this.network.addStation(hit.lng, hit.lat, hit.name, hit.atco || undefined, hit.crs || undefined);
  }

  private _onMapClick = async (e: MapMouseEvent): Promise<void> => {
    // In sim mode, only allow station selection for departure board — never create/modify anything
    if (this._simMode) {
      const networkStationId = this.renderer.hitTestStation([e.point.x, e.point.y]);
      if (networkStationId) {
        this.selectedStationId = networkStationId;
        this.renderer.setSelectedStation(networkStationId);
      } else {
        this.selectedStationId = null;
        this.renderer.setSelectedStation(null);
      }
      this._emit();
      return;
    }

    const networkStationId = this.renderer.hitTestStation([e.point.x, e.point.y]);
    const naptanHit = this._hitTestNaptan([e.point.x, e.point.y]);

    switch (this.mode) {
      case 'select': {
        if (networkStationId) {
          this.selectedStationId = networkStationId;
          this.renderer.setSelectedStation(networkStationId);
        } else if (naptanHit) {
          // Clicked a real-world station in select mode — import and select it
          const imported = this._getOrImportStation(naptanHit);
          this.selectedStationId = imported.id;
          this.renderer.setSelectedStation(imported.id);
        } else {
          const lineId = this.renderer.hitTestLine([e.point.x, e.point.y]);
          if (lineId) {
            this.setActiveLine(lineId);
            return; // setActiveLine already calls _emit
          }
          this.selectedStationId = null;
          this.renderer.setSelectedStation(null);
        }
        this._emit();
        break;
      }

      case 'station':
        if (networkStationId) {
          // Clicked an existing user-placed station — select it
          this.selectedStationId = networkStationId;
          this.renderer.setSelectedStation(networkStationId);
          this.mode = 'select';
          this._updateCursor();
        } else if (naptanHit) {
          // Clicked a real-world station — import or reuse it
          this._getOrImportStation(naptanHit);
        } else {
          // Empty map — place a new blank station
          this.network.addStation(e.lngLat.lng, e.lngLat.lat);
        }
        this._emit();
        break;

      case 'line':
        if (!this.activeLineId) break;
        {
          const activeLine = this.network.getLine(this.activeLineId);
          if (!activeLine) break;

          let station = networkStationId ? this.network.getStation(networkStationId) ?? null : null;
          const targetCoordinates: LinePathCoordinate = station
            ? [station.lng, station.lat]
            : naptanHit
              ? [naptanHit.lng, naptanHit.lat]
              : [e.lngLat.lng, e.lngLat.lat];

          const ensureTargetStation = (): Station => {
            if (station) return station;
            if (naptanHit) {
              station = this._getOrImportStation(naptanHit);
            } else {
              station = this.network.addStation(targetCoordinates[0], targetCoordinates[1]);
            }
            return station;
          };

          const shouldSnap = activeLine.snapToExisting === true && activeLine.stationIds.length > 0;
          if (shouldSnap) {
            const fromStationId = activeLine.stationIds[activeLine.stationIds.length - 1];
            const fromStation = fromStationId ? this.network.getStation(fromStationId) : undefined;
            if (fromStation) {
              this._setSnapAvailability(this.snapToExistingAvailable, true, 'Finding route along existing tracks…');
              this._emit();

              const route = await this.trackRouter.findRoute(
                this.network,
                [fromStation.lng, fromStation.lat],
                targetCoordinates,
              );
              this._setSnapAvailability(this.snapToExistingAvailable, false, this.snapToExistingReason);
              if (!route) {
                alert('No route could be found along existing tracks for that stop.');
                this._emit();
                return;
              }

              const snappedStation = ensureTargetStation();
              this.network.addStationToLine(this.activeLineId, snappedStation.id, route);
              this._emit();
              return;
            }
          }

          const targetStation = ensureTargetStation();
          this.network.addStationToLine(this.activeLineId, targetStation.id);
        }
        this._emit();
        break;
    }
  };

  _updateCursor(): void {
    const canvas = this.map.getCanvas();
    switch (this.mode) {
      case 'select':
        canvas.style.cursor = '';
        break;
      case 'station':
      case 'line':
        canvas.style.cursor = 'crosshair';
        break;
    }
  }

  private _emit(): void {
    this.onStateChange?.(this.getState());
  }
}

