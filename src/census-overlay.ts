import type { Map as MaplibreMap } from 'maplibre-gl';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CensusMetric =
  | 'off'
  // Demographics
  | 'population'
  | 'density'
  | 'working_age'
  | 'elderly'
  | 'youth'
  // Transport
  | 'no_car'
  | 'train_commuters'
  | 'bus_commuters'
  | 'drives_to_work'
  // Economic
  | 'economic_activity'
  | 'renters'
  // Accessibility
  | 'disability';

/** Category groupings for the accordion UI */
export interface MetricCategory {
  id: string;
  label: string;
  metrics: CensusMetric[];
}

export const METRIC_CATEGORIES: MetricCategory[] = [
  {
    id: 'demographics',
    label: 'Demographics',
    metrics: ['population', 'density', 'working_age', 'elderly', 'youth'],
  },
  {
    id: 'transport',
    label: 'Transport',
    metrics: ['no_car', 'train_commuters', 'bus_commuters', 'drives_to_work'],
  },
  {
    id: 'economic',
    label: 'Economic',
    metrics: ['economic_activity', 'renters'],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    metrics: ['disability'],
  },
];

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

const INSERT_BEFORE_LAYER = 'boundary-region';

const LSOA_GEOJSON_URL = '/data/lsoa_boundaries.geojson';
const MSOA_GEOJSON_URL = '/data/msoa_boundaries.geojson';

const ZOOM_THRESHOLD = 9;

// ── MapLibre data-driven paint expressions per metric ─────────────────────────
// Properties embedded by geography_processor.py via census_processor.py:
//   "pop"           — total usual residents
//   "work_pop"      — working-age population (15–64)
//   "elderly"       — residents aged 65+
//   "youth"         — residents aged 16–24
//   "no_car"        — households with no car/van
//   "households"    — total households
//   "travel_train"  — commuters using train
//   "travel_bus"    — commuters using bus/coach
//   "travel_drive"  — commuters driving a car/van
//   "travel_total"  — total commuters
//   "econ_active"   — economically active residents
//   "econ_total"    — total residents 16+
//   "renters"       — households renting
//   "disabled"      — residents with activity-limiting condition
//   "area_ha"       — polygon area in hectares

/** Safe percentage expression: (numerator / denominator * 100), returns 0 if denom is 0 */
function pctExpr(numProp: string, denomProp: string) {
  return [
    'case',
    ['>', ['to-number', ['get', denomProp], 0], 0],
    ['/', ['*', ['to-number', ['get', numProp], 0], 100], ['to-number', ['get', denomProp], 1]],
    0,
  ];
}

const FILL_COLORS: Record<Exclude<CensusMetric, 'off'>, unknown> = {

  // ── Demographics ───────────────────────────────────────────────────────────

  // Total population — blue ramp
  population: [
    'interpolate', ['linear'],
    ['to-number', ['get', 'pop'], 0],
    0, 'rgba(247,251,255,0.0)',  500, '#c6dbef',  1500, '#6baed6',
    2500, '#2171b5',  4000, '#08306b',
  ],

  // Population density (residents per hectare) — orange-brown ramp
  density: [
    'interpolate', ['linear'],
    ['/', ['to-number', ['get', 'pop'], 0],
          ['max', ['to-number', ['get', 'area_ha'], 1], 0.01]],
    0, 'rgba(255,247,188,0.0)',  5, '#fee391',  20, '#fe9929',
    60, '#cc4c02',  150, '#662506',
  ],

  // Working-age % (work_pop / pop * 100) — green ramp
  working_age: [
    'interpolate', ['linear'],
    pctExpr('work_pop', 'pop'),
    0, 'rgba(255,245,235,0.0)',  30, '#c7e9b4',  45, '#41b6c4',
    55, '#1d91c0',  70, '#0c2c84',
  ],

  // Elderly % (65+ / pop * 100) — purple ramp
  elderly: [
    'interpolate', ['linear'],
    pctExpr('elderly', 'pop'),
    0, 'rgba(252,251,253,0.0)',  10, '#cbc9e2',  20, '#9e9ac8',
    30, '#756bb1',  50, '#54278f',
  ],

  // Youth % (16–24 / pop * 100) — teal ramp
  youth: [
    'interpolate', ['linear'],
    pctExpr('youth', 'pop'),
    0, 'rgba(247,252,253,0.0)',  5, '#ccece6',  10, '#66c2a4',
    20, '#238b45',  40, '#00441b',
  ],

  // ── Transport ──────────────────────────────────────────────────────────────

  // No-car households % — red ramp (high = more transit-dependent)
  no_car: [
    'interpolate', ['linear'],
    pctExpr('no_car', 'households'),
    0, 'rgba(255,245,240,0.0)',  15, '#fcbba1',  30, '#fb6a4a',
    50, '#cb181d',  80, '#67000d',
  ],

  // Train commuters % — deep blue ramp
  train_commuters: [
    'interpolate', ['linear'],
    pctExpr('travel_train', 'travel_total'),
    0, 'rgba(247,251,255,0.0)',  2, '#c6dbef',  5, '#6baed6',
    15, '#2171b5',  40, '#08306b',
  ],

  // Bus commuters % — amber ramp
  bus_commuters: [
    'interpolate', ['linear'],
    pctExpr('travel_bus', 'travel_total'),
    0, 'rgba(255,255,229,0.0)',  5, '#fed976',  10, '#feb24c',
    20, '#f03b20',  40, '#bd0026',
  ],

  // Drives to work % — grey-steel ramp (high = potential to convert)
  drives_to_work: [
    'interpolate', ['linear'],
    pctExpr('travel_drive', 'travel_total'),
    0, 'rgba(247,247,247,0.0)',  30, '#d9d9d9',  50, '#969696',
    70, '#525252',  90, '#252525',
  ],

  // ── Economic ───────────────────────────────────────────────────────────────

  // Economic activity % — warm green ramp
  economic_activity: [
    'interpolate', ['linear'],
    pctExpr('econ_active', 'econ_total'),
    0, 'rgba(247,252,245,0.0)',  40, '#c7e9c0',  55, '#74c476',
    70, '#238b45',  90, '#00441b',
  ],

  // Renters % — pink-magenta ramp
  renters: [
    'interpolate', ['linear'],
    pctExpr('renters', 'households'),
    0, 'rgba(253,224,239,0.0)',  20, '#fcc5c0',  40, '#f768a1',
    60, '#c51b8a',  80, '#7a0177',
  ],

  // ── Accessibility ──────────────────────────────────────────────────────────

  // Disability % (activity-limited / pop * 100) — brown ramp
  disability: [
    'interpolate', ['linear'],
    pctExpr('disabled', 'pop'),
    0, 'rgba(255,247,243,0.0)',  10, '#fdd0a2',  20, '#f16913',
    35, '#d94801',  50, '#7f2704',
  ],
};

