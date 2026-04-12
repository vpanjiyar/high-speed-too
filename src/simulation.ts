// ── Train running simulation ───────────────────────────────────────────────────
// Drives trains along designed lines using pre-computed physics profiles from
// computeLineStats(). Position is derived from the actual polyline geometry, not
// physics integration, keeping the simulation deterministic and drift-free.

import type { Network, Line } from './network';
import {
  computeLineStats,
  ROLLING_STOCK,
  type RollingStock,
  type JourneyProfileSegment,
  type JourneyStationStop,
} from './rolling-stock';
import { getLineLogicalSegments } from './network-geometry';
import { railSpeedIndex } from './rail-speed-index';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Block length in metres — one signal block. Trains stop if the next block is occupied. */
export const BLOCK_LENGTH_M = 1500;

/** Dwell time per intermediate stop in seconds (must match rolling-stock.ts). */
const DWELL_TIME_SEC = 45;

/** Turnaround time at terminals in minutes (must match rolling-stock.ts). */
const TURNAROUND_TIME_MIN = 5;

/** Maximum wall-clock delta per tick in ms — prevents spiral-of-death after tab backgrounding. */
const MAX_WALL_DELTA_MS = 200;

/** Maximum simulated time per sub-step — prevents trains teleporting through blocks. */
const MAX_SIM_SUBSTEP_SEC = 20;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TrainStatus = 'running' | 'dwelling' | 'waiting_signal' | 'turnaround';
export type SimSpeed = 1 | 5 | 10 | 30;

export interface TrainState {
  id: string;
  lineId: string;
  lineColor: string;
  lineName: string;
  rollingStockName: string;
  carsPerUnit: number;
  totalCapacity: number;
  /** Index into line.stationIds[] — the *next* station this train is heading toward */
  nextStationIndex: number;
  direction: 'forward' | 'reverse';
  status: TrainStatus;
  /** Real distance along the line polyline in metres */
  polylineDistanceM: number;
  /** Current interpolated map position */
  lng: number;
  lat: number;
  /** Current speed in km/h */
  speedKmh: number;
  /** Elapsed seconds within the current station-to-station leg */
  legElapsedSec: number;
  /** Dwell/turnaround seconds remaining at a station */
  dwellRemainingSec: number;
  /** Occupancy as a fraction of totalCapacity (0–1) */
  occupancy: number;
  /** Current block index (floor(polylineDistanceM / BLOCK_LENGTH_M)) */
  currentBlockIndex: number;
  /** Name of the next scheduled stop */
  nextStationName: string;
  /** Estimated arrival at next station in seconds of simulated time */
  nextArrivalSimSec: number;
  /** Human-readable headcode (e.g. "1A23") */
  headcode: string;
  /** Service description (e.g. "09:15 London Euston to Birmingham") */
  serviceDescription: string;
  /** Origin station name */
  originName: string;
  /** Destination station name */
  destinationName: string;
  /** Whether this train is being followed (show train image instead of dot) */
  isFollowed: boolean;
  /** Bearing in degrees for train orientation */
  bearing: number;
  /** Total train length in metres (from rolling stock catalogue) */
  lengthM: number;
  /** Per-carriage load fractions (0–1 each). Length === carsPerUnit. */
  carLoads: number[];
  /** Seconds this train has been continuously held at a red signal (real-time). */
  signalHeldSec: number;
}

export interface LinePolylineCache {
  lineId: string;
  /** Cumulative real distances at each vertex, in metres */
  cumulativeDistM: number[];
  /** Map coordinates parallel to cumulativeDistM */
  coordinates: [number, number][];
  /** Total real length of the polyline in metres */
  totalLengthM: number;
  /** Per-leg info mapping leg index → real polyline start/end distance */
  legs: Array<{ startM: number; endM: number; lengthM: number }>;
  /** Station stops from computeLineStats (winding-inflated distances) */
  stationStops: JourneyStationStop[];
  /** Profile segments from computeLineStats */
  profileSegments: JourneyProfileSegment[];
  /** Total round-trip time in seconds (includes turnaround at each terminal) */
  roundTripSec: number;
  /** One-way travel time in seconds */
  oneWayTravelSec: number;
  /** Per-vertex curvature speed limits in km/h (smoothed over 600m windows). */
  curvatureLimitsKmh: number[];
  /** Rolling stock max speed in km/h (from spec). */
  lineMaxSpeedKmh: number;
}

export interface SimulationState {
  running: boolean;
  speedMultiplier: SimSpeed;
  /** Accumulated simulation time in seconds */
  simTimeSec: number;
  trains: Map<string, TrainState>;
  /** key = `${lineId}:${blockIndex}` */
  blocks: Map<string, string | null>;
  polylineCaches: Map<string, LinePolylineCache>;
  /** Catchment boarding weights by stationId (0–1 normalised). Optional. */
  stationWeights: Map<string, number>;
  /** Game metrics tracking */
  metrics: GameMetrics;
}

/** Accumulated game performance metrics */
export interface GameMetrics {
  /** Total passengers delivered (alighted at any station) */
  totalPassengersDelivered: number;
  /** Total revenue earned (pence, displayed as £) */
  totalRevenue: number;
  /** Running cost per hour (£) based on active trains */
  operatingCostPerHour: number;
  /** Number of signal stops (delays) accumulated */
  signalDelays: number;
  /** Total dwell overruns (time spent waiting at signals) in seconds */
  signalWaitTimeSec: number;
  /** Passenger satisfaction score (0–100) */
  satisfaction: number;
  /** Passengers delivered in the last tracked period */
  recentDeliveries: number;
  /** Timestamp (simTimeSec) of last metric reset */
  lastMetricResetSec: number;
}

// ── Per-carriage load initialisation ───────────────────────────────────────────

/** Create initial per-car loads with slight random variation around a mean. */
function initCarLoads(cars: number, meanOccupancy: number): number[] {
  const loads: number[] = [];
  for (let i = 0; i < cars; i++) {
    const jitter = (Math.random() - 0.5) * 0.15; // ±7.5% variation
    loads.push(Math.max(0, Math.min(1, meanOccupancy + jitter)));
  }
  return loads;
}

