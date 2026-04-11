import type { Line, Station } from './network';

export type Coordinate = [number, number];

interface StationLookup {
  getStation(id: string): Station | undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function coordinatesMatch(a: Coordinate, b: Coordinate): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function squaredDistance(a: Coordinate, b: Coordinate): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function cloneCoordinate([lng, lat]: Coordinate): Coordinate {
  return [lng, lat];
}

function dedupeSequentialCoordinates(coords: Coordinate[]): Coordinate[] {
  const deduped: Coordinate[] = [];
  for (const coord of coords) {
    if (deduped.length === 0 || !coordinatesMatch(deduped[deduped.length - 1], coord)) {
      deduped.push(cloneCoordinate(coord));
    }
  }
  return deduped;
}

export function coordinateKey([lng, lat]: Coordinate): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

export function normalizeAtomicSegmentKey(a: Coordinate, b: Coordinate): string {
  const forward = `${coordinateKey(a)}|${coordinateKey(b)}`;
  const reverse = `${coordinateKey(b)}|${coordinateKey(a)}`;
  return forward <= reverse ? forward : reverse;
}

export function buildDirectPath(start: Station, end: Station): Coordinate[] {
  return [
    [start.lng, start.lat],
    [end.lng, end.lat],
  ];
}

export function sanitizePathCoordinates(path: unknown): Coordinate[] | null {
  if (!Array.isArray(path)) return null;

  const coords: Coordinate[] = [];
  for (const point of path) {
    if (!Array.isArray(point) || point.length !== 2) return null;
    const [lng, lat] = point;
    if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
    coords.push([lng, lat]);
  }

  const deduped = dedupeSequentialCoordinates(coords);
  return deduped.length >= 2 ? deduped : null;
}

export function orientPath(path: Coordinate[], start: Coordinate, end: Coordinate): Coordinate[] {
  const first = path[0];
  const last = path[path.length - 1];
  const forwardCost = squaredDistance(first, start) + squaredDistance(last, end);
  const reverseCost = squaredDistance(first, end) + squaredDistance(last, start);
  if (reverseCost + 1e-12 < forwardCost) {
    return [...path].reverse().map(cloneCoordinate);
  }
  return path.map(cloneCoordinate);
}

export function getLineLogicalSegments(
  line: Line,
  stations: StationLookup,
): Array<{ fromStationId: string; toStationId: string; coordinates: Coordinate[] }> {
  const segments: Array<{ fromStationId: string; toStationId: string; coordinates: Coordinate[] }> = [];

  for (let index = 0; index < line.stationIds.length - 1; index++) {
    const fromStationId = line.stationIds[index];
    const toStationId = line.stationIds[index + 1];
    if (!fromStationId || !toStationId) continue;

    const fromStation = stations.getStation(fromStationId);
    const toStation = stations.getStation(toStationId);
    if (!fromStation || !toStation) continue;

    const storedPath = sanitizePathCoordinates(line.segmentPaths?.[index] ?? null);
    const defaultPath = buildDirectPath(fromStation, toStation);
    const coordinates = storedPath
      ? orientPath(storedPath, defaultPath[0], defaultPath[defaultPath.length - 1])
      : defaultPath;

    segments.push({ fromStationId, toStationId, coordinates });
  }

  return segments;
}

export function getLinePolylineCoordinates(line: Line, stations: StationLookup): Coordinate[] {
  const polyline: Coordinate[] = [];

  for (const segment of getLineLogicalSegments(line, stations)) {
    for (let index = 0; index < segment.coordinates.length; index++) {
      const coord = segment.coordinates[index];
      if (!coord) continue;
      if (polyline.length > 0 && index === 0 && coordinatesMatch(polyline[polyline.length - 1], coord)) {
        continue;
      }
      polyline.push(cloneCoordinate(coord));
    }
  }

  return dedupeSequentialCoordinates(polyline);
}

export function getLineAtomicSegments(
  line: Line,
  stations: StationLookup,
): Array<{ lineId: string; lineName: string; color: string; coordinates: [Coordinate, Coordinate] }> {
  const polyline = getLinePolylineCoordinates(line, stations);
  const segments: Array<{ lineId: string; lineName: string; color: string; coordinates: [Coordinate, Coordinate] }> = [];

  for (let index = 1; index < polyline.length; index++) {
    const start = polyline[index - 1];
    const end = polyline[index];
    if (!start || !end || coordinatesMatch(start, end)) continue;
    segments.push({
      lineId: line.id,
      lineName: line.name,
      color: line.color,
      coordinates: [cloneCoordinate(start), cloneCoordinate(end)],
    });
  }

  return segments;
}