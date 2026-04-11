import type { Network } from './network';
import type { Coordinate } from './network-geometry';
import { coordinateKey, getLineAtomicSegments } from './network-geometry';

const RAIL_LINES_URL = '/data/rail_lines.geojson';
const MAX_ANCHOR_DISTANCE_METERS = 1600;
const GRID_CELL_DEGREES = 0.08;

interface GraphEdge {
  to: string;
  weight: number;
}

interface IndexedSegment {
  a: Coordinate;
  b: Coordinate;
  aId: string;
  bId: string;
}

interface GraphData {
  coords: Map<string, Coordinate>;
  edges: Map<string, GraphEdge[]>;
  segments: IndexedSegment[];
}

interface BaseGraph extends GraphData {
  segmentIndex: Map<string, number[]>;
}

interface ProjectionResult {
  point: Coordinate;
  distanceMeters: number;
}

interface AnchorResult {
  nodeId: string;
  coord: Coordinate;
  virtualEdges: Array<{ from: string; to: string; weight: number }>;
}

interface FeatureCollectionLike {
  features?: Array<{
    geometry?: {
      type?: string;
      coordinates?: unknown;
    };
  }>;
}

class MinHeap<T> {
  private readonly items: Array<{ priority: number; value: T }> = [];

  push(value: T, priority: number): void {
    this.items.push({ value, priority });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): { priority: number; value: T } | undefined {
    if (this.items.length === 0) return undefined;
    const first = this.items[0];
    const last = this.items.pop();
    if (!last) return first;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  get size(): number {
    return this.items.length;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.items[parentIndex]!.priority <= this.items[index]!.priority) break;
      [this.items[parentIndex], this.items[index]] = [this.items[index]!, this.items[parentIndex]!];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.items.length && this.items[left]!.priority < this.items[smallest]!.priority) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right]!.priority < this.items[smallest]!.priority) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [this.items[index]!, this.items[smallest]!];
      index = smallest;
    }
  }
}

function ensureNode(coords: Map<string, Coordinate>, coord: Coordinate): string {
  const id = coordinateKey(coord);
  if (!coords.has(id)) {
    coords.set(id, [coord[0], coord[1]]);
  }
  return id;
}

function appendEdge(edges: Map<string, GraphEdge[]>, from: string, to: string, weight: number): void {
  const list = edges.get(from);
  if (list) {
    list.push({ to, weight });
  } else {
    edges.set(from, [{ to, weight }]);
  }
}