// ── Haversine distance ─────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Polyline cache ─────────────────────────────────────────────────────────────

/**
 * Build a LinePolylineCache from a line's segment paths.
 * The cache stores real geographic distances (not winding-inflated) so that
 * profile times can be mapped accurately to map positions.
 */
export function buildLinePolylineCache(line: Line, network: Network): LinePolylineCache | null {
  if (line.stationIds.length < 2) return null;

  const stationLookup = { getStation: (id: string) => network.getStation(id) };
  const logicalSegments = getLineLogicalSegments(line, stationLookup);
  if (logicalSegments.length === 0) return null;

  const stationObjects = line.stationIds
    .map(id => network.getStation(id))
    .filter((s): s is NonNullable<typeof s> => s != null);

  if (stationObjects.length < 2) return null;

  // Build coordinate array with cumulative real distances FIRST so we can
  // derive per-leg speed limits before computing the journey profile.
  const coordinates: [number, number][] = [];
  const cumulativeDistM: number[] = [];
  let running = 0;

  const legs: Array<{ startM: number; endM: number; lengthM: number }> = [];

  for (let li = 0; li < logicalSegments.length; li++) {
    const seg = logicalSegments[li]!;
    const legStartM = running;

    for (let ci = 0; ci < seg.coordinates.length; ci++) {
      const coord = seg.coordinates[ci]!;
      if (ci === 0 && coordinates.length > 0) {
        // Skip duplicate junction vertex but don't add distance
        const last = coordinates[coordinates.length - 1]!;
        if (Math.abs(last[0] - coord[0]) < 1e-9 && Math.abs(last[1] - coord[1]) < 1e-9) continue;
      }
      if (coordinates.length > 0) {
        const prev = coordinates[coordinates.length - 1]!;
        running += haversineM(prev[1], prev[0], coord[1], coord[0]);
      }
      coordinates.push([coord[0], coord[1]]);
      cumulativeDistM.push(running);
    }

    legs.push({ startM: legStartM, endM: running, lengthM: running - legStartM });
  }

  const totalLengthM = running;

  // Compute per-vertex speed limits (curvature + OSM overlay)
  const curvatureLimitsKmh = computeCurvatureLimits(coordinates, cumulativeDistM);
  const speedLimitsKmh = curvatureLimitsKmh.map((curv, i) => {
    const osm = railSpeedIndex.queryAt(coordinates[i]![0], coordinates[i]![1], 200);
    return (osm !== null && osm > 0) ? osm : curv;
  });

  // Derive per-leg speed limits: for each leg, sample vertices and take the
  // median speed limit (avoids a single tight curve dominating an entire leg).
  const legSpeedLimitsKmh: number[] = [];
  for (const leg of legs) {
    const samples: number[] = [];
    for (let vi = 0; vi < coordinates.length; vi++) {
      const d = cumulativeDistM[vi]!;
      if (d >= leg.startM && d <= leg.endM) {
        const s = speedLimitsKmh[vi]!;
        if (s < 900) samples.push(s); // ignore 999 (no limit / straight track)
      }
    }
    if (samples.length > 0) {
      samples.sort((a, b) => a - b);
      // Use median sampled limit so lines aren't systematically under-sped.
      const midIdx = Math.floor(samples.length * 0.5);
      legSpeedLimitsKmh.push(samples[midIdx]!);
    } else {
      legSpeedLimitsKmh.push(0); // 0 = no limit (computeLineStats ignores 0)
    }
  }

  // Determine rolling stock and compute profile with speed limits
  const stock: RollingStock = ROLLING_STOCK.find(r => r.id === line.rollingStockId)
    ?? ROLLING_STOCK.find(r => r.id === 'class-700')!;
  const unitCount = line.trainCount ?? 1;
  const stats = computeLineStats(stationObjects, stock, unitCount, legSpeedLimitsKmh);

  // Round-trip time: two one-way journeys + turnaround at each terminal
  const oneWayTravelSec = stats.totalTimeMin * 60;
  const roundTripSec = oneWayTravelSec * 2 + TURNAROUND_TIME_MIN * 60 * 2;

  return {
    lineId: line.id,
    cumulativeDistM,
    coordinates,
    totalLengthM,
    legs,
    stationStops: stats.stationStops,
    profileSegments: stats.profileSegments,
    roundTripSec,
    oneWayTravelSec,
    curvatureLimitsKmh: speedLimitsKmh,
    lineMaxSpeedKmh: stock.maxSpeedKmh,
  };
}

/**
 * Interpolate a map position from a real polyline distance using binary search.
 */
export function interpolatePosition(
  cache: LinePolylineCache,
  distanceM: number,
): [number, number] {
  const dist = Math.max(0, Math.min(distanceM, cache.totalLengthM));
  const { cumulativeDistM, coordinates } = cache;

  // Binary search for the straddling pair
  let lo = 0;
  let hi = cumulativeDistM.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulativeDistM[mid]! <= dist) lo = mid;
    else hi = mid;
  }

  const d0 = cumulativeDistM[lo]!;
  const d1 = cumulativeDistM[hi]!;
  const c0 = coordinates[lo]!;
  const c1 = coordinates[hi]!;

  if (d1 === d0) return [c0[0], c0[1]];
  const t = (dist - d0) / (d1 - d0);
  return [c0[0] + t * (c1[0] - c0[0]), c0[1] + t * (c1[1] - c0[1])];
}

// Speed limits derived from Network Rail Group Standard NR/GS/CIV/027 (Track Design).
// For real-world accuracy, OpenRailwayMap (openrailwaymap.org) has per-segment
// maxspeed data sourced from OSM railway=rail maxspeed tags.

/** UK Network Rail speed limits by curve radius (approximate). */
function radiusToSpeedKmh(radiusM: number): number {
  if (radiusM < 200)  return 40;   // ~25 mph — very tight curve
  if (radiusM < 400)  return 65;   // ~40 mph
  if (radiusM < 600)  return 97;   // ~60 mph
  if (radiusM < 900)  return 121;  // ~75 mph
  if (radiusM < 1500) return 145;  // ~90 mph
  if (radiusM < 2500) return 161;  // ~100 mph
  if (radiusM < 4000) return 177;  // ~110 mph
  return 999;                      // straight track — no curve limit
}

