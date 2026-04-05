import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { mapStyle } from './map-style';
import { CensusOverlay, LEGEND_CONFIGS } from './census-overlay';
import type { CensusMetric, CensusOverlayState } from './census-overlay';
import { NetworkEditor } from './network-editor';
import type { EditorState } from './network-editor';
import { LINE_COLORS } from './network';

// Register the PMTiles custom protocol so MapLibre can load .pmtiles files
// via HTTP range-requests from a single static file.
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

// Tiles are expected at /tiles/uk.pmtiles (served from public/tiles/)
const tilesUrl = `${window.location.origin}/tiles/uk.pmtiles`;

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
  'top-right',
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

  document.querySelectorAll<HTMLInputElement>('input[name="census-metric"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      overlay.setMetric(radio.value as CensusMetric);
    });
  });

  // ── Network editor ──────────────────────────────────────────────────────
  //
  // updateNetworkUI / renderLineList are declared before the editor so they
  // can be passed as callbacks, but they use `editor` which is assigned
  // immediately after construction. The constructor no longer calls _emit(),
  // so these functions are never invoked before `editor` is assigned.

  // eslint-disable-next-line prefer-const
  let editor!: NetworkEditor;

  function updateNetworkUI(state: EditorState): void {
    // Update toolbar active states
    document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
      const mode = btn.id.replace('tool-', '');
      btn.classList.toggle('active', mode === state.mode);
    });

    // Show/hide panels
    const linePanel = document.getElementById('line-panel')!;
    const stationPanel = document.getElementById('station-panel')!;

    if (state.mode === 'line') {
      linePanel.classList.remove('hidden');
      stationPanel.classList.add('hidden');
    } else if (state.selectedStationId) {
      stationPanel.classList.remove('hidden');
      linePanel.classList.add('hidden');

      const station = editor.network.getStation(state.selectedStationId);
      if (station) {
        (document.getElementById('station-name-input') as HTMLInputElement).value = station.name;
      }
    } else {
      stationPanel.classList.add('hidden');
    }

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
        editor.deleteLine(line.id);
      });

      item.appendChild(dot);
      item.appendChild(lineName);
      item.appendChild(count);
      item.appendChild(del);

      item.addEventListener('click', () => {
        editor.setActiveLine(line.id);
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
        document.getElementById('line-panel')!.classList.remove('hidden');
        document.getElementById('station-panel')!.classList.add('hidden');
      } else {
        editor.setMode(mode as 'select' | 'station');
        document.getElementById('line-panel')!.classList.add('hidden');
      }
    });
  });

  // Clear button
  document.getElementById('tool-clear')!.addEventListener('click', () => {
    if (editor.network.stations.length === 0 && editor.network.lines.length === 0) return;
    if (confirm('Clear the entire network?')) {
      editor.clearNetwork();
    }
  });

  // Line panel close
  document.getElementById('line-panel-close')!.addEventListener('click', () => {
    document.getElementById('line-panel')!.classList.add('hidden');
    editor.setMode('select');
  });

  // Station panel close
  document.getElementById('station-panel-close')!.addEventListener('click', () => {
    document.getElementById('station-panel')!.classList.add('hidden');
    editor.setMode('select');
  });

  // Color swatches for new line
  const colorContainer = document.getElementById('new-line-colors')!;
  let selectedColor = editor.network.nextColor();

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

  // Add line button
  document.getElementById('new-line-add')!.addEventListener('click', () => {
    const nameInput = document.getElementById('new-line-name') as HTMLInputElement;
    const name = nameInput.value.trim() || `Line ${editor.network.lines.length + 1}`;
    editor.createLine(name, selectedColor);
    nameInput.value = '';
    selectedColor = editor.network.nextColor();
    renderColorSwatches();
  });

  // Station name input
  const stationNameInput = document.getElementById('station-name-input') as HTMLInputElement;
  stationNameInput.addEventListener('change', () => {
    editor.renameSelectedStation(stationNameInput.value.trim());
  });

  // Station delete
  document.getElementById('station-delete')!.addEventListener('click', () => {
    editor.deleteSelectedStation();
    document.getElementById('station-panel')!.classList.add('hidden');
  });

  // Trigger initial UI sync now that editor is fully constructed and assigned
  editor.syncUI();
});

function updateCensusUI(state: CensusOverlayState): void {
  // Sync radio selection
  document.querySelectorAll<HTMLInputElement>('input[name="census-metric"]').forEach((radio) => {
    radio.checked = radio.value === state.metric;
  });

  // Loading spinner
  const spinner = document.getElementById('census-loading');
  if (spinner) spinner.style.display = state.loading ? 'inline' : 'none';

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
      legend.style.display = 'block';
    } else {
      legend.style.display = 'none';
    }
  }

  // Error
  const errEl = document.getElementById('census-error');
  if (errEl) {
    errEl.textContent = state.error ?? '';
    errEl.style.display = state.error ? 'block' : 'none';
  }

  // Last updated
  const updatedEl = document.getElementById('census-updated');
  if (updatedEl) {
    if (state.lastModified) {
      updatedEl.textContent = 'Updated ' + state.lastModified.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      updatedEl.style.display = 'block';
    } else {
      updatedEl.style.display = 'none';
    }
  }
}