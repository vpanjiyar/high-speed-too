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
}

export interface NetworkData {
  stations: Station[];
  lines: Line[];
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
    for (const fn of this.listeners) fn();
  }
}
