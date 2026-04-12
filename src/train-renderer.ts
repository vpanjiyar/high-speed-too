// ── Train renderer ────────────────────────────────────────────────────────────
// Renders trains on the MapLibre map:
// - Zoomed out (< z13): coloured circle dots with headcode labels
// - Zoomed in (≥ z13): per-car LineString segments that pivot around curves,
//   following the actual polyline geometry of the track.

import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
import type { TrainState, LinePolylineCache } from './simulation';
import { interpolatePosition } from './simulation';

const SOURCE_TRAINS        = 'sim-trains';
const SOURCE_TRAIN_CARS    = 'sim-train-cars';
const SOURCE_TRAIN_LABELS  = 'sim-train-labels';
const LAYER_TRAIN_HALO     = 'sim-train-halo';
const LAYER_TRAIN_FILL     = 'sim-train-fill';
const LAYER_TRAIN_LABEL    = 'sim-train-label';
const LAYER_TRAIN_CASING   = 'sim-train-car-casing';
const LAYER_TRAIN_CARS     = 'sim-train-cars';
const LAYER_TRAIN_CAR_LABEL = 'sim-train-car-label';

const INSERT_BEFORE = 'network-station-label';

/** Coupling gap between carriages in metres. */
const COUPLING_GAP_M = 3;
/** Sample spacing along polyline for smooth car curves. */
const SAMPLE_SPACING_M = 5;

export class TrainRenderer {
  private readonly map: MaplibreMap;

  constructor(map: MaplibreMap) {
    this.map = map;
    this._initSources();
    this._initLayers();
  }

