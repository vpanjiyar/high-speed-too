// ── Timetable model ───────────────────────────────────────────────────────────
// Generates and stores per-line service schedules with headcodes,
// departure times, calling points, and estimated demand loading.

import type { Network, Line } from './network';
import type { LinePolylineCache } from './simulation';

/** A single scheduled service on a line. */
export interface TimetableService {
  /** Unique ID for this service within the timetable. */
  serviceId: string;
  /** Human-readable headcode (e.g. "1A23"). */
  headcode: string;
  /** Description (e.g. "09:15 London Euston to Birmingham New Street"). */
  description: string;
  /** Line this service belongs to. */
  lineId: string;
  /** Origin station name. */
  originName: string;
  /** Destination station name. */
  destinationName: string;
  /** Direction: outbound or return. */
  direction: 'outbound' | 'return';
  /** Departure time from origin in simulated seconds since midnight (06:00 base = 21600). */
  departureTimeSec: number;
  /** Scheduled calling points with times. */
  callingPoints: CallingPoint[];
  /** Estimated peak load fraction (0–1). */
  estimatedLoad: number;
  /** Number of intermediate stops. */
  intermediateStops: number;
}

export interface CallingPoint {
  stationName: string;
  stationId: string;
  arrivalTimeSec: number;
  departureTimeSec: number;
}

/** Per-line timetable config. */
export interface LineTimetableConfig {
  lineId: string;
  /** First departure (seconds since midnight, where 06:00 = 21600). */
  firstServiceSec: number;
  /** Last departure. */
  lastServiceSec: number;
  /** Trains per hour in each direction. */
  trainsPerHour: number;
}

/** Full timetable for the simulation. */
export interface Timetable {
  configs: Map<string, LineTimetableConfig>;
  services: TimetableService[];
}

const SIM_BASE_SEC = 6 * 3600; // 06:00 is sim time 0

/** Generate a headcode: digit + letter + two digits (UK style). */
function generateHeadcode(lineIndex: number, serviceIndex: number): string {
  const digit1 = (lineIndex % 9) + 1;
  const letter = String.fromCharCode(65 + (lineIndex % 26));
  const num = String(serviceIndex % 100).padStart(2, '0');
  return `${digit1}${letter}${num}`;
}

