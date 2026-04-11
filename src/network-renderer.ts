// ── Network renderer ─────────────────────────────────────────────────────────
// Renders stations and lines onto MapLibre as GeoJSON layers.

import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
import type { Network, Station, Line } from './network';
import { getLineAtomicSegments, getLinePolylineCoordinates, normalizeAtomicSegmentKey } from './network-geometry';

const SOURCE_STATIONS = 'network-stations';
const SOURCE_LINE_CASES = 'network-line-cases';
const SOURCE_LINE_SEGMENTS = 'network-line-segments';
const SOURCE_LINE_HIT = 'network-lines';

const LAYER_LINE_CASING     = 'network-line-casing';
const LAYER_LINE             = 'network-line';
const LAYER_LINE_HIT         = 'network-line-hit';
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
      layers: [LAYER_LINE_HIT],
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
    this.map.addSource(SOURCE_LINE_CASES, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addSource(SOURCE_LINE_SEGMENTS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addSource(SOURCE_LINE_HIT, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  private _initLayers(): void {
    // Line casing (thicker outline behind the line)
    this.map.addLayer({
      id: LAYER_LINE_CASING,
      type: 'line',
      source: SOURCE_LINE_CASES,
      paint: {
        'line-color': 'rgba(26, 26, 46, 0.24)',
        'line-width': ['coalesce', ['get', 'width'], 8],
        'line-opacity': 1,
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
      source: SOURCE_LINE_SEGMENTS,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['coalesce', ['get', 'width'], 4],
        'line-offset': ['coalesce', ['get', 'offset'], 0],
        'line-opacity': 0.95,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    this.map.addLayer({
      id: LAYER_LINE_HIT,
      type: 'line',
      source: SOURCE_LINE_HIT,
      paint: {
        'line-color': '#000000',
        'line-width': ['+', ['coalesce', ['get', 'width'], 6], 8],
        'line-opacity': 0.01,
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
    const casingSource = this.map.getSource(SOURCE_LINE_CASES) as GeoJSONSource | undefined;
    const segmentSource = this.map.getSource(SOURCE_LINE_SEGMENTS) as GeoJSONSource | undefined;
    const hitSource = this.map.getSource(SOURCE_LINE_HIT) as GeoJSONSource | undefined;
    if (!casingSource || !segmentSource || !hitSource) return;

    const lineOrder = new Map(this.network.lines.map((line, index) => [line.id, index]));
    const sharedSegments = new Map<string, Array<{ lineId: string; lineName: string; color: string; coordinates: [[number, number], [number, number]] }>>();

    for (const line of this.network.lines) {
      for (const segment of getLineAtomicSegments(line, this.network)) {
        const key = normalizeAtomicSegmentKey(segment.coordinates[0], segment.coordinates[1]);
        const members = sharedSegments.get(key);
        const entry = {
          lineId: segment.lineId,
          lineName: segment.lineName,
          color: segment.color,
          coordinates: [
            [segment.coordinates[0][0], segment.coordinates[0][1]],
            [segment.coordinates[1][0], segment.coordinates[1][1]],
          ] as [[number, number], [number, number]],
        };
        if (members) members.push(entry);
        else sharedSegments.set(key, [entry]);
      }
    }

    const casingFeatures: Array<{
      type: 'Feature';
      geometry: { type: 'LineString'; coordinates: [[number, number], [number, number]] };
      properties: { width: number; lineIds: string };
    }> = [];
    const segmentFeatures: Array<{
      type: 'Feature';
      geometry: { type: 'LineString'; coordinates: [[number, number], [number, number]] };
      properties: { id: string; name: string; color: string; width: number; offset: number };
    }> = [];

    for (const members of sharedSegments.values()) {
      const orderedMembers = [...members].sort((a, b) => (lineOrder.get(a.lineId) ?? 0) - (lineOrder.get(b.lineId) ?? 0));
      const casingWidth = orderedMembers.length === 1 ? 8 : Math.max(8.4, orderedMembers.length * 2.6 + 2.2);
      const fillWidth = orderedMembers.length === 1 ? 4 : Math.max(1.7, Math.min(2.8, 5.2 / orderedMembers.length + 0.9));
      const offsetStep = orderedMembers.length === 1 ? 0 : fillWidth + 0.5;

      casingFeatures.push({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: orderedMembers[0]!.coordinates,
        },
        properties: {
          width: casingWidth,
          lineIds: orderedMembers.map((member) => member.lineId).join(','),
        },
      });

      orderedMembers.forEach((member, index) => {
        const offset = orderedMembers.length === 1
          ? 0
          : (index - (orderedMembers.length - 1) / 2) * offsetStep;
        segmentFeatures.push({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: member.coordinates,
          },
          properties: {
            id: member.lineId,
            name: member.lineName,
            color: member.color,
            width: fillWidth,
            offset,
          },
        });
      });
    }

    const hitFeatures = this.network.lines
      .map((line: Line) => {
        const coords = getLinePolylineCoordinates(line, this.network);
        if (coords.length < 2) return null;
        return {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: coords },
          properties: { id: line.id, name: line.name, color: line.color, width: 6 },
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null);

    casingSource.setData({ type: 'FeatureCollection', features: casingFeatures });
    segmentSource.setData({ type: 'FeatureCollection', features: segmentFeatures });
    hitSource.setData({ type: 'FeatureCollection', features: hitFeatures });
  }

  private _updateStationSelection(): void {
    if (!this.map.getLayer(LAYER_STATION_SELECTED)) return;
    // Re-push station data so the 'selected' property updates the filter
    this._updateStationsSource();
  }
}
