// ── OSM rail speed limit spatial index ────────────────────────────────────────
// Loads rail_lines.geojson (the same file track-router.ts uses) and builds a
// grid-based spatial index so the simulation can look up OSM maxspeed values
// for any map position in O(1) time.
//
// NOTE: maxspeed fields are only present in rail_lines.geojson if the data
// pipeline has been re-run after the processor was updated to emit them.
// Without re-running tools/rail_lines_processor.py, all maxspeed values will
// be null and the curvature fallback in simulation.ts will be used throughout.

const RAIL_LINES_URL = '/data/rail_lines.geojson';
const GRID_CELL_DEGREES = 0.04;

interface SpeedSegment {
  a: [number, number];
  b: [number, number];
  speedKmh: number;
  /** "rail" = third/conductor rail, "contact_line" = overhead, "4th_rail" = London Underground */
  electrified: string;
  voltage: number;
}

function distToSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const cosLat = Math.cos(p[1] * Math.PI / 180);
  const px = (p[0] - a[0]) * cosLat * 111320;
  const py = (p[1] - a[1]) * 111320;
  const bx = (b[0] - a[0]) * cosLat * 111320;
  const by = (b[1] - a[1]) * 111320;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - bx * t, dy = py - by * t;
  return Math.sqrt(dx * dx + dy * dy);
}

class RailSpeedIndex {
  private grid = new Map<string, SpeedSegment[]>();
  private _loaded = false;
  private _promise: Promise<void> | null = null;
  private _onLoadedCallbacks: Array<() => void> = [];

  load(): Promise<void> {
    if (!this._promise) this._promise = this._doLoad();
    return this._promise;
  }

  isLoaded(): boolean { return this._loaded; }

  /** Register a callback to fire once when the speed index finishes loading. */
  onLoaded(cb: () => void): void {
    if (this._loaded) { cb(); return; }
    this._onLoadedCallbacks.push(cb);
  }

  private async _doLoad(): Promise<void> {
    try {
      const resp = await fetch(RAIL_LINES_URL);
      if (!resp.ok) return;
      const data = await resp.json() as { features?: Array<{
        geometry?: { type?: string; coordinates?: unknown };
        properties?: Record<string, unknown>;
      }> };
      this._buildGrid(data.features ?? []);
      this._loaded = true;
      for (const cb of this._onLoadedCallbacks) cb();
      this._onLoadedCallbacks = [];
    } catch { /* silently fall back to curvature */ }
  }

  private _buildGrid(features: Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }>): void {
    for (const f of features) {
      if (f.geometry?.type !== 'LineString') continue;
      const props = f.properties ?? {};
      const railway = String(props['railway'] ?? '');
      if (railway && railway !== 'rail') continue;
      const speed = typeof props['maxspeed'] === 'number' ? props['maxspeed'] : 0;
      if (speed <= 0) continue;

      const coords = f.geometry.coordinates as [number, number][];
      if (!Array.isArray(coords)) continue;
      const seg: SpeedSegment = {
        a: [0, 0], b: [0, 0],   // placeholder, overridden per pair below
        speedKmh: speed,
        electrified: String(props['electrified'] ?? ''),
        voltage: parseInt(String(props['voltage'] ?? '0'), 10),
      };

      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1]!, b = coords[i]!;
        const s: SpeedSegment = { ...seg, a: [a[0], a[1]], b: [b[0], b[1]] };
        const x0 = Math.floor(Math.min(a[0], b[0]) / GRID_CELL_DEGREES);
        const x1 = Math.floor(Math.max(a[0], b[0]) / GRID_CELL_DEGREES);
        const y0 = Math.floor(Math.min(a[1], b[1]) / GRID_CELL_DEGREES);
        const y1 = Math.floor(Math.max(a[1], b[1]) / GRID_CELL_DEGREES);
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const key = `${x}:${y}`;
            const bucket = this.grid.get(key);
            if (bucket) bucket.push(s);
            else this.grid.set(key, [s]);
          }
        }
      }
    }
  }

  /**
   * Return the speed limit in km/h of the nearest OSM rail segment within
   * radiusM metres of the given point, or null if none found.
   */
  queryAt(lng: number, lat: number, radiusM = 200): number | null {
    if (!this._loaded) return null;
    const cx = Math.floor(lng / GRID_CELL_DEGREES);
    const cy = Math.floor(lat / GRID_CELL_DEGREES);
    let best: { dist: number; speed: number } | null = null;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const s of this.grid.get(`${x}:${y}`) ?? []) {
          const d = distToSegmentM([lng, lat], s.a, s.b);
          if (d <= radiusM && (!best || d < best.dist)) {
            best = { dist: d, speed: s.speedKmh };
          }
        }
      }
    }
    return best?.speed ?? null;
  }

  /**
   * Return the electrification type of the nearest segment within radiusM, or ''.
   * Useful for displaying track type info or applying infrastructure caps.
   */
  queryElectrificationAt(lng: number, lat: number, radiusM = 200): string {
    if (!this._loaded) return '';
    const cx = Math.floor(lng / GRID_CELL_DEGREES);
    const cy = Math.floor(lat / GRID_CELL_DEGREES);
    let best: { dist: number; elec: string } | null = null;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const s of this.grid.get(`${x}:${y}`) ?? []) {
          const d = distToSegmentM([lng, lat], s.a, s.b);
          if (d <= radiusM && (!best || d < best.dist)) {
            best = { dist: d, elec: s.electrified };
          }
        }
      }
    }
    return best?.elec ?? '';
  }
}

export const railSpeedIndex = new RailSpeedIndex();
