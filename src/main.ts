import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { mapStyle, applySchematicMode } from './map-style';
import { CensusOverlay, LEGEND_CONFIGS } from './census-overlay';
import type { CensusMetric, CensusOverlayState } from './census-overlay';
import { NetworkEditor } from './network-editor';
import type { EditorState } from './network-editor';
import { LINE_COLORS } from './network';
import type { NetworkExport } from './network';
import { validateNetworkExport } from './network';
import { fetchCatchmentStats, preloadLsoa, fetchLineCatchmentStats } from './station-manager';
import type { CatchmentStats } from './station-manager';
import { ROLLING_STOCK, ROLLING_STOCK_CATEGORIES, getRollingStock, computeLineStats } from './rolling-stock';
import type { RollingStock, LineTrainStats, JourneyProfileSegment } from './rolling-stock';
import { estimateLineDemand } from './line-demand';
import type { LineDemandModel } from './line-demand';
import { buildExportPreviewHTML, openExportPage } from './map-export';
import type { ExportStyle } from './map-export';

// Register the PMTiles custom protocol so MapLibre can load .pmtiles files
// via HTTP range-requests from a single static file.
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

const SVG_NS = 'http://www.w3.org/2000/svg';

type MotionPreset = 'panel' | 'drawer' | 'modal' | 'section' | 'badge';
type VisibilityStrategy = 'class' | 'display';

type VisibilityOptions = {
  preset: MotionPreset;
  strategy?: VisibilityStrategy;
  displayValue?: string;
  surfaceSelector?: string;
};

type ActiveVisibilityMotion = {
  token: symbol;
  animations: Animation[];
};

const COMPACT_PANEL_BREAKPOINT = 840;

type ResizeAxis = 'inline' | 'block' | 'both';
type ResizeHandleRole = 'corner' | 'edge-inline-start' | 'edge-block-start' | 'edge-block-end';
type ResizeLayoutMode = 'desktop' | 'mobile';

type ResizeLayoutConfig = {
  axis: ResizeAxis;
  handleRole: ResizeHandleRole;
  minInline?: number;
  maxInline?: (viewportWidth: number) => number;
  defaultInline?: number;
  minBlock?: number;
  maxBlock?: (viewportHeight: number) => number;
  defaultBlock?: number;
};

type ResizablePanelConfig = {
  storageKey: string;
  label: string;
  element: HTMLElement;
  inlineCssVar?: string;
  blockCssVar?: string;
  desktop: ResizeLayoutConfig;
  mobile: ResizeLayoutConfig;
};

type StoredPanelDimensions = Partial<Record<ResizeLayoutMode, { inline?: number; block?: number }>>;

const activeVisibilityMotions = new WeakMap<HTMLElement, ActiveVisibilityMotion>();

function getVisibilityMotion(
  preset: MotionPreset,
  visible: boolean,
): { duration: number; easing: string; root: Keyframe[]; surface?: Keyframe[] } {
  const enterEasing = 'cubic-bezier(0.22, 1.24, 0.36, 1)';
  const exitEasing = 'cubic-bezier(0.4, 0, 0.2, 1)';

  switch (preset) {
    case 'drawer':
      if (window.matchMedia(`(max-width: ${COMPACT_PANEL_BREAKPOINT}px)`).matches) {
        return {
          duration: visible ? 240 : 150,
          easing: visible ? enterEasing : exitEasing,
          root: visible
            ? [
                { opacity: 0, transform: 'translateY(34px) scale(0.985)' },
                { opacity: 1, transform: 'translateY(-6px) scale(1.01)', offset: 0.72 },
                { opacity: 1, transform: 'translateY(0) scale(1)' },
              ]
            : [
                { opacity: 1, transform: 'translateY(0) scale(1)' },
                { opacity: 0.78, transform: 'translateY(8px) scale(0.992)', offset: 0.45 },
                { opacity: 0, transform: 'translateY(28px) scale(0.97)' },
              ],
        };
      }

      return {
        duration: visible ? 240 : 150,
        easing: visible ? enterEasing : exitEasing,
        root: visible
          ? [
              { opacity: 0, transform: 'translateX(34px) scale(0.985)' },
              { opacity: 1, transform: 'translateX(-6px) scale(1.01)', offset: 0.72 },
              { opacity: 1, transform: 'translateX(0) scale(1)' },
            ]
          : [
              { opacity: 1, transform: 'translateX(0) scale(1)' },
              { opacity: 0.78, transform: 'translateX(8px) scale(0.992)', offset: 0.45 },
              { opacity: 0, transform: 'translateX(28px) scale(0.97)' },
            ],
      };

    case 'modal':
      return {
        duration: visible ? 220 : 150,
        easing: visible ? enterEasing : exitEasing,
        root: visible
          ? [
              { opacity: 0 },
              { opacity: 1 },
            ]
          : [
              { opacity: 1 },
              { opacity: 0 },
            ],
        surface: visible
          ? [
              { opacity: 0.25, transform: 'translateY(26px) scale(0.92)' },
              { opacity: 1, transform: 'translateY(-5px) scale(1.012)', offset: 0.72 },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ]
          : [
              { opacity: 1, transform: 'translateY(0) scale(1)' },
              { opacity: 0.72, transform: 'translateY(8px) scale(0.985)', offset: 0.45 },
              { opacity: 0, transform: 'translateY(22px) scale(0.95)' },
            ],
      };

    case 'badge':
      return {
        duration: visible ? 180 : 120,
        easing: visible ? enterEasing : exitEasing,
        root: visible
          ? [
              { opacity: 0, transform: 'translateY(8px) scale(0.9)' },
              { opacity: 1, transform: 'translateY(-2px) scale(1.04)', offset: 0.65 },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ]
          : [
              { opacity: 1, transform: 'translateY(0) scale(1)' },
              { opacity: 0, transform: 'translateY(6px) scale(0.92)' },
            ],
      };

    case 'section':
      return {
        duration: visible ? 190 : 130,
        easing: visible ? enterEasing : exitEasing,
        root: visible
          ? [
              { opacity: 0, transform: 'translateY(12px) scale(0.97)' },
              { opacity: 1, transform: 'translateY(-2px) scale(1.01)', offset: 0.68 },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ]
          : [
              { opacity: 1, transform: 'translateY(0) scale(1)' },
              { opacity: 0, transform: 'translateY(8px) scale(0.96)' },
            ],
      };

    case 'panel':
    default:
      return {
        duration: visible ? 210 : 140,
        easing: visible ? enterEasing : exitEasing,
        root: visible
          ? [
              { opacity: 0, transform: 'translateY(18px) scale(0.94)' },
              { opacity: 1, transform: 'translateY(-4px) scale(1.02)', offset: 0.7 },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ]
          : [
              { opacity: 1, transform: 'translateY(0) scale(1)' },
              { opacity: 0.72, transform: 'translateY(5px) scale(0.985)', offset: 0.45 },
              { opacity: 0, transform: 'translateY(14px) scale(0.95)' },
            ],
      };
  }
}

function setAnimatedVisibility(
  element: HTMLElement,
  visible: boolean,
  options: VisibilityOptions,
): void {
  const strategy = options.strategy ?? 'class';
  const hidden = strategy === 'class'
    ? element.classList.contains('hidden')
    : getComputedStyle(element).display === 'none';
  const state = element.dataset.motionState;

  if (visible) {
    if (state === 'entering' || state === 'open') return;
    if (!hidden && state !== 'exiting') return;
  } else {
    if (state === 'exiting' || state === 'closed') return;
    if (hidden && state !== 'entering') return;
  }

  const activeMotion = activeVisibilityMotions.get(element);
  if (activeMotion) {
    activeMotion.animations.forEach((animation) => animation.cancel());
    activeVisibilityMotions.delete(element);
  }

  if (visible) {
    if (strategy === 'class') {
      element.classList.remove('hidden');
    } else {
      element.style.display = options.displayValue ?? '';
    }
    element.setAttribute('aria-hidden', 'false');
  }

  element.dataset.motionState = visible ? 'entering' : 'exiting';
  element.style.pointerEvents = 'none';

  const motion = getVisibilityMotion(options.preset, visible);
  const animations: Animation[] = [
    element.animate(motion.root, {
      duration: motion.duration,
      easing: motion.easing,
      fill: 'both',
    }),
  ];

  const surface = options.surfaceSelector
    ? element.querySelector<HTMLElement>(options.surfaceSelector)
    : null;
  if (surface && motion.surface) {
    animations.push(surface.animate(motion.surface, {
      duration: motion.duration,
      easing: motion.easing,
      fill: 'both',
    }));
  }

  const token = Symbol();
  activeVisibilityMotions.set(element, { token, animations });

  void Promise.allSettled(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
    const currentMotion = activeVisibilityMotions.get(element);
    if (!currentMotion || currentMotion.token !== token) return;

    animations.forEach((animation) => animation.cancel());
    activeVisibilityMotions.delete(element);
    element.style.pointerEvents = '';

    if (visible) {
      element.dataset.motionState = 'open';
      return;
    }

    if (strategy === 'class') {
      element.classList.add('hidden');
    } else {
      element.style.display = 'none';
    }
    element.dataset.motionState = 'closed';
    element.setAttribute('aria-hidden', 'true');
  });
}

function showAnimatedClass(element: HTMLElement, preset: MotionPreset, surfaceSelector?: string): void {
  setAnimatedVisibility(element, true, { preset, surfaceSelector });
}

function hideAnimatedClass(element: HTMLElement, preset: MotionPreset, surfaceSelector?: string): void {
  setAnimatedVisibility(element, false, { preset, surfaceSelector });
}

function showAnimatedDisplay(element: HTMLElement, preset: MotionPreset, displayValue = ''): void {
  setAnimatedVisibility(element, true, { preset, strategy: 'display', displayValue });
}

function hideAnimatedDisplay(element: HTMLElement, preset: MotionPreset): void {
  setAnimatedVisibility(element, false, { preset, strategy: 'display' });
}

function resolveTilesUrl(configuredUrl: string | undefined): string {
  const fallbackUrl = `${window.location.origin}/tiles/uk.pmtiles`;
  if (!configuredUrl) return fallbackUrl;

  const trimmedUrl = configuredUrl.trim();
  if (!trimmedUrl) return fallbackUrl;

  const candidateUrl = /^[a-z]+:\/\//i.test(trimmedUrl)
    ? trimmedUrl
    : `https://${trimmedUrl}`;

  try {
    const parsedUrl = new URL(candidateUrl);
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '') {
      parsedUrl.pathname = '/uk.pmtiles';
    }
    return parsedUrl.toString();
  } catch {
    return fallbackUrl;
  }
}

// Tiles URL: use VITE_TILES_URL env var if set (e.g. Cloudflare R2 public bucket),
// otherwise fall back to the locally-served file for dev.
const tilesUrl = resolveTilesUrl(import.meta.env.VITE_TILES_URL as string | undefined);

const map = new maplibregl.Map({
  container: 'map',
  style: mapStyle(tilesUrl),
  center: [-2.0, 54.5],
  zoom: 5.5,
  minZoom: 4.5,
  maxZoom: 20,
  attributionControl: false, // we add our own compact one at bottom-left below
  // Bounds tightly wrap the British Isles region:
  // West: 11°W  — clear of the western coast of Ireland
  // East: 4°E   — into the southern North Sea (excludes Netherlands coast)
  // South: 48°N — well into the English Channel (includes Channel Islands)
  // North: 61.5°N — just above Shetland (61°N), below Faroe Islands (62°N)
  maxBounds: [[-11, 48], [4, 61.5]],
});

