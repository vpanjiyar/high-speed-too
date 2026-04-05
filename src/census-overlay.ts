import type { Map as MaplibreMap } from 'maplibre-gl';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CensusMetric = 'off' | 'population' | 'density' | 'working_age';

export interface CensusOverlayState {
  metric: CensusMetric;
  loading: boolean;
  error: string | null;
  lastModified: Date | null;
}

export type StateChangeCallback = (state: CensusOverlayState) => void;

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_LSOA   = 'census-lsoa';
const SOURCE_MSOA   = 'census-msoa';
const LSOA_FILL     = 'census-lsoa-fill';
const LSOA_OUTLINE  = 'census-lsoa-outline';
const MSOA_FILL     = 'census-msoa-fill';
const MSOA_OUTLINE  = 'census-msoa-outline';

// The census fills are inserted immediately above the landuse layers so that
// boundaries, rail, roads, and labels all render on top.
const INSERT_BEFORE_LAYER = 'boundary-region';

// Data URLs (served from public/data/ by the Vite dev server)
const LSOA_GEOJSON_URL = '/data/lsoa_boundaries.geojson';
const MSOA_GEOJSON_URL = '/data/msoa_boundaries.geojson';

// Zoom threshold: MSOA shown at zoom < 9 (regional), LSOA at zoom >= 9 (city)
const ZOOM_THRESHOLD = 9;

// ── MapLibre data-driven paint expressions per metric ─────────────────────────
// These use properties embedded by geography_processor.py:
//   "pop"      — total usual residents
//   "work_pop" — working-age population (16–64)
//   "area_ha"  — polygon area in hectares
//
// All values are guarded with ['to-number', ..., 0] so features without
// census data render transparently rather than breaking the layer.

const FILL_COLORS: Record<Exclude<CensusMetric, 'off'>, unknown> = {

  // Total population per LSOA — blue ramp
  // LSOAs are designed to contain ~1,500 residents, so the scale tops at ~4,000
  population: [
    'interpolate', ['linear'],
    ['to-number', ['get', 'pop'], 0],
    0,    'rgba(247,251,255,0.0)',
    500,  '#c6dbef',
    1500, '#6baed6',
    2500, '#2171b5',
    4000, '#08306b',
  ],

  // Population density (residents per hectare) — orange-brown ramp
  // Computed from "pop" / max("area_ha", 0.01) to avoid divide-by-zero
  density: [
    'interpolate', ['linear'],
    ['/', ['to-number', ['get', 'pop'], 0],
          ['max', ['to-number', ['get', 'area_ha'], 1], 0.01]],
    0,    'rgba(255,247,188,0.0)',
    5,    '#fee391',
    20,   '#fe9929',
    60,   '#cc4c02',
    150,  '#662506',
  ],

  // Working-age percentage (work_pop / pop * 100) — green ramp
  // Falls back to 0 when "pop" is absent or zero
  working_age: [
    'interpolate', ['linear'],
    ['case',
      ['>', ['to-number', ['get', 'pop'], 0], 0],
      ['/',
        ['*', ['to-number', ['get', 'work_pop'], 0], 100],
        ['to-number', ['get', 'pop'], 1],
      ],
      0,
    ],
    0,  'rgba(255,245,235,0.0)',
    30, '#c7e9b4',
    45, '#41b6c4',
    55, '#1d91c0',
    70, '#0c2c84',
  ],
};

export const METRIC_LABELS: Record<CensusMetric, string> = {
  off:         'Off',
  population:  'Population',
  density:     'Density (pop/ha)',
  working_age: 'Working Age %',
};

export interface LegendConfig {
  /** CSS linear-gradient string */
  gradient: string;
  minLabel: string;
  maxLabel: string;
}

