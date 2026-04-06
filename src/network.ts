// ── Network data model ────────────────────────────────────────────────────────
// Stations, lines, and the network container with localStorage persistence.

export interface Station {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** NaPTAN ATCO code, set when the station was imported from the NaPTAN layer. */
  atco?: string;
}

export interface Line {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
  /** Rolling stock ID from the catalogue (optional). */
  rollingStockId?: string;
  /** Number of train units assigned to this line. */
  trainCount?: number;
}

export interface NetworkData {
  stations: Station[];
  lines: Line[];
}

// ── File export / import ──────────────────────────────────────────────────────

export interface NetworkExport {
  appId: 'high-speed-too';
  version: 1;
  exportedAt: string;
  network: NetworkData;
}

/** Type-guard: returns true if `raw` is a well-formed NetworkExport. */
export function validateNetworkExport(raw: unknown): raw is NetworkExport {
  if (typeof raw !== 'object' || raw === null) return false;
  const d = raw as Record<string, unknown>;
  if (d['appId'] !== 'high-speed-too') return false;
  if (typeof d['version'] !== 'number') return false;
  if (typeof d['network'] !== 'object' || d['network'] === null) return false;
  const net = d['network'] as Record<string, unknown>;
  if (!Array.isArray(net['stations']) || !Array.isArray(net['lines'])) return false;
  for (const s of net['stations'] as unknown[]) {
    if (typeof s !== 'object' || s === null) return false;
    const stn = s as Record<string, unknown>;
    if (typeof stn['id'] !== 'string' || typeof stn['name'] !== 'string') return false;
    if (typeof stn['lng'] !== 'number' || typeof stn['lat'] !== 'number') return false;
  }
  for (const l of net['lines'] as unknown[]) {
    if (typeof l !== 'object' || l === null) return false;
    const ln = l as Record<string, unknown>;
    if (typeof ln['id'] !== 'string' || typeof ln['name'] !== 'string') return false;
    if (typeof ln['color'] !== 'string' || !Array.isArray(ln['stationIds'])) return false;
  }
  return true;
}

// ── Mini Metro–inspired palette ──────────────────────────────────────────────
export const LINE_COLORS = [
  '#E53935', // red
  '#1E88E5', // blue
  '#43A047', // green
  '#FDD835', // yellow
  '#8E24AA', // purple
  '#FB8C00', // orange
  '#00ACC1', // cyan
  '#6D4C41', // brown
  '#EC407A', // pink
  '#546E7A', // slate
] as const;

const STORAGE_KEY = 'hst-network';

let idCounter = 0;
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

// ── Network class ─────────────────────────────────────────────────────────────

export class Network {
  stations: Station[] = [];
  lines: Line[] = [];

  private listeners = new Set<() => void>();

  // ── History (undo / redo) ──────────────────────────────────────────────────

  private _history: NetworkData[] = [];
  private _historyIndex = -1;
  private _inHistoryOp = false;

  private _snapshot(): NetworkData {
    return {
      stations: JSON.parse(JSON.stringify(this.stations)),
      lines: JSON.parse(JSON.stringify(this.lines)),
    };
  }

  canUndo(): boolean { return this._historyIndex > 0; }
  canRedo(): boolean { return this._historyIndex < this._history.length - 1; }

  undo(): void {
    if (!this.canUndo()) return;
    this._historyIndex--;
    const snap = this._history[this._historyIndex];
    this.stations = JSON.parse(JSON.stringify(snap.stations));
    this.lines = JSON.parse(JSON.stringify(snap.lines));
    this._inHistoryOp = true;
    this._emit();
    this._inHistoryOp = false;
  }

  redo(): void {
    if (!this.canRedo()) return;
    this._historyIndex++;
    const snap = this._history[this._historyIndex];
    this.stations = JSON.parse(JSON.stringify(snap.stations));
    this.lines = JSON.parse(JSON.stringify(snap.lines));
    this._inHistoryOp = true;
    this._emit();
    this._inHistoryOp = false;
  }

  // ── Stations ───────────────────────────────────────────────────────────────

  addStation(lng: number, lat: number, name?: string, atco?: string): Station {
    const station: Station = {
      id: generateId('stn'),
      name: name ?? `Station ${this.stations.length + 1}`,
      lng,
      lat,
      ...(atco ? { atco } : {}),
    };
    this.stations.push(station);
    this._emit();
    return station;
  }

  /** Find a network station by ATCO code (deduplicates NaPTAN imports). */
  findByAtco(atco: string): Station | undefined {
    return this.stations.find((s) => s.atco === atco);
  }

  removeStation(id: string): void {
    this.stations = this.stations.filter((s) => s.id !== id);
    // Remove from all lines
    for (const line of this.lines) {
      line.stationIds = line.stationIds.filter((sid) => sid !== id);
    }
    this._emit();
  }