/**
 * Compute per-vertex curvature speed limits for a polyline.
 * OSM data is jagged so we use a 600m smoothing window: a curve limit
 * at vertex i is spread both forward and backward over 600m of track
 * so the train begins braking well before the bend.
 */
function computeCurvatureLimits(
  coords: [number, number][],
  cumulativeDistM: number[],
): number[] {
  const n = coords.length;
  const pointLimits = new Array<number>(n).fill(999);

  // Compute raw limit at each interior vertex
  for (let i = 1; i < n - 1; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const c = coords[i + 1]!;

    // Vectors AB and BC in approximate metres (longitude scaled by cos(lat))
    const cosLat = Math.cos(b[1] * Math.PI / 180);
    const abX = (b[0] - a[0]) * cosLat * 111320;
    const abY = (b[1] - a[1]) * 111320;
    const bcX = (c[0] - b[0]) * cosLat * 111320;
    const bcY = (c[1] - b[1]) * 111320;

    const magAB = Math.sqrt(abX * abX + abY * abY);
    const magBC = Math.sqrt(bcX * bcX + bcY * bcY);
    if (magAB < 1 || magBC < 1) continue;

    const dot = (abX * bcX + abY * bcY) / (magAB * magBC);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))); // radians, 0=straight

    if (angle < 0.02) continue; // < ~1° — effectively straight

    // Radius of curvature: R ≈ average_segment_length / angle
    const avgSegLen = (magAB + magBC) / 2;
    const R = avgSegLen / angle;
    pointLimits[i] = radiusToSpeedKmh(R);
  }

  // Spread limits over a ±600m window (braking approach zone)
  const WINDOW_M = 600;
  const smoothed = [...pointLimits];
  for (let i = 0; i < n; i++) {
    const lim = pointLimits[i]!;
    if (lim >= 999) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (cumulativeDistM[i]! - cumulativeDistM[j]! > WINDOW_M) break;
      if (lim < smoothed[j]!) smoothed[j] = lim;
    }
    for (let j = i + 1; j < n; j++) {
      if (cumulativeDistM[j]! - cumulativeDistM[i]! > WINDOW_M) break;
      if (lim < smoothed[j]!) smoothed[j] = lim;
    }
  }
  return smoothed;
}

/** Look up the curvature speed limit (km/h) at a given polyline distance. */
function getCurvatureLimit(cache: LinePolylineCache, posM: number): number {
  const { cumulativeDistM, curvatureLimitsKmh } = cache;
  let lo = 0, hi = cumulativeDistM.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulativeDistM[mid]! <= posM) lo = mid; else hi = mid;
  }
  const d0 = cumulativeDistM[lo]!, d1 = cumulativeDistM[hi]!;
  const t = d1 > d0 ? (posM - d0) / (d1 - d0) : 0;
  return (curvatureLimitsKmh[lo]! + t * (curvatureLimitsKmh[hi]! - curvatureLimitsKmh[lo]!));
}

// ── Profile lookup ─────────────────────────────────────────────────────────────

/**
 * Given elapsed seconds within a one-way journey, return speed and fractional
 * distance along the real polyline.
 *
 * The profile uses winding-inflated distances; we convert to real polyline
 * distances via per-leg fractions (avoiding direct use of RAIL_WINDING_FACTOR
 * against the actual OSM path length, which may differ from station haversine).
 */
function profileLookup(
  cache: LinePolylineCache,
  elapsedSec: number,
  direction: 'forward' | 'reverse',
): { speedKmh: number; polylineDistanceM: number; legIndex: number; nextStationIndex: number } {
  const segs = cache.profileSegments;
  const stops = cache.stationStops;
  const legs = cache.legs;

  // Clamp to valid range
  const t = Math.max(0, Math.min(elapsedSec, cache.oneWayTravelSec));

  // Find the active profile segment
  let seg = segs[0]!;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i]!.startTimeSec <= t && t <= segs[i]!.endTimeSec) {
      seg = segs[i]!;
      break;
    }
    if (segs[i]!.startTimeSec > t) break;
    seg = segs[i]!;
  }

  // Interpolate speed
  const segDuration = seg.endTimeSec - seg.startTimeSec;
  const segT = segDuration > 0 ? (t - seg.startTimeSec) / segDuration : 1;
  const speedKmh = seg.startSpeedKmh + segT * (seg.endSpeedKmh - seg.startSpeedKmh);

  // Convert winding-inflated profile distance to real polyline distance.
  // Strategy: for each leg, use the fraction of progress within that leg.
  const legIndex = seg.legIndex;
  const leg = legs[legIndex];
  if (!leg) {
    return { speedKmh: 0, polylineDistanceM: 0, legIndex: 0, nextStationIndex: 1 };
  }

  const fromStop = stops[legIndex];
  const toStop = stops[legIndex + 1];
  if (!fromStop || !toStop) {
    return { speedKmh: 0, polylineDistanceM: leg.startM, legIndex, nextStationIndex: legIndex + 1 };
  }

  // Winding-inflated leg distance
  const windedLegKm = toStop.distanceKm - fromStop.distanceKm;
  // Current winding-inflated progress within this leg
  const windedProgressKm = seg.startDistanceKm + segT * (seg.endDistanceKm - seg.startDistanceKm) - fromStop.distanceKm;
  const legFraction = windedLegKm > 0 ? Math.max(0, Math.min(1, windedProgressKm / windedLegKm)) : 0;

  const polylineDistanceM = direction === 'forward'
    ? leg.startM + legFraction * leg.lengthM
    : cache.totalLengthM - (leg.startM + legFraction * leg.lengthM);

  // Next station index (in the direction of travel)
  const nextStationIndex = direction === 'forward' ? legIndex + 1 : legIndex;

  return { speedKmh: Math.max(0, speedKmh), polylineDistanceM, legIndex, nextStationIndex };
}

/** Map a physical station index (line.stationIds order) to forward-profile index. */
function profileStationIndex(direction: 'forward' | 'reverse', stationCount: number, stationIndex: number): number {
  return direction === 'forward' ? stationIndex : (stationCount - 1 - stationIndex);
}

// ── Simulation initialisation ──────────────────────────────────────────────────