export const METRIC_LABELS: Record<CensusMetric, string> = {
  off:               'Off',
  population:        'Population',
  density:           'Density (pop/ha)',
  working_age:       'Working Age %',
  elderly:           'Elderly (65+) %',
  youth:             'Youth (16–24) %',
  no_car:            'No Car/Van %',
  train_commuters:   'Train Commuters %',
  bus_commuters:     'Bus Commuters %',
  drives_to_work:    'Drives to Work %',
  economic_activity: 'Economically Active %',
  renters:           'Renters %',
  disability:        'Disability %',
};

export interface LegendConfig {
  gradient: string;
  minLabel: string;
  maxLabel: string;
}

export const LEGEND_CONFIGS: Record<Exclude<CensusMetric, 'off'>, LegendConfig> = {
  population: {
    gradient: 'linear-gradient(to right, #c6dbef, #6baed6, #2171b5, #08306b)',
    minLabel: '0', maxLabel: '4,000+ residents',
  },
  density: {
    gradient: 'linear-gradient(to right, #fee391, #fe9929, #cc4c02, #662506)',
    minLabel: '0 /ha', maxLabel: '150+ /ha',
  },
  working_age: {
    gradient: 'linear-gradient(to right, #c7e9b4, #41b6c4, #1d91c0, #0c2c84)',
    minLabel: '30%', maxLabel: '70%',
  },
  elderly: {
    gradient: 'linear-gradient(to right, #cbc9e2, #9e9ac8, #756bb1, #54278f)',
    minLabel: '10%', maxLabel: '50%',
  },
  youth: {
    gradient: 'linear-gradient(to right, #ccece6, #66c2a4, #238b45, #00441b)',
    minLabel: '5%', maxLabel: '40%',
  },
  no_car: {
    gradient: 'linear-gradient(to right, #fcbba1, #fb6a4a, #cb181d, #67000d)',
    minLabel: '15%', maxLabel: '80%',
  },
  train_commuters: {
    gradient: 'linear-gradient(to right, #c6dbef, #6baed6, #2171b5, #08306b)',
    minLabel: '2%', maxLabel: '40%',
  },
  bus_commuters: {
    gradient: 'linear-gradient(to right, #fed976, #feb24c, #f03b20, #bd0026)',
    minLabel: '5%', maxLabel: '40%',
  },
  drives_to_work: {
    gradient: 'linear-gradient(to right, #d9d9d9, #969696, #525252, #252525)',
    minLabel: '30%', maxLabel: '90%',
  },
  economic_activity: {
    gradient: 'linear-gradient(to right, #c7e9c0, #74c476, #238b45, #00441b)',
    minLabel: '40%', maxLabel: '90%',
  },
  renters: {
    gradient: 'linear-gradient(to right, #fcc5c0, #f768a1, #c51b8a, #7a0177)',
    minLabel: '20%', maxLabel: '80%',
  },
  disability: {
    gradient: 'linear-gradient(to right, #fdd0a2, #f16913, #d94801, #7f2704)',
    minLabel: '10%', maxLabel: '50%',
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