// Expose map + state on window for testing/debugging
const _w = window as unknown as Record<string, unknown>;
_w['__map'] = map;
_w['__mapState'] = 'init';
map.on('styledata', () => { _w['__mapState'] = 'styledata'; });
map.on('load',      () => { _w['__mapState'] = 'loaded'; });
map.on('error', (e) => {
  _w['__mapState'] = 'error:' + (e as { error?: { message?: string } }).error?.message;
});

map.addControl(
  new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }),
  'bottom-right',
);
map.addControl(
  new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' }),
  'bottom-right',
);
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

// Show a warning banner if the PMTiles file is missing
map.on('error', (e) => {
  const msg = (e as { error?: { message?: string } }).error?.message ?? '';
  if (msg.includes('uk.pmtiles') || msg.includes('Could not load')) {
    const el = document.getElementById('no-tiles-warning');
    if (el) el.style.display = 'block';
  }
});

// National rail lines — GeoJSON source (rail-overview-*) is visible at every zoom level.
// Heritage/service layers from PMTiles only appear at zoom 8/12+ where tile data exists.
const RAIL_LINE_LAYERS: { id: string; minzoom: number }[] = [
  { id: 'rail-overview-casing', minzoom: 0  },
  { id: 'rail-overview',        minzoom: 0  },
  { id: 'rail-overview-tunnel', minzoom: 4  },
  { id: 'rail-heritage',        minzoom: 8  },
  { id: 'rail-service',         minzoom: 12 },
  { id: 'rail-label',           minzoom: 13 },
];

// City metro / underground / tram lines (separate toggle).
const METRO_LINE_LAYERS: { id: string; minzoom: number }[] = [
  { id: 'rail-light-casing', minzoom: 6 },
  { id: 'rail-light',        minzoom: 6 },
  { id: 'rail-tram',         minzoom: 8 },
];

const RAIL_STATION_LAYERS: { id: string; minzoom: number }[] = [
  { id: 'naptan-station-mainline', minzoom: 5  },
  { id: 'naptan-station-metro',    minzoom: 7  },
  { id: 'naptan-label-mainline',   minzoom: 8  },
  { id: 'naptan-label-metro',      minzoom: 10 },
  { id: 'poi-transit',             minzoom: 9  },
];

function setLayerGroupVisible(
  layers: { id: string; minzoom: number }[],
  visible: boolean,
): void {
  layers.forEach(({ id, minzoom }) => {
    if (!map.getLayer(id)) return;
    // setLayerZoomRange(layerId, minzoom, maxzoom)
    // maxzoom 24 is MapLibre's effective maximum.
    map.setLayerZoomRange(id, visible ? minzoom : 25, 24);
  });
}