let trainIdCounter = 0;
function newTrainId(): string {
  return `train_${(trainIdCounter++).toString(36)}`;
}

/** Generate a UK-style headcode: digit + letter + two digits. */
function generateHeadcode(lineIdx: number, trainIdx: number): string {
  const d = (lineIdx % 9) + 1;
  const l = String.fromCharCode(65 + (trainIdx % 26));
  const n = String(trainIdx % 100).padStart(2, '0');
  return `${d}${l}${n}`;
}

function computeBearing(cache: LinePolylineCache, posM: number): number {
  const [lng1, lat1] = interpolatePosition(cache, Math.max(0, posM - 50));
  const [lng2, lat2] = interpolatePosition(cache, Math.min(cache.totalLengthM, posM + 50));
  // Scale longitude difference by cos(lat) to correct for projection at this latitude
  const cosLat = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.atan2((lng2 - lng1) * cosLat, lat2 - lat1) * 180 / Math.PI;
}

function spawnTrainsForLine(
  line: Line,
  cache: LinePolylineCache,
  lineIdx: number,
  simTimeSec = 0,
): TrainState[] {
  const stock: RollingStock = ROLLING_STOCK.find(r => r.id === line.rollingStockId)
    ?? ROLLING_STOCK.find(r => r.id === 'class-700')!;
  const trainCount = Math.max(1, line.trainCount ?? 1);

  const trains: TrainState[] = [];
  const stationCount = line.stationIds.length;

  for (let i = 0; i < trainCount; i++) {
    // Offset trains evenly across the round-trip, then use absolute sim time
    // to position them mid-route (so time changes place trains correctly)
    const baseOffsetSec = (cache.roundTripSec / trainCount) * i;
    const trainTimeSec = (baseOffsetSec + simTimeSec) % cache.roundTripSec;

    let direction: 'forward' | 'reverse';
    let elapsedSec: number;
    let status: TrainStatus;
    let dwellRemaining = 0;

    if (trainTimeSec < cache.oneWayTravelSec) {
      // Outbound leg
      direction = 'forward';
      elapsedSec = trainTimeSec;
      status = 'running';
    } else if (trainTimeSec < cache.oneWayTravelSec + TURNAROUND_TIME_MIN * 60) {
      // Turnaround at terminal
      direction = 'reverse';
      elapsedSec = 0;
      status = 'turnaround';
      dwellRemaining = cache.oneWayTravelSec + TURNAROUND_TIME_MIN * 60 - trainTimeSec;
    } else if (trainTimeSec < cache.oneWayTravelSec * 2 + TURNAROUND_TIME_MIN * 60) {
      // Return leg
      direction = 'reverse';
      elapsedSec = trainTimeSec - cache.oneWayTravelSec - TURNAROUND_TIME_MIN * 60;
      status = 'running';
    } else {
      // Turnaround at origin
      direction = 'forward';
      elapsedSec = 0;
      status = 'turnaround';
      dwellRemaining = cache.roundTripSec - trainTimeSec;
    }

    const lookup = status === 'running'
      ? profileLookup(cache, elapsedSec, direction)
      : null;

    const polylineDistanceM = lookup?.polylineDistanceM
      ?? (direction === 'forward' ? 0 : cache.totalLengthM);
    const [lng, lat] = interpolatePosition(cache, polylineDistanceM);
    const blockIndex = Math.floor(polylineDistanceM / BLOCK_LENGTH_M);

    // Next station in direction of travel
    // For reverse: profile legIndex 0 maps to the last station approaching the
    // second-to-last, so stationCount - 2 - legIndex gives the correct index.
    const nextStationIndex = direction === 'forward'
      ? (lookup?.nextStationIndex ?? 1)
      : (stationCount - 2 - (lookup?.nextStationIndex ?? 0));

    const clampedNext = Math.max(0, Math.min(stationCount - 1, nextStationIndex));
    const nextStationId = line.stationIds[clampedNext] ?? '';
    const nextStation = cache.stationStops[profileStationIndex(direction, stationCount, clampedNext)];

    const originName = cache.stationStops[0]?.name ?? 'Origin';
    const destName = cache.stationStops[stationCount - 1]?.name ?? 'Destination';
    const headcode = generateHeadcode(lineIdx, i);
    const svcOrigin = direction === 'forward' ? originName : destName;
    const svcDest = direction === 'forward' ? destName : originName;
    const bearing = computeBearing(cache, polylineDistanceM);

    const baseDemand = getTimeDemandMultiplier(simTimeSec);
    const startOccupancy = Math.max(0.15, Math.min(0.92, (0.12 + Math.random() * 0.2) * Math.max(1, baseDemand * 0.65)));

    trains.push({
      id: newTrainId(),
      lineId: line.id,
      lineColor: line.color,
      lineName: line.name,
      rollingStockName: stock.designation,
      carsPerUnit: stock.carsPerUnit,
      totalCapacity: stock.totalCapacity,
      nextStationIndex: clampedNext,
      direction,
      status,
      polylineDistanceM,
      lng,
      lat,
      speedKmh: lookup?.speedKmh ?? 0,
      legElapsedSec: elapsedSec,
      dwellRemainingSec: dwellRemaining,
      occupancy: startOccupancy,
      currentBlockIndex: blockIndex,
      nextStationName: nextStation?.name ?? nextStationId,
      nextArrivalSimSec: 0,
      headcode,
      serviceDescription: `${headcode} ${svcOrigin} to ${svcDest}`,
      originName: svcOrigin,
      destinationName: svcDest,
      isFollowed: false,
      bearing,
      lengthM: stock.lengthM,
      carLoads: initCarLoads(stock.carsPerUnit, startOccupancy),
      signalHeldSec: 0,
    });
  }

  return trains;
}