  renameStation(id: string, name: string): void {
    const s = this.stations.find((s) => s.id === id);
    if (s) {
      s.name = name;
      this._emit();
    }
  }

  getStation(id: string): Station | undefined {
    return this.stations.find((s) => s.id === id);
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  addLine(name: string, color: string): Line {
    const line: Line = {
      id: generateId('line'),
      name,
      color,
      stationIds: [],
    };
    this.lines.push(line);
    this._emit();
    return line;
  }

  removeLine(id: string): void {
    this.lines = this.lines.filter((l) => l.id !== id);
    this._emit();
  }

  renameLine(id: string, name: string): void {
    const l = this.lines.find((l) => l.id === id);
    if (l) {
      l.name = name;
      this._emit();
    }
  }

  setLineColor(id: string, color: string): void {
    const l = this.lines.find((l) => l.id === id);
    if (l) {
      l.color = color;
      this._emit();
    }
  }

  setLineTrain(id: string, rollingStockId: string | undefined, trainCount?: number): void {
    const l = this.lines.find((l) => l.id === id);
    if (!l) return;
    l.rollingStockId = rollingStockId;
    l.trainCount = rollingStockId ? (trainCount ?? l.trainCount ?? 1) : undefined;
    this._emit();
  }

  setLineTrainCount(id: string, count: number): void {
    const l = this.lines.find((l) => l.id === id);
    if (l) {
      l.trainCount = Math.max(0, Math.round(count));
      this._emit();
    }
  }

  addStationToLine(lineId: string, stationId: string): void {
    const line = this.lines.find((l) => l.id === lineId);
    if (!line) return;
    // Don't add duplicate consecutive station
    if (line.stationIds[line.stationIds.length - 1] === stationId) return;
    line.stationIds.push(stationId);
    this._emit();
  }

  removeStationFromLine(lineId: string, index: number): void {
    const line = this.lines.find((l) => l.id === lineId);
    if (!line) return;
    line.stationIds.splice(index, 1);
    this._emit();
  }

  getLine(id: string): Line | undefined {
    return this.lines.find((l) => l.id === id);
  }

  /** Returns the next unused color from the palette. */
  nextColor(): string {
    const used = new Set(this.lines.map((l) => l.color));
    return LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[this.lines.length % LINE_COLORS.length];
  }

  // ── File export / import ──────────────────────────────────────────────────

  /** Returns the current network wrapped in a versioned export envelope. */
  exportNetwork(): NetworkExport {
    return {
      appId: 'high-speed-too',
      version: 1,
      exportedAt: new Date().toISOString(),
      network: this._snapshot(),
    };
  }

  /**
   * Load from a validated import envelope.
   * - merge=false: replaces everything (stations + lines) with the imported data.
   * - merge=true: remaps imported IDs to fresh ones and appends to the existing
   *   network so nothing is overwritten.
   */
  importNetwork(data: NetworkData, merge: boolean): void {
    if (!merge) {
      this.stations = JSON.parse(JSON.stringify(data.stations));
      this.lines = JSON.parse(JSON.stringify(data.lines));
    } else {
      const idMap = new Map<string, string>();
      for (const s of data.stations) {
        const newId = generateId('stn');
        idMap.set(s.id, newId);
        this.stations.push({ ...s, id: newId });
      }
      for (const l of data.lines) {
        this.lines.push({
          ...l,
          id: generateId('line'),
          stationIds: l.stationIds.map((sid) => idMap.get(sid) ?? sid),
        });
      }
    }
    this._emit();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  save(): void {
    const data: NetworkData = { stations: this.stations, lines: this.lines };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* quota exceeded — silently ignore */ }
  }

  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data: NetworkData = JSON.parse(raw);
      if (Array.isArray(data.stations)) this.stations = data.stations;
      if (Array.isArray(data.lines)) this.lines = data.lines;
      this._emit();
    } catch { /* corrupted data — start fresh */ }
  }

  clear(): void {
    this.stations = [];
    this.lines = [];
    localStorage.removeItem(STORAGE_KEY);
    this._emit();
  }

  // ── Change notification ────────────────────────────────────────────────────

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private _emit(): void {
    this.save();
    if (!this._inHistoryOp) {
      // Truncate any undone "future" entries, then push the new state
      this._history.splice(this._historyIndex + 1);
      this._history.push(this._snapshot());
      // Cap to 100 entries to bound memory use
      const MAX_HISTORY = 100;
      if (this._history.length > MAX_HISTORY) {
        this._history.splice(0, this._history.length - MAX_HISTORY);
      }
      this._historyIndex = this._history.length - 1;
    }
    for (const fn of this.listeners) fn();
  }
}