  /**
   * Update all train features.
   * @param trains  Current train states from the simulation.
   * @param caches  Polyline caches keyed by lineId — needed to compute
   *                per-car positions along the track geometry.
   */
  update(trains: TrainState[], caches?: Map<string, LinePolylineCache>): void {
    const dotSource   = this.map.getSource(SOURCE_TRAINS) as GeoJSONSource | undefined;
    const carSource   = this.map.getSource(SOURCE_TRAIN_CARS) as GeoJSONSource | undefined;
    const labelSource = this.map.getSource(SOURCE_TRAIN_LABELS) as GeoJSONSource | undefined;
    if (!dotSource) return;

    const dotFeatures:   GeoJSON.Feature[] = [];
    const carFeatures:   GeoJSON.Feature[] = [];
    const labelFeatures: GeoJSON.Feature[] = [];

    const zoom = this.map.getZoom();

    for (const t of trains) {
      const cache = caches?.get(t.lineId);
      const useCarView = (t.isFollowed || zoom >= 13) && cache;

      if (useCarView) {
        // ── Per-car LineStrings following the polyline ──────────────
        const totalLen = t.lengthM ?? 200;
        const carCount = t.carsPerUnit || 1;
        const carLenM  = totalLen / carCount;

        for (let c = 0; c < carCount; c++) {
          const carOffset = c * (carLenM + COUPLING_GAP_M);

          let carHeadM: number;
          let carTailM: number;
          if (t.direction === 'forward') {
            carHeadM = t.polylineDistanceM - carOffset;
            carTailM = carHeadM - carLenM;
          } else {
            carHeadM = t.polylineDistanceM + carOffset;
            carTailM = carHeadM + carLenM;
          }

          // Clamp to polyline bounds
          const maxM = cache.totalLengthM;
          carHeadM = Math.max(0, Math.min(maxM, carHeadM));
          carTailM = Math.max(0, Math.min(maxM, carTailM));

          const startM = Math.min(carHeadM, carTailM);
          const endM   = Math.max(carHeadM, carTailM);
          const span   = endM - startM;
          if (span < 0.5) continue; // degenerate — skip

          // Sample polyline at regular intervals for this car
          const numPts = Math.max(2, Math.ceil(span / SAMPLE_SPACING_M) + 1);
          const coords: [number, number][] = [];
          for (let p = 0; p < numPts; p++) {
            const d = startM + (span * p) / (numPts - 1);
            coords.push(interpolatePosition(cache, d));
          }

          carFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: {
              id: t.id,
              color: t.lineColor,
              carIndex: c,
            },
          });
        }

        // Label at the head of the train
        labelFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
          properties: {
            id: t.id,
            color: t.lineColor,
            headcode: t.headcode,
          },
        });
      } else {
        // ── Dot feature ────────────────────────────────────────────
        dotFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
          properties: {
            id: t.id,
            color: t.lineColor,
            headcode: t.headcode,
          },
        });
      }
    }

    dotSource.setData({ type: 'FeatureCollection', features: dotFeatures });
    carSource?.setData({ type: 'FeatureCollection', features: carFeatures });
    labelSource?.setData({ type: 'FeatureCollection', features: labelFeatures });
  }

  setVisible(visible: boolean): void {
    const v = visible ? 'visible' : 'none';
    for (const id of [LAYER_TRAIN_HALO, LAYER_TRAIN_FILL, LAYER_TRAIN_LABEL, LAYER_TRAIN_CASING, LAYER_TRAIN_CARS, LAYER_TRAIN_CAR_LABEL]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', v);
      }
    }
  }

  hitTest(point: [number, number]): string | null {
    const pad = 14;
    const bbox: [[number, number], [number, number]] = [
      [point[0] - pad, point[1] - pad],
      [point[0] + pad, point[1] + pad],
    ];
    const layers: string[] = [];
    if (this.map.getLayer(LAYER_TRAIN_FILL)) layers.push(LAYER_TRAIN_FILL);
    if (this.map.getLayer(LAYER_TRAIN_CARS)) layers.push(LAYER_TRAIN_CARS);
    if (layers.length === 0) return null;

    const features = this.map.queryRenderedFeatures(bbox, { layers });
    if (features.length > 0) {
      return (features[0].properties?.id as string) ?? null;
    }
    return null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _initSources(): void {
    this.map.addSource(SOURCE_TRAINS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'id',
    });
    this.map.addSource(SOURCE_TRAIN_CARS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addSource(SOURCE_TRAIN_LABELS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'id',
    });
  }

  private _initLayers(): void {
    const before = this.map.getLayer(INSERT_BEFORE) ? INSERT_BEFORE : undefined;

    // ── Dot layers (zoomed out) ────────────────────────────────────────
    this.map.addLayer({
      id: LAYER_TRAIN_HALO,
      type: 'circle',
      source: SOURCE_TRAINS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 10, 8, 14, 12, 18, 16, 24],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.28,
        'circle-blur': 0.5,
      },
    }, before);

    this.map.addLayer({
      id: LAYER_TRAIN_FILL,
      type: 'circle',
      source: SOURCE_TRAINS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 6, 8, 8, 12, 10, 16, 14],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#fffcf4',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 2.5, 16, 3],
      },
    }, before);

    this.map.addLayer({
      id: LAYER_TRAIN_LABEL,
      type: 'symbol',
      source: SOURCE_TRAINS,
      minzoom: 11,
      layout: {
        'text-field': ['get', 'headcode'],
        'text-size': 10,
        'text-offset': [0, -1.4],
        'text-anchor': 'bottom',
        'text-optional': true,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': 'rgba(255, 252, 244, 0.92)',
        'text-halo-width': 1.5,
      },
    }, before);

    // ── Car casing (white outline for visibility against same-colour lines) ──
    this.map.addLayer({
      id: LAYER_TRAIN_CASING,
      type: 'line',
      source: SOURCE_TRAIN_CARS,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['exponential', 2], ['zoom'],
          13, 5,
          15, 8,
          17, 14,
          19, 24,
        ],
        'line-opacity': 0.95,
      },
    }, before);

    // ── Car body lines (zoomed in) ─────────────────────────────────────
    this.map.addLayer({
      id: LAYER_TRAIN_CARS,
      type: 'line',
      source: SOURCE_TRAIN_CARS,
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['exponential', 2], ['zoom'],
          13, 3,
          15, 5,
          17, 10,
          19, 18,
        ],
        'line-opacity': 1.0,
      },
    }, before);

    // Headcode label above the car-rendered train
    this.map.addLayer({
      id: LAYER_TRAIN_CAR_LABEL,
      type: 'symbol',
      source: SOURCE_TRAIN_LABELS,
      layout: {
        'text-field': ['get', 'headcode'],
        'text-size': 11,
        'text-offset': [0, -1.6],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': 'rgba(255, 252, 244, 0.92)',
        'text-halo-width': 1.5,
      },
    }, before);
  }
}
