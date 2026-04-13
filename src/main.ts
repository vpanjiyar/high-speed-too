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
import type { RollingStock, LineTrainStats, JourneyProfilePoint, JourneyProfileSegment, JourneyStationStop } from './rolling-stock';
import { estimateLineDemand } from './line-demand';
import type { LineDemandModel } from './line-demand';
import { buildExportPreviewHTML, openExportPage } from './map-export';
import type { ExportStyle } from './map-export';
import { railSpeedIndex } from './rail-speed-index';
import { Simulation } from './simulation';
import type { SimSpeed, TrainState } from './simulation';
import { TrainRenderer } from './train-renderer';
import { DepartureBoard } from './departure-board';
import { SignalSystem, ASPECT_LABEL } from './signal-system';
import type { SignalInfo } from './signal-system';
import { buildTimetable, findActiveService } from './timetable';
import type { Timetable, LineTimetableConfig } from './timetable';

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

type AttributionSourceInfo = {
  title: string;
  usedFor: string;
  provider: string;
  terms: string;
  href: string;
};

const ATTRIBUTION_SOURCES: AttributionSourceInfo[] = [
  {
    title: 'UK PMTiles basemap',
    usedFor: 'Offline-ready vector basemap tiles for the map itself.',
    provider: 'Protomaps and OpenStreetMap contributors',
    terms: 'ODbL / Protomaps terms',
    href: 'https://protomaps.com',
  },
  {
    title: 'ONS Open Geography boundaries',
    usedFor: 'LSOA and MSOA polygons for the census choropleths.',
    provider: 'Office for National Statistics',
    terms: 'Open Government Licence v3.0',
    href: 'https://geoportal.statistics.gov.uk/',
  },
  {
    title: 'NOMIS Census 2021 tables',
    usedFor: 'Population, density, age, commuting, and socioeconomic overlay metrics.',
    provider: 'NOMIS and ONS',
    terms: 'Open Government Licence v3.0',
    href: 'https://www.nomisweb.co.uk/sources/census_2021',
  },
  {
    title: 'OpenStreetMap rail geometry',
    usedFor: 'National rail line geometry and several processed network overlays.',
    provider: 'OpenStreetMap contributors via Overpass API',
    terms: 'ODbL',
    href: 'https://overpass-api.de/',
  },
  {
    title: 'NaPTAN access nodes',
    usedFor: 'Station snapping, station import, and real-world stop metadata.',
    provider: 'Department for Transport',
    terms: 'Open Government Licence v3.0',
    href: 'https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv',
  },
  {
    title: 'MapLibre GL JS',
    usedFor: 'WebGL rendering, controls, hit-testing, and the main map runtime.',
    provider: 'MapLibre project',
    terms: 'BSD',
    href: 'https://maplibre.org/',
  },
  {
    title: 'PMTiles tooling',
    usedFor: 'Archive reading, custom protocols, and tile extraction workflows.',
    provider: 'Protomaps / PMTiles project',
    terms: 'Project-specific open-source licences',
    href: 'https://github.com/protomaps/go-pmtiles',
  },
  {
    title: 'Protomaps glyph assets',
    usedFor: 'Hosted glyph fonts for map labels in the current prototype.',
    provider: 'Protomaps basemaps-assets',
    terms: 'Project asset terms',
    href: 'https://protomaps.github.io/basemaps-assets/',
  },
];

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
): Promise<void> {
  const strategy = options.strategy ?? 'class';
  const hidden = strategy === 'class'
    ? element.classList.contains('hidden')
    : getComputedStyle(element).display === 'none';
  const state = element.dataset.motionState;

  if (visible) {
    if (state === 'entering' || state === 'open') return Promise.resolve();
    if (!hidden && state !== 'exiting') return Promise.resolve();
  } else {
    if (state === 'exiting' || state === 'closed') return Promise.resolve();
    if (hidden && state !== 'entering') return Promise.resolve();
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
  // Preserve horizontal centering for elements that use `left:50%` + `translateX(-50%)`
  // (notably the simulation toolbar) by injecting the centering translate into
  // the animation keyframes so the element doesn't visually snap from the
  // left/right during the animation.
  if (element.id === 'sim-toolbar') {
    const addCenter = (kfs: Keyframe[] | undefined) => {
      if (!kfs) return kfs;
      return kfs.map((kf) => {
        const copy: Keyframe = { ...kf };
        if (typeof copy.transform === 'string') {
          copy.transform = `translateX(-50%) ${copy.transform}`;
        } else {
          copy.transform = 'translateX(-50%)';
        }
        return copy;
      });
    };

    const centeredRoot = addCenter(motion.root);
    if (centeredRoot) motion.root = centeredRoot;
    if (motion.surface) {
      const centeredSurface = addCenter(motion.surface);
      if (centeredSurface) motion.surface = centeredSurface;
    }
  }
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

  return Promise.allSettled(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
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
  }).then(() => undefined);
}

function showAnimatedClass(element: HTMLElement, preset: MotionPreset, surfaceSelector?: string): Promise<void> {
  return setAnimatedVisibility(element, true, { preset, surfaceSelector });
}

function hideAnimatedClass(element: HTMLElement, preset: MotionPreset, surfaceSelector?: string): Promise<void> {
  return setAnimatedVisibility(element, false, { preset, surfaceSelector });
}

function showAnimatedDisplay(element: HTMLElement, preset: MotionPreset, displayValue = ''): Promise<void> {
  return setAnimatedVisibility(element, true, { preset, strategy: 'display', displayValue });
}

function hideAnimatedDisplay(element: HTMLElement, preset: MotionPreset): Promise<void> {
  return setAnimatedVisibility(element, false, { preset, strategy: 'display' });
}

type FloatingPanelPosition = { left: number; top: number };
const FLOATING_PANEL_STORAGE_KEY = 'hst2-floating-panel-positions';
const floatingPanelPositions = new Map<string, FloatingPanelPosition>();
const floatingPanelElements = new Map<string, HTMLElement>();

try {
  const raw = window.localStorage.getItem(FLOATING_PANEL_STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, FloatingPanelPosition>;
    for (const [panelKey, pos] of Object.entries(parsed)) {
      if (
        pos
        && Number.isFinite(pos.left)
        && Number.isFinite(pos.top)
      ) {
        floatingPanelPositions.set(panelKey, { left: pos.left, top: pos.top });
      }
    }
  }
} catch {
  // Ignore invalid persisted panel coordinates.
}