export function initSimulation(network: Network, startSimTimeSec = 0): SimulationState {
  const trains = new Map<string, TrainState>();
  const blocks = new Map<string, string | null>();
  const polylineCaches = new Map<string, LinePolylineCache>();
  const stationWeights = new Map<string, number>();

  let lineIdx = 0;
  for (const line of network.lines) {
    if (line.stationIds.length < 2) { lineIdx++; continue; }
    const cache = buildLinePolylineCache(line, network);
    if (!cache) { lineIdx++; continue; }
    polylineCaches.set(line.id, cache);

    for (const train of spawnTrainsForLine(line, cache, lineIdx, startSimTimeSec)) {
      trains.set(train.id, train);
    }
    lineIdx++;
  }

  return {
    running: false,
    speedMultiplier: 1,
    simTimeSec: startSimTimeSec,
    trains,
    blocks,
    polylineCaches,
    stationWeights,
    metrics: {
      totalPassengersDelivered: 0,
      totalRevenue: 0,
      operatingCostPerHour: 0,
      signalDelays: 0,
      signalWaitTimeSec: 0,
      satisfaction: 85,
      recentDeliveries: 0,
      lastMetricResetSec: 0,
    },
  };
}

// ── Passenger exchange ─────────────────────────────────────────────────────────

/**
 * Model boarding and alighting at a station stop.
 * - Alighting fraction: 20–45% of current occupancy leave at each stop.
 * - Boarding: new passengers proportional to station catchment weight (0–1).
 * - At terminals: most passengers alight (terminal flag).
 */
/**
 * Time-of-day demand multiplier.  simTimeSec is seconds since 06:00.
 * AM peak 07:00-09:00 (3600-10800), PM peak 17:00-19:00 (39600-46800).
 */
function getTimeDemandMultiplier(simTimeSec: number): number {
  const daySeconds = ((simTimeSec % 86400) + 86400) % 86400; // wrap
  // AM peak  07:00-09:00  → 3600-10800
  if (daySeconds >= 3600 && daySeconds < 10800) return 6.0;
  // AM shoulder 06:00-07:00 / 09:00-10:00
  if (daySeconds < 3600) return 1.0 + 5.0 * (daySeconds / 3600);
  if (daySeconds >= 10800 && daySeconds < 14400) return 6.0 - 4.0 * ((daySeconds - 10800) / 3600);
  // PM peak  17:00-19:00  → 39600-46800
  if (daySeconds >= 39600 && daySeconds < 46800) return 5.0;
  // PM shoulder 16:00-17:00 / 19:00-20:00
  if (daySeconds >= 36000 && daySeconds < 39600) return 1.5 + 3.5 * ((daySeconds - 36000) / 3600);
  if (daySeconds >= 46800 && daySeconds < 50400) return 5.0 - 3.0 * ((daySeconds - 46800) / 3600);
  // Off-peak
  return 1.0;
}

function applyPassengerExchange(
  train: TrainState,
  stationId: string,
  stationWeights: Map<string, number>,
  isTerminal: boolean,
  metrics: GameMetrics,
  simTimeSec: number,
): void {
  const capacity = train.totalCapacity;
  if (capacity <= 0) return;
  const cars = train.carsPerUnit;
  const capPerCar = capacity / cars;

  // Ensure carLoads array exists
  if (!train.carLoads || train.carLoads.length !== cars) {
    train.carLoads = new Array(cars).fill(train.occupancy);
  }

  // Total current pax
  let currentPax = 0;
  for (let c = 0; c < cars; c++) currentPax += Math.round(train.carLoads[c]! * capPerCar);

  // ── Alighting ──
  const timeFactor = getTimeDemandMultiplier(simTimeSec);
  const peakCompression = timeFactor >= 4 ? 0.55 : timeFactor >= 2 ? 0.75 : 1;
  const alightFraction = isTerminal
    ? 0.8 + Math.random() * 0.18
    : (0.1 + Math.random() * 0.14) * peakCompression;
  let totalAlighting = 0;
  for (let c = 0; c < cars; c++) {
    const paxInCar = Math.round(train.carLoads[c]! * capPerCar);
    // Slight per-car randomness on alight fraction
    const carAlightFrac = alightFraction * (0.8 + Math.random() * 0.4);
    const alight = Math.min(paxInCar, Math.round(paxInCar * carAlightFrac));
    train.carLoads[c] = Math.max(0, (paxInCar - alight) / capPerCar);
    totalAlighting += alight;
  }

  if (totalAlighting > 0) {
    metrics.totalPassengersDelivered += totalAlighting;
    metrics.recentDeliveries += totalAlighting;
    metrics.totalRevenue += totalAlighting * 3.5;
  }

  // ── Boarding — clustered around station-preferred carriages ──
  // Hash station ID to get a preferred boarding cluster
  let stationHash = 0;
  for (let i = 0; i < stationId.length; i++) stationHash = ((stationHash << 5) - stationHash + stationId.charCodeAt(i)) | 0;
  const clusterCenter = Math.abs(stationHash) % cars;
  const clusterSpread = Math.max(1, Math.floor(cars * 0.3)); // ~30% of train

  const weight = stationWeights.get(stationId) ?? 0.1;
  const demandWeight = Math.max(0.3, weight * 1.8);
  const baseBoardingRate = isTerminal ? 1.0 : 0.75;
  const boardingPressure = demandWeight * capacity * baseBoardingRate * timeFactor;
  currentPax = 0;
  for (let c = 0; c < cars; c++) currentPax += Math.round(train.carLoads[c]! * capPerCar);
  const availableSpace = capacity - currentPax;
  const totalBoarding = Math.round(Math.min(availableSpace, boardingPressure * (0.85 + Math.random() * 0.4)));

  if (totalBoarding > 0) {
    // Build per-car boarding weights: higher near cluster center, with spillover when full
    const weights = new Array(cars).fill(0) as number[];
    for (let c = 0; c < cars; c++) {
      // Distance from cluster center (wrap-around for variety)
      const dist = Math.min(Math.abs(c - clusterCenter), cars - Math.abs(c - clusterCenter));
      // Gaussian-like weighting: strong preference for cluster, falls off
      const baseWeight = Math.exp(-0.5 * (dist / Math.max(1, clusterSpread)) ** 2);
      // If car is nearly full, reduce its attractiveness so passengers spill
      const carLoad = train.carLoads[c]!;
      const fullnessPenalty = carLoad > 0.85 ? Math.max(0.05, 1 - (carLoad - 0.85) * 6) : 1;
      weights[c] = baseWeight * fullnessPenalty + 0.05; // small base ensures some spread
    }
    // Normalise
    const wSum = weights.reduce((a, b) => a + b, 0);
    let remaining = totalBoarding;
    for (let c = 0; c < cars; c++) {
      const share = Math.round(totalBoarding * (weights[c]! / wSum));
      const carPax = Math.round(train.carLoads[c]! * capPerCar);
      const canBoard = Math.min(share, Math.round(capPerCar) - carPax);
      const actual = Math.min(canBoard, remaining);
      train.carLoads[c] = Math.min(1, (carPax + actual) / capPerCar);
      remaining -= actual;
    }
    // Distribute any remainder to least-loaded cars
    while (remaining > 0) {
      let minLoad = 2;
      let minIdx = 0;
      for (let c = 0; c < cars; c++) {
        if (train.carLoads[c]! < minLoad) { minLoad = train.carLoads[c]!; minIdx = c; }
      }
      const carPax = Math.round(train.carLoads[minIdx]! * capPerCar);
      if (carPax >= Math.round(capPerCar)) break; // all full
      train.carLoads[minIdx] = Math.min(1, (carPax + 1) / capPerCar);
      remaining--;
    }
  }

  // Update aggregate occupancy
  let total = 0;
  for (let c = 0; c < cars; c++) total += train.carLoads[c]! * capPerCar;
  train.occupancy = Math.min(1, total / capacity);
}