function formatClockFromSec(sec: number): string {
  const total = Math.floor(sec) % 86400;
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Build a timetable for all lines in the network. */
export function buildTimetable(
  network: Network,
  caches: Map<string, LinePolylineCache>,
  configs: Map<string, LineTimetableConfig>,
  stationWeights: Map<string, number>,
): Timetable {
  const services: TimetableService[] = [];
  let lineIdx = 0;

  for (const line of network.lines) {
    const cache = caches.get(line.id);
    if (!cache || line.stationIds.length < 2) { lineIdx++; continue; }

    let config = configs.get(line.id);
    if (!config) {
      const tph = Math.max(1, line.trainCount ?? 1);
      config = {
        lineId: line.id,
        firstServiceSec: SIM_BASE_SEC,
        lastServiceSec: 23 * 3600,
        trainsPerHour: tph,
      };
      configs.set(line.id, config);
    }

    const intervalSec = 3600 / config.trainsPerHour;
    const stops = cache.stationStops;
    const originName = stops[0]?.name ?? 'Origin';
    const destName = stops[stops.length - 1]?.name ?? 'Destination';

    // Average station weight for demand estimation
    const avgWeight = getAverageWeight(line, stationWeights);

    let svcIdx = 0;

    // Outbound services
    for (let depSec = config.firstServiceSec; depSec <= config.lastServiceSec; depSec += intervalSec) {
      const headcode = generateHeadcode(lineIdx, svcIdx);
      const callingPoints = buildCallingPoints(line, stops, depSec, 'outbound', network);
      const estimatedLoad = estimateLoad(config.trainsPerHour, avgWeight, depSec);

      services.push({
        serviceId: `${line.id}_out_${svcIdx}`,
        headcode,
        description: `${formatClockFromSec(depSec)} ${originName} to ${destName}`,
        lineId: line.id,
        originName,
        destinationName: destName,
        direction: 'outbound',
        departureTimeSec: depSec,
        callingPoints,
        estimatedLoad,
        intermediateStops: Math.max(0, line.stationIds.length - 2),
      });
      svcIdx++;
    }

    // Return services (offset by one-way travel time)
    const returnOffset = cache.oneWayTravelSec + 5 * 60; // 5 min turnaround
    let retIdx = 0;
    for (let depSec = config.firstServiceSec + returnOffset; depSec <= config.lastServiceSec + returnOffset; depSec += intervalSec) {
      const headcode = generateHeadcode(lineIdx + 13, retIdx);
      const callingPoints = buildCallingPoints(line, stops, depSec, 'return', network);
      const estimatedLoad = estimateLoad(config.trainsPerHour, avgWeight, depSec);

      services.push({
        serviceId: `${line.id}_ret_${retIdx}`,
        headcode,
        description: `${formatClockFromSec(depSec)} ${destName} to ${originName}`,
        lineId: line.id,
        originName: destName,
        destinationName: originName,
        direction: 'return',
        departureTimeSec: depSec,
        callingPoints,
        estimatedLoad,
        intermediateStops: Math.max(0, line.stationIds.length - 2),
      });
      retIdx++;
    }

    lineIdx++;
  }

  // Sort by departure time
  services.sort((a, b) => a.departureTimeSec - b.departureTimeSec);

  return { configs, services };
}

function buildCallingPoints(
  line: Line,
  stops: { name: string; arrivalTimeSec: number; departureTimeSec: number }[],
  baseDepartSec: number,
  direction: 'outbound' | 'return',
  _network: Network,
): CallingPoint[] {
  const points: CallingPoint[] = [];
  const ids = direction === 'outbound' ? [...line.stationIds] : [...line.stationIds].reverse();
  const stopsOrdered = direction === 'outbound' ? stops : [...stops].reverse();

  const originDep = stopsOrdered[0]?.departureTimeSec ?? 0;

  for (let i = 0; i < ids.length; i++) {
    const stop = stopsOrdered[i];
    if (!stop) continue;
    const offset = direction === 'outbound'
      ? stop.arrivalTimeSec
      : (stops[stops.length - 1]?.arrivalTimeSec ?? 0) - stop.arrivalTimeSec;

    points.push({
      stationName: stop.name,
      stationId: ids[i]!,
      arrivalTimeSec: i === 0 ? baseDepartSec : baseDepartSec + (offset - originDep),
      departureTimeSec: i === ids.length - 1
        ? baseDepartSec + (offset - originDep)
        : baseDepartSec + ((direction === 'outbound' ? stop.departureTimeSec : stop.arrivalTimeSec + 45) - originDep),
    });
  }

  return points;
}

function getAverageWeight(line: Line, weights: Map<string, number>): number {
  if (line.stationIds.length === 0) return 0.1;
  let sum = 0;
  for (const id of line.stationIds) {
    sum += weights.get(id) ?? 0.1;
  }
  return sum / line.stationIds.length;
}

/** Estimate load factor based on demand, TPH, and time of day. */
function estimateLoad(tph: number, avgWeight: number, depTimeSec: number): number {
  // Peak hours: 07:00–09:00 and 17:00–19:30
  const h = (depTimeSec / 3600) % 24;
  let peakMultiplier = 1.0;
  if ((h >= 7 && h < 9) || (h >= 17 && h < 19.5)) {
    peakMultiplier = 2.2;
  } else if ((h >= 9 && h < 10) || (h >= 16 && h < 17)) {
    peakMultiplier = 1.6;
  } else if (h >= 6 && h < 22) {
    peakMultiplier = 1.0;
  } else {
    peakMultiplier = 0.4; // late night
  }

  // Base demand: weight is 0–1 representing catchment relative population.
  // Boost base so even moderate stations show meaningful demand.
  const baseDemand = Math.max(0.25, avgWeight) * 1.8;

  // Higher demand / lower TPH = higher load (under-served routes fill up)
  const supplyFactor = Math.max(0.5, tph / 6);
  const rawLoad = (baseDemand * peakMultiplier) / supplyFactor;
  return Math.min(1, Math.max(0, rawLoad));
}

/** Find the active service for a given train based on sim time and line cache.
 *  trainElapsedSec is how far the train is into its current one-way leg,
 *  used to compute approximate departure time for matching. */
export function findActiveService(
  timetable: Timetable,
  lineId: string,
  direction: 'forward' | 'reverse',
  simTimeSec: number,
  cache: LinePolylineCache,
  trainElapsedSec = 0,
): TimetableService | null {
  const baseSec = SIM_BASE_SEC + simTimeSec;
  const ttDir = direction === 'forward' ? 'outbound' : 'return';
  // Approximate departure time of this train
  const approxDepSec = baseSec - trainElapsedSec;

  // Find the service whose departure is closest to this train's approximate departure
  let best: TimetableService | null = null;
  let bestDelta = Infinity;

  for (const svc of timetable.services) {
    if (svc.lineId !== lineId || svc.direction !== ttDir) continue;
    const delta = approxDepSec - svc.departureTimeSec;
    const absDelta = Math.abs(delta);
    // Service should be within a reasonable window of the train's journey
    if (absDelta < cache.oneWayTravelSec && absDelta < bestDelta) {
      bestDelta = absDelta;
      best = svc;
    }
  }

  return best;
}
