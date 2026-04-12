// ── Signal system ─────────────────────────────────────────────────────────────
// Renders UK colour-light block signals and track direction arrows.
// Supports: green, single yellow, double yellow, red aspects.
// Signals visible at zoom ≥ 10. Clickable for detail panel.
// Supports manual signal placement/removal per line.

import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
import type { Simulation } from './simulation';
import { BLOCK_LENGTH_M, interpolatePosition } from './simulation';
import type { Network } from './network';

const SOURCE_SIGNALS = 'sim-signals';
const SOURCE_DIRECTION = 'sim-direction-arrows';
const LAYER_SIGNAL_ICON = 'sim-signal-icon';
const LAYER_DIRECTION = 'sim-direction-arrow';
const INSERT_BEFORE = 'network-station-label';

export type SignalAspect = 'green' | 'single-yellow' | 'double-yellow' | 'red';

export interface SignalInfo {
  signalId: string;
  lineId: string;
  lineName: string;
  lineColor: string;
  blockIndex: number;
  distanceM: number;
  aspect: SignalAspect;
  lng: number;
  lat: number;
  direction: 'forward' | 'reverse';
  lineSpeedKmh: number;
  signalSpeedKmh: number;
  adjacentTrains: string[];
}

/** Per-line manual signal overrides: positions along the line in metres. */
export interface ManualSignalConfig {
  lineId: string;
  /** Signal positions as distance along the polyline in metres.
   *  Each entry defines a block boundary for both directions. */
  positions: number[];
}

const ASPECT_TOP: Record<SignalAspect, string> = {
  'red':           '#ef4444',
  'single-yellow': '#f59e0b',
  'double-yellow': '#f59e0b',
  'green':         '#22c55e',
};

const ASPECT_BOTTOM: Record<SignalAspect, string> = {
  'red':           '#2a2a3a',
  'single-yellow': '#2a2a3a',
  'double-yellow': '#f59e0b',
  'green':         '#2a2a3a',
};

const ASPECT_LABEL: Record<SignalAspect, string> = {
  'red': 'Red',
  'single-yellow': 'Yellow',
  'double-yellow': 'Double Yellow',
  'green': 'Green',
};

export { ASPECT_LABEL };

// ── SVG signal image generation ───────────────────────────────────────────────

/** Create a UK colour-light signal SVG for a given aspect. */
function generateSignalSVG(aspect: SignalAspect): string {
  const topColor = ASPECT_TOP[aspect];
  const bottomColor = ASPECT_BOTTOM[aspect];
  const glowTop = aspect === 'green' ? 'rgba(34,197,94,0.5)'
    : aspect === 'red' ? 'rgba(239,68,68,0.5)'
    : 'rgba(245,158,11,0.5)';
  const glowBottom = aspect === 'double-yellow' ? 'rgba(245,158,11,0.4)' : 'none';

  // 24×48 signal head: dark housing with rounded top, two lights
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="48" viewBox="0 0 24 48">
    <!-- Post -->
    <rect x="10" y="32" width="4" height="16" rx="1" fill="#3a3a4e"/>
    <!-- Housing -->
    <rect x="2" y="0" width="20" height="34" rx="5" fill="#1a1a2e" stroke="#5a5a6e" stroke-width="1"/>
    <rect x="4" y="2" width="16" height="30" rx="3.5" fill="#111122"/>
    <!-- Top light glow -->
    <circle cx="12" cy="11" r="8" fill="${glowTop}" opacity="0.5"/>
    <!-- Top light -->
    <circle cx="12" cy="11" r="5" fill="${topColor}" opacity="0.95"/>
    <circle cx="12" cy="11" r="2.5" fill="white" opacity="0.3"/>
    <!-- Bottom light glow -->
    ${glowBottom !== 'none' ? `<circle cx="12" cy="23" r="7" fill="${glowBottom}" opacity="0.45"/>` : ''}
    <!-- Bottom light -->
    <circle cx="12" cy="23" r="5" fill="${bottomColor}" opacity="0.95"/>
    ${aspect === 'double-yellow' ? '<circle cx="12" cy="23" r="2.5" fill="white" opacity="0.2"/>' : ''}
    <!-- Visor hoods -->
    <path d="M5,6 Q12,3 19,6" stroke="#2a2a3e" stroke-width="1.5" fill="none"/>
    <path d="M5,18 Q12,15 19,18" stroke="#2a2a3e" stroke-width="1.5" fill="none"/>
  </svg>`;
}

/** Register all signal aspect images with the map. */
function registerSignalImages(map: MaplibreMap): void {
  const aspects: SignalAspect[] = ['green', 'single-yellow', 'double-yellow', 'red'];
  for (const aspect of aspects) {
    const key = `signal-${aspect}`;
    if (map.hasImage(key)) continue;
    const svg = generateSignalSVG(aspect);
    const img = new Image(24, 48);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    img.onload = () => {
      if (!map.hasImage(key)) map.addImage(key, img, { sdf: false });
    };
    if (img.complete && !map.hasImage(key)) {
      map.addImage(key, img, { sdf: false });
    }
  }

  // Pointy arrow for track direction indicators
  const arrowKey = 'direction-arrow';
  if (!map.hasImage(arrowKey)) {
    const arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="24" viewBox="0 0 20 24">
      <path d="M10,0 L19,22 L10,16 L1,22 Z" fill="white"/>
    </svg>`;
    const arrowImg = new Image(20, 24);
    arrowImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(arrowSvg);
    arrowImg.onload = () => {
      if (!map.hasImage(arrowKey)) map.addImage(arrowKey, arrowImg, { sdf: true });
    };
    if (arrowImg.complete && !map.hasImage(arrowKey)) {
      map.addImage(arrowKey, arrowImg, { sdf: true });
    }
  }
}

