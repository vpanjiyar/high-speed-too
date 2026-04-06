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

  // ── Line Manager helpers ────────────────────────────────────────────────

  let openLineId: string | null = null;
  /** Stable signature of station IDs for the open line — used to gate census re-fetches. */
  let openLineStopSig = '';

  function closeLineManager(): void {
    lmEl.classList.add('hidden');
    smEl.classList.remove('lm-open');
    openLineId = null;
    openLineStopSig = '';
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
  }

  function renderLmStops(lineId: string): void {
    const line = editor.network.getLine(lineId);
    const list = document.getElementById('lm-stop-list')!;
    const countEl = document.getElementById('lm-stop-count')!;
    list.innerHTML = '';

    if (!line || line.stationIds.length === 0) {
      countEl.textContent = '';
      const empty = document.createElement('p');
      empty.className = 'lm-stops-empty';
      empty.textContent = 'No stops yet — switch to line mode and click the map.';
      list.appendChild(empty);
      return;
    }

    countEl.textContent = `${line.stationIds.length} stop${line.stationIds.length !== 1 ? 's' : ''}`;

    line.stationIds.forEach((sid, idx) => {
      const station = editor.network.getStation(sid);
      const name = station?.name ?? '(unknown)';
      const isFirst = idx === 0;
      const isLast  = idx === line.stationIds.length - 1;

      const item = document.createElement('div');
      item.className = 'lm-stop-item';
      item.dataset.stationId = sid;

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

      const arrow = document.createElement('div');
      arrow.className = 'lm-stop-arrow';
      arrow.textContent = '›';

      item.appendChild(rail);
      item.appendChild(nameEl);
      item.appendChild(arrow);

      item.addEventListener('click', () => {
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
    grid.style.display = 'none';
    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');

    const stations = line.stationIds
      .map((id) => editor.network.getStation(id))
      .filter((s): s is NonNullable<typeof s> => !!s);

    fetchLineCatchmentStats(stations).then((stats) => {
      if (openLineId !== lineId) return;
      loadingEl.classList.add('hidden');
      if (stats.lsoaCount === 0) {
        errorEl.textContent = line.stationIds.length === 0
          ? 'Add stops to see catchment data.'
          : 'No census data nearby.';
        errorEl.classList.remove('hidden');
        return;
      }
      document.getElementById('lm-stat-pop')!.textContent     = stats.population.toLocaleString('en-GB');
      document.getElementById('lm-stat-workers')!.textContent  = stats.workingAge.toLocaleString('en-GB');
      document.getElementById('lm-stat-pct')!.textContent      = `${stats.workingAgePct.toFixed(1)}%`;
      document.getElementById('lm-stat-density')!.textContent  = stats.densityPerHa.toFixed(1);
      grid.style.display = 'grid';
    }).catch(() => {
      loadingEl.classList.add('hidden');
      errorEl.textContent = 'Failed to load census data.';
      errorEl.classList.remove('hidden');
    });
  }

  function openLineManager(lineId: string): void {
    const line = editor.network.getLine(lineId);
    if (!line) return;
    const wasAlreadyOpen = openLineId === lineId;
    openLineId = lineId;
    lmEl.classList.remove('hidden');
    smEl.classList.add('lm-open');   // shift SM left of LM

    (document.getElementById('line-manager-name') as HTMLInputElement).value = line.name;
    renderLmHeader(lineId);
    renderLmSwatches(lineId);
    renderLmStops(lineId);

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
    smEl.classList.add('hidden');
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

    smEl.classList.remove('hidden');

    // Always update name + lines (may have changed)
    (document.getElementById('station-manager-name') as HTMLInputElement).value = station.name;
    renderManagerLines(stationId);

    // Only re-fetch census when the selected station changes
    if (smCensusStationId !== stationId) {
      smCensusStationId = stationId;

      const grid = document.getElementById('sm-stats-grid')!;
      const loadingEl = document.getElementById('sm-stats-loading')!;
      const errorEl = document.getElementById('sm-stats-error')!;
      grid.style.display = 'none';
      loadingEl.classList.remove('hidden');
      errorEl.classList.add('hidden');

      fetchCatchmentStats(station.lng, station.lat).then((stats) => {
        if (smCensusStationId !== stationId) return;
        loadingEl.classList.add('hidden');
        if (stats.lsoaCount === 0) {
          errorEl.textContent = 'No census data nearby.';
          errorEl.classList.remove('hidden');
          return;
        }
        document.getElementById('sm-stat-pop')!.textContent     = stats.population.toLocaleString('en-GB');
        document.getElementById('sm-stat-workers')!.textContent  = stats.workingAge.toLocaleString('en-GB');
        document.getElementById('sm-stat-pct')!.textContent      = `${stats.workingAgePct.toFixed(1)}%`;
        document.getElementById('sm-stat-density')!.textContent  = stats.densityPerHa.toFixed(1);
        grid.style.display = 'grid';
      }).catch(() => {
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'Failed to load census data.';
        errorEl.classList.remove('hidden');
      });
    }
  }

  // ── Network UI callbacks ────────────────────────────────────────────────

  function updateNetworkUI(state: EditorState): void {
    document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.id.replace('tool-', '') === state.mode);
    });

    const doneBtn = document.getElementById('tool-done') as HTMLElement | null;
    if (doneBtn) doneBtn.style.display = (state.mode === 'station' || state.mode === 'line') ? '' : 'none';

    const linePanel = document.getElementById('line-panel')!;
    linePanel.classList.toggle('hidden', state.mode !== 'line');

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
        // Re-fetch census only when stop list changed
        const sig = line.stationIds.join(',');
        if (sig !== openLineStopSig) {
          openLineStopSig = sig;
          refreshLmStats(openLineId);
        }
      }
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
        document.getElementById('line-panel')!.classList.remove('hidden');
      } else {
        editor.setMode(mode as 'select' | 'station');
        document.getElementById('line-panel')!.classList.add('hidden');
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
    document.getElementById('line-panel')!.classList.add('hidden');
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
    document.getElementById('line-panel')!.classList.add('hidden');
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
    document.getElementById('import-modal')!.classList.add('hidden');
    closeLineManager();
    closeStationManager();
    editor.importNetwork(data.network, merge);
  }

  function openImportModal(payload: NetworkExport): void {
    _pendingImport = payload;
    document.getElementById('import-modal')!.classList.remove('hidden');
  }

  function closeImportModal(): void {
    _pendingImport = null;
    document.getElementById('import-modal')!.classList.add('hidden');
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
  document.getElementById('import-modal')!.addEventListener('click', (e) => {
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