function addUndirectedSegment(graph: GraphData, a: Coordinate, b: Coordinate): void {
  const weight = distanceMeters(a, b);
  if (weight <= 0) return;

  const aId = ensureNode(graph.coords, a);
  const bId = ensureNode(graph.coords, b);
  appendEdge(graph.edges, aId, bId, weight);
  appendEdge(graph.edges, bId, aId, weight);
  graph.segments.push({ a: [a[0], a[1]], b: [b[0], b[1]], aId, bId });
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function projectPointToSegment(point: Coordinate, a: Coordinate, b: Coordinate): ProjectionResult {
  const meanLat = ((a[1] + b[1] + point[1]) / 3) * Math.PI / 180;
  const cosLat = Math.max(0.2, Math.cos(meanLat));
  const ax = a[0] * cosLat;
  const bx = b[0] * cosLat;
  const px = point[0] * cosLat;
  const ay = a[1];
  const by = b[1];
  const py = point[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const projected: Coordinate = [
    (ax + dx * t) / cosLat,
    ay + dy * t,
  ];
  return {
    point: projected,
    distanceMeters: distanceMeters(point, projected),
  };
}

function buildCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function getCellRange(coord: Coordinate, radiusDegrees: number): Array<{ x: number; y: number }> {
  const minX = Math.floor((coord[0] - radiusDegrees) / GRID_CELL_DEGREES);
  const maxX = Math.floor((coord[0] + radiusDegrees) / GRID_CELL_DEGREES);
  const minY = Math.floor((coord[1] - radiusDegrees) / GRID_CELL_DEGREES);
  const maxY = Math.floor((coord[1] + radiusDegrees) / GRID_CELL_DEGREES);
  const cells: Array<{ x: number; y: number }> = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function reverseCoordinate(coord: Coordinate): Coordinate {
  return [coord[0], coord[1]];
}

function buildBaseSegmentIndex(segments: IndexedSegment[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  segments.forEach((segment, segmentIndex) => {
    const minLng = Math.min(segment.a[0], segment.b[0]);
    const maxLng = Math.max(segment.a[0], segment.b[0]);
    const minLat = Math.min(segment.a[1], segment.b[1]);
    const maxLat = Math.max(segment.a[1], segment.b[1]);
    const minX = Math.floor(minLng / GRID_CELL_DEGREES);
    const maxX = Math.floor(maxLng / GRID_CELL_DEGREES);
    const minY = Math.floor(minLat / GRID_CELL_DEGREES);
    const maxY = Math.floor(maxLat / GRID_CELL_DEGREES);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const cellKey = buildCellKey(x, y);
        const items = index.get(cellKey);
        if (items) items.push(segmentIndex);
        else index.set(cellKey, [segmentIndex]);
      }
    }
  });
  return index;
}

function isLineStringCoordinates(value: unknown): value is Coordinate[] {
  return Array.isArray(value)
    && value.every((coord) => Array.isArray(coord)
      && coord.length === 2
      && typeof coord[0] === 'number'
      && typeof coord[1] === 'number');
}

function buildGraphFromFeatureCollection(data: FeatureCollectionLike | null | undefined): BaseGraph {
  const graph: GraphData = {
    coords: new Map(),
    edges: new Map(),
    segments: [],
  };

  for (const feature of data?.features ?? []) {
    if (feature.geometry?.type !== 'LineString' || !isLineStringCoordinates(feature.geometry.coordinates)) continue;
    const coordinates = feature.geometry.coordinates;
    for (let index = 1; index < coordinates.length; index++) {
      const a = coordinates[index - 1];
      const b = coordinates[index];
      if (!a || !b) continue;
      addUndirectedSegment(graph, [a[0], a[1]], [b[0], b[1]]);
    }
  }

  return {
    ...graph,
    segmentIndex: buildBaseSegmentIndex(graph.segments),
  };
}

function buildUserGraph(network: Network): GraphData {
  const graph: GraphData = {
    coords: new Map(),
    edges: new Map(),
    segments: [],
  };

  for (const line of network.lines) {
    for (const segment of getLineAtomicSegments(line, network)) {
      addUndirectedSegment(graph, segment.coordinates[0], segment.coordinates[1]);
    }
  }

  return graph;
}

function collectCandidateSegments(point: Coordinate, baseGraph: BaseGraph, userGraph: GraphData): IndexedSegment[] {
  const radiusDegrees = MAX_ANCHOR_DISTANCE_METERS / 111320;
  const candidateIndexes = new Set<number>();
  for (const cell of getCellRange(point, radiusDegrees)) {
    for (const segmentIndex of baseGraph.segmentIndex.get(buildCellKey(cell.x, cell.y)) ?? []) {
      candidateIndexes.add(segmentIndex);
    }
  }

  const segments = [...candidateIndexes].map((segmentIndex) => baseGraph.segments[segmentIndex]!).filter(Boolean);
  return segments.concat(userGraph.segments);
}

function buildAnchor(point: Coordinate, baseGraph: BaseGraph, userGraph: GraphData): AnchorResult | null {
  const candidates = collectCandidateSegments(point, baseGraph, userGraph);
  let best: { segment: IndexedSegment; projection: ProjectionResult } | null = null;

  for (const segment of candidates) {
    const projection = projectPointToSegment(point, segment.a, segment.b);
    if (projection.distanceMeters > MAX_ANCHOR_DISTANCE_METERS) continue;
    if (!best || projection.distanceMeters < best.projection.distanceMeters) {
      best = { segment, projection };
    }
  }

  if (!best) return null;

  const pointId = coordinateKey(best.projection.point);
  if (pointId === best.segment.aId) {
    return { nodeId: best.segment.aId, coord: reverseCoordinate(best.segment.a), virtualEdges: [] };
  }
  if (pointId === best.segment.bId) {
    return { nodeId: best.segment.bId, coord: reverseCoordinate(best.segment.b), virtualEdges: [] };
  }

  return {
    nodeId: `anchor:${pointId}`,
    coord: reverseCoordinate(best.projection.point),
    virtualEdges: [
      { from: `anchor:${pointId}`, to: best.segment.aId, weight: distanceMeters(best.projection.point, best.segment.a) },
      { from: `anchor:${pointId}`, to: best.segment.bId, weight: distanceMeters(best.projection.point, best.segment.b) },
      { from: best.segment.aId, to: `anchor:${pointId}`, weight: distanceMeters(best.projection.point, best.segment.a) },
      { from: best.segment.bId, to: `anchor:${pointId}`, weight: distanceMeters(best.projection.point, best.segment.b) },
    ],
  };
}

function reconstructPath(cameFrom: Map<string, string>, current: string): string[] {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.push(current);
  }
  return path.reverse();
}

function getNeighbours(
  nodeId: string,
  baseGraph: BaseGraph,
  userGraph: GraphData,
  virtualEdges: Map<string, GraphEdge[]>,
): GraphEdge[] {
  return [
    ...(baseGraph.edges.get(nodeId) ?? []),
    ...(userGraph.edges.get(nodeId) ?? []),
    ...(virtualEdges.get(nodeId) ?? []),
  ];
}

function findPath(
  start: AnchorResult,
  end: AnchorResult,
  baseGraph: BaseGraph,
  userGraph: GraphData,
): Coordinate[] | null {
  const coords = new Map<string, Coordinate>([
    ...baseGraph.coords.entries(),
    ...userGraph.coords.entries(),
    [start.nodeId, start.coord],
    [end.nodeId, end.coord],
  ]);

  const virtualEdges = new Map<string, GraphEdge[]>();
  for (const edge of [...start.virtualEdges, ...end.virtualEdges]) {
    appendEdge(virtualEdges, edge.from, edge.to, edge.weight);
  }

  const openSet = new MinHeap<string>();
  const gScore = new Map<string, number>([[start.nodeId, 0]]);
  const fScore = new Map<string, number>([[start.nodeId, distanceMeters(start.coord, end.coord)]]);
  const cameFrom = new Map<string, string>();

  openSet.push(start.nodeId, fScore.get(start.nodeId) ?? 0);

  while (openSet.size > 0) {
    const next = openSet.pop();
    if (!next) break;
    const current = next.value;

    if (current === end.nodeId) {
      const nodeIds = reconstructPath(cameFrom, current);
      return nodeIds.map((nodeId) => {
        const coord = coords.get(nodeId);
        if (!coord) throw new Error(`Missing coordinate for node ${nodeId}`);
        return [coord[0], coord[1]] as Coordinate;
      });
    }

    const currentScore = gScore.get(current) ?? Number.POSITIVE_INFINITY;
    for (const edge of getNeighbours(current, baseGraph, userGraph, virtualEdges)) {
      const tentative = currentScore + edge.weight;
      if (tentative >= (gScore.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;

      cameFrom.set(edge.to, current);
      gScore.set(edge.to, tentative);
      const neighbourCoord = coords.get(edge.to);
      if (!neighbourCoord) continue;
      const priority = tentative + distanceMeters(neighbourCoord, end.coord);
      fScore.set(edge.to, priority);
      openSet.push(edge.to, priority);
    }
  }

  return null;
}

export class ExistingTrackRouter {
  private baseGraphPromise: Promise<BaseGraph> | null = null;

  async canSnapFrom(network: Network, point: Coordinate): Promise<boolean> {
    const baseGraph = await this.getBaseGraph();
    const userGraph = buildUserGraph(network);
    return buildAnchor(point, baseGraph, userGraph) !== null;
  }

  async findRoute(network: Network, start: Coordinate, end: Coordinate): Promise<Coordinate[] | null> {
    const baseGraph = await this.getBaseGraph();
    const userGraph = buildUserGraph(network);
    const startAnchor = buildAnchor(start, baseGraph, userGraph);
    const endAnchor = buildAnchor(end, baseGraph, userGraph);
    if (!startAnchor || !endAnchor) return null;

    const path = findPath(startAnchor, endAnchor, baseGraph, userGraph);
    if (!path || path.length === 0) return null;

    const result: Coordinate[] = [];
    result.push([start[0], start[1]]);
    for (const coord of path) {
      const last = result[result.length - 1];
      if (!last || coordinateKey(last) !== coordinateKey(coord)) {
        result.push([coord[0], coord[1]]);
      }
    }
    const tail = result[result.length - 1];
    if (!tail || coordinateKey(tail) !== coordinateKey(end)) {
      result.push([end[0], end[1]]);
    }

    return result.length >= 2 ? result : null;
  }

  private async getBaseGraph(): Promise<BaseGraph> {
    if (!this.baseGraphPromise) {
      this.baseGraphPromise = fetch(RAIL_LINES_URL)
        .then(async (response) => {
          if (!response.ok) return buildGraphFromFeatureCollection(null);
          const data = await response.json() as FeatureCollectionLike;
          return buildGraphFromFeatureCollection(data);
        })
        .catch(() => buildGraphFromFeatureCollection(null));
    }
    return this.baseGraphPromise;
  }
}