export const LEGEND_CONFIGS: Record<Exclude<CensusMetric, 'off'>, LegendConfig> = {
  population: {
    gradient:  'linear-gradient(to right, #c6dbef, #6baed6, #2171b5, #08306b)',
    minLabel: '0',
    maxLabel: '4,000+ residents',
  },
  density: {
    gradient:  'linear-gradient(to right, #fee391, #fe9929, #cc4c02, #662506)',
    minLabel: '0 /ha',
    maxLabel: '150+ /ha',
  },
  working_age: {
    gradient:  'linear-gradient(to right, #c7e9b4, #41b6c4, #1d91c0, #0c2c84)',
    minLabel: '30%',
    maxLabel: '70%',
  },
};

// ── CensusOverlay class ───────────────────────────────────────────────────────

export class CensusOverlay {
  private readonly map: MaplibreMap;
  private metric: CensusMetric = 'off';
  private loadedSources = new Set<string>();
  private loading = false;
  private error: string | null = null;
  private lastModified: Date | null = null;
  private onStateChange?: StateChangeCallback;

  constructor(map: MaplibreMap, onStateChange?: StateChangeCallback) {
    this.map = map;
    this.onStateChange = onStateChange;
    this._fetchLastModified();
  }

  private get loaded(): boolean {
    return this.loadedSources.has(SOURCE_LSOA) && this.loadedSources.has(SOURCE_MSOA);
  }

  getState(): CensusOverlayState {
    return { metric: this.metric, loading: this.loading, error: this.error, lastModified: this.lastModified };
  }

  /** Switch the active metric. Pass 'off' to hide the overlay. */
  setMetric(metric: CensusMetric): void {
    this.metric = metric;
    this.error  = null;

    if (metric === 'off') {
      this._setLayersVisible(false);
      this._emitState();
      return;
    }

    if (!this.loaded && !this.loading) {
      this._loadSources();
    } else if (this.loaded) {
      this._setLayersVisible(true);
      this._updateFillColor(metric);
      this._emitState();
    }
  }