// ── Simulation tick ────────────────────────────────────────────────────────────

function tickTrain(
  train: TrainState,
  simDeltaSec: number,
  cache: LinePolylineCache,
  line: Line,
  isNextBlockOccupied: (lineId: string, direction: 'forward' | 'reverse', blockIndex: number) => boolean,
  stationWeights: Map<string, number>,
  metrics: GameMetrics,
  simTimeSec: number,
): void {
  const stationCount = line.stationIds.length;

  if (train.status === 'turnaround' || train.status === 'dwelling') {
    train.dwellRemainingSec -= simDeltaSec;
    train.speedKmh = 0;

    if (train.dwellRemainingSec <= 0) {
      train.dwellRemainingSec = 0;
      if (train.status === 'turnaround') {
        // Flip direction
        train.direction = train.direction === 'forward' ? 'reverse' : 'forward';
        train.legElapsedSec = 0;
        // Reset next station index for new direction
        train.nextStationIndex = train.direction === 'forward' ? 1 : stationCount - 2;
      }
      train.status = 'running';
    }
    return;
  }

  if (train.status === 'waiting_signal') {
    // Check if the block ahead has cleared
    const nextBlock = train.currentBlockIndex + (train.direction === 'forward' ? 1 : -1);
    if (!isNextBlockOccupied(train.lineId, train.direction, nextBlock)) {
      train.status = 'running';
    } else {
      train.speedKmh = 0;
      train.signalHeldSec += simDeltaSec;
      metrics.signalWaitTimeSec += simDeltaSec;
      return;
    }
  }

  // Advance elapsed time and look up position from profile
  // Signal-based speed compliance: check what's ahead and reduce movement rate.
  // (Scaling legElapsedSec advance is the only way to affect actual position.)
  const movDir = train.direction === 'forward' ? 1 : -1;
  const bAhead2 = train.currentBlockIndex + movDir * 2;
  const bAhead3 = train.currentBlockIndex + movDir * 3;
  let moveDelta = simDeltaSec;
  if (isNextBlockOccupied(train.lineId, train.direction, bAhead2)) {
    moveDelta *= 0.35; // single-yellow ahead — caution braking
  } else if (isNextBlockOccupied(train.lineId, train.direction, bAhead3)) {
    moveDelta *= 0.65; // double-yellow ahead — ease off
  }
  train.legElapsedSec += moveDelta;

  let lookup = profileLookup(cache, train.legElapsedSec, train.direction);

  // Apply curvature / OSM speed limit — if the physics profile wants to go
  // faster than the track allows, scale back legElapsedSec so the train
  // effectively brakes, then re-lookup for correct position.
  const curveLimitKmh = Math.min(
    getCurvatureLimit(cache, lookup.polylineDistanceM),
    cache.lineMaxSpeedKmh,
  );
  if (lookup.speedKmh > curveLimitKmh + 5) {
    const scale = curveLimitKmh / Math.max(1, lookup.speedKmh);
    train.legElapsedSec = train.legElapsedSec - moveDelta + moveDelta * scale;
    // Re-lookup to get corrected position and speed
    lookup = profileLookup(cache, train.legElapsedSec, train.direction);
  }
  const prevBlock = train.currentBlockIndex;
  const newBlock = Math.floor(lookup.polylineDistanceM / BLOCK_LENGTH_M);

  // Signal check: if moving into an occupied block, hold at current position
  if (newBlock !== prevBlock && isNextBlockOccupied(train.lineId, train.direction, newBlock)) {
    train.speedKmh = 0;
    train.status = 'waiting_signal';
    metrics.signalDelays++;
    // Don't advance — signalHeldSec already counting from approach
    return;
  }

  train.polylineDistanceM = lookup.polylineDistanceM;
  train.currentBlockIndex = newBlock;
  // Display speed: profile speed capped by track limit & signal factor
  const displaySpeed = Math.min(lookup.speedKmh, curveLimitKmh);
  train.speedKmh = displaySpeed * (moveDelta / simDeltaSec);

  // Signal-held counter: increment when next signal is red and speed below 20 mph (~32 km/h)
  const nextBlockAhead = newBlock + (train.direction === 'forward' ? 1 : -1);
  const nextSignalRed = isNextBlockOccupied(train.lineId, train.direction, nextBlockAhead);
  if (nextSignalRed && train.speedKmh < 32.2) {
    train.signalHeldSec += simDeltaSec;
  } else {
    train.signalHeldSec = 0;
  }

  const [lng, lat] = interpolatePosition(cache, train.polylineDistanceM);
  train.lng = lng;
  train.lat = lat;
  train.bearing = computeBearing(cache, train.polylineDistanceM);

  // Check if we've reached the next station
  const atTerminal = train.direction === 'forward'
    ? train.nextStationIndex >= stationCount - 1
    : train.nextStationIndex <= 0;

  const nextStop = cache.stationStops[profileStationIndex(train.direction, stationCount, train.nextStationIndex)];
  if (!nextStop) {
    if (atTerminal) {
      train.status = 'turnaround';
      train.dwellRemainingSec = TURNAROUND_TIME_MIN * 60;
      train.legElapsedSec = 0;
      train.speedKmh = 0;
    }
    return;
  }

  // Detect station arrival by profile segment leg transition
  const isIntermediate = !atTerminal;
  const legChanged = lookup.legIndex !== (train.direction === 'forward'
    ? train.nextStationIndex - 1
    : stationCount - 2 - train.nextStationIndex);

  if (legChanged || (train.legElapsedSec >= cache.oneWayTravelSec && atTerminal)) {
    if (atTerminal) {
      train.status = 'turnaround';
      train.dwellRemainingSec = TURNAROUND_TIME_MIN * 60;
      train.polylineDistanceM = train.direction === 'forward' ? cache.totalLengthM : 0;
      const [tlng, tlat] = interpolatePosition(cache, train.polylineDistanceM);
      train.lng = tlng;
      train.lat = tlat;
      // Passenger exchange at terminal: alight more, board from destination's catchment
      applyPassengerExchange(train, line.stationIds[train.direction === 'forward'
        ? stationCount - 1 : 0] ?? '', stationWeights, true, metrics, simTimeSec);
    } else if (isIntermediate) {
      train.status = 'dwelling';
      // Use the station index we're arriving AT (already incremented above for reverse)
      const arrivingAt = line.stationIds[train.nextStationIndex] ?? '';
      // Per-station dwell time override, or default
      const dwellSec = (arrivingAt ? line.stationDwellTimes?.[arrivingAt] : undefined) ?? DWELL_TIME_SEC;
      train.dwellRemainingSec = dwellSec;
      train.nextStationIndex += train.direction === 'forward' ? 1 : -1;
      // For reverse trains the profile runs forwards but the physical station
      // index is reversed, so map to the profile-equivalent station.
      const profileIdx = train.direction === 'forward'
        ? train.nextStationIndex - 1   // station we just departed (forward)
        : stationCount - 1 - (train.nextStationIndex + 1); // profile-equivalent of departed station
      const profileStop = cache.stationStops[profileIdx];
      train.legElapsedSec = profileStop?.departureTimeSec ?? nextStop.departureTimeSec;
      // Passenger exchange at intermediate stop
      applyPassengerExchange(train, arrivingAt, stationWeights, false, metrics, simTimeSec);
    }
    train.speedKmh = 0;
  }

  // Update next station name
  const ns = cache.stationStops[profileStationIndex(train.direction, stationCount, train.nextStationIndex)];
  if (ns) train.nextStationName = ns.name;
}