function persistFloatingPanelPositions(): void {
  try {
    const payload = Object.fromEntries(floatingPanelPositions.entries());
    window.localStorage.setItem(FLOATING_PANEL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore persistence failures.
  }
}

function clampFloatingPanelPosition(panel: HTMLElement, left: number, top: number): FloatingPanelPosition {
  const margin = 8;
  const rect = panel.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  return {
    left: Math.min(maxLeft, Math.max(margin, left)),
    top: Math.min(maxTop, Math.max(margin, top)),
  };
}

function applyFloatingPanelPosition(panel: HTMLElement, pos: FloatingPanelPosition): void {
  const clamped = clampFloatingPanelPosition(panel, pos.left, pos.top);
  panel.style.left = `${clamped.left}px`;
  panel.style.top = `${clamped.top}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
}

function makePanelPositionAbsolute(panel: HTMLElement): void {
  const rect = panel.getBoundingClientRect();
  applyFloatingPanelPosition(panel, { left: rect.left, top: rect.top });
}

function setupDraggableFloatingPanel(panelKey: string, panel: HTMLElement, handle: HTMLElement): void {
  floatingPanelElements.set(panelKey, panel);
  handle.classList.add('draggable-panel-handle');

  const saved = floatingPanelPositions.get(panelKey);
  if (saved) {
    applyFloatingPanelPosition(panel, saved);
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, select, textarea, a, label, [data-no-drag]')) {
      return;
    }

    makePanelPositionAbsolute(panel);
    const rect = panel.getBoundingClientRect();
    const pointerOffsetX = event.clientX - rect.left;
    const pointerOffsetY = event.clientY - rect.top;

    panel.classList.add('is-being-dragged');
    handle.setPointerCapture(event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const next = clampFloatingPanelPosition(
        panel,
        moveEvent.clientX - pointerOffsetX,
        moveEvent.clientY - pointerOffsetY,
      );
      applyFloatingPanelPosition(panel, next);
      floatingPanelPositions.set(panelKey, next);
    };

    const finishDrag = (): void => {
      panel.classList.remove('is-being-dragged');
      handle.removeEventListener('pointermove', onPointerMove);
      floatingPanelPositions.set(panelKey, {
        left: parseFloat(panel.style.left) || rect.left,
        top: parseFloat(panel.style.top) || rect.top,
      });
      persistFloatingPanelPositions();
    };

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishDrag, { once: true });
    handle.addEventListener('pointercancel', finishDrag, { once: true });
  });
}

function ensureFloatingPanelInViewport(panelKey: string, panel: HTMLElement): void {
  const styleLeft = parseFloat(panel.style.left);
  const styleTop = parseFloat(panel.style.top);
  if (Number.isFinite(styleLeft) && Number.isFinite(styleTop)) {
    const next = clampFloatingPanelPosition(panel, styleLeft, styleTop);
    floatingPanelPositions.set(panelKey, next);
    applyFloatingPanelPosition(panel, next);
    persistFloatingPanelPositions();
    return;
  }

  const saved = floatingPanelPositions.get(panelKey);
  if (saved) {
    const next = clampFloatingPanelPosition(panel, saved.left, saved.top);
    floatingPanelPositions.set(panelKey, next);
    applyFloatingPanelPosition(panel, next);
    persistFloatingPanelPositions();
  }
}

window.addEventListener('resize', () => {
  for (const [panelKey, panel] of floatingPanelElements.entries()) {
    const saved = floatingPanelPositions.get(panelKey);
    if (!saved) continue;
    const next = clampFloatingPanelPosition(panel, saved.left, saved.top);
    floatingPanelPositions.set(panelKey, next);
    applyFloatingPanelPosition(panel, next);
  }
  if (floatingPanelPositions.size > 0) {
    persistFloatingPanelPositions();
  }
});

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
  attributionControl: false, // handled by the custom credits popup beside nav controls
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

const navigationControl = new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false });
map.addControl(navigationControl, 'bottom-right');
map.addControl(
  new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' }),
  'bottom-right',
);

const attributionPopoverEl = document.getElementById('attribution-popover') as HTMLElement;
const attributionPopoverListEl = document.getElementById('attribution-popover-list') as HTMLElement;
const attributionPopoverCloseBtn = document.getElementById('attribution-popover-close') as HTMLButtonElement;

function renderAttributionSources(): void {
  attributionPopoverListEl.innerHTML = '';
  ATTRIBUTION_SOURCES.forEach((source) => {
    const card = document.createElement('section');
    card.className = 'attribution-source-card';

    const title = document.createElement('div');
    title.className = 'attribution-source-title';
    title.textContent = source.title;

    const meta = document.createElement('div');
    meta.className = 'attribution-source-meta';
    meta.innerHTML = `<strong>Used for:</strong> ${source.usedFor}<br/><strong>Provider:</strong> ${source.provider}<br/><strong>Terms:</strong> ${source.terms}`;

    const link = document.createElement('a');
    link.className = 'attribution-source-link';
    link.href = source.href;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = 'Learn more';

    card.append(title, meta, link);
    attributionPopoverListEl.appendChild(card);
  });
}

renderAttributionSources();

const attributionTriggerBtn = document.createElement('button');
attributionTriggerBtn.type = 'button';
attributionTriggerBtn.className = 'ctrl-attribution-trigger';
attributionTriggerBtn.title = 'Credits and acknowledgements';
attributionTriggerBtn.setAttribute('aria-label', 'Open credits and acknowledgements');
attributionTriggerBtn.textContent = 'Credits';

// Credits lives in its own small ctrl-group capsule, positioned next to the nav controls
const creditsGroup = document.createElement('div');
creditsGroup.id = 'credits-btn';
creditsGroup.className = 'maplibregl-ctrl-group';
creditsGroup.appendChild(attributionTriggerBtn);
document.getElementById('ui')?.appendChild(creditsGroup);

function isAttributionPopoverOpen(): boolean {
  return !attributionPopoverEl.classList.contains('hidden') && attributionPopoverEl.dataset.motionState !== 'closed';
}

function positionAttributionPopover(): void {
  if (window.innerWidth <= COMPACT_PANEL_BREAKPOINT) {
    attributionPopoverEl.style.left = '12px';
    attributionPopoverEl.style.top = `${Math.max(18, Math.round((window.innerHeight - attributionPopoverEl.offsetHeight) / 2))}px`;
    return;
  }

  const triggerRect = attributionTriggerBtn.getBoundingClientRect();
  const popoverWidth = attributionPopoverEl.offsetWidth;
  const popoverHeight = attributionPopoverEl.offsetHeight;
  const minInset = 12;
  const maxLeft = Math.max(minInset, window.innerWidth - popoverWidth - minInset);
  const maxTop = Math.max(minInset, window.innerHeight - popoverHeight - minInset);
  const left = Math.min(maxLeft, Math.max(minInset, Math.round(triggerRect.right - popoverWidth)));
  const top = Math.min(maxTop, Math.max(minInset, Math.round(triggerRect.top - popoverHeight - 12)));

  attributionPopoverEl.style.left = `${left}px`;
  attributionPopoverEl.style.top = `${top}px`;
}

function openAttributionPopover(): void {
  positionAttributionPopover();
  showAnimatedClass(attributionPopoverEl, 'panel');
  window.requestAnimationFrame(positionAttributionPopover);
}

function closeAttributionPopover(): void {
  hideAnimatedClass(attributionPopoverEl, 'panel');
}

attributionTriggerBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (isAttributionPopoverOpen()) {
    closeAttributionPopover();
    return;
  }
  openAttributionPopover();
});

attributionPopoverCloseBtn.addEventListener('click', () => {
  closeAttributionPopover();
});

document.addEventListener('mousedown', (event) => {
  const target = event.target as Node | null;
  if (!target || !isAttributionPopoverOpen()) return;
  if (attributionPopoverEl.contains(target) || attributionTriggerBtn.contains(target)) return;
  closeAttributionPopover();
});

window.addEventListener('resize', () => {
  if (isAttributionPopoverOpen()) {
    positionAttributionPopover();
  }
});

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
const TRACK_SPEED_LAYER = { id: 'rail-speed-limit-overlay', minzoom: 5 };
const NETWORK_TRACK_SPEED_SOURCE_ID = 'network-track-speed-overlay';
const NETWORK_TRACK_SPEED_LAYER_ID = 'network-track-speed-overlay';

function formatSpeedLabel(speedKmh: number): string {
  const mph = Math.round(speedKmh * 0.621371);
  return `${Math.round(speedKmh)} km/h (${mph} mph)`;
}

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
  // Pre-load OSM speed limit index — ready before user switches to sim mode
  void railSpeedIndex.load();

  const speedToggle = document.getElementById('toggle-track-speed') as HTMLInputElement | null;
  const speedLegend = document.getElementById('track-speed-legend');
  const speedHoverTooltipEl = document.getElementById('speed-hover-tooltip');
  const simSpeedKeyBtn = document.getElementById('sim-btn-speed-key') as HTMLButtonElement | null;
  const simSpeedLegendEl = document.getElementById('sim-speed-legend');
  let trackSpeedOverlayEnabled = speedToggle?.checked ?? false;
  let simSpeedKeyVisible = false;
  let simUiModeActive = false;

  /** Set the speed layer visibility directly on the map (both national + network layers). */
  const applySpeedLayerVisibility = (visible: boolean): void => {
    if (map.getLayer(TRACK_SPEED_LAYER.id)) {
      map.setLayoutProperty(TRACK_SPEED_LAYER.id, 'visibility', visible ? 'visible' : 'none');
    }
    if (map.getLayer(NETWORK_TRACK_SPEED_LAYER_ID)) {
      map.setLayoutProperty(NETWORK_TRACK_SPEED_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  };

  const syncSimSpeedKeyUi = (): void => {
    const inSimMode = simUiModeActive;
    const simActive = inSimMode && simSpeedKeyVisible;
    if (simSpeedLegendEl) {
      if (simActive) {
        showAnimatedClass(simSpeedLegendEl, 'section');
      } else {
        hideAnimatedClass(simSpeedLegendEl, 'section');
      }
    }
    simSpeedKeyBtn?.classList.toggle('sim-btn--active', simActive);
    // In sim mode layers follow the sim toggle; in plan mode they follow the overlay checkbox
    applySpeedLayerVisibility(inSimMode ? simSpeedKeyVisible : trackSpeedOverlayEnabled);
  };

  simSpeedKeyBtn?.addEventListener('click', () => {
    simSpeedKeyVisible = !simSpeedKeyVisible;
    syncSimSpeedKeyUi();
  });

  const setTrackSpeedOverlayVisible = (enabled: boolean): void => {
    trackSpeedOverlayEnabled = enabled;
    if (speedLegend) {
      if (enabled) {
        showAnimatedClass(speedLegend, 'section');
      } else {
        hideAnimatedClass(speedLegend, 'section');
      }
    }
    speedHoverTooltipEl?.classList.add('hidden');
    syncSimSpeedKeyUi();
  };

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

  speedToggle?.addEventListener('change', (e) => {
    setTrackSpeedOverlayVisible((e.target as HTMLInputElement).checked);
  });
  setTrackSpeedOverlayVisible(trackSpeedOverlayEnabled);

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

  // Track whether the user is actively zooming/panning so follow mode
  // doesn't fight against their interaction.
  let userInteracting = false;
  let userInteractingTimeout = 0;
  const onInteractionStart = () => {
    userInteracting = true;
    clearTimeout(userInteractingTimeout);
  };
  const onInteractionEnd = () => {
    // Small grace period so the camera settles before follow resumes
    userInteractingTimeout = window.setTimeout(() => { userInteracting = false; }, 400);
  };
  map.on('mousedown', onInteractionStart);
  map.on('touchstart', onInteractionStart);
  map.on('wheel', onInteractionStart);
  map.on('moveend', onInteractionEnd);
  map.on('zoomend', onInteractionEnd);

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
  const btnDetailed = document.getElementById('view-btn-detailed') as HTMLButtonElement;
  const btnSchematic = document.getElementById('view-btn-schematic') as HTMLButtonElement;
  const simBtnDetailed = document.getElementById('sim-view-btn-detailed') as HTMLButtonElement | null;
  const simBtnSchematic = document.getElementById('sim-view-btn-schematic') as HTMLButtonElement | null;

  const syncViewModeButtons = (): void => {
    [btnDetailed, simBtnDetailed].forEach((button) => {
      button?.classList.toggle('view-btn--active', !schematicMode);
      button?.setAttribute('aria-pressed', String(!schematicMode));
    });

    [btnSchematic, simBtnSchematic].forEach((button) => {
      button?.classList.toggle('view-btn--active', schematicMode);
      button?.setAttribute('aria-pressed', String(schematicMode));
    });
  };

  const setSchematicView = (nextMode: boolean): void => {
    if (schematicMode === nextMode) {
      syncViewModeButtons();
      return;
    }

    schematicMode = nextMode;
    applySchematicMode(map, schematicMode);
    syncViewModeButtons();
  };

  btnSchematic.addEventListener('click', () => setSchematicView(true));
  btnDetailed.addEventListener('click', () => setSchematicView(false));
  simBtnSchematic?.addEventListener('click', () => setSchematicView(true));
  simBtnDetailed?.addEventListener('click', () => setSchematicView(false));
  syncViewModeButtons();

  // ── Network editor ──────────────────────────────────────────────────────
  //
  // updateNetworkUI / renderLineList are declared before the editor so they
  // can be passed as callbacks, but they use `editor` which is assigned
  // immediately after construction. The constructor no longer calls _emit(),
  // so these functions are never invoked before `editor` is assigned.

  // eslint-disable-next-line prefer-const
  let editor!: NetworkEditor;

  // ── Panel element references ────────────────────────────────────────────
  const overlaysPanelEl = document.getElementById('overlays-panel')!;
  const overlaysPanelToggleBtn = document.getElementById('overlays-panel-toggle') as HTMLButtonElement;
  const smEl = document.getElementById('station-manager')!;
  const lmEl = document.getElementById('line-manager')!;
  const linePanelEl = document.getElementById('line-panel')!;
  const clearModalEl = document.getElementById('clear-modal')!;
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
    element: overlaysPanelEl,
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

  let overlaysCollapsed = false;

  const applyOverlaysCollapsed = (collapsed: boolean): void => {
    overlaysCollapsed = collapsed;
    overlaysPanelEl.classList.toggle('overlays-panel--collapsed', collapsed);
    overlaysPanelToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    overlaysPanelToggleBtn.title = collapsed ? 'Expand overlays' : 'Collapse overlays';
    overlaysPanelToggleBtn.setAttribute('aria-label', collapsed ? 'Expand overlays panel' : 'Collapse overlays panel');

    try {
      window.localStorage.setItem('hst.panel.overlays.collapsed', collapsed ? '1' : '0');
    } catch {
      // Ignore storage failures; the panel should still collapse for the session.
    }
  };

  overlaysPanelToggleBtn.addEventListener('click', () => {
    if (simMode) return; // ignore toggle while in simulate mode
    applyOverlaysCollapsed(!overlaysCollapsed);
  });

  try {
    overlaysCollapsed = window.localStorage.getItem('hst.panel.overlays.collapsed') === '1';
  } catch {
    overlaysCollapsed = false;
  }
  applyOverlaysCollapsed(overlaysCollapsed);

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
      distance.textContent = `${(stop.distanceKm * 0.621371).toFixed(1)} mi`;

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
      speedLabel.textContent = `${Math.round(speed * 0.621371)}`;
      svg.appendChild(speedLabel);

      // Secondary km/h label
      if (speed > 0) {
        const kmhLabel = createSvgElement('text', {
          x: `${padding.left - 12}`,
          y: `${yPos + 14}`,
          fill: '#9aa3b3',
          'font-size': '9',
          'text-anchor': 'end',
        });
        kmhLabel.textContent = `${Math.round(speed)}`;
        svg.appendChild(kmhLabel);
      }
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
    yAxisLabel.textContent = 'Speed (mph / km/h)';
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

      journeyProfileHoverReadoutEl.textContent = `${formatElapsedTimeLabel(sample.timeSec)} · ${Math.round(sample.speedKmh * 0.621371)} mph (${Math.round(sample.speedKmh)} km/h) · ${phaseLabel}`;
      tooltipTitle.textContent = segmentLabel;
      tooltipValue.textContent = `${Math.round(sample.speedKmh * 0.621371)} mph (${Math.round(sample.speedKmh)} km/h) at ${formatElapsedTimeLabel(sample.timeSec)}`;
      tooltipMeta.textContent = `${phaseLabel} · ${(sample.distanceKm * 0.621371).toFixed(1)} mi (${sample.distanceKm.toFixed(1)} km) from origin`;

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
    document.getElementById('journey-profile-summary')!.textContent = `${origin} to ${destination} over ${(stats.totalDistanceKm * 0.621371).toFixed(1)} mi (${stats.totalDistanceKm.toFixed(1)} km), with ${intermediateStops} intermediate stop${intermediateStops === 1 ? '' : 's'}${stats.dwellTimeMin > 0 ? ` and ${formatDurationLabel(stats.dwellTimeMin)} of scheduled dwell time.` : '.'}`;
    document.getElementById('journey-profile-total-time')!.textContent = formatDurationLabel(stats.totalTimeMin);
    document.getElementById('journey-profile-running-time')!.textContent = formatDurationLabel(stats.runningTimeMin);
    document.getElementById('journey-profile-peak-speed')!.textContent = `${Math.round(stats.maxReachedSpeedKmh * 0.621371)} mph (${Math.round(stats.maxReachedSpeedKmh)} km/h)`;
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

    const baseStats = computeLineStats(stations, stock, line.trainCount ?? 1);
    const cache = sim.getPolylineCaches().get(lineId);
    if (!cache || cache.legs.length === 0) return baseStats;

    const accelMs2 = Math.max(0.1, stock.accelerationMs2);
    const brakeMs2 = Math.min(accelMs2, 0.7);
    const sampleStepM = 500;

    const limitAtDistanceM = (distanceM: number): number => {
      const dist = clamp(distanceM, 0, cache.totalLengthM);
      const dists = cache.cumulativeDistM;
      const limits = cache.curvatureLimitsKmh;
      let lo = 0;
      let hi = dists.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (dists[mid]! <= dist) lo = mid;
        else hi = mid;
      }
      const d0 = dists[lo]!;
      const d1 = dists[hi]!;
      const t = d1 > d0 ? (dist - d0) / (d1 - d0) : 0;
      const raw = limits[lo]! + t * (limits[hi]! - limits[lo]!);
      const kmh = raw >= 999 ? cache.lineMaxSpeedKmh : raw;
      return Math.max(10, Math.min(cache.lineMaxSpeedKmh, kmh));
    };

    const profilePoints: JourneyProfilePoint[] = [{ timeSec: 0, speedKmh: 0, distanceKm: 0 }];
    const profileSegments: JourneyProfileSegment[] = [];
    const stationStops: JourneyStationStop[] = [{
      stationIndex: 0,
      name: stations[0]?.name ?? 'Stop 1',
      arrivalTimeSec: 0,
      departureTimeSec: 0,
      dwellTimeSec: 0,
      distanceKm: 0,
    }];

    let elapsedSec = 0;
    let runningSec = 0;
    let dwellSecTotal = 0;
    let maxReachedSpeedKmh = 0;

    for (let legIndex = 0; legIndex < cache.legs.length; legIndex++) {
      const leg = cache.legs[legIndex]!;
      const legLenM = Math.max(1, leg.lengthM);
      const sampleCount = Math.max(2, Math.ceil(legLenM / sampleStepM) + 1);

      const d: number[] = [];
      const limitMs: number[] = [];
      for (let i = 0; i < sampleCount; i++) {
        const frac = i / (sampleCount - 1);
        const localD = frac * legLenM;
        const absD = leg.startM + localD;
        d.push(localD);
        limitMs.push(limitAtDistanceM(absD) / 3.6);
      }

      const accelEnv = new Array<number>(sampleCount).fill(0);
      const brakeEnv = new Array<number>(sampleCount).fill(0);
      accelEnv[0] = 0;
      for (let i = 1; i < sampleCount; i++) {
        const ds = d[i]! - d[i - 1]!;
        accelEnv[i] = Math.min(limitMs[i]!, Math.sqrt(accelEnv[i - 1]! * accelEnv[i - 1]! + 2 * accelMs2 * ds));
      }
      brakeEnv[sampleCount - 1] = 0;
      for (let i = sampleCount - 2; i >= 0; i--) {
        const ds = d[i + 1]! - d[i]!;
        brakeEnv[i] = Math.min(limitMs[i]!, Math.sqrt(brakeEnv[i + 1]! * brakeEnv[i + 1]! + 2 * brakeMs2 * ds));
      }

      const v = new Array<number>(sampleCount).fill(0).map((_, i) => Math.min(limitMs[i]!, accelEnv[i]!, brakeEnv[i]!));

      for (let i = 0; i < sampleCount - 1; i++) {
        const ds = d[i + 1]! - d[i]!;
        const v0 = v[i]!;
        const v1 = v[i + 1]!;
        const avgV = Math.max(0.01, (v0 + v1) / 2);
        const dt = ds / avgV;
        const startTimeSec = elapsedSec;
        const endTimeSec = elapsedSec + dt;
        const startDistanceKm = (leg.startM + d[i]!) / 1000;
        const endDistanceKm = (leg.startM + d[i + 1]!) / 1000;

        let phase: JourneyProfileSegment['phase'] = 'cruising';
        if (v1 > v0 + 0.2) phase = 'accelerating';
        else if (v1 < v0 - 0.2) phase = 'braking';

        profileSegments.push({
          startTimeSec,
          endTimeSec,
          startSpeedKmh: v0 * 3.6,
          endSpeedKmh: v1 * 3.6,
          startDistanceKm,
          endDistanceKm,
          phase,
          legIndex,
          fromStationIndex: legIndex,
          toStationIndex: legIndex + 1,
          fromStationName: stations[legIndex]?.name,
          toStationName: stations[legIndex + 1]?.name,
        });

        elapsedSec = endTimeSec;
        runningSec += dt;
        maxReachedSpeedKmh = Math.max(maxReachedSpeedKmh, v0 * 3.6, v1 * 3.6);
        profilePoints.push({ timeSec: elapsedSec, speedKmh: v1 * 3.6, distanceKm: endDistanceKm });
      }

      const stationIndex = legIndex + 1;
      const isTerminal = stationIndex === stations.length - 1;
      const dwellTimeSec = isTerminal ? 0 : ((line.stationDwellTimes?.[line.stationIds[stationIndex] ?? ''] ?? 45));
      const arrivalTimeSec = elapsedSec;
      const departureTimeSec = elapsedSec + dwellTimeSec;
      stationStops.push({
        stationIndex,
        name: stations[stationIndex]?.name ?? `Stop ${stationIndex + 1}`,
        arrivalTimeSec,
        departureTimeSec,
        dwellTimeSec,
        distanceKm: leg.endM / 1000,
      });

      if (dwellTimeSec > 0) {
        profileSegments.push({
          startTimeSec: elapsedSec,
          endTimeSec: departureTimeSec,
          startSpeedKmh: 0,
          endSpeedKmh: 0,
          startDistanceKm: leg.endM / 1000,
          endDistanceKm: leg.endM / 1000,
          phase: 'dwell',
          legIndex,
          fromStationIndex: stationIndex,
          toStationIndex: stationIndex,
          fromStationName: stations[stationIndex]?.name,
          toStationName: stations[stationIndex]?.name,
        });
        elapsedSec = departureTimeSec;
        dwellSecTotal += dwellTimeSec;
        profilePoints.push({ timeSec: elapsedSec, speedKmh: 0, distanceKm: leg.endM / 1000 });
      }
    }

    return {
      ...baseStats,
      runningTimeMin: runningSec / 60,
      dwellTimeMin: dwellSecTotal / 60,
      totalTimeMin: elapsedSec / 60,
      maxReachedSpeedKmh,
      profilePoints,
      profileSegments,
      stationStops,
    };
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

      // Dwell time input for intermediate stops (not first/last)
      if (!isFirst && !isLast) {
        const dwellWrap = document.createElement('span');
        dwellWrap.className = 'lm-stop-dwell';
        const dwellInput = document.createElement('input');
        dwellInput.type = 'number';
        dwellInput.className = 'lm-stop-dwell-input';
        dwellInput.min = '5';
        dwellInput.max = '300';
        dwellInput.step = '5';
        dwellInput.title = 'Dwell time (seconds)';
        dwellInput.value = String(line.stationDwellTimes?.[sid] ?? 45);
        dwellInput.addEventListener('change', () => {
          const val = Math.max(5, Math.min(300, parseInt(dwellInput.value, 10) || 45));
          dwellInput.value = String(val);
          if (!line.stationDwellTimes) line.stationDwellTimes = {};
          if (val === 45) { delete line.stationDwellTimes[sid]; }
          else { line.stationDwellTimes[sid] = val; }
          editor.network.save();
        });
        dwellInput.addEventListener('click', (e) => e.stopPropagation());
        const dwellLabel = document.createElement('span');
        dwellLabel.className = 'lm-stop-dwell-label';
        dwellLabel.textContent = 's';
        dwellWrap.appendChild(dwellInput);
        dwellWrap.appendChild(dwellLabel);
        item.appendChild(dwellWrap);
      }

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
    document.getElementById('lm-ts-speed')!.textContent = `${Math.round(stock.maxSpeedKmh * 0.621371)} mph (${stock.maxSpeedKmh} km/h)`;
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

    document.getElementById('lm-ls-distance')!.textContent = `${(stats.totalDistanceKm * 0.621371).toFixed(1)} mi (${stats.totalDistanceKm.toFixed(1)} km)`;
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
              <div class="train-picker-stat-val">${Math.round(train.maxSpeedKmh * 0.621371)}</div>
              <div class="train-picker-stat-lbl">mph</div>
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

    // Always update name + lines + platforms (may have changed)
    (document.getElementById('station-manager-name') as HTMLInputElement).value = station.name;
    (document.getElementById('sm-platform-count') as HTMLInputElement).value = String(station.platforms ?? 2);
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

  const closeClearModal = (): void => {
    hideAnimatedClass(clearModalEl, 'modal', '.clear-modal-box');
  };

  document.getElementById('clear-btn-cancel')!.addEventListener('click', closeClearModal);
  document.getElementById('clear-btn-confirm')!.addEventListener('click', () => {
    closeClearModal();
    closeLineManager();
    closeStationManager();
    editor.clearNetwork();
  });

  clearModalEl.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      closeClearModal();
    }
  });

  // Clear button
  document.getElementById('tool-clear')!.addEventListener('click', () => {
    if (editor.network.stations.length === 0 && editor.network.lines.length === 0) return;
    showAnimatedClass(clearModalEl, 'modal', '.clear-modal-box');
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

  // ── Platform controls ──────────────────────────────────────────────────
  const smPlatformInput = document.getElementById('sm-platform-count') as HTMLInputElement;

  document.getElementById('sm-platform-dec')!.addEventListener('click', () => {
    const state = editor.getState();
    if (!state.selectedStationId) return;
    const station = editor.network.getStation(state.selectedStationId);
    const cur = station?.platforms ?? 2;
    editor.network.setStationPlatforms(state.selectedStationId, cur - 1);
    smPlatformInput.value = String(Math.max(1, cur - 1));
  });

  document.getElementById('sm-platform-inc')!.addEventListener('click', () => {
    const state = editor.getState();
    if (!state.selectedStationId) return;
    const station = editor.network.getStation(state.selectedStationId);
    const cur = station?.platforms ?? 2;
    editor.network.setStationPlatforms(state.selectedStationId, cur + 1);
    smPlatformInput.value = String(Math.min(20, cur + 1));
  });

  smPlatformInput.addEventListener('change', () => {
    const state = editor.getState();
    if (!state.selectedStationId) return;
    const val = Math.max(1, Math.min(20, parseInt(smPlatformInput.value, 10) || 2));
    editor.network.setStationPlatforms(state.selectedStationId, val);
    smPlatformInput.value = String(val);
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
    if (e.key === 'Escape' && isAttributionPopoverOpen()) {
      closeAttributionPopover();
      return;
    }

    if (e.key === 'Escape' && !clearModalEl.classList.contains('hidden')) {
      closeClearModal();
      return;
    }

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

  // ── Mode toggle (Plan / Simulate) ──────────────────────────────────────
  let simMode = false;
  const modeBtnPlan = document.getElementById('mode-btn-plan')!;
  const modeBtnSim  = document.getElementById('mode-btn-sim')!;
  const simToolbar  = document.getElementById('sim-toolbar')!;
  const simHud      = document.getElementById('sim-hud')!;

  function afterNextPaint(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }

  function hideElementImmediately(element: HTMLElement, strategy: VisibilityStrategy = 'class'): void {
    const activeMotion = activeVisibilityMotions.get(element);
    if (activeMotion) {
      activeMotion.animations.forEach((a) => a.cancel());
      activeVisibilityMotions.delete(element);
    }

    if (strategy === 'class') {
      element.classList.add('hidden');
    } else {
      element.style.display = 'none';
    }
    element.dataset.motionState = 'closed';
    element.setAttribute('aria-hidden', 'true');
    element.style.pointerEvents = '';
  }

  async function setSimMode(active: boolean): Promise<void> {
    simMode = active;
    simUiModeActive = active;
    editor.setSimMode(active);
    map.getCanvas().style.cursor = '';
    modeBtnPlan.classList.toggle('mode-btn--active', !active);
    modeBtnSim.classList.toggle('mode-btn--active', active);
    closeAttributionPopover();

    if (active) {
      document.body.classList.add('sim-mode');

      // Allow the class to take effect and flush layout before animating
      await afterNextPaint();

      // Immediately hide overlays panel so it never appears in the sim UI
      hideElementImmediately(overlaysPanelEl);
      // Disable the toggle so the user cannot expand overlays while simulating
      try {
        overlaysPanelToggleBtn.disabled = true;
        overlaysPanelToggleBtn.setAttribute('aria-hidden', 'true');
        overlaysPanelToggleBtn.style.visibility = 'hidden';
      } catch {
        // ignore if toggle button missing
      }

      // Start entrance animations (don't await here — let them run)
      void showAnimatedClass(simToolbar, 'panel');
      void showAnimatedClass(simHud, 'panel');

      trainRenderer.setVisible(true);
      signalSystem.setVisible(true);

      // Defer expensive simulation init to after the paint so animations stay smooth
      const initSim = () => {
        if (!sim.isRunning()) {
          sim.reinit();
          rebuildTimetable();
          sim.start();
          syncPlayBtn();
        }
        // Camera movement can be expensive; run after a small delay/idle window
        fitMapToNetwork();
        syncSimSpeedKeyUi();
      };

      if ('requestIdleCallback' in window) {
        try {
          (window as any).requestIdleCallback(initSim, { timeout: 250 });
        } catch {
          setTimeout(initSim, 60);
        }
      } else {
        setTimeout(initSim, 60);
      }
    } else {
      // Kick off hide animations and wait for them to finish before doing heavy cleanup
      const hides: Promise<void>[] = [];
      hides.push(hideAnimatedClass(simToolbar, 'panel'));
      hides.push(hideAnimatedClass(simHud, 'panel'));
      hides.push(hideAnimatedClass(tdPanel, 'panel'));
      hides.push(hideAnimatedClass(sigDetailPanel, 'panel'));
      hides.push(hideAnimatedClass(ttModal, 'modal', '.timetable-box'));

      depBoard.close();
      followedTrainId = null;
      updateFollowedState();

      // await animations, but use a reasonable timeout fallback to avoid locking forever
      await Promise.race([
        Promise.allSettled(hides.map((p) => (p as Promise<void>).catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ]);

      if (sim.isRunning()) {
        sim.stop();
        syncPlayBtn();
      }

      // Clear and hide train/signal layers so they don't bleed into plan mode
      trainRenderer.update([], undefined);
      signalSystem.clear();
      trainRenderer.setVisible(false);
      signalSystem.setVisible(false);
      speedHoverTooltipEl?.classList.add('hidden');
      syncSimSpeedKeyUi();

      // Remove sim-mode first so plan UI is visible, then animate overlays in
      document.body.classList.remove('sim-mode');
      // allow paint then show overlays with animation and re-enable toggle
      await afterNextPaint();
      try {
        overlaysPanelToggleBtn.disabled = false;
        overlaysPanelToggleBtn.removeAttribute('aria-hidden');
        overlaysPanelToggleBtn.style.visibility = '';
      } catch {
        // ignore if toggle button missing
      }
      void showAnimatedClass(overlaysPanelEl, 'panel');
    }
  }

  modeBtnPlan.addEventListener('click', () => setSimMode(false));
  modeBtnSim.addEventListener('click', () => setSimMode(true));

  /** Fit map to the bounds of the network so trains/signals are visible. */
  function fitMapToNetwork(): void {
    const stations = simNetwork.stations;
    if (stations.length < 2) return;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const s of stations) {
      if (s.lng < minLng) minLng = s.lng;
      if (s.lng > maxLng) maxLng = s.lng;
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
    }
    const pad = 0.02; // small padding in degrees
    map.fitBounds(
      [[minLng - pad, minLat - pad], [maxLng + pad, maxLat + pad]],
      { padding: { top: 80, bottom: 80, left: 240, right: 60 }, maxZoom: 14, duration: 1200 },
    );
  }

  // ── Simulation ──────────────────────────────────────────────────────────

  const sim = new Simulation(editor.network);
  const trainRenderer = new TrainRenderer(map);
  const signalSystem  = new SignalSystem(map);
  const depBoard      = new DepartureBoard();
  const simNetwork    = editor.network;
  _w['__sim'] = sim;

  function ensureNetworkTrackSpeedLayer(): void {
    if (!map.getSource(NETWORK_TRACK_SPEED_SOURCE_ID)) {
      map.addSource(NETWORK_TRACK_SPEED_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(NETWORK_TRACK_SPEED_LAYER_ID)) {
      map.addLayer({
        id: NETWORK_TRACK_SPEED_LAYER_ID,
        type: 'line',
        source: NETWORK_TRACK_SPEED_SOURCE_ID,
        minzoom: 6,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['to-number', ['get', 'speedKmh'], 0],
            0,   '#6b7280',
            40,  '#dc2626',
            80,  '#f59e0b',
            120, '#22c55e',
            160, '#06b6d4',
            220, '#3b82f6',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'],
            6, 1.2, 10, 2.6, 14, 4.2, 18, 6,
          ],
          'line-opacity': ['interpolate', ['linear'], ['zoom'],
            6, 0.65, 10, 0.85, 16, 1,
          ],
        },
      }, 'network-station-label');
    }
  }

  function updateNetworkTrackSpeedOverlayData(): void {
    const source = map.getSource(NETWORK_TRACK_SPEED_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const features: GeoJSON.Feature[] = [];
    for (const line of editor.network.lines) {
      const cache = sim.getPolylineCaches().get(line.id);
      if (!cache) continue;
      const coords = cache.coordinates;
      const limits = cache.curvatureLimitsKmh;
      if (coords.length < 2 || limits.length < 2) continue;

      for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1]!;
        const curr = coords[i]!;

        const leftLimit = limits[i - 1]! >= 999 ? cache.lineMaxSpeedKmh : limits[i - 1]!;
        const rightLimit = limits[i]! >= 999 ? cache.lineMaxSpeedKmh : limits[i]!;
        const speedKmh = Math.max(10, Math.min(cache.lineMaxSpeedKmh, Math.min(leftLimit, rightLimit)));

        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [prev, curr],
          },
          properties: {
            lineId: line.id,
            lineName: line.name,
            speedKmh: Math.round(speedKmh),
          },
        });
      }
    }

    source.setData({ type: 'FeatureCollection', features });
  }

  ensureNetworkTrackSpeedLayer();
  updateNetworkTrackSpeedOverlayData();
  if (map.getLayer(NETWORK_TRACK_SPEED_LAYER_ID)) {
    map.setLayoutProperty(NETWORK_TRACK_SPEED_LAYER_ID, 'visibility', trackSpeedOverlayEnabled ? 'visible' : 'none');
  }

  // Once OSM speed data finishes loading, rebuild polyline caches so
  // curvature limits incorporate real track speed limits.
  railSpeedIndex.onLoaded(() => {
    sim.rebuildPolylineCaches();
    updateNetworkTrackSpeedOverlayData();
  });

  // ── Timetable ─────────────────────────────────────────────────────────
  let timetable: Timetable | null = null;
  const ttConfigs = new Map<string, LineTimetableConfig>();

  function rebuildTimetable(): void {
    timetable = buildTimetable(simNetwork, sim.getPolylineCaches(), ttConfigs, sim.getState().stationWeights);
  }

  // ── Train detail panel state ──────────────────────────────────────────
  let followedTrainId: string | null = null;
  const tdPanel      = document.getElementById('train-detail-panel')!;
  const tdColorBar   = document.getElementById('train-detail-color-bar')!;
  const tdLine       = document.getElementById('train-detail-line')!;
  const tdStock      = document.getElementById('train-detail-stock')!;
  const tdHeadcode   = document.getElementById('train-detail-headcode')!;
  const tdServiceDesc = document.getElementById('td-service-desc')!;
  const tdSpeed      = document.getElementById('td-speed')!;
  const tdStatus     = document.getElementById('td-status')!;
  const tdOccupancy  = document.getElementById('td-occupancy')!;
  const tdNextName   = document.getElementById('td-next-name')!;
  const tdCarRow     = document.getElementById('td-carriage-row')!;
  const tdFollowBtn  = document.getElementById('train-detail-follow')!;

  function updateFollowedState(): void {
    const trains = sim.getTrains();
    for (const t of trains) {
      t.isFollowed = t.id === followedTrainId;
    }
    tdFollowBtn.classList.toggle('following', followedTrainId !== null);
    tdFollowBtn.textContent = followedTrainId !== null ? 'Following' : 'Follow';
  }

  tdFollowBtn.addEventListener('click', () => {
    if (!followedTrainId) {
      // Find the train that's currently displayed
      const trainId = tdPanel.dataset.trainId;
      if (trainId) {
        followedTrainId = trainId;
        updateFollowedState();
        // Instant camera jump with offset — train appears above the panel
        const t = sim.getTrains().find((tr) => tr.id === trainId);
        if (t) map.easeTo({ center: [t.lng, t.lat], zoom: Math.max(map.getZoom(), 13), offset: [0, -120], duration: 0 });
      }
    } else {
      followedTrainId = null;
      updateFollowedState();
    }
  });

  document.getElementById('train-detail-close')!.addEventListener('click', () => {
    followedTrainId = null;
    updateFollowedState();
    hideAnimatedClass(tdPanel, 'panel');
  });

  function openTrainDetail(train: TrainState): void {
    tdPanel.dataset.trainId = train.id;
    tdColorBar.style.background = train.lineColor;
    tdLine.textContent = train.lineName;
    tdStock.textContent = `${train.rollingStockName} · ${train.carsPerUnit} cars`;
    tdHeadcode.textContent = train.headcode;
    tdServiceDesc.textContent = train.serviceDescription;
    showAnimatedClass(tdPanel, 'panel');
    ensureFloatingPanelInViewport('train-detail-panel', tdPanel);
    updateTrainDetail(train);
  }

  function formatStatusLabel(train: TrainState): string {
    switch (train.status) {
      case 'running': return train.speedKmh < 1 ? 'Stopping' : 'Running';
      case 'dwelling': return 'At station';
      case 'waiting_signal': return 'Signal held';
      case 'turnaround': return 'Turnaround';
      default: return train.status;
    }
  }

  function updateTrainDetail(train: TrainState): void {
    const speedText = `${Math.round(train.speedKmh * 0.621371)} mph`;
    if (tdSpeed.textContent !== speedText) tdSpeed.textContent = speedText;
    const statusText = formatStatusLabel(train);
    if (tdStatus.textContent !== statusText) tdStatus.textContent = statusText;
    const occText = `${Math.round(train.occupancy * 100)}%`;
    if (tdOccupancy.textContent !== occText) tdOccupancy.textContent = occText;
    if (tdNextName.textContent !== train.nextStationName) tdNextName.textContent = train.nextStationName;
    if (tdHeadcode.textContent !== train.headcode) tdHeadcode.textContent = train.headcode;
    if (tdServiceDesc.textContent !== train.serviceDescription) tdServiceDesc.textContent = train.serviceDescription;
    renderThameslinkDisplay(tdCarRow, train);
  }

  // ── PIS screen cycling state ──────────────────────────────────────────
  type PisScreen = 'destination' | 'loading' | 'callingAt' | 'held';
  const PIS_BASE_SCREENS: PisScreen[] = ['destination', 'loading', 'callingAt'];
  const PIS_ALL_SCREENS: PisScreen[] = ['destination', 'loading', 'callingAt', 'held'];
  const PIS_CYCLE_MS = 6000; // 6 seconds per screen
  let pisCurrentScreen: PisScreen = 'destination';
  let pisLastSwitchMs = 0;
  let pisHeldWasActive = false;

  /**
   * Render a Thameslink Class 700-style passenger information display.
   * Cycles between screens: destination, loading diagram, calling points.
   * Dark navy LCD with scanlines, amber/white text, authentic GTR colours.
   */
  function renderThameslinkDisplay(container: HTMLElement, train: TrainState): void {
    const cars = train.carsPerUnit;
    const carLoads = train.carLoads && train.carLoads.length === cars
      ? train.carLoads
      : new Array(cars).fill(train.occupancy) as number[];

    const now = performance.now();
    const heldPageActive = train.signalHeldSec >= 10;
    const activeScreens = heldPageActive ? PIS_ALL_SCREENS : PIS_BASE_SCREENS;

    if (heldPageActive) {
      // First activation: immediately show held page.
      if (!pisHeldWasActive) {
        pisCurrentScreen = 'held';
        pisLastSwitchMs = now;
      }
      // If user manually moved away, return to held after one normal cycle period.
      if (pisCurrentScreen !== 'held' && now - pisLastSwitchMs > PIS_CYCLE_MS) {
        pisCurrentScreen = 'held';
        pisLastSwitchMs = now;
      }
      // While held page is visible, pause auto-cycling.
    } else {
      // Hold cleared: remove held page and continue normal cycling.
      if (pisCurrentScreen === 'held') {
        pisCurrentScreen = 'destination';
        pisLastSwitchMs = now;
      }
      if (!PIS_BASE_SCREENS.includes(pisCurrentScreen)) {
        pisCurrentScreen = 'destination';
        pisLastSwitchMs = now;
      }
      if (now - pisLastSwitchMs > PIS_CYCLE_MS) {
        pisLastSwitchMs = now;
        const idx = PIS_BASE_SCREENS.indexOf(pisCurrentScreen);
        pisCurrentScreen = PIS_BASE_SCREENS[(idx + 1) % PIS_BASE_SCREENS.length]!;
      }
    }
    pisHeldWasActive = heldPageActive;
    container.dataset.tlfHeldActive = heldPageActive ? '1' : '0';

    // Compute passenger count
    const capacity = train.totalCapacity;
    const capPerCar = capacity / cars;
    let totalPax = 0;
    for (let c = 0; c < cars; c++) totalPax += Math.round(carLoads[c]! * capPerCar);

    // Build/rebuild DOM when car count changes
    if (!container.dataset.tlfCars || parseInt(container.dataset.tlfCars) !== cars) {
      container.dataset.tlfCars = String(cars);
      container.innerHTML = '';

      const screen = document.createElement('div');
      screen.className = 'tlf-screen';

      // Scanline overlay
      const scanlines = document.createElement('div');
      scanlines.className = 'tlf-scanlines';
      screen.appendChild(scanlines);

      // ── Screen 1: Destination ──
      const destScreen = document.createElement('div');
      destScreen.className = 'tlf-page tlf-page-dest';
      destScreen.id = 'tlf-page-dest';
      const destHeading = document.createElement('div');
      destHeading.className = 'tlf-dest-heading';
      destHeading.textContent = 'This train is for';
      destScreen.appendChild(destHeading);
      const destName = document.createElement('div');
      destName.className = 'tlf-dest-name';
      destName.id = 'tlf-dest-name';
      destScreen.appendChild(destName);
      const destPaxRow = document.createElement('div');
      destPaxRow.className = 'tlf-pax-count';
      destPaxRow.id = 'tlf-pax-count-dest';
      destScreen.appendChild(destPaxRow);
      screen.appendChild(destScreen);

      // ── Screen 2: Loading diagram ──
      const loadScreen = document.createElement('div');
      loadScreen.className = 'tlf-page tlf-page-load';
      loadScreen.id = 'tlf-page-load';

      const loadHeader = document.createElement('div');
      loadHeader.className = 'tlf-load-header';
      const loadNextStop = document.createElement('span');
      loadNextStop.className = 'tlf-load-next';
      loadNextStop.id = 'tlf-load-next';
      loadHeader.appendChild(loadNextStop);
      const loadLabel = document.createElement('span');
      loadLabel.className = 'tlf-load-label';
      loadLabel.id = 'tlf-load-label';
      loadHeader.appendChild(loadLabel);
      loadScreen.appendChild(loadHeader);

      const trainRow = document.createElement('div');
      trainRow.className = 'tlf-train';
      for (let i = 0; i < cars; i++) {
        const carWrap = document.createElement('div');
        carWrap.className = 'tlf-car-wrap';
        const car = document.createElement('div');
        car.className = 'tlf-car';
        if (i === 0) car.classList.add('tlf-car-front');
        if (i === cars - 1) car.classList.add('tlf-car-rear');
        const fill = document.createElement('div');
        fill.className = 'tlf-car-fill';
        car.appendChild(fill);
        for (const side of ['top', 'bottom'] as const) {
          for (let d = 0; d < 2; d++) {
            const door = document.createElement('div');
            door.className = `tlf-door tlf-door-${side}`;
            door.style.left = `${25 + d * 50}%`;
            car.appendChild(door);
          }
        }
        const win = document.createElement('div');
        win.className = 'tlf-car-window';
        car.appendChild(win);
        carWrap.appendChild(car);
        const numLabel = document.createElement('div');
        numLabel.className = 'tlf-car-num';
        numLabel.textContent = String(i + 1);
        carWrap.appendChild(numLabel);
        trainRow.appendChild(carWrap);
      }
      loadScreen.appendChild(trainRow);

      const legend = document.createElement('div');
      legend.className = 'tlf-legend';
      for (const [label, cls] of [['Not busy', 'tlf-leg-green'], ['Busy', 'tlf-leg-amber'], ['Very busy', 'tlf-leg-red']] as const) {
        const item = document.createElement('span');
        item.className = `tlf-leg-item ${cls}`;
        const dot = document.createElement('span');
        dot.className = 'tlf-leg-dot';
        item.appendChild(dot);
        item.appendChild(document.createTextNode(label));
        legend.appendChild(item);
      }
      loadScreen.appendChild(legend);

      const paxCountLoad = document.createElement('div');
      paxCountLoad.className = 'tlf-pax-count';
      paxCountLoad.id = 'tlf-pax-count-load';
      loadScreen.appendChild(paxCountLoad);
      screen.appendChild(loadScreen);

      // ── Screen 3: Calling at ──
      const callScreen = document.createElement('div');
      callScreen.className = 'tlf-page tlf-page-call';
      callScreen.id = 'tlf-page-call';
      const callHeading = document.createElement('div');
      callHeading.className = 'tlf-call-heading';
      callHeading.textContent = 'Calling at:';
      callScreen.appendChild(callHeading);
      const callList = document.createElement('div');
      callList.className = 'tlf-call-list';
      callList.id = 'tlf-call-list';
      callScreen.appendChild(callList);
      screen.appendChild(callScreen);

      // ── Screen 4: Held at red signal ──
      const heldPageScreen = document.createElement('div');
      heldPageScreen.className = 'tlf-page tlf-page-held-screen';
      heldPageScreen.id = 'tlf-page-held-screen';
      const heldSignalHeader = document.createElement('div');
      heldSignalHeader.className = 'tlf-held-screen-header';
      heldSignalHeader.textContent = '⬤ RED SIGNAL';
      heldPageScreen.appendChild(heldSignalHeader);
      const heldScreenMsg = document.createElement('div');
      heldScreenMsg.className = 'tlf-held-screen-msg';
      heldScreenMsg.textContent = 'This train has been held';
      heldPageScreen.appendChild(heldScreenMsg);
      const heldScreenSub = document.createElement('div');
      heldScreenSub.className = 'tlf-held-screen-sub';
      heldScreenSub.textContent = 'We apologise for the delay';
      heldPageScreen.appendChild(heldScreenSub);
      screen.appendChild(heldPageScreen);

      // ── Prev / Next nav buttons ──
      const nav = document.createElement('div');
      nav.className = 'tlf-nav';
      const prevBtn = document.createElement('button');
      prevBtn.className = 'tlf-nav-btn';
      prevBtn.textContent = '◀';
      prevBtn.title = 'Previous page';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const heldActive = container.dataset.tlfHeldActive === '1';
        const screens = heldActive ? PIS_ALL_SCREENS : PIS_BASE_SCREENS;
        const idx = Math.max(0, screens.indexOf(pisCurrentScreen));
        pisCurrentScreen = screens[(idx - 1 + screens.length) % screens.length]!;
        pisLastSwitchMs = performance.now();
      });
      const nextBtn = document.createElement('button');
      nextBtn.className = 'tlf-nav-btn';
      nextBtn.textContent = '▶';
      nextBtn.title = 'Next page';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const heldActive = container.dataset.tlfHeldActive === '1';
        const screens = heldActive ? PIS_ALL_SCREENS : PIS_BASE_SCREENS;
        const idx = Math.max(0, screens.indexOf(pisCurrentScreen));
        pisCurrentScreen = screens[(idx + 1) % screens.length]!;
        pisLastSwitchMs = performance.now();
      });
      nav.appendChild(prevBtn);
      // Page dots
      for (const page of PIS_ALL_SCREENS) {
        const dot = document.createElement('span');
        dot.className = 'tlf-nav-dot';
        dot.dataset.screen = page;
        nav.appendChild(dot);
      }
      nav.appendChild(nextBtn);
      screen.appendChild(nav);

      container.appendChild(screen);
    }

    // ── Show/hide pages based on cycle ──
    const pageDest = container.querySelector('#tlf-page-dest') as HTMLElement;
    const pageLoad = container.querySelector('#tlf-page-load') as HTMLElement;
    const pageCall = container.querySelector('#tlf-page-call') as HTMLElement;
    const pageHeldScreen = container.querySelector('#tlf-page-held-screen') as HTMLElement;
    if (pageDest) pageDest.style.display = pisCurrentScreen === 'destination' ? '' : 'none';
    if (pageLoad) pageLoad.style.display = pisCurrentScreen === 'loading' ? '' : 'none';
    if (pageCall) pageCall.style.display = pisCurrentScreen === 'callingAt' ? '' : 'none';
    if (pageHeldScreen) pageHeldScreen.style.display = heldPageActive && pisCurrentScreen === 'held' ? '' : 'none';

    // Update page dots
    const dots = container.querySelectorAll<HTMLElement>('.tlf-nav-dot');
    dots.forEach((dot) => {
      const dotScreen = dot.dataset.screen as PisScreen | undefined;
      const show = !!dotScreen && activeScreens.includes(dotScreen);
      dot.style.display = show ? '' : 'none';
      dot.classList.toggle('tlf-nav-dot-active', show && dotScreen === pisCurrentScreen);
    });

    // ── Update destination page ──
    const destNameEl = container.querySelector('#tlf-dest-name') as HTMLElement;
    if (destNameEl) {
      const text = train.destinationName.toUpperCase();
      if (destNameEl.textContent !== text) destNameEl.textContent = text;
    }
    const paxDestEl = container.querySelector('#tlf-pax-count-dest') as HTMLElement;
    if (paxDestEl) {
      const paxText = `${totalPax} / ${capacity} passengers`;
      if (paxDestEl.textContent !== paxText) paxDestEl.textContent = paxText;
    }

    // ── Update loading page ──
    const loadNextEl = container.querySelector('#tlf-load-next') as HTMLElement;
    if (loadNextEl) {
      const nextText = train.status === 'dwelling'
        ? train.nextStationName
        : `Next: ${train.nextStationName}`;
      if (loadNextEl.textContent !== nextText) loadNextEl.textContent = nextText;
    }
    const loadLabelEl = container.querySelector('#tlf-load-label') as HTMLElement;
    if (loadLabelEl) {
      const avgLoad = train.occupancy;
      const label = avgLoad > 0.8 ? 'Very busy' : avgLoad > 0.5 ? 'Busy' : 'Not busy';
      const colour = avgLoad > 0.8 ? '#ef4444' : avgLoad > 0.5 ? '#f59e0b' : '#4ade80';
      if (loadLabelEl.textContent !== label) {
        loadLabelEl.textContent = label;
        loadLabelEl.style.color = colour;
      }
    }
    const carEls = container.querySelectorAll<HTMLElement>('.tlf-car');
    for (let i = 0; i < cars; i++) {
      const carEl = carEls[i];
      if (!carEl) continue;
      const load = carLoads[i]!;
      const fillEl = carEl.querySelector<HTMLElement>('.tlf-car-fill');
      if (fillEl) {
        const pct = Math.round(load * 100);
        fillEl.style.height = `${pct}%`;
        fillEl.style.background = load > 0.8 ? '#ef4444' : load > 0.5 ? '#f59e0b' : '#4ade80';
      }
      carEl.title = `Car ${i + 1}: ${Math.round(load * 100)}%`;
    }
    const paxLoadEl = container.querySelector('#tlf-pax-count-load') as HTMLElement;
    if (paxLoadEl) {
      const paxText = `${totalPax} / ${capacity} passengers`;
      if (paxLoadEl.textContent !== paxText) paxLoadEl.textContent = paxText;
    }

    // ── Update calling-at page ──
    const callListEl = container.querySelector('#tlf-call-list') as HTMLElement;
    if (callListEl) {
      // Build calling points from the line's station list
      const line = editor.network.lines.find(l => l.id === train.lineId);
      if (line) {
        const stationIds = line.stationIds;
        const nextIdx = train.nextStationIndex;
        const dir = train.direction;
        const sc = stationIds.length;
        const pisCache = sim.getPolylineCaches().get(train.lineId);
        const rows: { name: string; eta: string }[] = [];
        const holdBeforeDepartureSec = train.status === 'dwelling' || train.status === 'turnaround'
          ? train.dwellRemainingSec
          : 0;
        const fmtEta = (remainingSec: number): string => {
          const roundedMinutes = Math.max(0, Math.round(remainingSec / 60));
          if (roundedMinutes >= 60) {
            const hours = Math.floor(roundedMinutes / 60);
            const minutes = roundedMinutes % 60;
            return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
          }
          return `${roundedMinutes}m`;
        };
        const reverseArrivalOffsetSec = (profileArrivalSec: number): number => {
          const terminalArrivalSec = pisCache?.stationStops[sc - 1]?.arrivalTimeSec ?? 0;
          return Math.max(0, terminalArrivalSec - profileArrivalSec);
        };
        const profileEtaSec = (profileArrivalSec: number, direction: 'forward' | 'reverse'): string => {
          const targetOffsetSec = direction === 'forward'
            ? profileArrivalSec
            : reverseArrivalOffsetSec(profileArrivalSec);
          const remaining = Math.max(0, targetOffsetSec - train.legElapsedSec) + holdBeforeDepartureSec;
          return fmtEta(remaining);
        };
        if (dir === 'forward') {
          for (let i = nextIdx; i < stationIds.length; i++) {
            const sid = stationIds[i]!;
            const st = editor.network.stations.find(s => s.id === sid);
            const profileStop = pisCache?.stationStops[i];
            const eta = profileStop ? profileEtaSec(profileStop.arrivalTimeSec, dir) : '';
            rows.push({ name: st?.name ?? sid, eta });
          }
        } else {
          for (let i = nextIdx; i >= 0; i--) {
            const sid = stationIds[i]!;
            const st = editor.network.stations.find(s => s.id === sid);
            const profileStop = pisCache?.stationStops[sc - 1 - i];
            const eta = profileStop ? profileEtaSec(profileStop.arrivalTimeSec, dir) : '';
            rows.push({ name: st?.name ?? sid, eta });
          }
        }
          const newKey = rows.map(r => `${r.name}|${r.eta}`).join('\n');
          if (callListEl.dataset.rowKey !== newKey) {
            callListEl.dataset.rowKey = newKey;
            callListEl.innerHTML = '';
            for (const row of rows) {
              const rowEl = document.createElement('div');
              rowEl.className = 'tlf-call-row';
              const nameEl = document.createElement('span');
              nameEl.className = 'tlf-call-name';
              nameEl.textContent = row.name;
              rowEl.appendChild(nameEl);
              if (row.eta) {
                const etaEl = document.createElement('span');
                etaEl.className = 'tlf-call-eta';
                etaEl.textContent = row.eta;
                rowEl.appendChild(etaEl);
              }
              callListEl.appendChild(rowEl);
            }
          }
      }
    }
  }

  // ── Signal detail panel state ─────────────────────────────────────────
  const sigDetailPanel = document.getElementById('signal-detail-panel')!;
  const sdAspect       = document.getElementById('signal-detail-aspect')!;
  const sdLine         = document.getElementById('signal-detail-line')!;
  const sdBlockId      = document.getElementById('sd-block-id')!;
  const sdDistance      = document.getElementById('sd-distance')!;
  const sdAdjList      = document.getElementById('sd-adj-list')!;
  const sdIcon         = document.getElementById('signal-detail-icon')!;

  const tdHeader = document.getElementById('train-detail-header');
  const sigHeader = document.getElementById('signal-detail-header');
  const dbHeader = document.getElementById('db-header');
  if (tdHeader) setupDraggableFloatingPanel('train-detail-panel', tdPanel, tdHeader);
  if (sigHeader) setupDraggableFloatingPanel('signal-detail-panel', sigDetailPanel, sigHeader);
  if (dbHeader) {
    const boardPanel = document.getElementById('departure-board');
    if (boardPanel) setupDraggableFloatingPanel('departure-board', boardPanel, dbHeader);
  }

  document.getElementById('signal-detail-close')!.addEventListener('click', () => {
    delete sigDetailPanel.dataset.signalId;
    hideAnimatedClass(sigDetailPanel, 'panel');
  });

  function openSignalDetail(info: SignalInfo): void {
    sigDetailPanel.dataset.signalId = info.signalId;
    sdAspect.textContent = ASPECT_LABEL[info.aspect];
    sdAspect.style.color = info.aspect === 'red' ? '#ef4444'
      : info.aspect.includes('yellow') ? '#f59e0b'
      : '#22c55e';
    sdLine.textContent = `${info.lineName} (${info.direction === 'forward' ? '→' : '←'})`;
    sdLine.style.color = info.lineColor;
    sdBlockId.textContent = `Block ${info.blockIndex}`;

    // Show both distance and speed info
    const distText = `${(info.distanceM / 1000).toFixed(1)} km`;
    const lineSpeedMph = info.lineSpeedKmh > 0 ? Math.round(info.lineSpeedKmh * 0.621371) : 0;
    const lineSpeedText = info.lineSpeedKmh > 0 ? `Line: ${lineSpeedMph} mph (${info.lineSpeedKmh} km/h)` : '';
    const sigSpeedMph = info.signalSpeedKmh > 0 ? Math.round(info.signalSpeedKmh * 0.621371) : 0;
    const sigSpeedText = info.signalSpeedKmh > 0
      ? `Signal: ${sigSpeedMph} mph (${info.signalSpeedKmh} km/h)`
      : info.aspect === 'red' ? 'Signal: STOP' : '';
    sdDistance.innerHTML = `${distText}${lineSpeedText ? `<br><span style="font-size:11px;opacity:0.8">${lineSpeedText}</span>` : ''}${sigSpeedText ? `<br><span style="font-size:11px;opacity:0.8">${sigSpeedText}</span>` : ''}`;

    sdAdjList.textContent = info.adjacentTrains.length > 0
      ? info.adjacentTrains.join(', ')
      : 'None';

    // Draw realistic UK colour-light signal SVG
    const topColor = info.aspect === 'red' ? '#ef4444'
      : info.aspect.includes('yellow') ? '#f59e0b'
      : '#22c55e';
    const glowTop = info.aspect === 'green' ? 'rgba(34,197,94,0.5)'
      : info.aspect === 'red' ? 'rgba(239,68,68,0.5)'
      : 'rgba(245,158,11,0.5)';
    const bottomColor = info.aspect === 'double-yellow' ? '#f59e0b' : '#2a2a3a';
    const glowBottom = info.aspect === 'double-yellow' ? 'rgba(245,158,11,0.4)' : 'none';
    const dirArrow = info.direction === 'forward' ? '→' : '←';
    sdIcon.innerHTML = `<svg width="36" height="72" viewBox="0 0 36 72">
      <!-- Post -->
      <rect x="15" y="48" width="6" height="24" rx="1.5" fill="#3a3a4e"/>
      <!-- Housing -->
      <rect x="3" y="0" width="30" height="50" rx="7" fill="#1a1a2e" stroke="#5a5a6e" stroke-width="1.5"/>
      <rect x="6" y="3" width="24" height="44" rx="5" fill="#111122"/>
      <!-- Top light glow -->
      <circle cx="18" cy="16" r="11" fill="${glowTop}" opacity="0.45"/>
      <!-- Top light -->
      <circle cx="18" cy="16" r="7" fill="${topColor}" opacity="0.95"/>
      <circle cx="18" cy="16" r="3.5" fill="white" opacity="0.3"/>
      <!-- Bottom light glow -->
      ${glowBottom !== 'none' ? `<circle cx="18" cy="34" r="10" fill="${glowBottom}" opacity="0.4"/>` : ''}
      <!-- Bottom light -->
      <circle cx="18" cy="34" r="7" fill="${bottomColor}" opacity="0.95"/>
      ${info.aspect === 'double-yellow' ? '<circle cx="18" cy="34" r="3.5" fill="white" opacity="0.2"/>' : ''}
      <!-- Visor hoods -->
      <path d="M7.5,9 Q18,5 28.5,9" stroke="#2a2a3e" stroke-width="2" fill="none"/>
      <path d="M7.5,27 Q18,23 28.5,27" stroke="#2a2a3e" stroke-width="2" fill="none"/>
      <!-- Direction label -->
      <text x="18" y="65" text-anchor="middle" fill="#aaa" font-size="11">${dirArrow}</text>
    </svg>`;

    showAnimatedClass(sigDetailPanel, 'panel');
    ensureFloatingPanelInViewport('signal-detail-panel', sigDetailPanel);
  }

  // ── Sim HUD ───────────────────────────────────────────────────────────
  const hudTrains   = document.getElementById('sim-hud-trains')!;
  const hudPax      = document.getElementById('sim-hud-pax')!;
  const hudAvgSpeed = document.getElementById('sim-hud-avgspeed')!;
  const hudOnTime   = document.getElementById('sim-hud-ontime')!;
  const hudRevenue  = document.getElementById('sim-hud-revenue')!;
  const hudCost     = document.getElementById('sim-hud-cost')!;
  const hudDelivered = document.getElementById('sim-hud-delivered')!;
  const hudSatisfaction = document.getElementById('sim-hud-satisfaction')!;

  function updateHud(trains: TrainState[]): void {
    hudTrains.textContent = String(trains.length);
    let totalPax = 0;
    let speedSum = 0;
    let running = 0;
    let waitingSignal = 0;
    for (const t of trains) {
      totalPax += Math.round(t.occupancy * t.totalCapacity);
      if (t.status === 'running') {
        speedSum += t.speedKmh;
        running++;
      }
      if (t.status === 'waiting_signal') waitingSignal++;
    }
    hudPax.textContent = totalPax.toLocaleString('en-GB');
    hudAvgSpeed.textContent = running > 0 ? `${Math.round((speedSum / running) * 0.621371)}` : '0';

    // Real on-time performance: trains not held at signals
    const onTimePct = trains.length > 0
      ? Math.round(((trains.length - waitingSignal) / trains.length) * 100)
      : 100;
    hudOnTime.textContent = `${onTimePct}%`;
    hudOnTime.style.color = onTimePct >= 90 ? '#22c55e' : onTimePct >= 70 ? '#f59e0b' : '#ef4444';

    // Game metrics
    const metrics = sim.getMetrics();
    hudRevenue.textContent = metrics.totalRevenue >= 1000
      ? `£${(metrics.totalRevenue / 1000).toFixed(1)}k`
      : `£${Math.round(metrics.totalRevenue)}`;
    hudCost.textContent = `£${metrics.operatingCostPerHour.toLocaleString('en-GB')}/hr`;
    hudDelivered.textContent = metrics.totalPassengersDelivered.toLocaleString('en-GB');

    const sat = Math.round(metrics.satisfaction);
    hudSatisfaction.textContent = `${sat}%`;
    hudSatisfaction.style.color = sat >= 80 ? '#22c55e' : sat >= 60 ? '#f59e0b' : '#ef4444';
  }

  // ── Sim clock formatter ───────────────────────────────────────────────
  const simClockEl = document.getElementById('sim-clock')!;

  function formatSimClock(sec: number): string {
    const base = 6 * 3600;
    const total = Math.floor(base + sec) % 86400;
    const h = Math.floor(total / 3600) % 24;
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── Tick callback ─────────────────────────────────────────────────────
  sim.setOnTick(() => {
    const trains = sim.getTrains();

    // Update train headcodes and service descriptions from the timetable
    if (timetable) {
      const simSec = sim.getSimTimeSec();
      for (const t of trains) {
        const cache = sim.getPolylineCaches().get(t.lineId);
        if (!cache) continue;
        const svc = findActiveService(timetable, t.lineId, t.direction, simSec, cache, t.legElapsedSec);
        if (svc) {
          t.headcode = svc.headcode;
          t.serviceDescription = svc.description;
          t.originName = svc.originName;
          t.destinationName = svc.destinationName;
        }
      }
    }

    trainRenderer.update(trains, sim.getPolylineCaches());
    signalSystem.update(sim, simNetwork, map.getZoom());
    simClockEl.textContent = formatSimClock(sim.getSimTimeSec());

    if (simMode) updateHud(trains);

    if (depBoard.isOpen()) {
      depBoard.update(sim, simNetwork);
    }

    // Refresh detail panel for the currently open train on every tick
    if (!tdPanel.classList.contains('hidden')) {
      const visId = tdPanel.dataset.trainId;
      const vt = visId ? trains.find((tr) => tr.id === visId) : undefined;
      if (vt) updateTrainDetail(vt);
    }

    // Refresh signal detail panel live on every tick
    if (!sigDetailPanel.classList.contains('hidden')) {
      const openSigId = sigDetailPanel.dataset.signalId;
      if (openSigId) {
        const info = signalSystem.getSignals().find(s => s.signalId === openSigId);
        if (info) openSignalDetail(info);
      }
    }

    // Update camera follow — offset so train sits above the detail panel
    if (followedTrainId && !userInteracting) {
      const t = trains.find((tr) => tr.id === followedTrainId);
      if (t) {
        // Offset upward so the train is centred in the visible area above the panel
        // The detail panel is ~350px from the bottom; shift focal point up by ~150px
        map.easeTo({ center: [t.lng, t.lat], offset: [0, -120], duration: 0, easing: (t) => t });
      } else {
        followedTrainId = null;
        updateFollowedState();
        hideAnimatedClass(tdPanel, 'panel');
      }
    }
  });

  // ── Play/Pause button ─────────────────────────────────────────────────
  const simPlayBtn   = document.getElementById('sim-btn-play')!;
  const simIconPlay  = document.getElementById('sim-icon-play')!;
  const simIconPause = document.getElementById('sim-icon-pause')!;
  const simPlayLabel = document.getElementById('sim-play-label')!;

  function syncPlayBtn(): void {
    const running = sim.isRunning();
    simPlayBtn.classList.toggle('running', running);
    simIconPlay.style.display  = running ? 'none' : '';
    simIconPause.style.display = running ? '' : 'none';
    simPlayLabel.textContent   = running ? 'Pause' : 'Play';
  }

  simPlayBtn.addEventListener('click', () => {
    sim.toggle();
    syncPlayBtn();
    if (sim.isRunning() && sim.getTrains().length === 0) {
      sim.reinit();
      rebuildTimetable();
    }
  });

  // ── Speed buttons ─────────────────────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>('.sim-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const speed = parseInt(btn.dataset.speed ?? '1', 10) as SimSpeed;
      sim.setSpeed(speed);
      document.querySelectorAll('.sim-speed-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Time picker ───────────────────────────────────────────────────────
  const simTimeInput    = document.getElementById('sim-time-input') as HTMLInputElement;
  const simRealtimeBtn  = document.getElementById('sim-btn-realtime')!;

  /** Convert absolute HH:MM:SS to sim seconds (offset from 06:00). */
  function wallTimeToSimSec(h: number, m: number, s = 0): number {
    return (h * 3600 + m * 60 + s) - 6 * 3600;
  }

  /** Commit the text value in simTimeInput and hide it. */
  function commitTimeInput(): void {
    document.removeEventListener('mousedown', onTimeInputOutsideClick);
    const parts = simTimeInput.value.split(':').map(Number);
    const h = isNaN(parts[0]) ? 6 : parts[0];
    const m = isNaN(parts[1]) ? 0 : parts[1];
    const s = isNaN(parts[2]) ? 0 : parts[2];
    const targetSec = wallTimeToSimSec(h, m, s);
    const wasRunning = sim.isRunning();
    sim.stop();
    sim.reinitAtTime(targetSec);
    rebuildTimetable();
    if (wasRunning) { sim.start(); syncPlayBtn(); }
    simTimeInput.style.display = 'none';
    simClockEl.style.display = 'inline';
  }

  /** Dismiss the input if the user clicks anywhere outside it. */
  function onTimeInputOutsideClick(e: MouseEvent): void {
    if (e.target === simTimeInput || e.target === simClockEl) return;
    commitTimeInput();
  }

  simClockEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const base = 6 * 3600;
    const total = Math.floor(base + sim.getSimTimeSec()) % 86400;
    const h = Math.floor(total / 3600) % 24;
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    simTimeInput.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    simClockEl.style.display = 'none';
    simTimeInput.style.display = 'block';
    requestAnimationFrame(() => {
      simTimeInput.focus();
      simTimeInput.select();
      setTimeout(() => { document.addEventListener('mousedown', onTimeInputOutsideClick); }, 0);
    });
  });

  simTimeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitTimeInput(); }
    if (e.key === 'Escape') {
      document.removeEventListener('mousedown', onTimeInputOutsideClick);
      simTimeInput.style.display = 'none';
      simClockEl.style.display = '';
    }
  });

  simRealtimeBtn.addEventListener('click', () => {
    const now = new Date();
    const targetSec = wallTimeToSimSec(now.getHours(), now.getMinutes(), now.getSeconds());
    const wasRunning = sim.isRunning();
    sim.stop();
    sim.reinitAtTime(targetSec);
    rebuildTimetable();
    if (wasRunning) { sim.start(); syncPlayBtn(); }
  });

  // ── Click on train dot / signal / station in sim mode ───────────────
  map.on('click', (e) => {
    if (!simMode) return;

    // Check train hit first
    const trainId = trainRenderer.hitTest([e.point.x, e.point.y]);
    if (trainId) {
      const train = sim.getTrains().find((t) => t.id === trainId);
      if (train) {
        openTrainDetail(train);
        return;
      }
    }

    // Check signal hit
    const signalInfo = signalSystem.hitTest([e.point.x, e.point.y]);
    if (signalInfo) {
      openSignalDetail(signalInfo);
      return;
    }

    // Station selection is already handled by the network editor click handler
    // (it fires on the same click event since both are map.on('click') listeners)
  });

  map.on('mousemove', (e) => {
    if (!speedHoverTooltipEl) return;
    const speedActive = simMode ? simSpeedKeyVisible : trackSpeedOverlayEnabled;
    if (!speedActive) {
      speedHoverTooltipEl.classList.add('hidden');
      return;
    }

    const layersToQuery = [NETWORK_TRACK_SPEED_LAYER_ID, TRACK_SPEED_LAYER.id]
      .filter((layerId) => Boolean(map.getLayer(layerId)));
    if (layersToQuery.length === 0) {
      speedHoverTooltipEl.classList.add('hidden');
      return;
    }

    const pad = 8;
    const bbox: [[number, number], [number, number]] = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad],
    ];
    const features = map.queryRenderedFeatures(bbox, { layers: layersToQuery });
    if (features.length === 0) {
      speedHoverTooltipEl.classList.add('hidden');
      return;
    }

    let top: maplibregl.MapGeoJSONFeature | null = null;
    let speedKmh = NaN;
    for (const feature of features) {
      const props = feature.properties ?? {};
      const speedRaw = props['speedKmh'] ?? props['maxspeed'];
      const parsed = Number(speedRaw);
      if (Number.isFinite(parsed) && parsed > 0) {
        top = feature;
        speedKmh = parsed;
        break;
      }
    }

    if (!top || !Number.isFinite(speedKmh) || speedKmh <= 0) {
      speedHoverTooltipEl.classList.add('hidden');
      return;
    }

    const props = top.properties ?? {};

    const title = top.layer.id === NETWORK_TRACK_SPEED_LAYER_ID
      ? `Line: ${String(props['lineName'] ?? 'Custom line')}`
      : 'National rail track';
    speedHoverTooltipEl.innerHTML = `<strong>${title}</strong><br/>Limit: ${formatSpeedLabel(speedKmh)}`;

    const offsetX = 14;
    const offsetY = 18;
    const maxLeft = window.innerWidth - 280;
    const maxTop = window.innerHeight - 70;
    speedHoverTooltipEl.style.left = `${Math.min(maxLeft, Math.max(10, e.point.x + offsetX))}px`;
    speedHoverTooltipEl.style.top = `${Math.min(maxTop, Math.max(10, e.point.y + offsetY))}px`;
    speedHoverTooltipEl.classList.remove('hidden');
  });

  map.on('mouseleave', () => {
    speedHoverTooltipEl?.classList.add('hidden');
  });

  // ── Station click → departure board ──────────────────────────────────
  let lastSelectedStationId: string | null = null;
  setInterval(() => {
    if (!simMode) return;
    const state = editor.getState();
    const selId = state.selectedStationId ?? null;
    if (selId !== lastSelectedStationId) {
      lastSelectedStationId = selId;
      if (selId) {
        const station = editor.network.getStation(selId);
        const stationName = station?.name ?? selId;
        const stationCrs = station?.crs ?? undefined;
        depBoard.open(selId, stationName, stationCrs);
        depBoard.update(sim, simNetwork);
      } else {
        depBoard.close();
      }
    }
  }, 200);

  depBoard.setOnClose(() => {
    editor.deselectStation();
  });

  // ── Timetable designer ─────────────────────────────────────────────────
  const ttModal   = document.getElementById('timetable-modal')!;
  const ttTabs    = document.getElementById('timetable-tabs')!;
  const ttTbody   = document.getElementById('timetable-tbody')!;
  const ttTph     = document.getElementById('tt-tph') as HTMLInputElement;
  const ttFirst   = document.getElementById('tt-first-service') as HTMLInputElement;
  const ttLast    = document.getElementById('tt-last-service') as HTMLInputElement;
  const ttDemand  = document.getElementById('tt-demand-indicator')!;
  let ttActiveLineId: string | null = null;

  document.getElementById('sim-btn-timetable')!.addEventListener('click', () => {
    rebuildTimetable();
    renderTimetableTabs();
    showAnimatedClass(ttModal, 'modal', '.timetable-box');
  });

  document.getElementById('timetable-close')!.addEventListener('click', () => {
    hideAnimatedClass(ttModal, 'modal', '.timetable-box');
  });

  ttModal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideAnimatedClass(ttModal, 'modal', '.timetable-box');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ttModal.classList.contains('hidden')) {
      hideAnimatedClass(ttModal, 'modal', '.timetable-box');
    }
  });

  function renderTimetableTabs(): void {
    ttTabs.innerHTML = '';
    const lines = simNetwork.lines;
    if (lines.length === 0) return;
    if (!ttActiveLineId || !lines.find(l => l.id === ttActiveLineId)) {
      ttActiveLineId = lines[0]!.id;
    }
    for (const line of lines) {
      const tab = document.createElement('button');
      tab.className = 'tt-tab' + (line.id === ttActiveLineId ? ' active' : '');
      tab.textContent = line.name;
      tab.style.borderBottomColor = line.id === ttActiveLineId ? line.color : 'transparent';
      tab.addEventListener('click', () => {
        ttActiveLineId = line.id;
        renderTimetableTabs();
        renderTimetableContent();
      });
      ttTabs.appendChild(tab);
    }
    renderTimetableContent();
  }

  function renderTimetableContent(): void {
    if (!timetable || !ttActiveLineId) return;

    const config = timetable.configs.get(ttActiveLineId);
    if (config) {
      const toTimeStr = (sec: number) => {
        const h = Math.floor((sec / 3600) % 24);
        const m = Math.floor((sec % 3600) / 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };
      ttFirst.value = toTimeStr(config.firstServiceSec);
      ttLast.value  = toTimeStr(config.lastServiceSec);
      ttTph.value   = String(config.trainsPerHour);
    }

    const services = timetable.services.filter(s => s.lineId === ttActiveLineId);
    ttTbody.innerHTML = '';

    // Demand bar
    const avgLoad = services.length > 0
      ? services.reduce((s, svc) => s + svc.estimatedLoad, 0) / services.length
      : 0;
    ttDemand.style.setProperty('--demand-pct', `${Math.round(avgLoad * 100)}%`);

    for (const svc of services) {
      const tr = document.createElement('tr');
      const loadPct = Math.round(svc.estimatedLoad * 100);
      const loadClass = loadPct > 80 ? 'tt-load-red' : loadPct > 50 ? 'tt-load-amber' : 'tt-load-green';

      tr.innerHTML = `
        <td class="tt-headcode">${svc.headcode}</td>
        <td>${formatSimClock(svc.departureTimeSec - 6 * 3600)}</td>
        <td>${svc.originName}</td>
        <td>${svc.destinationName}</td>
        <td>${svc.intermediateStops}</td>
        <td><div class="tt-load-bar"><div class="tt-load-fill ${loadClass}" style="width:${loadPct}%"></div></div> ${loadPct}%</td>
      `;
      ttTbody.appendChild(tr);
    }
  }

  // Timetable controls → rebuild
  function parseTimetableInputs(): void {
    if (!ttActiveLineId) return;
    const parseTime = (val: string) => {
      const [h, m] = val.split(':').map(Number);
      return (h ?? 6) * 3600 + (m ?? 0) * 60;
    };
    ttConfigs.set(ttActiveLineId, {
      lineId: ttActiveLineId,
      firstServiceSec: parseTime(ttFirst.value),
      lastServiceSec: parseTime(ttLast.value),
      trainsPerHour: Math.max(1, parseInt(ttTph.value, 10) || 4),
    });

    // Keep simulation service level aligned with timetable tph.
    const cfg = ttConfigs.get(ttActiveLineId);
    const cache = sim.getPolylineCaches().get(ttActiveLineId);
    const line = editor.network.getLine(ttActiveLineId);
    if (cfg && cache && line?.rollingStockId) {
      const requiredUnits = Math.max(1, Math.ceil((cfg.trainsPerHour * cache.roundTripSec) / 3600));
      const currentUnits = Math.max(1, line.trainCount ?? 1);
      if (requiredUnits !== currentUnits) {
        editor.network.setLineTrainCount(ttActiveLineId, requiredUnits);
        const wasRunning = sim.isRunning();
        const simNow = sim.getSimTimeSec();
        sim.stop();
        sim.reinitAtTime(simNow);
        if (wasRunning) { sim.start(); syncPlayBtn(); }
      }
    }

    rebuildTimetable();
    renderTimetableContent();
  }

  ttTph.addEventListener('change', parseTimetableInputs);
  ttFirst.addEventListener('change', parseTimetableInputs);
  ttLast.addEventListener('change', parseTimetableInputs);

  // Re-init simulation when network changes
  editor.network.onChange(() => {
    sim.rebuildPolylineCaches();
    updateNetworkTrackSpeedOverlayData();

    if (!sim.isRunning()) return;
    sim.reinit();
    rebuildTimetable();
    loadStationWeights();
  });

  /** Pre-fetch catchment data for all stations and load weights into sim. */
  function loadStationWeights(): void {
    const stations = editor.network.stations;
    if (stations.length === 0) return;
    const promises = stations.map((s) => fetchCatchmentStats(s.lng, s.lat).then((st) => ({
      id: s.id,
      pop: st.population,
    })).catch(() => ({ id: s.id, pop: 0 })));

    Promise.all(promises).then((results) => {
      const maxPop = Math.max(1, ...results.map((r) => r.pop));
      const weights = new Map<string, number>();
      for (const r of results) {
        // Keep a demand floor so viable corridors are not starved by sparse census cells.
        const normalised = r.pop / maxPop;
        const boosted = 0.25 + normalised * 0.75;
        weights.set(r.id, Math.min(1, Math.max(0.25, boosted)));
      }
      sim.setStationWeights(weights);
    }).catch(() => { /* silent — passenger weights are optional */ });
  }

  loadStationWeights();
  syncPlayBtn();
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