export class SignalSystem {
  private readonly map: MaplibreMap;
  private signals: SignalInfo[] = [];
  /** Per-line manual signal positions (distances in metres). */
  private manualSignals = new Map<string, number[]>();

  constructor(map: MaplibreMap) {
    this.map = map;
    registerSignalImages(map);
    this._initSources();
    this._initLayers();
  }

  // ── Manual signal management ─────────────────────────────────────────────

  /** Set manual signal positions for a line. Pass empty array to revert to auto. */
  setManualSignals(lineId: string, positions: number[]): void {
    if (positions.length === 0) {
      this.manualSignals.delete(lineId);
    } else {
      this.manualSignals.set(lineId, [...positions].sort((a, b) => a - b));
    }
  }

  /** Get manual signal positions for a line (empty = auto). */
  getManualSignals(lineId: string): number[] {
    return this.manualSignals.get(lineId) ?? [];
  }

  /** Add a signal at a specific distance along a line. */
  addSignal(lineId: string, distanceM: number, totalLengthM: number): void {
    let positions = this.manualSignals.get(lineId);
    if (!positions) {
      // Initialize from auto positions
      const blockCount = Math.ceil(totalLengthM / BLOCK_LENGTH_M);
      positions = [];
      for (let b = 1; b < blockCount - 1; b++) {
        positions.push(b * BLOCK_LENGTH_M);
      }
    }
    // Add if not too close to existing
    const MIN_SPACING = 200;
    if (!positions.some(p => Math.abs(p - distanceM) < MIN_SPACING)) {
      positions.push(distanceM);
      positions.sort((a, b) => a - b);
    }
    this.manualSignals.set(lineId, positions);
  }

