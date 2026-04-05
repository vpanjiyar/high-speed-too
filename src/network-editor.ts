// ── Network editor ───────────────────────────────────────────────────────────
// Handles interaction modes (select / station / line) and wires UI events.

import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
import { Network } from './network';
import type { Station } from './network';
import { NetworkRenderer } from './network-renderer';

export type EditorMode = 'select' | 'station' | 'line';

export interface EditorState {
  mode: EditorMode;
  /** The line currently being built / edited, or null. */
  activeLineId: string | null;
  /** The station currently selected (in select mode). */
  selectedStationId: string | null;
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

  constructor(map: MaplibreMap, onStateChange?: EditorStateCallback) {
    this.map = map;
    this.network = new Network();
    this.network.load();
    this.renderer = new NetworkRenderer(map, this.network);

    this.onStateChange = onStateChange;
    this.network.onChange(() => {
      this.renderer.update();
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

    // Cursor feedback: real-world NaPTAN stations (show pointer when in an
    // active placement mode so the user knows snapping is available)
    for (const layer of NAPTAN_HIT_LAYERS) {
      this.map.on('mouseenter', layer, () => {
        if (this.mode === 'station' || this.mode === 'line') {
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
    this._emit();
  }

  getState(): EditorState {
    return {
      mode: this.mode,
      activeLineId: this.activeLineId,
      selectedStationId: this.selectedStationId,
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
    this._emit();
  }

  // ── Line management ────────────────────────────────────────────────────────

  createLine(name: string, color: string): void {
    const line = this.network.addLine(name, color);
    this.activeLineId = line.id;
    this.mode = 'line';
    this._updateCursor();
    this._emit();
  }

  setActiveLine(id: string | null): void {
    this.activeLineId = id;
    if (id) this.mode = 'line';
    this._updateCursor();
    this._emit();
  }

  deleteLine(id: string): void {
    this.network.removeLine(id);
    if (this.activeLineId === id) {
      this.activeLineId = null;
      this.mode = 'select';
    }
    this._updateCursor();
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

  clearNetwork(): void {
    this.network.clear();
    this.activeLineId = null;
    this.selectedStationId = null;
    this.renderer.setSelectedStation(null);
    this.mode = 'select';
    this._updateCursor();
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

    return { name, atco, lng: geom.coordinates[0], lat: geom.coordinates[1] };
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
    return this.network.addStation(hit.lng, hit.lat, hit.name, hit.atco || undefined);
  }

  private _onMapClick = (e: MapMouseEvent): void => {
    const networkStationId = this.renderer.hitTestStation([e.point.x, e.point.y]);
    const naptanHit = this._hitTestNaptan([e.point.x, e.point.y]);

    switch (this.mode) {
      case 'select':
        this.selectedStationId = networkStationId;
        this.renderer.setSelectedStation(networkStationId);
        this._emit();
        break;

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
        if (networkStationId) {
          // Existing user station — add directly to line
          this.network.addStationToLine(this.activeLineId, networkStationId);
        } else if (naptanHit) {
          // Real-world station — import/reuse and add to line
          const station = this._getOrImportStation(naptanHit);
          this.network.addStationToLine(this.activeLineId, station.id);
        } else {
          // Empty map — place a new blank station and add to line
          const station = this.network.addStation(e.lngLat.lng, e.lngLat.lat);
          this.network.addStationToLine(this.activeLineId, station.id);
        }
        this._emit();
        break;
    }
  };

  private _updateCursor(): void {
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

