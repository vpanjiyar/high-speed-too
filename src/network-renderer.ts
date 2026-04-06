// ── Network renderer ─────────────────────────────────────────────────────────
// Renders stations and lines onto MapLibre as GeoJSON layers.

import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
import type { Network, Station, Line } from './network';

const SOURCE_STATIONS = 'network-stations';
const SOURCE_LINES    = 'network-lines';

const LAYER_LINE_CASING     = 'network-line-casing';
const LAYER_LINE             = 'network-line';
const LAYER_STATION_OUTER    = 'network-station-outer';
const LAYER_STATION_INNER    = 'network-station-inner';
const LAYER_STATION_LABEL    = 'network-station-label';
const LAYER_STATION_SELECTED = 'network-station-selected';

export class NetworkRenderer {
  private readonly map: MaplibreMap;
  private readonly network: Network;
  private selectedStationId: string | null = null;

  constructor(map: MaplibreMap, network: Network) {
    this.map = map;
    this.network = network;
    this._initSources();
    this._initLayers();
    this.update();
  }

  setSelectedStation(id: string | null): void {
    this.selectedStationId = id;
    this._updateStationSelection();
  }

  update(): void {
    this._updateStationsSource();
    this._updateLinesSource();
    this._updateStationSelection();
  }

  /** Returns the line id at the given point, if any. Uses a padded bbox to
   *  make clicking thin line segments easier. */
  hitTestLine(point: [number, number]): string | null {
    const pad = 6;
    const bbox: [[number, number], [number, number]] = [
      [point[0] - pad, point[1] - pad],
      [point[0] + pad, point[1] + pad],
    ];
    const features = this.map.queryRenderedFeatures(bbox, {
      layers: [LAYER_LINE_CASING],
    });
    if (features.length > 0) {
      return (features[0].properties?.id as string) ?? null;
    }
    return null;
  }

  /** Returns the station id at the given point, if any. Uses a small padded
   *  bbox so that clicking close to (but not pixel-perfect on) a circle dot
   *  still registers a hit. */
  hitTestStation(point: [number, number]): string | null {
    const pad = 10;
    const bbox: [[number, number], [number, number]] = [
      [point[0] - pad, point[1] - pad],
      [point[0] + pad, point[1] + pad],
    ];
    const features = this.map.queryRenderedFeatures(bbox, {
      layers: [LAYER_STATION_OUTER],
    });
    if (features.length > 0) {
      return (features[0].properties?.id as string) ?? null;
    }
    return null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _initSources(): void {
    this.map.addSource(SOURCE_STATIONS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addSource(SOURCE_LINES, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  private _initLayers(): void {
    // Line casing (thicker outline behind the line)
    this.map.addLayer({
      id: LAYER_LINE_CASING,
      type: 'line',
      source: SOURCE_LINES,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 8,
        'line-opacity': 0.25,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Line fill
    this.map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE_LINES,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 4,
        'line-opacity': 0.9,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Station outer ring (white border)
    this.map.addLayer({
      id: LAYER_STATION_OUTER,
      type: 'circle',
      source: SOURCE_STATIONS,
      paint: {
        'circle-radius': 7,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#1a1a2e',
        'circle-stroke-width': 1.5,
      },
    });

    // Station inner fill (colored if on a line)
    this.map.addLayer({
      id: LAYER_STATION_INNER,
      type: 'circle',
      source: SOURCE_STATIONS,
      paint: {
        'circle-radius': 4,
        'circle-color': ['case',
          ['has', 'lineColor'],
          ['get', 'lineColor'],
          '#1a1a2e',
        ],
      },
    });

    // Selection ring
    this.map.addLayer({
      id: LAYER_STATION_SELECTED,
      type: 'circle',
      source: SOURCE_STATIONS,
      filter: ['==', 'selected', true],
      paint: {
        'circle-radius': 12,
        'circle-color': 'transparent',
        'circle-stroke-color': '#1E88E5',
        'circle-stroke-width': 2.5,
        'circle-stroke-opacity': 0.8,
      },
    });

    // Station label
    this.map.addLayer({
      id: LAYER_STATION_LABEL,
      type: 'symbol',
      source: SOURCE_STATIONS,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-optional': true,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#1a1a2e',
        'text-halo-color': 'rgba(255, 252, 244, 0.9)',
        'text-halo-width': 1.5,
      },
    });
  }

  private _updateStationsSource(): void {
    const source = this.map.getSource(SOURCE_STATIONS) as GeoJSONSource | undefined;
    if (!source) return;

    // Build a map of station → first line color for dot fill
    const stationColorMap = new Map<string, string>();
    for (const line of this.network.lines) {
      for (const sid of line.stationIds) {
        if (!stationColorMap.has(sid)) {
          stationColorMap.set(sid, line.color);
        }
      }
    }

    const features = this.network.stations.map((s: Station) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        selected: s.id === this.selectedStationId,
        ...(stationColorMap.has(s.id) ? { lineColor: stationColorMap.get(s.id) } : {}),
      },
    }));

    source.setData({ type: 'FeatureCollection', features });
  }

  private _updateLinesSource(): void {
    const source = this.map.getSource(SOURCE_LINES) as GeoJSONSource | undefined;
    if (!source) return;

    const features = this.network.lines
      .filter((line: Line) => line.stationIds.length >= 2)
      .map((line: Line) => {
        const coords = line.stationIds
          .map((sid) => this.network.getStation(sid))
          .filter((s): s is Station => !!s)
          .map((s) => [s.lng, s.lat]);

        return {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: coords },
          properties: { id: line.id, name: line.name, color: line.color },
        };
      });

    source.setData({ type: 'FeatureCollection', features });
  }

  private _updateStationSelection(): void {
    if (!this.map.getLayer(LAYER_STATION_SELECTED)) return;
    // Re-push station data so the 'selected' property updates the filter
    this._updateStationsSource();
  }
}