  /** Remove the signal nearest to distanceM on a line. */
  removeSignal(lineId: string, distanceM: number): void {
    const positions = this.manualSignals.get(lineId);
    if (!positions || positions.length === 0) return;
    let bestIdx = 0;
    let bestDist = Math.abs(positions[0]! - distanceM);
    for (let i = 1; i < positions.length; i++) {
      const d = Math.abs(positions[i]! - distanceM);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    positions.splice(bestIdx, 1);
    if (positions.length === 0) {
      this.manualSignals.delete(lineId);
    }
  }

  /** Get signal block boundaries for a line. Uses manual if available, auto otherwise. */
  getBlockBoundaries(lineId: string, totalLengthM: number): number[] {
    const manual = this.manualSignals.get(lineId);
    if (manual && manual.length > 0) return manual;
    // Auto: generate from BLOCK_LENGTH_M
    const blockCount = Math.ceil(totalLengthM / BLOCK_LENGTH_M);
    const positions: number[] = [];
    for (let b = 1; b < blockCount - 1; b++) {
      positions.push(b * BLOCK_LENGTH_M);
    }
    return positions;
  }

  /** Rebuild signal + direction GeoJSON from latest simulation state. */
  update(sim: Simulation, network?: Network, zoom = 14): void {
    const sigSource = this.map.getSource(SOURCE_SIGNALS) as GeoJSONSource | undefined;
    const dirSource = this.map.getSource(SOURCE_DIRECTION) as GeoJSONSource | undefined;
    if (!sigSource) return;

    const blocks = sim.getBlocks();
    const caches = sim.getPolylineCaches();

    const sigFeatures: GeoJSON.Feature[] = [];
    const dirFeatures: GeoJSON.Feature[] = [];
    this.signals = [];

    const aspectSpeedKmh: Record<SignalAspect, number> = {
      'green': 999,
      'double-yellow': 145,
      'single-yellow': 65,
      'red': 0,
    };

    for (const [lineId, cache] of caches) {
      const line = network?.lines.find(l => l.id === lineId);
      const lineName = line?.name ?? lineId;
      const lineColor = line?.color ?? '#888';

      const signalPositions = this.getBlockBoundaries(lineId, cache.totalLengthM);
      const directions: Array<'forward' | 'reverse'> = ['forward', 'reverse'];

      for (const dir of directions) {
        const dirPrefix = dir === 'forward' ? 'fwd' : 'rev';

        for (let si = 0; si < signalPositions.length; si++) {
          const posM = signalPositions[si]!;
          const b = si + 1; // block index (1-based, 0 is before first signal)
          const [baseLng, baseLat] = interpolatePosition(cache, posM);

          // Compute bearing for this signal position
          const [lng1, lat1] = interpolatePosition(cache, Math.max(0, posM - 50));
          const [lng2, lat2] = interpolatePosition(cache, Math.min(cache.totalLengthM, posM + 50));
          const cosLatBearing = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
          const bearing = Math.atan2((lng2 - lng1) * cosLatBearing, lat2 - lat1) * 180 / Math.PI;
          const bearingRad = bearing * Math.PI / 180;

          // Offset signal to the left-hand side of the direction of travel.
          // Scale with zoom so opposing-direction signals don't overlap when zoomed out.
          // At zoom 10 → ~70m, zoom 14 → ~15m, zoom 18 → ~5m (rough screen-px parity).
          const offsetM = Math.max(5, 15 * Math.pow(2, 14 - zoom));
          const cosLat = Math.cos(baseLat * Math.PI / 180);
          const mPerDegLng = 111320 * cosLat;
          const mPerDegLat = 111320;
          const perpAngle = dir === 'forward'
            ? bearingRad - Math.PI / 2
            : bearingRad + Math.PI / 2;
          const lng = baseLng + (Math.sin(perpAngle) * offsetM) / mPerDegLng;
          const lat = baseLat + (Math.cos(perpAngle) * offsetM) / mPerDegLat;

          // Direction-aware block keys
          // The signal sits at the boundary between block (b-1) and block b.
          // Forward signals protect block b (ahead in direction of travel).
          // Reverse signals protect block b-1 (ahead in direction of travel).
          const movDir = dir === 'forward' ? 1 : -1;
          const protectedBlock = dir === 'forward' ? b : b - 1;
          const thisKey    = `${lineId}:${dirPrefix}:${protectedBlock}`;
          const nextKey    = `${lineId}:${dirPrefix}:${protectedBlock + movDir}`;
          const ahead2Key  = `${lineId}:${dirPrefix}:${protectedBlock + movDir * 2}`;

          let aspect: SignalAspect;
          if (blocks.has(thisKey)) {
            aspect = 'red';
          } else if (blocks.has(nextKey)) {
            aspect = 'single-yellow';
          } else if (blocks.has(ahead2Key)) {
            aspect = 'double-yellow';
          } else {
            aspect = 'green';
          }

          const signalId = `sig_${lineId}_${dirPrefix}_${b}`;

          // Query line speed at this position
          let lineSpeedKmh = 0;
          if (cache.curvatureLimitsKmh) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let vi = 0; vi < cache.cumulativeDistM.length; vi++) {
              const d = Math.abs(cache.cumulativeDistM[vi]! - posM);
              if (d < bestDist) { bestDist = d; bestIdx = vi; }
            }
            lineSpeedKmh = Math.round(cache.curvatureLimitsKmh[bestIdx] ?? 0);
            if (lineSpeedKmh >= 999) lineSpeedKmh = Math.round(cache.lineMaxSpeedKmh);
          }

          const adjacentTrains: string[] = [];
          const prevKey = `${lineId}:${dirPrefix}:${protectedBlock - movDir}`;
          for (const k of [prevKey, thisKey, nextKey]) {
            const occ = blocks.get(k);
            if (occ) adjacentTrains.push(occ);
          }

          this.signals.push({
            signalId, lineId, lineName, lineColor,
            blockIndex: b, distanceM: posM, aspect, lng, lat,
            direction: dir,
            lineSpeedKmh,
            signalSpeedKmh: aspectSpeedKmh[aspect],
            adjacentTrains,
          });

          // Signal faces the approaching train: the post (base) points in
          // the direction of travel and the head faces toward the driver.
          const sigBearing = dir === 'forward' ? bearing : bearing + 180;

          sigFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              id: signalId,
              aspect,
              signalImage: `signal-${aspect}`,
              lineColor,
              direction: dir,
              bearing: sigBearing,
            },
          });
        }
      }

      // Direction arrows — every 3000m along the line
      const arrowSpacing = 3000;
      const arrowCount = Math.floor(cache.totalLengthM / arrowSpacing);
      for (let a = 1; a <= arrowCount; a++) {
        const posM = a * arrowSpacing;
        const [lng, lat] = interpolatePosition(cache, posM);
        const [alng1, alat1] = interpolatePosition(cache, Math.max(0, posM - 50));
        const [alng2, alat2] = interpolatePosition(cache, Math.min(cache.totalLengthM, posM + 50));
        const cosLatArr = Math.cos(((alat1 + alat2) / 2) * Math.PI / 180);
        const bearing = Math.atan2((alng2 - alng1) * cosLatArr, alat2 - alat1) * 180 / Math.PI;

        dirFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: { bearing, lineColor },
        });
      }
    }

    sigSource.setData({ type: 'FeatureCollection', features: sigFeatures });
    dirSource?.setData({ type: 'FeatureCollection', features: dirFeatures });
  }

  /** Hit test for signal click — returns SignalInfo or null.
   *  Uses rendered features first, then falls back to coordinate-based search. */
  hitTest(point: [number, number]): SignalInfo | null {
    // Try rendered feature query first
    const pad = 20;
    const bbox: [[number, number], [number, number]] = [
      [point[0] - pad, point[1] - pad],
      [point[0] + pad, point[1] + pad],
    ];
    const layersToQuery: string[] = [];
    if (this.map.getLayer(LAYER_SIGNAL_ICON)) layersToQuery.push(LAYER_SIGNAL_ICON);
    if (layersToQuery.length > 0) {
      try {
        const features = this.map.queryRenderedFeatures(bbox, { layers: layersToQuery });
        if (features.length > 0) {
          const sigId = features[0].properties?.id as string | undefined;
          if (sigId) {
            const found = this.signals.find(s => s.signalId === sigId);
            if (found) return found;
          }
        }
      } catch (_) { /* layer may not exist yet */ }
    }

    // Fallback: find nearest signal by projected screen coordinates
    const maxDistPx = 24;
    let bestDist = Infinity;
    let bestSignal: SignalInfo | null = null;
    for (const sig of this.signals) {
      const sp = this.map.project([sig.lng, sig.lat]);
      const dx = sp.x - point[0];
      const dy = sp.y - point[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDistPx && dist < bestDist) {
        bestDist = dist;
        bestSignal = sig;
      }
    }
    return bestSignal;
  }

  /** Find the nearest signal to a line distance and return it. */
  hitTestByDistance(lineId: string, distanceM: number): SignalInfo | null {
    let best: SignalInfo | null = null;
    let bestDist = Infinity;
    for (const sig of this.signals) {
      if (sig.lineId !== lineId) continue;
      const d = Math.abs(sig.distanceM - distanceM);
      if (d < bestDist) { bestDist = d; best = sig; }
    }
    return best;
  }

  getSignals(): SignalInfo[] { return this.signals; }

  clear(): void {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    (this.map.getSource(SOURCE_SIGNALS) as GeoJSONSource | undefined)?.setData(empty);
    (this.map.getSource(SOURCE_DIRECTION) as GeoJSONSource | undefined)?.setData(empty);
    this.signals = [];
  }

  setVisible(visible: boolean): void {
    const v = visible ? 'visible' : 'none';
    for (const id of [LAYER_SIGNAL_ICON, LAYER_DIRECTION]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', v);
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _initSources(): void {
    this.map.addSource(SOURCE_SIGNALS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addSource(SOURCE_DIRECTION, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  private _initLayers(): void {
    const before = this.map.getLayer(INSERT_BEFORE) ? INSERT_BEFORE : undefined;

    // Signal icon — realistic UK colour-light signal image
    this.map.addLayer({
      id: LAYER_SIGNAL_ICON,
      type: 'symbol',
      source: SOURCE_SIGNALS,
      minzoom: 10,
      layout: {
        'icon-image': ['get', 'signalImage'],
        'icon-size': ['interpolate', ['linear'], ['zoom'],
          10, 0.35,
          12, 0.55,
          14, 0.8,
          16, 1.1,
          18, 1.5,
        ],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['case',
          ['==', ['get', 'aspect'], 'red'], 0,
          ['==', ['get', 'aspect'], 'single-yellow'], 1,
          ['==', ['get', 'aspect'], 'double-yellow'], 2,
          3,
        ],
      },
      paint: {
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 12, 0.9, 14, 1],
      },
    }, before);

    // Direction arrows — pointy arrow SVG along the track
    this.map.addLayer({
      id: LAYER_DIRECTION,
      type: 'symbol',
      source: SOURCE_DIRECTION,
      minzoom: 11,
      layout: {
        'icon-image': 'direction-arrow',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 0.55, 18, 0.75],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-placement': 'point',
      },
      paint: {
        'icon-color': ['get', 'lineColor'],
        'icon-opacity': 0.8,
      },
    }, before);
  }
}