/** Build a direction-aware block key: forward and reverse are separate tracks. */
function blockKey(lineId: string, direction: 'forward' | 'reverse', blockIndex: number): string {
  return `${lineId}:${direction === 'forward' ? 'fwd' : 'rev'}:${blockIndex}`;
}

/** Station currently occupied by a train while dwelling/turning around. */
function occupiedStationIdForTrain(train: TrainState, line: Line): string | null {
  const stationCount = line.stationIds.length;
  if (stationCount === 0) return null;

  if (train.status === 'dwelling') {
    const idx = train.direction === 'forward'
      ? train.nextStationIndex - 1
      : train.nextStationIndex + 1;
    return line.stationIds[Math.max(0, Math.min(stationCount - 1, idx))] ?? null;
  }

  if (train.status === 'turnaround') {
    const idx = train.direction === 'forward' ? stationCount - 1 : 0;
    return line.stationIds[idx] ?? null;
  }

  return null;
}

/** Map station blocks for a direction: block index -> station ids in that block. */
function buildStationBlockMap(
  line: Line,
  cache: LinePolylineCache,
  direction: 'forward' | 'reverse',
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const stationCount = line.stationIds.length;

  for (let stationIdx = 0; stationIdx < stationCount; stationIdx++) {
    const profileIdx = direction === 'forward' ? stationIdx : (stationCount - 1 - stationIdx);
    const stop = cache.stationStops[profileIdx];
    const sid = line.stationIds[stationIdx];
    if (!stop || !sid) continue;
    const block = Math.floor((stop.distanceKm * 1000) / BLOCK_LENGTH_M);
    const existing = map.get(block);
    if (existing) existing.push(sid);
    else map.set(block, [sid]);
  }

  return map;
}

/** Rebuild block occupancy map from current train positions. */
function rebuildBlocks(state: SimulationState): void {
  state.blocks.clear();
  for (const [, train] of state.trains) {
    const key = blockKey(train.lineId, train.direction, train.currentBlockIndex);
    state.blocks.set(key, train.id);
  }
}

// ── Public simulation loop ─────────────────────────────────────────────────────

export class Simulation {
  private state: SimulationState;
  private network: Network;
  private rafId: number | null = null;
  private lastTickMs = 0;
  private onTick: (() => void) | null = null;

  constructor(network: Network) {
    this.network = network;
    this.state = initSimulation(network);
  }

  getState(): SimulationState { return this.state; }

  setOnTick(cb: () => void): void { this.onTick = cb; }

  start(): void {
    if (this.state.running) return;
    this.state.running = true;
    this.lastTickMs = performance.now();
    this._schedule();
  }