// Overlays panel wiring
map.on('load', () => {
  // Rail line toggle (national rail)
  (document.getElementById('toggle-rail-lines') as HTMLInputElement | null)
    ?.addEventListener('change', (e) => {
      setLayerGroupVisible(RAIL_LINE_LAYERS, (e.target as HTMLInputElement).checked);
    });

  // City metro / tram toggle
  (document.getElementById('toggle-metro-lines') as HTMLInputElement | null)
    ?.addEventListener('change', (e) => {
      setLayerGroupVisible(METRO_LINE_LAYERS, (e.target as HTMLInputElement).checked);
    });

  // Rail station toggle
  (document.getElementById('toggle-rail-stations') as HTMLInputElement | null)
    ?.addEventListener('change', (e) => {
      setLayerGroupVisible(RAIL_STATION_LAYERS, (e.target as HTMLInputElement).checked);
    });

  // ── Zoom level hotlinks ────────────────────────────────────────────────
  const zoomLinks = document.querySelectorAll<HTMLButtonElement>('.zoom-link');

  function updateZoomLinkActive(): void {
    const currentZoom = map.getZoom();
    // Find the button whose zoom level is closest to the current zoom
    let closest: HTMLButtonElement | null = null;
    let closestDist = Infinity;
    zoomLinks.forEach((btn) => {
      const target = parseFloat(btn.dataset.zoom ?? '0');
      const dist = Math.abs(target - currentZoom);
      if (dist < closestDist) { closestDist = dist; closest = btn; }
    });
    // Only highlight if within ±1.5 zoom levels of a hotlink
    zoomLinks.forEach((btn) => {
      btn.classList.toggle('active', btn === closest && closestDist < 1.5);
    });
  }

  zoomLinks.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = parseFloat(btn.dataset.zoom ?? '5.5');
      map.easeTo({ zoom: target, duration: 600, easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t });
    });
  });

  // Keep active state in sync as the user zooms
  map.on('zoom', updateZoomLinkActive);
  updateZoomLinkActive();

  // Census overlay
  const overlay = new CensusOverlay(map, updateCensusUI);
  _w['__censusOverlay'] = overlay;

  // Pre-warm LSOA data so Station Manager loads fast
  preloadLsoa();

  document.querySelectorAll<HTMLInputElement>('input[name="census-metric"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      overlay.setMetric(radio.value as CensusMetric);
    });
  });

  // ── View toggle (Detailed / Schematic) ─────────────────────────────────
  let schematicMode = false;
  const btnDetailed   = document.getElementById('view-btn-detailed')!;
  const btnSchematic  = document.getElementById('view-btn-schematic')!;

  btnSchematic.addEventListener('click', () => {
    if (schematicMode) return;
    schematicMode = true;
    applySchematicMode(map, true);
    btnSchematic.classList.add('view-btn--active');
    btnDetailed.classList.remove('view-btn--active');
  });

  btnDetailed.addEventListener('click', () => {
    if (!schematicMode) return;
    schematicMode = false;
    applySchematicMode(map, false);
    btnDetailed.classList.add('view-btn--active');
    btnSchematic.classList.remove('view-btn--active');
  });

  // ── Network editor ──────────────────────────────────────────────────────
  //
  // updateNetworkUI / renderLineList are declared before the editor so they
  // can be passed as callbacks, but they use `editor` which is assigned
  // immediately after construction. The constructor no longer calls _emit(),
  // so these functions are never invoked before `editor` is assigned.

  // eslint-disable-next-line prefer-const
  let editor!: NetworkEditor;

  // ── Panel element references ────────────────────────────────────────────
  const smEl = document.getElementById('station-manager')!;
  const lmEl = document.getElementById('line-manager')!;
  const linePanelEl = document.getElementById('line-panel')!;
  const trainPickerModalEl = document.getElementById('train-picker-modal')!;
  const importModalEl = document.getElementById('import-modal')!;
  const journeyProfileModalEl = document.getElementById('journey-profile-modal')!;
  const lineDemandModalEl = document.getElementById('line-demand-modal')!;
  const journeyProfileChartEl = document.getElementById('journey-profile-chart')!;
  const journeyProfileTooltipEl = document.getElementById('journey-profile-tooltip')!;
  const journeyProfileHoverReadoutEl = document.getElementById('journey-profile-hover-readout')!;
  const panelRoot = document.documentElement;
  const compactPanelsQuery = window.matchMedia(`(max-width: ${COMPACT_PANEL_BREAKPOINT}px)`);
  const panelSizeCache = new Map<string, StoredPanelDimensions>();

  function getResizeMode(): ResizeLayoutMode {
    return compactPanelsQuery.matches ? 'mobile' : 'desktop';
  }

  function getResizeLayout(config: ResizablePanelConfig, mode = getResizeMode()): ResizeLayoutConfig {
    return mode === 'mobile' ? config.mobile : config.desktop;
  }

  function loadStoredPanelDimensions(storageKey: string): StoredPanelDimensions {
    const cached = panelSizeCache.get(storageKey);
    if (cached) return cached;

    try {
      const raw = window.localStorage.getItem(`hst.panel.${storageKey}`);
      const parsed = raw ? JSON.parse(raw) as StoredPanelDimensions : {};
      panelSizeCache.set(storageKey, parsed);
      return parsed;
    } catch {
      const fallback: StoredPanelDimensions = {};
      panelSizeCache.set(storageKey, fallback);
      return fallback;
    }
  }

  function saveStoredPanelDimensions(storageKey: string, dimensions: StoredPanelDimensions): void {
    panelSizeCache.set(storageKey, dimensions);
    try {
      window.localStorage.setItem(`hst.panel.${storageKey}`, JSON.stringify(dimensions));
    } catch {
      // Ignore storage failures; resizing should still work for the current session.
    }
  }

  function applyPanelDimensions(
    config: ResizablePanelConfig,
    dimensions: { inline?: number; block?: number },
    persist = false,
    forcedMode?: ResizeLayoutMode,
  ): void {
    const mode = forcedMode ?? getResizeMode();
    const layout = getResizeLayout(config, mode);
    const current = loadStoredPanelDimensions(config.storageKey);
    const nextForMode = { ...(current[mode] ?? {}) };

    if (config.inlineCssVar && layout.axis !== 'block') {
      const baseInline = dimensions.inline ?? nextForMode.inline ?? layout.defaultInline;
      if (typeof baseInline === 'number') {
        const maxInline = layout.maxInline?.(window.innerWidth) ?? baseInline;
        const clampedInline = clamp(baseInline, layout.minInline ?? baseInline, maxInline);
        panelRoot.style.setProperty(config.inlineCssVar, `${clampedInline}px`);
        nextForMode.inline = clampedInline;
      }
    }

    if (config.blockCssVar && layout.axis !== 'inline') {
      const baseBlock = dimensions.block ?? nextForMode.block ?? layout.defaultBlock;
      if (typeof baseBlock === 'number') {
        const maxBlock = layout.maxBlock?.(window.innerHeight) ?? baseBlock;
        const clampedBlock = clamp(baseBlock, layout.minBlock ?? baseBlock, maxBlock);
        panelRoot.style.setProperty(config.blockCssVar, `${clampedBlock}px`);
        nextForMode.block = clampedBlock;
      }
    }

    if (!persist) return;

    saveStoredPanelDimensions(config.storageKey, {
      ...current,
      [mode]: nextForMode,
    });
  }

  function getInlinePointerDelta(role: ResizeHandleRole, deltaX: number): number {
    return role === 'edge-inline-start' ? -deltaX : deltaX;
  }

  function getBlockPointerDelta(role: ResizeHandleRole, deltaY: number): number {
    return role === 'edge-block-start' ? -deltaY : deltaY;
  }

  function getBlockKeyboardDelta(role: ResizeHandleRole, key: string, step: number): number | null {
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;

    if (role === 'edge-block-start') {
      return key === 'ArrowUp' ? step : -step;
    }

    return key === 'ArrowDown' ? step : -step;
  }

  function setupResizablePanel(config: ResizablePanelConfig): void {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'panel-resize-handle';
    handle.setAttribute('role', 'separator');
    config.element.appendChild(handle);

    const syncHandle = (): void => {
      const layout = getResizeLayout(config);
      handle.dataset.resizeRole = layout.handleRole;
      handle.title = `Resize ${config.label}`;
      handle.setAttribute('aria-label', `Resize ${config.label}`);
      handle.setAttribute('aria-orientation', layout.axis === 'block' ? 'horizontal' : 'vertical');
    };

    const syncLayout = (): void => {
      const mode = getResizeMode();
      const layout = getResizeLayout(config, mode);
      const stored = loadStoredPanelDimensions(config.storageKey)[mode] ?? {};

      applyPanelDimensions(config, {
        inline: stored.inline ?? layout.defaultInline,
        block: stored.block ?? layout.defaultBlock,
      }, false, mode);
      syncHandle();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const mode = getResizeMode();
      const layout = getResizeLayout(config, mode);
      const startRect = config.element.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;

      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('panel-resizing');
      config.element.classList.add('is-resizing');
      handle.dataset.resizeActive = 'true';

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const nextDimensions: { inline?: number; block?: number } = {};

        if (layout.axis !== 'block') {
          nextDimensions.inline = startRect.width + getInlinePointerDelta(layout.handleRole, moveEvent.clientX - startX);
        }

        if (layout.axis !== 'inline') {
          nextDimensions.block = startRect.height + getBlockPointerDelta(layout.handleRole, moveEvent.clientY - startY);
        }

        applyPanelDimensions(config, nextDimensions, false, mode);
      };

      const finishResize = (): void => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        document.body.classList.remove('panel-resizing');
        config.element.classList.remove('is-resizing');
        delete handle.dataset.resizeActive;

        applyPanelDimensions(config, {
          inline: config.element.getBoundingClientRect().width,
          block: config.element.getBoundingClientRect().height,
        }, true, mode);
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', finishResize, { once: true });
      handle.addEventListener('pointercancel', finishResize, { once: true });
    });

    handle.addEventListener('keydown', (event) => {
      const layout = getResizeLayout(config);
      const step = event.shiftKey ? 40 : 16;
      const rect = config.element.getBoundingClientRect();
      const nextDimensions: { inline?: number; block?: number } = {
        inline: rect.width,
        block: rect.height,
      };
      let handled = false;

      if (layout.axis !== 'block' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        nextDimensions.inline = rect.width + (event.key === 'ArrowRight' ? step : -step);
        handled = true;
      }

      if (layout.axis !== 'inline') {
        const blockDelta = getBlockKeyboardDelta(layout.handleRole, event.key, step);
        if (blockDelta !== null) {
          nextDimensions.block = rect.height + blockDelta;
          handled = true;
        }
      }

      if (!handled) return;

      event.preventDefault();
      applyPanelDimensions(config, nextDimensions, true);
    });

    syncLayout();
    compactPanelsQuery.addEventListener('change', syncLayout);
    window.addEventListener('resize', syncLayout);
  }

  setupResizablePanel({
    storageKey: 'overlays-panel',
    label: 'Overlays panel',
    element: document.getElementById('overlays-panel') as HTMLElement,
    inlineCssVar: '--overlays-width',
    blockCssVar: '--overlays-height',
    desktop: {
      axis: 'both',
      handleRole: 'corner',
      minInline: 212,
      maxInline: (viewportWidth) => Math.max(212, Math.min(380, viewportWidth - 32)),
      defaultInline: 272,
      minBlock: 260,
      maxBlock: (viewportHeight) => Math.max(260, viewportHeight - 136),
      defaultBlock: 540,
    },
    mobile: {
      axis: 'block',
      handleRole: 'edge-block-end',
      minBlock: 196,
      maxBlock: (viewportHeight) => Math.max(196, viewportHeight - 264),
      defaultBlock: 320,
    },
  });

  setupResizablePanel({
    storageKey: 'line-panel',
    label: 'Line panel',
    element: linePanelEl,
    inlineCssVar: '--line-panel-width',
    blockCssVar: '--line-panel-height',
    desktop: {
      axis: 'both',
      handleRole: 'corner',
      minInline: 220,
      maxInline: (viewportWidth) => Math.max(220, Math.min(400, viewportWidth - 32)),
      defaultInline: 296,
      minBlock: 250,
      maxBlock: (viewportHeight) => Math.max(250, viewportHeight - 164),
      defaultBlock: 420,
    },
    mobile: {
      axis: 'block',
      handleRole: 'edge-block-start',
      minBlock: 220,
      maxBlock: (viewportHeight) => Math.max(220, viewportHeight - 286),
      defaultBlock: 300,
    },
  });

  setupResizablePanel({
    storageKey: 'station-manager',
    label: 'Station Manager',
    element: smEl,
    inlineCssVar: '--station-manager-width',
    blockCssVar: '--station-manager-height',
    desktop: {
      axis: 'inline',
      handleRole: 'edge-inline-start',
      minInline: 260,
      maxInline: (viewportWidth) => Math.max(260, Math.min(440, Math.round(viewportWidth * 0.42))),
      defaultInline: 300,
    },
    mobile: {
      axis: 'block',
      handleRole: 'edge-block-start',
      minBlock: 220,
      maxBlock: (viewportHeight) => Math.max(220, viewportHeight - 226),
      defaultBlock: 300,
    },
  });

  setupResizablePanel({
    storageKey: 'line-manager',
    label: 'Line Manager',
    element: lmEl,
    inlineCssVar: '--line-manager-width',
    blockCssVar: '--line-manager-height',
    desktop: {
      axis: 'inline',
      handleRole: 'edge-inline-start',
      minInline: 280,
      maxInline: (viewportWidth) => Math.max(280, Math.min(480, Math.round(viewportWidth * 0.48))),
      defaultInline: 340,
    },
    mobile: {
      axis: 'block',
      handleRole: 'edge-block-start',
      minBlock: 240,
      maxBlock: (viewportHeight) => Math.max(240, viewportHeight - 226),
      defaultBlock: 360,
    },
  });

  // ── Line Manager helpers ────────────────────────────────────────────────

  let openLineId: string | null = null;
  let openJourneyProfileLineId: string | null = null;
  let openLineDemandLineId: string | null = null;
  /** Stable signature of station IDs for the open line — used to gate census re-fetches. */
  let openLineStopSig = '';
  let lmDragSourceIndex: number | null = null;
  let lmSuppressStopClick = false;
  const lineCatchmentStatsByLine = new Map<string, CatchmentStats | null>();

  function closeLineManager(): void {
    hideAnimatedClass(lmEl, 'drawer');
    smEl.classList.remove('lm-open');
    closeJourneyProfileModal();
    closeLineDemandModal();
    openLineId = null;
    openLineStopSig = '';
  }

  function getLineCatchmentStats(lineId: string): CatchmentStats | null {
    return lineCatchmentStatsByLine.get(lineId) ?? null;
  }

  function renderLmSwatches(lineId: string): void {
    const line = editor.network.getLine(lineId);
    if (!line) return;
    const container = document.getElementById('lm-color-swatches')!;
    container.innerHTML = '';
    LINE_COLORS.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'lm-swatch' + (c === line.color ? ' selected' : '');
      sw.style.background = c;
      sw.addEventListener('click', () => {
        editor.network.setLineColor(lineId, c);
        renderLmSwatches(lineId);
        renderLmHeader(lineId);
        renderLineList(editor.getState());
      });
      container.appendChild(sw);
    });
  }

  function renderLmHeader(lineId: string): void {
    const line = editor.network.getLine(lineId);
    if (!line) return;
    const icon = document.getElementById('line-manager-icon')!;
    icon.style.color = line.color;
    icon.style.opacity = '1';
    renderLmTotalTime(lineId);
  }

  function formatDurationLabel(minutes: number): string {
    const rounded = Math.max(1, Math.round(minutes));
    if (rounded >= 60) {
      const hours = Math.floor(rounded / 60);
      const mins = rounded % 60;
      return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
    }
    return `${rounded} min`;
  }

  function formatElapsedTimeLabel(totalSeconds: number): string {
    const roundedSeconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(roundedSeconds / 3600);
    const minutes = Math.floor((roundedSeconds % 3600) / 60);
    const seconds = roundedSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatJourneyPhaseLabel(phase: JourneyProfileSegment['phase']): string {
    switch (phase) {
      case 'accelerating':
        return 'Accelerating';
      case 'cruising':
        return 'Cruising';
      case 'braking':
        return 'Braking';
      case 'dwell':
        return 'Dwelling';
      default:
        return 'Moving';
    }
  }

  function createSvgElement<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string>,
  ): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    return element;
  }

  function niceCeiling(value: number, step: number): number {
    return Math.max(step, Math.ceil(value / step) * step);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function formatAxisTimeLabel(totalSeconds: number): string {
    const roundedMinutes = Math.round(totalSeconds / 60);
    if (roundedMinutes >= 60) {
      const hours = Math.floor(roundedMinutes / 60);
      const minutes = roundedMinutes % 60;
      return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
    }

    return `${roundedMinutes}m`;
  }

  function getJourneySampleAtTime(stats: LineTrainStats, timeSec: number) {
    const lastPoint = stats.profilePoints[stats.profilePoints.length - 1];
    const boundedTimeSec = clamp(timeSec, 0, lastPoint?.timeSec ?? 0);
    const fallbackSegment = stats.profileSegments[stats.profileSegments.length - 1];

    let activeSegment = fallbackSegment;
    for (const segment of stats.profileSegments) {
      if (boundedTimeSec <= segment.endTimeSec) {
        activeSegment = segment;
        break;
      }
    }

    if (!activeSegment) {
      return {
        timeSec: boundedTimeSec,
        speedKmh: 0,
        distanceKm: 0,
        segment: null,
      };
    }

    const durationSec = activeSegment.endTimeSec - activeSegment.startTimeSec;
    const progress = durationSec <= 0 ? 0 : clamp((boundedTimeSec - activeSegment.startTimeSec) / durationSec, 0, 1);

    return {
      timeSec: boundedTimeSec,
      speedKmh: activeSegment.startSpeedKmh + ((activeSegment.endSpeedKmh - activeSegment.startSpeedKmh) * progress),
      distanceKm: activeSegment.startDistanceKm + ((activeSegment.endDistanceKm - activeSegment.startDistanceKm) * progress),
      segment: activeSegment,
    };
  }

  function renderJourneyProfileStops(stats: LineTrainStats, lineColor: string): void {
    const container = document.getElementById('journey-profile-stops')!;
    container.innerHTML = '';

    stats.stationStops.forEach((stop, index) => {
      const item = document.createElement('div');
      item.className = 'journey-profile-stop';
      item.style.setProperty('--journey-stop-accent', lineColor);

      const title = document.createElement('div');
      title.className = 'journey-profile-stop-title';
      title.textContent = stop.name;

      const meta = document.createElement('div');
      meta.className = 'journey-profile-stop-meta';
      if (index === 0) {
        meta.textContent = `Depart ${formatElapsedTimeLabel(stop.departureTimeSec)}`;
      } else if (index === stats.stationStops.length - 1) {
        meta.textContent = `Arrive ${formatElapsedTimeLabel(stop.arrivalTimeSec)}`;
      } else {
        meta.textContent = `Arrive ${formatElapsedTimeLabel(stop.arrivalTimeSec)} · Dwell ${stop.dwellTimeSec}s`;
      }

      const distance = document.createElement('div');
      distance.className = 'journey-profile-stop-distance';
      distance.textContent = `${stop.distanceKm.toFixed(1)} km`;

      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(distance);
      container.appendChild(item);
    });
  }

  function renderJourneyProfileChart(lineColor: string, stats: LineTrainStats): void {
    const svg = document.getElementById('journey-profile-svg');
    if (!(svg instanceof SVGSVGElement)) return;
    svg.replaceChildren();
    journeyProfileTooltipEl.replaceChildren();
    journeyProfileTooltipEl.classList.add('hidden');
    journeyProfileHoverReadoutEl.textContent = 'Hover the curve for details';
    journeyProfileChartEl.style.setProperty('--journey-line-color', lineColor);

    const tooltipTitle = document.createElement('div');
    tooltipTitle.className = 'journey-profile-tooltip-title';
    const tooltipValue = document.createElement('div');
    tooltipValue.className = 'journey-profile-tooltip-value';
    const tooltipMeta = document.createElement('div');
    tooltipMeta.className = 'journey-profile-tooltip-meta';
    journeyProfileTooltipEl.appendChild(tooltipTitle);
    journeyProfileTooltipEl.appendChild(tooltipValue);
    journeyProfileTooltipEl.appendChild(tooltipMeta);

    const width = 760;
    const height = 360;
    const padding = { top: 24, right: 22, bottom: 44, left: 60 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const points = stats.profilePoints;
    const lastPoint = points[points.length - 1];
    const totalTimeSec = Math.max(lastPoint?.timeSec ?? 0, 1);
    const maxSpeedKmh = niceCeiling(Math.max(stats.maxReachedSpeedKmh * 1.1, 40), 20);

    const x = (timeSec: number) => padding.left + ((timeSec / totalTimeSec) * plotWidth);
    const y = (speedKmh: number) => padding.top + plotHeight - ((speedKmh / maxSpeedKmh) * plotHeight);

    const defs = createSvgElement('defs', {});
    const gradient = createSvgElement('linearGradient', {
      id: 'journey-profile-area-gradient',
      x1: '0',
      x2: '0',
      y1: '0',
      y2: '1',
    });
    gradient.appendChild(createSvgElement('stop', {
      offset: '0%',
      'stop-color': lineColor,
      'stop-opacity': '0.28',
    }));
    gradient.appendChild(createSvgElement('stop', {
      offset: '100%',
      'stop-color': lineColor,
      'stop-opacity': '0',
    }));
    defs.appendChild(gradient);
    svg.appendChild(defs);

    stats.stationStops
      .filter((stop) => stop.dwellTimeSec > 0)
      .forEach((stop) => {
        const dwellRect = createSvgElement('rect', {
          x: `${x(stop.arrivalTimeSec)}`,
          y: `${padding.top}`,
          width: `${Math.max(1, x(stop.departureTimeSec) - x(stop.arrivalTimeSec))}`,
          height: `${plotHeight}`,
          fill: lineColor,
          opacity: '0.06',
          rx: '4',
        });
        svg.appendChild(dwellRect);
      });

    for (let index = 0; index <= 5; index++) {
      const speed = (maxSpeedKmh / 5) * index;
      const yPos = y(speed);
      svg.appendChild(createSvgElement('line', {
        x1: `${padding.left}`,
        y1: `${yPos}`,
        x2: `${width - padding.right}`,
        y2: `${yPos}`,
        stroke: 'rgba(34, 49, 63, 0.12)',
        'stroke-width': '1',
      }));
      const speedLabel = createSvgElement('text', {
        x: `${padding.left - 12}`,
        y: `${yPos + 4}`,
        fill: '#687186',
        'font-size': '11',
        'text-anchor': 'end',
      });
      speedLabel.textContent = `${Math.round(speed)}`;
      svg.appendChild(speedLabel);
    }

    for (let index = 0; index <= 5; index++) {
      const timeSec = (totalTimeSec / 5) * index;
      const xPos = x(timeSec);
      svg.appendChild(createSvgElement('line', {
        x1: `${xPos}`,
        y1: `${padding.top}`,
        x2: `${xPos}`,
        y2: `${height - padding.bottom}`,
        stroke: 'rgba(34, 49, 63, 0.08)',
        'stroke-width': '1',
        'stroke-dasharray': index === 0 || index === 5 ? '0' : '3 5',
      }));
      const timeLabel = createSvgElement('text', {
        x: `${xPos}`,
        y: `${height - 14}`,
        fill: '#687186',
        'font-size': '11',
        'text-anchor': index === 0 ? 'start' : index === 5 ? 'end' : 'middle',
      });
      timeLabel.textContent = formatAxisTimeLabel(timeSec);
      svg.appendChild(timeLabel);
    }

    stats.stationStops.forEach((stop) => {
      const xPos = x(stop.arrivalTimeSec);
      svg.appendChild(createSvgElement('line', {
        x1: `${xPos}`,
        y1: `${height - padding.bottom}`,
        x2: `${xPos}`,
        y2: `${height - padding.bottom + 6}`,
        stroke: lineColor,
        'stroke-width': '1.5',
        opacity: '0.6',
      }));
    });

    const pathPoints = points.map((point) => `${x(point.timeSec)} ${y(point.speedKmh)}`).join(' L ');
    const areaPath = createSvgElement('path', {
      d: `M ${x(points[0]?.timeSec ?? 0)} ${y(0)} L ${pathPoints} L ${x(lastPoint?.timeSec ?? 0)} ${y(0)} Z`,
      fill: 'url(#journey-profile-area-gradient)',
    });
    svg.appendChild(areaPath);

    const linePath = createSvgElement('path', {
      d: `M ${pathPoints}`,
      fill: 'none',
      stroke: lineColor,
      'stroke-width': '4',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    svg.appendChild(linePath);

    points.forEach((point, index) => {
      const pointMarker = createSvgElement('circle', {
        cx: `${x(point.timeSec)}`,
        cy: `${y(point.speedKmh)}`,
        r: index === 0 || index === points.length - 1 ? '4' : '3.5',
        fill: '#fffcf4',
        stroke: lineColor,
        'stroke-width': '2',
      });
      svg.appendChild(pointMarker);
    });

    const hoverGuide = createSvgElement('line', {
      x1: `${padding.left}`,
      y1: `${padding.top}`,
      x2: `${padding.left}`,
      y2: `${height - padding.bottom}`,
      stroke: '#2a3242',
      'stroke-width': '1',
      'stroke-dasharray': '4 4',
      opacity: '0',
    });
    const hoverDot = createSvgElement('circle', {
      cx: `${padding.left}`,
      cy: `${height - padding.bottom}`,
      r: '6',
      fill: '#fffcf4',
      stroke: lineColor,
      'stroke-width': '3',
      opacity: '0',
    });
    svg.appendChild(hoverGuide);
    svg.appendChild(hoverDot);

    const xAxisLabel = createSvgElement('text', {
      x: `${padding.left + (plotWidth / 2)}`,
      y: `${height - 2}`,
      fill: '#425067',
      'font-size': '12',
      'font-weight': '600',
      'text-anchor': 'middle',
    });
    xAxisLabel.textContent = 'Elapsed time';
    svg.appendChild(xAxisLabel);

    const yAxisLabel = createSvgElement('text', {
      x: '16',
      y: `${padding.top + (plotHeight / 2)}`,
      fill: '#425067',
      'font-size': '12',
      'font-weight': '600',
      transform: `rotate(-90 16 ${padding.top + (plotHeight / 2)})`,
      'text-anchor': 'middle',
    });
    yAxisLabel.textContent = 'Speed (km/h)';
    svg.appendChild(yAxisLabel);

    const hoverCapture = createSvgElement('rect', {
      x: `${padding.left}`,
      y: `${padding.top}`,
      width: `${plotWidth}`,
      height: `${plotHeight}`,
      fill: 'transparent',
      'pointer-events': 'all',
    });
    svg.appendChild(hoverCapture);

    const hideHoverState = (): void => {
      hoverGuide.setAttribute('opacity', '0');
      hoverDot.setAttribute('opacity', '0');
      journeyProfileTooltipEl.classList.add('hidden');
      journeyProfileHoverReadoutEl.textContent = 'Hover the curve for details';
    };

    const updateHoverState = (event: PointerEvent): void => {
      const rect = journeyProfileChartEl.getBoundingClientRect();
      const localX = clamp(event.clientX - rect.left, 0, rect.width);
      const normalizedX = clamp(localX, (padding.left / width) * rect.width, ((width - padding.right) / width) * rect.width);
      const timeSec = ((normalizedX - ((padding.left / width) * rect.width)) / ((plotWidth / width) * rect.width)) * totalTimeSec;
      const sample = getJourneySampleAtTime(stats, timeSec);
      if (!sample.segment) {
        hideHoverState();
        return;
      }

      const dotX = x(sample.timeSec);
      const dotY = y(sample.speedKmh);
      hoverGuide.setAttribute('x1', `${dotX}`);
      hoverGuide.setAttribute('x2', `${dotX}`);
      hoverGuide.setAttribute('opacity', '1');
      hoverDot.setAttribute('cx', `${dotX}`);
      hoverDot.setAttribute('cy', `${dotY}`);
      hoverDot.setAttribute('opacity', '1');

      const phaseLabel = formatJourneyPhaseLabel(sample.segment.phase);
      const segmentLabel = sample.segment.phase === 'dwell'
        ? `Dwell at ${sample.segment.fromStationName ?? 'Station'}`
        : `${sample.segment.fromStationName ?? 'Origin'} → ${sample.segment.toStationName ?? 'Destination'}`;

      journeyProfileHoverReadoutEl.textContent = `${formatElapsedTimeLabel(sample.timeSec)} · ${Math.round(sample.speedKmh)} km/h · ${phaseLabel}`;
      tooltipTitle.textContent = segmentLabel;
      tooltipValue.textContent = `${Math.round(sample.speedKmh)} km/h at ${formatElapsedTimeLabel(sample.timeSec)}`;
      tooltipMeta.textContent = `${phaseLabel} · ${sample.distanceKm.toFixed(1)} km from origin`;

      journeyProfileTooltipEl.classList.remove('hidden');
      const pixelY = (dotY / height) * rect.height;
      const tooltipWidth = journeyProfileTooltipEl.offsetWidth;
      const tooltipHeight = journeyProfileTooltipEl.offsetHeight;
      let tooltipLeft = localX + 18;
      if (tooltipLeft + tooltipWidth > rect.width - 10) {
        tooltipLeft = localX - tooltipWidth - 18;
      }
      const tooltipTop = clamp(pixelY - (tooltipHeight / 2), 10, rect.height - tooltipHeight - 10);
      journeyProfileTooltipEl.style.left = `${tooltipLeft}px`;
      journeyProfileTooltipEl.style.top = `${tooltipTop}px`;
    };

    hoverCapture.addEventListener('pointermove', updateHoverState);
    hoverCapture.addEventListener('pointerenter', updateHoverState);
    hoverCapture.addEventListener('pointerleave', hideHoverState);
  }

  function renderJourneyProfileModal(lineId: string): void {
    const line = editor.network.getLine(lineId);
    const stats = getLineTravelStats(lineId);
    if (!line || !stats) {
      closeJourneyProfileModal();
      return;
    }

    const stock = line.rollingStockId ? getRollingStock(line.rollingStockId) : null;
    const origin = stats.stationStops[0]?.name ?? 'Origin';
    const destination = stats.stationStops[stats.stationStops.length - 1]?.name ?? 'Destination';
    const intermediateStops = Math.max(0, stats.stationStops.length - 2);
    const modalBox = journeyProfileModalEl.querySelector<HTMLElement>('.journey-profile-box');
    modalBox?.style.setProperty('--journey-line-color', line.color);

    document.getElementById('journey-profile-subtitle')!.textContent = stock
      ? `${line.name} · ${stock.designation} ${stock.name}`
      : line.name;
    document.getElementById('journey-profile-summary')!.textContent = `${origin} to ${destination} over ${stats.totalDistanceKm.toFixed(1)} km, with ${intermediateStops} intermediate stop${intermediateStops === 1 ? '' : 's'}${stats.dwellTimeMin > 0 ? ` and ${formatDurationLabel(stats.dwellTimeMin)} of scheduled dwell time.` : '.'}`;
    document.getElementById('journey-profile-total-time')!.textContent = formatDurationLabel(stats.totalTimeMin);
    document.getElementById('journey-profile-running-time')!.textContent = formatDurationLabel(stats.runningTimeMin);
    document.getElementById('journey-profile-peak-speed')!.textContent = `${Math.round(stats.maxReachedSpeedKmh)} km/h`;
    document.getElementById('journey-profile-stop-count')!.textContent = `${stats.stationStops.length}`;

    renderJourneyProfileChart(line.color, stats);
    renderJourneyProfileStops(stats, line.color);
  }

  function openJourneyProfileModal(lineId: string): void {
    const stats = getLineTravelStats(lineId);
    if (!stats) return;

    openJourneyProfileLineId = lineId;
    renderJourneyProfileModal(lineId);
    showAnimatedClass(journeyProfileModalEl, 'modal', '.journey-profile-box');
  }

  function closeJourneyProfileModal(): void {
    hideAnimatedClass(journeyProfileModalEl, 'modal', '.journey-profile-box');
    journeyProfileTooltipEl.classList.add('hidden');
    journeyProfileHoverReadoutEl.textContent = 'Hover the curve for details';
    openJourneyProfileLineId = null;
  }

  function refreshJourneyProfileModal(): void {
    if (!openJourneyProfileLineId) return;

    const line = editor.network.getLine(openJourneyProfileLineId);
    if (!line) {
      closeJourneyProfileModal();
      return;
    }

    const stats = getLineTravelStats(openJourneyProfileLineId);
    if (!stats) {
      closeJourneyProfileModal();
      return;
    }

    renderJourneyProfileModal(openJourneyProfileLineId);
  }

  function getLineDemandModel(lineId: string): LineDemandModel | null {
    const line = editor.network.getLine(lineId);
    if (!line?.rollingStockId) return null;

    const stats = getLineTravelStats(lineId);
    const stock = getRollingStock(line.rollingStockId);
    const catchment = getLineCatchmentStats(lineId);
    if (!stats || !stock || !catchment || catchment.lsoaCount === 0) return null;

    return estimateLineDemand(stats, catchment, stock, line.stationIds.length);
  }

  function renderLineDemandModal(lineId: string): void {
    const line = editor.network.getLine(lineId);
    const stats = getLineTravelStats(lineId);
    const demand = getLineDemandModel(lineId);
    if (!line || !stats || !demand) {
      closeLineDemandModal();
      return;
    }

    const stock = line.rollingStockId ? getRollingStock(line.rollingStockId) : null;
    const modalBox = lineDemandModalEl.querySelector<HTMLElement>('.line-demand-box');
    modalBox?.style.setProperty('--journey-line-color', line.color);

    document.getElementById('line-demand-subtitle')!.textContent = stock
      ? `${line.name} · ${stock.designation} ${stock.name}`
      : line.name;
    document.getElementById('line-demand-summary')!.textContent = demand.summary;
    document.getElementById('line-demand-estimate')!.textContent = demand.estimatedPassengersPerHour.toLocaleString('en-GB');
    document.getElementById('line-demand-band')!.textContent = demand.popularityBand;
    document.getElementById('line-demand-score')!.textContent = `${demand.popularityScore}/100`;
    document.getElementById('line-demand-utilisation')!.textContent = `${demand.capacityUtilisationPct.toFixed(1)}%`;
    document.getElementById('line-demand-catchment')!.textContent = demand.catchment.residents.toLocaleString('en-GB');

    document.getElementById('line-demand-base-market')!.textContent = `${demand.baseMarketPassengersPerHour.toLocaleString('en-GB')} pax/hr`;
    document.getElementById('line-demand-propensity')!.textContent = `${demand.propensityFactor.toFixed(2)}x`;
    document.getElementById('line-demand-service-factor')!.textContent = `${demand.serviceFactor.toFixed(2)}x`;
    document.getElementById('line-demand-capacity')!.textContent = `${demand.suppliedCapacityPerHour.toLocaleString('en-GB')} pax/hr`;

    document.getElementById('line-demand-working-age')!.textContent = `${demand.catchment.workingAgePct.toFixed(1)}% working age`;
    document.getElementById('line-demand-density')!.textContent = `${demand.catchment.densityPerHa.toFixed(1)} pop/ha`;
    document.getElementById('line-demand-no-car')!.textContent = `${demand.catchment.noCarPct.toFixed(1)}% no car`;
    document.getElementById('line-demand-train-share')!.textContent = `${demand.catchment.trainCommutersPct.toFixed(1)}% already commute by rail`;
    document.getElementById('line-demand-drive-share')!.textContent = `${demand.catchment.driveCommutersPct.toFixed(1)}% commute by car`;
    document.getElementById('line-demand-renters')!.textContent = `${demand.catchment.rentersPct.toFixed(1)}% renters`;

    document.getElementById('line-demand-frequency')!.textContent = `${demand.service.trainsPerHour} tph`;
    document.getElementById('line-demand-journey-time')!.textContent = `${demand.service.endToEndMin.toFixed(1)} min end-to-end`;
    document.getElementById('line-demand-average-speed')!.textContent = `${demand.service.averageSpeedKmh.toFixed(1)} km/h average`;
    document.getElementById('line-demand-stop-spacing')!.textContent = `${demand.service.stopSpacingKm.toFixed(1)} km average spacing`;
    document.getElementById('line-demand-wait-time')!.textContent = `${demand.service.averageWaitTimeMin.toFixed(1)} min average wait`;
    document.getElementById('line-demand-stock-fit')!.textContent = `${demand.service.stockFitFactor.toFixed(2)}x stock fit`;

    document.getElementById('line-demand-latent-demand')!.textContent = demand.demandConstrainedByCapacity
      ? `${demand.unconstrainedPassengersPerHour.toLocaleString('en-GB')} pax/hr latent demand`
      : 'Demand currently sits within supplied capacity';
    document.getElementById('line-demand-methodology')!.textContent = demand.methodology;
  }

  function openLineDemandModal(lineId: string): void {
    const demand = getLineDemandModel(lineId);
    if (!demand) return;

    openLineDemandLineId = lineId;
    renderLineDemandModal(lineId);
    showAnimatedClass(lineDemandModalEl, 'modal', '.line-demand-box');
  }

  function closeLineDemandModal(): void {
    hideAnimatedClass(lineDemandModalEl, 'modal', '.line-demand-box');
    openLineDemandLineId = null;
  }

  function refreshLineDemandModal(): void {
    if (!openLineDemandLineId) return;

    const line = editor.network.getLine(openLineDemandLineId);
    if (!line || !getLineDemandModel(openLineDemandLineId)) {
      closeLineDemandModal();
      return;
    }

    renderLineDemandModal(openLineDemandLineId);
  }

  function getLineTravelStats(lineId: string) {
    const line = editor.network.getLine(lineId);
    if (!line?.rollingStockId) return null;

    const stock = getRollingStock(line.rollingStockId);
    if (!stock) return null;

    const stations = line.stationIds
      .map((id) => editor.network.getStation(id))
      .filter((station): station is NonNullable<typeof station> => !!station);

    if (stations.length < 2) return null;

    return computeLineStats(stations, stock, line.trainCount ?? 1);
  }

  function renderLmTotalTime(lineId: string): void {
    const badge = document.getElementById('lm-total-time')!;
    const stats = getLineTravelStats(lineId);

    if (!stats) {
      badge.textContent = '';
      hideAnimatedClass(badge, 'badge');
      return;
    }

    badge.textContent = `${formatDurationLabel(stats.totalTimeMin)} end-to-end`;
    showAnimatedClass(badge, 'badge');
  }

  function moveLmStop(lineId: string, fromIndex: number, targetIndex: number, placeAfter: boolean): void {
    const line = editor.network.getLine(lineId);
    if (!line) return;

    let toIndex = placeAfter ? targetIndex + 1 : targetIndex;
    if (fromIndex < toIndex) toIndex -= 1;
    toIndex = Math.max(0, Math.min(line.stationIds.length - 1, toIndex));

    if (toIndex === fromIndex) return;
    editor.network.moveStationInLine(lineId, fromIndex, toIndex);
  }

  function focusLmStopHandle(index: number): void {
    window.requestAnimationFrame(() => {
      const handle = document.querySelector<HTMLElement>(`.lm-stop-item[data-stop-index="${index}"] .lm-stop-handle`);
      handle?.focus();
    });
  }

  function renderLmStops(lineId: string): void {
    const line = editor.network.getLine(lineId);
    const list = document.getElementById('lm-stop-list')!;
    const countEl = document.getElementById('lm-stop-count')!;
    list.innerHTML = '';

    const clearDropState = (): void => {
      list.querySelectorAll<HTMLElement>('.lm-stop-item').forEach((node) => {
        node.classList.remove('drag-over-before', 'drag-over-after', 'is-dragging');
      });
    };

    if (!line || line.stationIds.length === 0) {
      countEl.textContent = '';
      const empty = document.createElement('p');
      empty.className = 'lm-stops-empty';
      empty.textContent = 'No stops yet — switch to line mode and click the map.';
      list.appendChild(empty);
      return;
    }

    countEl.textContent = `${line.stationIds.length} stop${line.stationIds.length !== 1 ? 's' : ''}`;

    const travelStats = getLineTravelStats(lineId);

    line.stationIds.forEach((sid, idx) => {
      const station = editor.network.getStation(sid);
      const name = station?.name ?? '(unknown)';
      const isFirst = idx === 0;
      const isLast  = idx === line.stationIds.length - 1;

      const item = document.createElement('div');
      item.className = 'lm-stop-item';
      item.dataset.stationId = sid;
      item.dataset.stopIndex = String(idx);
      item.draggable = true;

      const rail = document.createElement('div');
      rail.className = 'lm-stop-rail';

      const segTop = document.createElement('div');
      segTop.className = 'lm-stop-seg' + (isFirst ? ' invisible' : '');
      segTop.style.background = line.color;

      const circle = document.createElement('div');
      circle.className = 'lm-stop-circle';
      circle.style.borderColor = line.color;

      const segBottom = document.createElement('div');
      segBottom.className = 'lm-stop-seg' + (isLast ? ' invisible' : '');
      segBottom.style.background = line.color;

      rail.appendChild(segTop);
      rail.appendChild(circle);
      rail.appendChild(segBottom);

      const nameEl = document.createElement('div');
      nameEl.className = 'lm-stop-name';
      nameEl.textContent = name;

      const legTime = !isFirst ? travelStats?.legTimesMin[idx - 1] : undefined;
      const timeTag = typeof legTime === 'number' ? document.createElement('span') : null;
      if (timeTag && typeof legTime === 'number') {
        timeTag.className = 'lm-stop-time-tag';
        timeTag.textContent = formatDurationLabel(legTime);
      }

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'lm-stop-handle';
      handle.title = 'Drag to reorder. Press Alt+Arrow keys to move.';
      handle.setAttribute('aria-label', `Reorder ${name}. Drag to move, or press Alt plus arrow keys.`);
      handle.innerHTML = '<span class="lm-stop-grip" aria-hidden="true"><span class="lm-stop-grip-line"></span><span class="lm-stop-grip-line"></span><span class="lm-stop-grip-line"></span></span>';
      handle.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      handle.addEventListener('keydown', (event) => {
        if (!event.altKey) return;

        if (event.key === 'ArrowUp' && !isFirst) {
          event.preventDefault();
          event.stopPropagation();
          editor.network.moveStationInLine(lineId, idx, idx - 1);
          focusLmStopHandle(idx - 1);
        }

        if (event.key === 'ArrowDown' && !isLast) {
          event.preventDefault();
          event.stopPropagation();
          editor.network.moveStationInLine(lineId, idx, idx + 1);
          focusLmStopHandle(idx + 1);
        }
      });

      item.addEventListener('dragstart', (event) => {
        lmDragSourceIndex = idx;
        lmSuppressStopClick = true;
        clearDropState();
        item.classList.add('is-dragging');
        event.dataTransfer?.setData('text/plain', String(idx));
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.dropEffect = 'move';
        }
      });

      item.addEventListener('dragover', (event) => {
        if (lmDragSourceIndex === null || lmDragSourceIndex === idx) return;
        event.preventDefault();

        const rect = item.getBoundingClientRect();
        const placeAfter = event.clientY > rect.top + rect.height / 2;
        clearDropState();
        item.classList.add(placeAfter ? 'drag-over-after' : 'drag-over-before');
      });

      item.addEventListener('drop', (event) => {
        if (lmDragSourceIndex === null) return;

        event.preventDefault();
        event.stopPropagation();

        const rect = item.getBoundingClientRect();
        const placeAfter = event.clientY > rect.top + rect.height / 2;
        moveLmStop(lineId, lmDragSourceIndex, idx, placeAfter);
        clearDropState();
      });

      item.addEventListener('dragleave', (event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && item.contains(relatedTarget)) return;
        item.classList.remove('drag-over-before', 'drag-over-after');
      });

      item.addEventListener('dragend', () => {
        lmDragSourceIndex = null;
        clearDropState();
        window.setTimeout(() => {
          lmSuppressStopClick = false;
        }, 0);
      });

      item.appendChild(rail);
      item.appendChild(nameEl);
      if (timeTag) item.appendChild(timeTag);
      item.appendChild(handle);

      item.addEventListener('click', () => {
        if (lmSuppressStopClick) return;
        if (station) editor.selectStation(station.id);
      });

      list.appendChild(item);
    });
  }

  function refreshLmStats(lineId: string): void {
    const line = editor.network.getLine(lineId);
    if (!line) return;
    const grid = document.getElementById('lm-stats-grid')!;
    const loadingEl = document.getElementById('lm-stats-loading')!;
    const errorEl = document.getElementById('lm-stats-error')!;
    hideAnimatedDisplay(grid, 'section');
    showAnimatedClass(loadingEl, 'section');
    hideAnimatedClass(errorEl, 'section');
    lineCatchmentStatsByLine.delete(lineId);
    refreshLineStats(lineId);

    const stations = line.stationIds
      .map((id) => editor.network.getStation(id))
      .filter((s): s is NonNullable<typeof s> => !!s);

    fetchLineCatchmentStats(stations).then((stats) => {
      if (openLineId !== lineId) return;
      hideAnimatedClass(loadingEl, 'section');
      if (stats.lsoaCount === 0) {
        lineCatchmentStatsByLine.set(lineId, null);
        errorEl.textContent = line.stationIds.length === 0
          ? 'Add stops to see catchment data.'
          : 'No census data nearby.';
        showAnimatedClass(errorEl, 'section');
        refreshLineStats(lineId);
        refreshLineDemandModal();
        return;
      }
      lineCatchmentStatsByLine.set(lineId, stats);
      document.getElementById('lm-stat-pop')!.textContent     = stats.population.toLocaleString('en-GB');
      document.getElementById('lm-stat-workers')!.textContent  = stats.workingAge.toLocaleString('en-GB');
      document.getElementById('lm-stat-pct')!.textContent      = `${stats.workingAgePct.toFixed(1)}%`;
      document.getElementById('lm-stat-density')!.textContent  = stats.densityPerHa.toFixed(1);
      showAnimatedDisplay(grid, 'section', 'grid');
      refreshLineStats(lineId);
      refreshLineDemandModal();
    }).catch(() => {
      hideAnimatedClass(loadingEl, 'section');
      lineCatchmentStatsByLine.set(lineId, null);
      errorEl.textContent = 'Failed to load census data.';
      showAnimatedClass(errorEl, 'section');
      refreshLineStats(lineId);
      refreshLineDemandModal();
    });
  }

  // ── Rolling stock helpers ───────────────────────────────────────────────

  function renderTrainCard(stock: RollingStock): void {
    document.getElementById('lm-train-flag')!.textContent = stock.flag;
    document.getElementById('lm-train-card-name')!.textContent = `${stock.designation} ${stock.name}`;
    document.getElementById('lm-train-card-sub')!.textContent = `${stock.manufacturer} · ${stock.country}`;
    document.getElementById('lm-ts-speed')!.textContent = `${stock.maxSpeedKmh} km/h`;
    document.getElementById('lm-ts-accel')!.textContent = `${stock.accelerationMs2} m/s²`;
    document.getElementById('lm-ts-cap')!.textContent = stock.totalCapacity.toLocaleString('en-GB');
    document.getElementById('lm-ts-cost')!.textContent = `£${stock.costMillionGbp}M`;
    document.getElementById('lm-ts-cars')!.textContent = `${stock.carsPerUnit}`;
    document.getElementById('lm-ts-length')!.textContent = `${stock.lengthM} m`;
    document.getElementById('lm-train-funfact')!.textContent = stock.funFact;
  }

  function renderLmTrain(lineId: string): void {
    const line = editor.network.getLine(lineId);
    if (!line) return;
    const selector = document.getElementById('lm-train-selector')!;
    const info = document.getElementById('lm-train-info')!;
    const countInput = document.getElementById('lm-train-count') as HTMLInputElement;

    if (line.rollingStockId) {
      const stock = getRollingStock(line.rollingStockId);
      if (stock) {
        hideAnimatedDisplay(selector, 'section');
        showAnimatedClass(info, 'section');
        renderTrainCard(stock);
        countInput.value = String(line.trainCount ?? 1);
        renderLmTotalTime(lineId);
        refreshLineStats(lineId);
        return;
      }
    }
    showAnimatedDisplay(selector, 'section');
    hideAnimatedClass(info, 'section');
    hideAnimatedClass(document.getElementById('lm-line-stats')!, 'section');
    renderLmTotalTime(lineId);
  }

  function refreshLineStats(lineId: string): void {
    const stats = getLineTravelStats(lineId);
    if (!stats) {
      hideAnimatedClass(document.getElementById('lm-line-stats')!, 'section');
      return;
    }
    const el = document.getElementById('lm-line-stats')!;
    showAnimatedClass(el, 'section');

    document.getElementById('lm-ls-distance')!.textContent = `${stats.totalDistanceKm.toFixed(1)} km`;
    document.getElementById('lm-ls-time')!.textContent = formatDurationLabel(stats.totalTimeMin);
    document.getElementById('lm-ls-totalcost')!.textContent = `£${stats.totalCostM.toFixed(1)}M`;
    document.getElementById('lm-ls-capacity')!.textContent = stats.totalCapacity.toLocaleString('en-GB');
    document.getElementById('lm-ls-tph')!.textContent = `${stats.trainsPerHour}`;

    const demandCard = document.getElementById('lm-open-demand-model') as HTMLButtonElement;
    const demandValueEl = document.getElementById('lm-ls-demand')!;
    const demandBandEl = document.getElementById('lm-ls-demand-band')!;
    const demand = getLineDemandModel(lineId);
    const hasCatchmentState = lineCatchmentStatsByLine.has(lineId);

    if (demand) {
      demandValueEl.textContent = demand.estimatedPassengersPerHour.toLocaleString('en-GB');
      demandBandEl.textContent = `${demand.popularityBand} · ${demand.popularityScore}/100`;
      demandCard.disabled = false;
      demandCard.title = 'View line popularity model';
    } else {
      demandValueEl.textContent = '—';
      demandBandEl.textContent = hasCatchmentState ? 'No census model available' : 'Loading census model';
      demandCard.disabled = true;
      demandCard.title = hasCatchmentState ? 'Popularity model unavailable for this line' : 'Loading census model';
    }
  }

  function openTrainPicker(lineId: string): void {
    const modal = trainPickerModalEl;
    const list = document.getElementById('train-picker-list')!;
    list.innerHTML = '';

    let currentCategory = '';
    for (const cat of ROLLING_STOCK_CATEGORIES) {
      const trains = ROLLING_STOCK.filter((t) => t.category === cat);
      if (trains.length === 0) continue;
      if (cat !== currentCategory) {
        currentCategory = cat;
        const heading = document.createElement('div');
        heading.className = 'train-picker-category';
        heading.textContent = cat;
        list.appendChild(heading);
      }
      for (const train of trains) {
        const item = document.createElement('div');
        item.className = 'train-picker-item';

        item.innerHTML = `
          <span class="train-picker-flag">${train.flag}</span>
          <div class="train-picker-info">
            <div class="train-picker-name">${train.designation} ${train.name}</div>
            <div class="train-picker-sub">${train.manufacturer}</div>
          </div>
          <div class="train-picker-stats">
            <div class="train-picker-stat">
              <div class="train-picker-stat-val">${train.maxSpeedKmh}</div>
              <div class="train-picker-stat-lbl">km/h</div>
            </div>
            <div class="train-picker-stat">
              <div class="train-picker-stat-val">${train.totalCapacity.toLocaleString('en-GB')}</div>
              <div class="train-picker-stat-lbl">pax</div>
            </div>
            <div class="train-picker-stat">
              <div class="train-picker-stat-val">£${train.costMillionGbp}M</div>
              <div class="train-picker-stat-lbl">cost</div>
            </div>
          </div>
        `;

        item.addEventListener('click', () => {
          editor.network.setLineTrain(lineId, train.id, 1);
          hideAnimatedClass(modal, 'modal', '.train-picker-box');
          renderLmTrain(lineId);
        });

        list.appendChild(item);
      }
    }

    showAnimatedClass(modal, 'modal', '.train-picker-box');
  }

  function openLineManager(lineId: string): void {
    const line = editor.network.getLine(lineId);
    if (!line) return;
    const wasAlreadyOpen = openLineId === lineId;
    openLineId = lineId;
    showAnimatedClass(lmEl, 'drawer');
    smEl.classList.add('lm-open');   // shift SM left of LM

    (document.getElementById('line-manager-name') as HTMLInputElement).value = line.name;
    renderLmHeader(lineId);
    renderLmSwatches(lineId);
    renderLmStops(lineId);
    renderLmTrain(lineId);

    // Fetch census stats only on first open or when stops changed
    const sig = line.stationIds.join(',');
    if (!wasAlreadyOpen || sig !== openLineStopSig) {
      openLineStopSig = sig;
      refreshLmStats(lineId);
    }
  }

  // ── Station Manager helpers ─────────────────────────────────────────────

  /** Station ID whose census data is currently loaded (avoid redundant fetches). */
  let smCensusStationId: string | null = null;

  function closeStationManager(): void {
    hideAnimatedClass(smEl, 'drawer');
    smCensusStationId = null;
  }

  function renderManagerLines(stationId: string): void {
    const list = document.getElementById('sm-lines-list')!;
    list.innerHTML = '';
    const lines = editor.network.lines.filter((l) => l.stationIds.includes(stationId));
    if (lines.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sm-lines-empty';
      empty.textContent = 'Not on any line yet.';
      list.appendChild(empty);
      return;
    }
    lines.forEach((line) => {
      const badge = document.createElement('div');
      badge.className = 'sm-line-badge';
      badge.title = 'Open line details';

      const dot = document.createElement('span');
      dot.className = 'sm-line-dot';
      dot.style.background = line.color;

      const name = document.createElement('span');
      name.className = 'sm-line-name';
      name.textContent = line.name;

      const stops = document.createElement('span');
      stops.className = 'sm-line-stop-num';
      stops.textContent = `${line.stationIds.length} stops`;

      badge.appendChild(dot);
      badge.appendChild(name);
      badge.appendChild(stops);

      badge.addEventListener('click', () => openLineManager(line.id));

      list.appendChild(badge);
    });
  }

  function openStationManager(stationId: string): void {
    const station = editor.network.getStation(stationId);
    if (!station) return;

    showAnimatedClass(smEl, 'drawer');

    // Always update name + lines (may have changed)
    (document.getElementById('station-manager-name') as HTMLInputElement).value = station.name;
    renderManagerLines(stationId);

    // Only re-fetch census when the selected station changes
    if (smCensusStationId !== stationId) {
      smCensusStationId = stationId;

      const grid = document.getElementById('sm-stats-grid')!;
      const loadingEl = document.getElementById('sm-stats-loading')!;
      const errorEl = document.getElementById('sm-stats-error')!;
      hideAnimatedDisplay(grid, 'section');
      showAnimatedClass(loadingEl, 'section');
      hideAnimatedClass(errorEl, 'section');

      fetchCatchmentStats(station.lng, station.lat).then((stats) => {
        if (smCensusStationId !== stationId) return;
        hideAnimatedClass(loadingEl, 'section');
        if (stats.lsoaCount === 0) {
          errorEl.textContent = 'No census data nearby.';
          showAnimatedClass(errorEl, 'section');
          return;
        }
        document.getElementById('sm-stat-pop')!.textContent     = stats.population.toLocaleString('en-GB');
        document.getElementById('sm-stat-workers')!.textContent  = stats.workingAge.toLocaleString('en-GB');
        document.getElementById('sm-stat-pct')!.textContent      = `${stats.workingAgePct.toFixed(1)}%`;
        document.getElementById('sm-stat-density')!.textContent  = stats.densityPerHa.toFixed(1);
        showAnimatedDisplay(grid, 'section', 'grid');
      }).catch(() => {
        hideAnimatedClass(loadingEl, 'section');
        errorEl.textContent = 'Failed to load census data.';
        showAnimatedClass(errorEl, 'section');
      });
    }
  }

  // ── Network UI callbacks ────────────────────────────────────────────────

  function updateNetworkUI(state: EditorState): void {
    document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.id.replace('tool-', '') === state.mode);
    });

    const snapCheckbox = document.getElementById('new-line-snap') as HTMLInputElement | null;
    const snapHelp = document.getElementById('new-line-snap-help');
    const activeLine = state.activeLineId ? editor.network.getLine(state.activeLineId) : null;
    if (snapCheckbox) {
      snapCheckbox.checked = activeLine ? activeLine.snapToExisting === true : selectedSnapToExisting;
      snapCheckbox.disabled = !!activeLine && (!state.snapToExistingAvailable || state.snapToExistingBusy);
    }
    if (snapHelp) {
      snapHelp.textContent = state.snapToExistingBusy
        ? 'Checking nearby tracks…'
        : activeLine && !state.snapToExistingAvailable
          ? (state.snapToExistingReason ?? 'No existing route is available from the current endpoint.')
          : 'Reuse National Rail or previously drawn track where possible.';
    }

    const doneBtn = document.getElementById('tool-done') as HTMLElement | null;
    if (doneBtn) {
      if (state.mode === 'station' || state.mode === 'line') {
        showAnimatedDisplay(doneBtn, 'badge');
      } else {
        hideAnimatedDisplay(doneBtn, 'badge');
      }
    }

    if (state.mode === 'line') {
      showAnimatedClass(linePanelEl, 'panel');
    } else {
      hideAnimatedClass(linePanelEl, 'panel');
    }

    // Undo / redo button state
    const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = !editor.canUndo();
    if (redoBtn) redoBtn.disabled = !editor.canRedo();

    // Station manager
    if (state.selectedStationId) {
      openStationManager(state.selectedStationId);
    } else {
      closeStationManager();
    }

    // Automatically open Line Manager when a line becomes active
    if (state.activeLineId && state.activeLineId !== openLineId) {
      openLineManager(state.activeLineId);
    }

    // Refresh LM content if it is open (stops change as user draws)
    if (openLineId) {
      const line = editor.network.getLine(openLineId);
      if (!line) {
        closeLineManager();
      } else {
        renderLmStops(openLineId);
        (document.getElementById('line-manager-name') as HTMLInputElement).value = line.name;
        renderLmHeader(openLineId);
        renderLmSwatches(openLineId);
        renderLmTrain(openLineId);
        // Re-fetch census only when stop list changed
        const sig = line.stationIds.join(',');
        if (sig !== openLineStopSig) {
          openLineStopSig = sig;
          refreshLmStats(openLineId);
        }
      }
    }

    refreshJourneyProfileModal();
    refreshLineDemandModal();

    renderLineList(state);
  }

  function renderLineList(state: EditorState): void {
    const container = document.getElementById('line-list')!;
    container.innerHTML = '';

    for (const line of editor.network.lines) {
      const item = document.createElement('div');
      item.className = 'line-item' + (line.id === state.activeLineId ? ' active' : '');

      const dot = document.createElement('div');
      dot.className = 'line-item-color';
      dot.style.background = line.color;

      const lineName = document.createElement('span');
      lineName.className = 'line-item-name';
      lineName.textContent = line.name;

      const count = document.createElement('span');
      count.className = 'line-item-stations';
      count.textContent = `${line.stationIds.length} stn`;

      const del = document.createElement('button');
      del.className = 'line-item-delete';
      del.title = 'Delete line';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openLineId === line.id) closeLineManager();
        editor.deleteLine(line.id);
      });

      item.appendChild(dot);
      item.appendChild(lineName);
      item.appendChild(count);
      item.appendChild(del);

      item.addEventListener('click', () => {
        editor.setActiveLine(line.id);
        openLineManager(line.id);
      });

      container.appendChild(item);
    }
  }

  editor = new NetworkEditor(map, updateNetworkUI);
  _w['__networkEditor'] = editor;

  // Toolbar mode buttons
  const toolBtns = {
    select:  document.getElementById('tool-select')!,
    station: document.getElementById('tool-station')!,
    line:    document.getElementById('tool-line')!,
  };

  Object.entries(toolBtns).forEach(([mode, btn]) => {
    btn.addEventListener('click', () => {
      if (mode === 'line') {
        editor.setMode('line');
        showAnimatedClass(linePanelEl, 'panel');
      } else {
        editor.setMode(mode as 'select' | 'station');
        hideAnimatedClass(linePanelEl, 'panel');
        if (mode !== 'select') {
          closeStationManager();
          closeLineManager();
        }
      }
    });
  });

  // Done button (exits station/line mode back to select)
  document.getElementById('tool-done')!.addEventListener('click', () => {
    editor.setMode('select');
    hideAnimatedClass(linePanelEl, 'panel');
  });

  // Clear button
  document.getElementById('tool-clear')!.addEventListener('click', () => {
    if (editor.network.stations.length === 0 && editor.network.lines.length === 0) return;
    if (confirm('Clear the entire network?')) {
      closeLineManager();
      closeStationManager();
      editor.clearNetwork();
    }
  });

  // Line panel close
  document.getElementById('line-panel-close')!.addEventListener('click', () => {
    hideAnimatedClass(linePanelEl, 'panel');
    editor.setMode('select');
  });

  // Station Manager wiring
  document.getElementById('station-manager-close')!.addEventListener('click', () => {
    editor.deselectStation();
  });

  const smNameInput = document.getElementById('station-manager-name') as HTMLInputElement;
  smNameInput.addEventListener('change', () => {
    const name = smNameInput.value.trim();
    if (name) {
      editor.renameSelectedStation(name);
      const state = editor.getState();
      if (state.selectedStationId) {
        renderManagerLines(state.selectedStationId);
        // Refresh stop name in open Line Manager
        if (openLineId) renderLmStops(openLineId);
      }
    }
  });
  smNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') smNameInput.blur();
  });

  document.getElementById('station-manager-delete')!.addEventListener('click', () => {
    if (openLineId) {
      // Refresh stop list after deletion
      const lineId = openLineId;
      editor.deleteSelectedStation();
      renderLmStops(lineId);
    } else {
      editor.deleteSelectedStation();
    }
  });

  // ── Line Manager wiring ─────────────────────────────────────────────────

  document.getElementById('line-manager-close')!.addEventListener('click', () => {
    closeLineManager();
  });

  const lmNameInput = document.getElementById('line-manager-name') as HTMLInputElement;
  lmNameInput.addEventListener('change', () => {
    const name = lmNameInput.value.trim();
    if (name && openLineId) {
      editor.network.renameLine(openLineId, name);
      renderLineList(editor.getState());
      // Refresh SM line badges if a station is selected
      const state = editor.getState();
      if (state.selectedStationId) renderManagerLines(state.selectedStationId);
    }
  });
  lmNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lmNameInput.blur();
  });

  document.getElementById('line-manager-delete')!.addEventListener('click', () => {
    if (!openLineId) return;
    const lid = openLineId;
    closeLineManager();
    editor.deleteLine(lid);
  });

  document.getElementById('lm-open-journey-profile')!.addEventListener('click', () => {
    if (openLineId) openJourneyProfileModal(openLineId);
  });
  document.getElementById('lm-open-demand-model')!.addEventListener('click', () => {
    if (openLineId) openLineDemandModal(openLineId);
  });

  // ── Rolling stock wiring ──────────────────────────────────────────────

  document.getElementById('lm-train-pick')!.addEventListener('click', () => {
    if (openLineId) openTrainPicker(openLineId);
  });

  document.getElementById('lm-train-remove')!.addEventListener('click', () => {
    if (!openLineId) return;
    editor.network.setLineTrain(openLineId, undefined);
    renderLmTrain(openLineId);
  });

  const trainCountInput = document.getElementById('lm-train-count') as HTMLInputElement;

  document.getElementById('lm-train-dec')!.addEventListener('click', () => {
    if (!openLineId) return;
    const line = editor.network.getLine(openLineId);
    if (!line) return;
    const newCount = Math.max(0, (line.trainCount ?? 1) - 1);
    editor.network.setLineTrainCount(openLineId, newCount);
    trainCountInput.value = String(newCount);
    refreshLineStats(openLineId);
  });

  document.getElementById('lm-train-inc')!.addEventListener('click', () => {
    if (!openLineId) return;
    const line = editor.network.getLine(openLineId);
    if (!line) return;
    const newCount = Math.min(200, (line.trainCount ?? 1) + 1);
    editor.network.setLineTrainCount(openLineId, newCount);
    trainCountInput.value = String(newCount);
    refreshLineStats(openLineId);
  });

  trainCountInput.addEventListener('change', () => {
    if (!openLineId) return;
    const val = Math.max(0, Math.min(200, parseInt(trainCountInput.value, 10) || 0));
    editor.network.setLineTrainCount(openLineId, val);
    trainCountInput.value = String(val);
    refreshLineStats(openLineId);
  });

  // Train picker modal cancel / backdrop close
  document.getElementById('train-picker-cancel')!.addEventListener('click', () => {
    hideAnimatedClass(trainPickerModalEl, 'modal', '.train-picker-box');
  });
  trainPickerModalEl.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      hideAnimatedClass(trainPickerModalEl, 'modal', '.train-picker-box');
    }
  });

  document.getElementById('journey-profile-close')!.addEventListener('click', () => {
    closeJourneyProfileModal();
  });
  document.getElementById('journey-profile-dismiss')!.addEventListener('click', () => {
    closeJourneyProfileModal();
  });
  journeyProfileModalEl.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeJourneyProfileModal();
    }
  });

  document.getElementById('line-demand-close')!.addEventListener('click', () => {
    closeLineDemandModal();
  });
  document.getElementById('line-demand-dismiss')!.addEventListener('click', () => {
    closeLineDemandModal();
  });
  lineDemandModalEl.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeLineDemandModal();
    }
  });

  // Color swatches for new line
  const colorContainer = document.getElementById('new-line-colors')!;
  const snapCheckbox = document.getElementById('new-line-snap') as HTMLInputElement;
  let selectedColor = editor.network.nextColor();
  let selectedSnapToExisting = false;

  function renderColorSwatches(): void {
    colorContainer.innerHTML = '';
    LINE_COLORS.forEach((c) => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch' + (c === selectedColor ? ' selected' : '');
      swatch.style.background = c;
      swatch.addEventListener('click', () => {
        selectedColor = c;
        renderColorSwatches();
      });
      colorContainer.appendChild(swatch);
    });
  }
  renderColorSwatches();

  snapCheckbox.addEventListener('change', () => {
    selectedSnapToExisting = snapCheckbox.checked;
    if (editor.getState().activeLineId) {
      editor.setActiveLineSnapToExisting(snapCheckbox.checked);
    }
  });

  // Add line button
  document.getElementById('new-line-add')!.addEventListener('click', () => {
    const nameInput = document.getElementById('new-line-name') as HTMLInputElement;
    const name = nameInput.value.trim() || `Line ${editor.network.lines.length + 1}`;
    editor.createLine(name, selectedColor, selectedSnapToExisting);
    nameInput.value = '';
    selectedColor = editor.network.nextColor();
    renderColorSwatches();
  });

  // Trigger initial UI sync now that editor is fully constructed and assigned
  editor.syncUI();

  // ── Undo / Redo ─────────────────────────────────────────────────────────
  function animateHistoryBtn(id: string): void {
    const btn = document.getElementById(id)!;
    btn.classList.remove('btn-animate');
    void (btn as HTMLElement).offsetWidth; // reflow to restart animation
    btn.classList.add('btn-animate');
    btn.addEventListener('animationend', () => btn.classList.remove('btn-animate'), { once: true });
  }

  document.getElementById('btn-undo')!.addEventListener('click', () => { animateHistoryBtn('btn-undo'); editor.undo(); });
  document.getElementById('btn-redo')!.addEventListener('click', () => { animateHistoryBtn('btn-redo'); editor.redo(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !journeyProfileModalEl.classList.contains('hidden')) {
      closeJourneyProfileModal();
      return;
    }

    if (e.key === 'Escape' && !lineDemandModalEl.classList.contains('hidden')) {
      closeLineDemandModal();
      return;
    }

    // Don't fire when the user is typing in a text field
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const platformMod = e.metaKey || e.ctrlKey;
    if (!platformMod) return;

    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      editor.undo();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      editor.redo();
    }
  });

  // ── Save (download) ────────────────────────────────────────────────────

  document.getElementById('btn-save')!.addEventListener('click', () => {
    const payload: NetworkExport = editor.network.exportNetwork();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `high-speed-too-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Import ─────────────────────────────────────────────────────────────

  // Pending import data, held while the conflict modal is open.
  let _pendingImport: NetworkExport | null = null;

  function executeImport(merge: boolean): void {
    if (!_pendingImport) return;
    const data = _pendingImport;
    _pendingImport = null;
    hideAnimatedClass(importModalEl, 'modal', '.modal-box');
    closeLineManager();
    closeStationManager();
    editor.importNetwork(data.network, merge);
  }

  function openImportModal(payload: NetworkExport): void {
    _pendingImport = payload;
    showAnimatedClass(importModalEl, 'modal', '.modal-box');
  }

  function closeImportModal(): void {
    _pendingImport = null;
    hideAnimatedClass(importModalEl, 'modal', '.modal-box');
  }

  document.getElementById('import-btn-replace')!.addEventListener('click', () => {
    executeImport(false);
  });

  document.getElementById('import-btn-merge')!.addEventListener('click', () => {
    executeImport(true);
  });

  document.getElementById('import-btn-cancel')!.addEventListener('click', () => {
    closeImportModal();
  });

  // Close modal on backdrop click
  importModalEl.addEventListener('click', (e: MouseEvent) => {
    if (e.target === e.currentTarget) closeImportModal();
  });

  document.getElementById('btn-import')!.addEventListener('click', () => {
    (document.getElementById('import-file-input') as HTMLInputElement).click();
  });

  document.getElementById('import-file-input')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // reset so same file can be re-imported
    if (!file) return;

    file.text().then((text) => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        alert('Could not read the file: not valid JSON.');
        return;
      }

      if (!validateNetworkExport(raw)) {
        alert('This does not appear to be a High Speed Too network file.');
        return;
      }

      const hasData = editor.network.stations.length > 0 || editor.network.lines.length > 0;
      if (hasData) {
        openImportModal(raw);
      } else {
        closeLineManager();
        closeStationManager();
        editor.importNetwork(raw.network, false);
      }
    }).catch(() => {
      alert('Failed to read the file.');
    });
  });

  // ── Export ──────────────────────────────────────────────────────────────

  const exportModal = document.getElementById('export-modal')!;
  const exportStepLines = document.getElementById('export-step-lines')!;
  const exportStepStyle = document.getElementById('export-step-style')!;
  const exportBtnNext = document.getElementById('export-btn-next')!;
  const exportBtnBack = document.getElementById('export-btn-back')!;
  const exportBtnExport = document.getElementById('export-btn-export')!;
  const exportBtnCancel = document.getElementById('export-btn-cancel')!;
  const exportLineList = document.getElementById('export-line-list')!;
  const exportNoLines = document.getElementById('export-no-lines')!;
  const exportShowLegend = document.getElementById('export-show-legend') as HTMLInputElement;
  const exportPreviewFrame = document.getElementById('export-preview-frame') as HTMLIFrameElement;
  let exportPreviewKey = '';

  function getSelectedExportStyle(): ExportStyle {
    const styleRadio = document.querySelector<HTMLInputElement>('input[name="export-style"]:checked');
    return (styleRadio?.value as ExportStyle) || 'mta';
  }

  function renderExportPreview(): void {
    const style = getSelectedExportStyle();
    const lineIds = getSelectedExportLineIds();
    const showLegend = exportShowLegend.checked;

    if (lineIds.length === 0) {
      exportPreviewKey = '';
      exportPreviewFrame.srcdoc = '';
      return;
    }

    const previewKey = JSON.stringify({ style, lineIds, showLegend });
    if (previewKey === exportPreviewKey) return;

    exportPreviewKey = previewKey;
    exportPreviewFrame.srcdoc = buildExportPreviewHTML(editor.network, {
      style,
      lineIds,
      showLegend,
    });
  }

  function openExportModal(): void {
    showAnimatedClass(exportStepLines, 'section');
    hideAnimatedClass(exportStepStyle, 'section');
    showAnimatedClass(exportBtnNext, 'badge');
    hideAnimatedClass(exportBtnBack, 'badge');
    hideAnimatedClass(exportBtnExport, 'badge');

    // Populate line list
    exportLineList.innerHTML = '';
    exportPreviewKey = '';
    const lines = editor.network.lines;

    if (lines.length === 0) {
      showAnimatedClass(exportNoLines, 'section');
      hideAnimatedClass(exportBtnNext, 'badge');
      exportPreviewFrame.srcdoc = '';
    } else {
      hideAnimatedClass(exportNoLines, 'section');
      showAnimatedClass(exportBtnNext, 'badge');
      for (const line of lines) {
        const item = document.createElement('label');
        item.className = 'export-line-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = line.id;

        const dot = document.createElement('span');
        dot.className = 'export-line-dot';
        dot.style.background = line.color;

        const name = document.createElement('span');
        name.className = 'export-line-name';
        name.textContent = line.name;

        const stops = document.createElement('span');
        stops.className = 'export-line-stops';
        stops.textContent = `${line.stationIds.length} stops`;

        cb.addEventListener('change', () => {
          renderExportPreview();
        });

        item.appendChild(cb);
        item.appendChild(dot);
        item.appendChild(name);
        item.appendChild(stops);
        exportLineList.appendChild(item);
      }

      renderExportPreview();
    }

    showAnimatedClass(exportModal, 'modal', '.export-modal-box');
  }

  function closeExportModal(): void {
    hideAnimatedClass(exportModal, 'modal', '.export-modal-box');
  }

  function getSelectedExportLineIds(): string[] {
    return Array.from(exportLineList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
      .map((cb) => cb.value);
  }

  exportBtnNext.addEventListener('click', () => {
    const selected = getSelectedExportLineIds();
    if (selected.length === 0) {
      alert('Please select at least one line to export.');
      return;
    }
    hideAnimatedClass(exportStepLines, 'section');
    showAnimatedClass(exportStepStyle, 'section');
    hideAnimatedClass(exportBtnNext, 'badge');
    showAnimatedClass(exportBtnBack, 'badge');
    showAnimatedClass(exportBtnExport, 'badge');
    renderExportPreview();
  });

  exportBtnBack.addEventListener('click', () => {
    showAnimatedClass(exportStepLines, 'section');
    hideAnimatedClass(exportStepStyle, 'section');
    showAnimatedClass(exportBtnNext, 'badge');
    hideAnimatedClass(exportBtnBack, 'badge');
    hideAnimatedClass(exportBtnExport, 'badge');
  });

  exportBtnExport.addEventListener('click', () => {
    const lineIds = getSelectedExportLineIds();
    const style = getSelectedExportStyle();
    const showLegend = exportShowLegend.checked;

    closeExportModal();
    openExportPage(editor.network, { style, lineIds, showLegend });
  });

  document.querySelectorAll<HTMLInputElement>('input[name="export-style"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      renderExportPreview();
    });
  });

  exportShowLegend.addEventListener('change', () => {
    renderExportPreview();
  });

  exportBtnCancel.addEventListener('click', closeExportModal);

  exportModal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeExportModal();
  });

  document.getElementById('btn-export')!.addEventListener('click', openExportModal);
});

function updateCensusUI(state: CensusOverlayState): void {
  // Sync radio selection
  document.querySelectorAll<HTMLInputElement>('input[name="census-metric"]').forEach((radio) => {
    radio.checked = radio.value === state.metric;
  });

  // Loading spinner
  const spinner = document.getElementById('census-loading');
  if (spinner) {
    if (state.loading) {
      showAnimatedDisplay(spinner, 'badge', 'inline');
    } else {
      hideAnimatedDisplay(spinner, 'badge');
    }
  }

  // Colour legend
  const legend = document.getElementById('census-legend');
  if (legend) {
    if (state.metric !== 'off') {
      const cfg = LEGEND_CONFIGS[state.metric];
      const bar = document.getElementById('census-legend-bar');
      if (bar) bar.style.background = cfg.gradient;
      const minEl = document.getElementById('census-legend-min');
      const maxEl = document.getElementById('census-legend-max');
      if (minEl) minEl.textContent = cfg.minLabel;
      if (maxEl) maxEl.textContent = cfg.maxLabel;
      showAnimatedDisplay(legend, 'section', 'block');
    } else {
      hideAnimatedDisplay(legend, 'section');
    }
  }

  // Error
  const errEl = document.getElementById('census-error');
  if (errEl) {
    errEl.textContent = state.error ?? '';
    if (state.error) {
      showAnimatedDisplay(errEl, 'section', 'block');
    } else {
      hideAnimatedDisplay(errEl, 'section');
    }
  }

  // Last updated
  const updatedEl = document.getElementById('census-updated');
  if (updatedEl) {
    if (state.lastModified) {
      updatedEl.textContent = 'Updated ' + state.lastModified.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      showAnimatedDisplay(updatedEl, 'badge', 'block');
    } else {
      hideAnimatedDisplay(updatedEl, 'badge');
    }
  }
}