  /** Reload the GeoJSON sources from disk without changing the active metric. */
  refresh(): void {
    if (this.metric === 'off') return;
    this._removeSourcesAndLayers();
    this.loadedSources.clear();
    this._loadSources();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _fetchLastModified(): void {
    fetch(LSOA_GEOJSON_URL, { method: 'HEAD' })
      .then((res) => {
        const raw = res.headers.get('Last-Modified');
        if (raw) {
          const d = new Date(raw);
          if (!isNaN(d.getTime())) {
            this.lastModified = d;
            this._emitState();
          }
        }
      })
      .catch(() => { /* file not present yet — silently ignore */ });
  }

  private _loadSources(): void {
    this._removeSourcesAndLayers();
    this.loadedSources.clear();
    this.loading = true;
    this._emitState();

    this._loadOneSource(SOURCE_LSOA, LSOA_GEOJSON_URL);
    this._loadOneSource(SOURCE_MSOA, MSOA_GEOJSON_URL);
  }

  private _loadOneSource(sourceId: string, url: string): void {
    this.map.addSource(sourceId, { type: 'geojson', data: url });
    this._addLayersForSource(sourceId);

    const onSourceData = (e: { sourceId: string; isSourceLoaded: boolean }) => {
      if (e.sourceId !== sourceId || !e.isSourceLoaded) return;
      this.map.off('sourcedata', onSourceData as Parameters<typeof this.map.off>[1]);

      this.loadedSources.add(sourceId);
      if (this.loaded) {
        this.loading = false;
      }

      if (this.metric !== 'off') {
        this._setLayersVisibleForSource(sourceId, true);
        this._updateFillColorForSource(sourceId, this.metric);
      }
      this._emitState();
    };
    this.map.on('sourcedata', onSourceData as Parameters<typeof this.map.on>[1]);

    const onError = (e: { error?: { message?: string }; source?: { id?: string } }) => {
      const srcId = (e as { source?: { id?: string } }).source?.id;
      if (srcId && srcId !== sourceId) return;

      this.map.off('sourcedata', onSourceData as Parameters<typeof this.map.off>[1]);
      this.map.off('error', onError as Parameters<typeof this.map.off>[1]);
      this._removeSourceAndLayers(sourceId);

      this.loading = false;
      const raw = e.error?.message ?? '';
      this.error = (raw.includes('404') || raw.toLowerCase().includes('not found'))
        ? 'Boundary data not found. Run: npm run census-merge'
        : raw || 'Failed to load census boundaries';
      this._emitState();
    };
    this.map.on('error', onError as Parameters<typeof this.map.on>[1]);
  }

  private _addLayersForSource(sourceId: string): void {
    const beforeId = this.map.getLayer(INSERT_BEFORE_LAYER) ? INSERT_BEFORE_LAYER : undefined;

    const initMetric: Exclude<CensusMetric, 'off'> =
      this.metric !== 'off' ? this.metric : 'population';

    const isLsoa   = sourceId === SOURCE_LSOA;
    const fillId   = isLsoa ? LSOA_FILL : MSOA_FILL;
    const outlineId = isLsoa ? LSOA_OUTLINE : MSOA_OUTLINE;

    // LSOA shows at zoom ≥ threshold (city detail)
    // MSOA shows at zoom < threshold (regional overview)
    const zoomOpts = isLsoa
      ? { minzoom: ZOOM_THRESHOLD }
      : { maxzoom: ZOOM_THRESHOLD };

    this.map.addLayer(
      {
        id:     fillId,
        type:   'fill',
        source: sourceId,
        layout: { visibility: 'none' },
        ...zoomOpts,
        paint: {
          'fill-color':   FILL_COLORS[initMetric] as maplibregl.ExpressionSpecification,
          'fill-opacity': 0.72,
        },
      },
      beforeId,
    );

    this.map.addLayer(
      {
        id:     outlineId,
        type:   'line',
        source: sourceId,
        layout: { visibility: 'none' },
        ...zoomOpts,
        paint: {
          'line-color': 'rgba(0,0,0,0.18)',
          'line-width': 0.5,
        },
      },
      beforeId,
    );
  }

  private _removeSourceAndLayers(sourceId: string): void {
    const fillId    = sourceId === SOURCE_LSOA ? LSOA_FILL    : MSOA_FILL;
    const outlineId = sourceId === SOURCE_LSOA ? LSOA_OUTLINE : MSOA_OUTLINE;
    if (this.map.getLayer(outlineId)) this.map.removeLayer(outlineId);
    if (this.map.getLayer(fillId))    this.map.removeLayer(fillId);
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
  }

  private _removeSourcesAndLayers(): void {
    this._removeSourceAndLayers(SOURCE_LSOA);
    this._removeSourceAndLayers(SOURCE_MSOA);
  }

  private _setLayersVisibleForSource(sourceId: string, visible: boolean): void {
    const v = visible ? 'visible' : 'none';
    const fillId    = sourceId === SOURCE_LSOA ? LSOA_FILL    : MSOA_FILL;
    const outlineId = sourceId === SOURCE_LSOA ? LSOA_OUTLINE : MSOA_OUTLINE;
    if (this.map.getLayer(fillId))    this.map.setLayoutProperty(fillId,    'visibility', v);
    if (this.map.getLayer(outlineId)) this.map.setLayoutProperty(outlineId, 'visibility', v);
  }

  private _setLayersVisible(visible: boolean): void {
    this._setLayersVisibleForSource(SOURCE_LSOA, visible);
    this._setLayersVisibleForSource(SOURCE_MSOA, visible);
  }

  private _updateFillColorForSource(sourceId: string, metric: Exclude<CensusMetric, 'off'>): void {
    const fillId = sourceId === SOURCE_LSOA ? LSOA_FILL : MSOA_FILL;
    if (this.map.getLayer(fillId)) {
      this.map.setPaintProperty(
        fillId,
        'fill-color',
        FILL_COLORS[metric] as maplibregl.ExpressionSpecification,
      );
    }
  }

  private _updateFillColor(metric: Exclude<CensusMetric, 'off'>): void {
    this._updateFillColorForSource(SOURCE_LSOA, metric);
    this._updateFillColorForSource(SOURCE_MSOA, metric);
  }

  private _emitState(): void {
    this.onStateChange?.(this.getState());
  }
}