  stop(): void {
    this.state.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  toggle(): void {
    if (this.state.running) this.stop();
    else this.start();
  }

  setSpeed(s: SimSpeed): void { this.state.speedMultiplier = s; }
  getSpeed(): SimSpeed { return this.state.speedMultiplier; }
  isRunning(): boolean { return this.state.running; }
  getSimTimeSec(): number { return this.state.simTimeSec; }

  /** Jump simulation to a specific time (seconds since 06:00). */
  setSimTimeSec(sec: number): void {
    this.state.simTimeSec = Math.max(0, sec);
  }

  /**
   * Provide pre-fetched catchment weights so passenger simulation can use real data.
   * Weights are normalised 0–1 values (1 = highest demand station).
   */
  setStationWeights(weights: Map<string, number>): void {
    this.state.stationWeights = weights;
  }

  /** Re-initialise the simulation (e.g. after network changes). */
  reinit(): void {
    const wasRunning = this.state.running;
    const stationWeights = this.state.stationWeights;
    this.stop();
    this.state = initSimulation(this.network);
    this.state.stationWeights = stationWeights;
    if (wasRunning) this.start();
  }

  /**
   * Re-initialise at a specific time. Trains are positioned mid-route to
   * match where they would be at the given sim time.
   */
  reinitAtTime(simTimeSec: number): void {
    const wasRunning = this.state.running;
    const stationWeights = this.state.stationWeights;
    this.stop();
    this.state = initSimulation(this.network, simTimeSec);
    this.state.stationWeights = stationWeights;
    if (wasRunning) this.start();
  }

  /**
   * Rebuild polyline caches (e.g. after OSM speed index loads).
   * Preserves train state but re-computes curvature/speed limits.
   */
  rebuildPolylineCaches(): void {
    for (const line of this.network.lines) {
      if (line.stationIds.length < 2) continue;
      const cache = buildLinePolylineCache(line, this.network);
      if (cache) this.state.polylineCaches.set(line.id, cache);
    }
  }

  /** Get all current train states as an array. */
  getTrains(): TrainState[] {
    return Array.from(this.state.trains.values());
  }

  /** Get block state for rendering signals. key = `${lineId}:${blockIndex}` */
  getBlocks(): Map<string, string | null> { return this.state.blocks; }

  /** Get line polyline caches (for signal position rendering). */
  getPolylineCaches(): Map<string, LinePolylineCache> { return this.state.polylineCaches; }

  /** Get game performance metrics. */
  getMetrics(): GameMetrics { return this.state.metrics; }

  private _schedule(): void {
    this.rafId = requestAnimationFrame((now) => this._tick(now));
  }

  private _tick(now: number): void {
    if (!this.state.running) return;

    const wallDelta = Math.min(now - this.lastTickMs, MAX_WALL_DELTA_MS);
    this.lastTickMs = now;

    const totalSimDelta = (wallDelta / 1000) * this.state.speedMultiplier;
    this.state.simTimeSec += totalSimDelta;

    // Sub-step to prevent block-teleportation at high speed multipliers
    let remaining = totalSimDelta;
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_SIM_SUBSTEP_SEC);
      remaining -= step;

      rebuildBlocks(this.state);

      const lineById = new Map(this.network.lines.map((l) => [l.id, l]));
      const stationBlockMapCache = new Map<string, Map<number, string[]>>();

      const countOccupiedPlatforms = (stationId: string): number => {
        let occupied = 0;
        for (const [, t] of this.state.trains) {
          const tLine = lineById.get(t.lineId);
          if (!tLine) continue;
          if (occupiedStationIdForTrain(t, tLine) === stationId) occupied++;
        }
        return occupied;
      };

      const isBlockOccupiedForTrain = (
        activeTrain: TrainState,
        line: Line,
        cache: LinePolylineCache,
        direction: 'forward' | 'reverse',
        blockIndex: number,
      ): boolean => {
        const key = blockKey(line.id, direction, blockIndex);
        const occupantId = this.state.blocks.get(key);
        if (occupantId == null || occupantId === activeTrain.id) return false;

        const mapKey = `${line.id}:${direction}`;
        let stationBlockMap = stationBlockMapCache.get(mapKey);
        if (!stationBlockMap) {
          stationBlockMap = buildStationBlockMap(line, cache, direction);
          stationBlockMapCache.set(mapKey, stationBlockMap);
        }
        const stationIds = stationBlockMap.get(blockIndex) ?? [];
        if (stationIds.length === 0) return true;

        // Only allow multi-occupancy for trains berthed in station platforms.
        const occupantTrain = this.state.trains.get(occupantId);
        const occupantBerthed = occupantTrain
          && (occupantTrain.status === 'dwelling' || occupantTrain.status === 'turnaround');
        if (!occupantBerthed) return true;

        for (const stationId of stationIds) {
          const station = this.network.getStation(stationId);
          const capacity = Math.max(1, station?.platforms ?? 2);
          if (countOccupiedPlatforms(stationId) < capacity) {
            return false;
          }
        }

        return true;
      };

      for (const [, train] of this.state.trains) {
        const cache = this.state.polylineCaches.get(train.lineId);
        const line = this.network.lines.find(l => l.id === train.lineId);
        if (!cache || !line) continue;

        tickTrain(train, step, cache, line, (lineId, direction, blockIndex) => {
          if (lineId !== line.id) {
            const key = blockKey(lineId, direction, blockIndex);
            const occupant = this.state.blocks.get(key);
            return occupant != null && occupant !== train.id;
          }
          return isBlockOccupiedForTrain(train, line, cache, direction, blockIndex);
        }, this.state.stationWeights, this.state.metrics, this.state.simTimeSec);
      }
    }

    rebuildBlocks(this.state);

    // Update operating costs and satisfaction periodically
    const m = this.state.metrics;
    // Operating cost: ~£300/hr per active train (driver, fuel, maintenance)
    m.operatingCostPerHour = this.state.trains.size * 300;

    // Update satisfaction every sim-minute (60s)
    if (this.state.simTimeSec - m.lastMetricResetSec >= 60) {
      const trainCount = this.state.trains.size;
      if (trainCount > 0) {
        const waitingCount = Array.from(this.state.trains.values()).filter(t => t.status === 'waiting_signal').length;
        const onTimeRate = 1 - (waitingCount / trainCount);
        // Satisfaction: weighted blend — on-time performance + occupancy factor
        let avgOccupancy = 0;
        for (const [, t] of this.state.trains) {
          avgOccupancy += t.occupancy;
        }
        avgOccupancy /= trainCount;
        // Over-crowded trains lower satisfaction; under-utilised is neutral
        const crowdPenalty = avgOccupancy > 0.85 ? (avgOccupancy - 0.85) * 40 : 0;
        const targetSat = Math.max(20, Math.min(100, onTimeRate * 95 - crowdPenalty + 5));
        // Smooth approach to target
        m.satisfaction = m.satisfaction * 0.95 + targetSat * 0.05;
      }
      m.lastMetricResetSec = this.state.simTimeSec;
    }

    this.onTick?.();
    this._schedule();
  }
}
