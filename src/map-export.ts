// ── Map Export ────────────────────────────────────────────────────────────────
// Builds a standalone export page that renders a schematic transit diagram in
// either a New York subway-inspired style, a London Underground-inspired
// style, or a Paris Metro-inspired style. The layout work happens here in
// TypeScript so the exported page only
// needs to paint precomputed geometry.

import type { Network, Station } from './network';

export type ExportStyle = 'mta' | 'lu' | 'paris';

export interface ExportOptions {
  style: ExportStyle;
  lineIds: string[];
  showLegend: boolean;
}

type ExportHeader = 'route-bullets' | 'roundel' | 'metro-placard';

type TextAlign = 'left' | 'right' | 'center';
type StationSymbol = 'dot' | 'tick' | 'interchange' | 'terminal';

const EXPORT_CANVAS_WIDTH = 1400;
const EXPORT_CANVAS_HEIGHT = 900;

const LU_FONT_STACK = '"TfL Johnston", "New Johnston", "Johnston100", "Johnston ITC", "Gill Sans", "Segoe UI", sans-serif';
const MTA_FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const PARIS_FONT_STACK = '"Trebuchet MS", Arial, sans-serif';

interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  width: number;
  height: number;
}

interface ExportLine {
  id: string;
  name: string;
  color: string;
  routeBullet: string;
  bulletTextColor: string;
  stations: Station[];
}

interface StationRecord extends Station {
  lineIds: string[];
  colors: string[];
  degree: number;
  indexByLine: Record<string, number>;
}

interface LayoutLine {
  id: string;
  name: string;
  color: string;
  routeBullet: string;
  bulletTextColor: string;
  points: Point[];
}

interface LayoutStation extends Point {
  id: string;
  name: string;
  lineIds: string[];
  colors: string[];
  angle: number;
  symbol: StationSymbol;
}

interface LayoutLabel {
  stationId: string;
  text: string;
  x: number;
  y: number;
  align: TextAlign;
  width: number;
  height: number;
}

interface ExportTheme {
  pageBackground: string;
  panelBackground: string;
  panelBorder: string;
  toolbarAccent: string;
  toolbarAccentText: string;
  toolbarGhostBackground: string;
  toolbarGhostText: string;
  canvasBackground: string;
  titleColor: string;
  subtitleColor: string;
  labelText: string;
  labelBackground: string;
  stationOutline: string;
  stationFill: string;
  legendBackground: string;
  legendBorder: string;
  legendTitle: string;
  legendText: string;
  water: string;
  waterAccent: string;
  park: string;
  roundelBlue?: string;
  roundelRed?: string;
  uiFontFamily: string;
  titleFont: string;
  subtitleFont: string;
  labelFont: string;
  legendFont: string;
  routeWidth: number;
  routeCasingWidth: number;
  routeCornerRadius: number;
}

interface LayoutTuning {
  grid: number;
  iterations: number;
  neighborWeight: number;
  snapWeight: number;
  inset: number;
  minStationDistance: number;
  diagonalTolerance: number;
  segmentFlatMin: number;
  routeAvoidance: number;
  labelBaseOffset: number;
  labelInterchangeOffset: number;
  labelDenseBoost: number;
}

interface SegmentDebug {
  lineId: string;
  angles: number[];
  allOctilinear: boolean;
}

interface ParallelSharedSegmentDebug {
  key: string;
  lineIds: string[];
  laneOffsets: Array<{ lineId: string; offset: number }>;
}

interface SharedTrackGroup {
  key: string;
  startId: string;
  endId: string;
  lineIds: string[];
  laneOffsets: Map<string, number>;
}

interface ExportDebug {
  style: ExportStyle;
  header: ExportHeader;
  decorationKinds: string[];
  brandingText: string;
  fontStack: string;
  routeBullets: Array<{ lineId: string; bullet: string }>;
  stationSymbols: Array<{
    id: string;
    symbol: StationSymbol;
    x: number;
    y: number;
    lineCount: number;
  }>;
  segmentAngles: SegmentDebug[];
  allOctilinear: boolean;
  labelCollisions: boolean;
  parallelSharedSegments: ParallelSharedSegmentDebug[];
}

interface ExportDocument {
  style: ExportStyle;
  width: number;
  height: number;
  title: string;
  subtitle: string;
  brandingText: string;
  showLegend: boolean;
  contentRect: Rect;
  lines: LayoutLine[];
  stations: LayoutStation[];
  labels: LayoutLabel[];
  theme: ExportTheme;
  debug: ExportDebug;
}

interface BuildHtmlOptions {
  preview?: boolean;
}

function gatherExportData(network: Network, lineIds: string[]): ExportLine[] {
  const result: ExportLine[] = [];

  for (const id of lineIds) {
    const line = network.getLine(id);
    if (!line) continue;

    const stations = line.stationIds
      .map((stationId) => network.getStation(stationId))
      .filter((station): station is Station => !!station);

    result.push({
      id: line.id,
      name: line.name,
      color: line.color,
      routeBullet: buildRouteBullet(line.name),
      bulletTextColor: getContrastingTextColor(line.color),
      stations,
    });
  }

  return result;
}

function buildRouteBullet(name: string): string {
  const trimmed = name.trim().toUpperCase();
  const cleaned = trimmed
    .replace(/\b(LINE|BRANCH|SERVICE|RAILWAY|UNDERGROUND|SUBWAY|EXPRESS)\b/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim();

  const firstToken = (cleaned.split(/\s+/).find(Boolean) ?? trimmed).replace(/[^A-Z0-9]/g, '');
  if (!firstToken) return '•';
  if (/^\d+$/.test(firstToken)) return firstToken.slice(0, 2);
  return firstToken[0];
}

function getContrastingTextColor(color: string): string {
  const rgb = parseHexColor(color);
  if (!rgb) return '#FFFFFF';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.67 ? '#111111' : '#FFFFFF';
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    };
  }
  if (hex.length !== 6) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function openExportPage(network: Network, options: ExportOptions): void {
  const doc = buildExportDocumentForNetwork(network, options, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);
  if (!doc) return;

  const html = buildExportHTML(doc);

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');

  setTimeout(() => URL.revokeObjectURL(url), 5000);

  if (!tab) {
    alert('Pop-up blocked. Please allow pop-ups for this site.');
  }
}

export function buildExportPreviewHTML(network: Network, options: ExportOptions): string {
  const doc = buildExportDocumentForNetwork(network, options, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);
  if (!doc) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  html, body {
    margin: 0;
    height: 100%;
    font-family: system-ui, "Segoe UI", sans-serif;
    background: linear-gradient(180deg, #f6f7fb 0%, #eef1f7 100%);
    color: #455065;
  }
  body {
    display: grid;
    place-items: center;
  }
  .empty {
    max-width: 320px;
    text-align: center;
    font-size: 13px;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="empty">Select at least one line to preview the export.</div>
</body>
</html>`;
  }

  return buildExportHTML(doc, { preview: true });
}

function buildExportDocumentForNetwork(
  network: Network,
  options: ExportOptions,
  width: number,
  height: number,
): ExportDocument | null {
  const lines = gatherExportData(network, options.lineIds);
  if (lines.length === 0) return null;
  return buildExportDocument(lines, options, width, height);
}

function buildExportDocument(
  lines: ExportLine[],
  options: ExportOptions,
  width: number,
  height: number,
): ExportDocument {
  const tuning = getLayoutTuning(options.style, lines);
  const theme = buildTheme(options.style, lines.length);
  const contentRect = getContentRect(width, height, options.showLegend, options.style);
  const { stations, neighbors } = buildStationRegistry(lines);
  const projected = projectStations(stations, contentRect);
  const positioned = relaxStationPositions(stations, neighbors, projected, contentRect, tuning);
  const sharedTracks = buildSharedTrackRegistry(lines, theme, options.style);
  const layoutLines = lines.map((line) => buildLayoutLine(line, positioned, tuning, sharedTracks));
  const lineLookup = new Map(lines.map((line) => [line.id, line]));
  const layoutStations = stations.map((station) =>
    buildLayoutStation(station, lineLookup, positioned, options.style),
  );
  const labels = placeLabels(layoutStations, layoutLines, contentRect, options.style, tuning);

  const { title, subtitle } = getStyleTitles(options.style);
  const brandingText = getBrandingText(options.style);

  return {
    style: options.style,
    width,
    height,
    title,
    subtitle,
    brandingText,
    showLegend: options.showLegend,
    contentRect,
    lines: layoutLines,
    stations: layoutStations,
    labels,
    theme,
    debug: buildDebug(options.style, layoutLines, layoutStations, labels, theme, brandingText, sharedTracks),
  };
}

function getStyleTitles(style: ExportStyle): { title: string; subtitle: string } {
  if (style === 'lu') {
    return {
      title: 'Tube map',
      subtitle: 'High Speed Too network',
    };
  }

  if (style === 'paris') {
    return {
      title: 'Metropolitain Diagram',
      subtitle: 'Paris-inspired dense city export',
    };
  }

  return {
    title: 'Subway Diagram',
    subtitle: 'New York-inspired schematic export',
  };
}

function getBrandingText(style: ExportStyle): string {
  return style === 'lu' ? 'HIGH SPEED TOO' : '';
}

function buildTheme(style: ExportStyle, lineCount: number): ExportTheme {
  if (style === 'lu') {
    return {
      pageBackground: '#0E172C',
      panelBackground: 'rgba(8, 14, 28, 0.72)',
      panelBorder: 'rgba(153, 173, 207, 0.22)',
      toolbarAccent: '#0019A8',
      toolbarAccentText: '#FFFFFF',
      toolbarGhostBackground: 'rgba(255, 255, 255, 0.08)',
      toolbarGhostText: '#D9E2FF',
      canvasBackground: '#FFFFFF',
      titleColor: '#0A2C84',
      subtitleColor: '#4D5B78',
      labelText: '#102A72',
      labelBackground: 'rgba(255, 255, 255, 0.94)',
      stationOutline: '#0B1F66',
      stationFill: '#FFFFFF',
      legendBackground: 'rgba(255, 255, 255, 0.96)',
      legendBorder: '#0019A8',
      legendTitle: '#0019A8',
      legendText: '#102A72',
      water: '#A8D8FF',
      waterAccent: '#D9F0FF',
      park: '#E8F4E2',
      roundelBlue: '#0019A8',
      roundelRed: '#DC241F',
      uiFontFamily: LU_FONT_STACK,
      titleFont: `700 31px ${LU_FONT_STACK}`,
      subtitleFont: `500 14px ${LU_FONT_STACK}`,
      labelFont: `14px ${LU_FONT_STACK}`,
      legendFont: `13px ${LU_FONT_STACK}`,
      routeWidth: Math.max(7.5, 10.5 - Math.max(0, lineCount - 4) * 0.55),
      routeCasingWidth: Math.max(3.5, 4.8 - Math.max(0, lineCount - 4) * 0.2),
      routeCornerRadius: 16,
    };
  }

  if (style === 'paris') {
    return {
      pageBackground: '#162126',
      panelBackground: 'rgba(17, 28, 34, 0.76)',
      panelBorder: 'rgba(177, 214, 201, 0.2)',
      toolbarAccent: '#0E6B5B',
      toolbarAccentText: '#F7F6F1',
      toolbarGhostBackground: 'rgba(255, 255, 255, 0.08)',
      toolbarGhostText: '#D7E9E2',
      canvasBackground: '#F5F7F4',
      titleColor: '#0F5C61',
      subtitleColor: '#587179',
      labelText: '#123D59',
      labelBackground: 'rgba(255, 255, 255, 0.95)',
      stationOutline: '#123D59',
      stationFill: '#FFFFFF',
      legendBackground: 'rgba(252, 252, 249, 0.97)',
      legendBorder: '#0E6B5B',
      legendTitle: '#0E6B5B',
      legendText: '#294955',
      water: '#BFDCEA',
      waterAccent: '#DDEEF5',
      park: '#E4E7D8',
      uiFontFamily: PARIS_FONT_STACK,
      titleFont: `700 29px ${PARIS_FONT_STACK}`,
      subtitleFont: `500 14px ${PARIS_FONT_STACK}`,
      labelFont: `14px ${PARIS_FONT_STACK}`,
      legendFont: `13px ${PARIS_FONT_STACK}`,
      routeWidth: Math.max(7.5, 10.8 - Math.max(0, lineCount - 4) * 0.48),
      routeCasingWidth: Math.max(3.2, 4.4 - Math.max(0, lineCount - 4) * 0.16),
      routeCornerRadius: 14,
    };
  }

  return {
    pageBackground: '#18212E',
    panelBackground: 'rgba(13, 21, 31, 0.72)',
    panelBorder: 'rgba(192, 201, 214, 0.18)',
    toolbarAccent: '#0E4D92',
    toolbarAccentText: '#FFFFFF',
    toolbarGhostBackground: 'rgba(255, 255, 255, 0.08)',
    toolbarGhostText: '#E6EEF8',
    canvasBackground: '#F2ECDD',
    titleColor: '#1A1A1A',
    subtitleColor: '#5F6368',
    labelText: '#1A1A1A',
    labelBackground: 'rgba(247, 243, 233, 0.96)',
    stationOutline: '#18181B',
    stationFill: '#F9F7F2',
    legendBackground: 'rgba(249, 245, 236, 0.97)',
    legendBorder: '#1C1C1C',
    legendTitle: '#1C1C1C',
    legendText: '#30343A',
    water: '#BFD0E1',
    waterAccent: '#DCE7F1',
    park: '#D8DFC5',
    uiFontFamily: MTA_FONT_STACK,
    titleFont: `700 30px ${MTA_FONT_STACK}`,
    subtitleFont: `500 14px ${MTA_FONT_STACK}`,
    labelFont: `14px ${MTA_FONT_STACK}`,
    legendFont: `13px ${MTA_FONT_STACK}`,
    routeWidth: Math.max(8.5, 12 - Math.max(0, lineCount - 4) * 0.65),
    routeCasingWidth: Math.max(4, 5.5 - Math.max(0, lineCount - 4) * 0.25),
    routeCornerRadius: 18,
  };
}

function getLayoutTuning(style: ExportStyle, lines: ExportLine[]): LayoutTuning {
  const stationCount = new Set(lines.flatMap((line) => line.stations.map((station) => station.id))).size;
  const lineCount = lines.length;
  const denseFactor = clamp((stationCount - 10) / 22, 0, 1);
  const branchFactor = clamp((lineCount - 3) / 8, 0, 1);

  if (style === 'lu') {
    return {
      grid: 28 - denseFactor * 3,
      iterations: 9 + Math.round(branchFactor * 2),
      neighborWeight: 0.58,
      snapWeight: 0.84,
      inset: 16,
      minStationDistance: 26 - denseFactor * 2,
      diagonalTolerance: 0.18,
      segmentFlatMin: 8,
      routeAvoidance: 15,
      labelBaseOffset: 18,
      labelInterchangeOffset: 23,
      labelDenseBoost: 6,
    };
  }

  if (style === 'paris') {
    return {
      grid: 22 - denseFactor * 2,
      iterations: 9 + Math.round(branchFactor * 3),
      neighborWeight: 0.52,
      snapWeight: 0.66,
      inset: 16,
      minStationDistance: 21 - denseFactor * 1.5,
      diagonalTolerance: 0.34,
      segmentFlatMin: 6,
      routeAvoidance: 12,
      labelBaseOffset: 17,
      labelInterchangeOffset: 22,
      labelDenseBoost: 7,
    };
  }

  return {
    grid: 24 - denseFactor * 2,
    iterations: 7 + Math.round(branchFactor * 2),
    neighborWeight: 0.46,
    snapWeight: 0.58,
    inset: 18,
    minStationDistance: 22 - denseFactor * 1.5,
    diagonalTolerance: 0.26,
    segmentFlatMin: 7,
    routeAvoidance: 13,
    labelBaseOffset: 20,
    labelInterchangeOffset: 24,
    labelDenseBoost: 5,
  };
}

function getContentRect(width: number, height: number, showLegend: boolean, style: ExportStyle): Rect {
  const legendWidth = showLegend ? (style === 'paris' ? 300 : 280) : 0;
  return {
    x: 88,
    y: 152,
    width: width - 176 - legendWidth,
    height: height - 244,
  };
}

function buildStationRegistry(lines: ExportLine[]): {
  stations: StationRecord[];
  neighbors: Map<string, Set<string>>;
} {
  const stationMap = new Map<string, StationRecord>();
  const neighbors = new Map<string, Set<string>>();

  const ensureNeighborSet = (stationId: string): Set<string> => {
    const existing = neighbors.get(stationId);
    if (existing) return existing;
    const created = new Set<string>();
    neighbors.set(stationId, created);
    return created;
  };

  for (const line of lines) {
    for (let index = 0; index < line.stations.length; index++) {
      const station = line.stations[index];
      const existing = stationMap.get(station.id);

      if (existing) {
        if (!existing.lineIds.includes(line.id)) existing.lineIds.push(line.id);
        if (!existing.colors.includes(line.color)) existing.colors.push(line.color);
        existing.indexByLine[line.id] = index;
      } else {
        stationMap.set(station.id, {
          ...station,
          lineIds: [line.id],
          colors: [line.color],
          degree: 0,
          indexByLine: { [line.id]: index },
        });
      }

      const currentNeighbors = ensureNeighborSet(station.id);
      if (index > 0) {
        const prev = line.stations[index - 1];
        currentNeighbors.add(prev.id);
        ensureNeighborSet(prev.id).add(station.id);
      }
    }
  }

  const stations = Array.from(stationMap.values()).map((station) => ({
    ...station,
    degree: neighbors.get(station.id)?.size ?? 0,
  }));

  return { stations, neighbors };
}

function projectStations(stations: StationRecord[], rect: Rect): Map<string, Point> {
  const projected = new Map<string, Point>();
  if (stations.length === 0) return projected;

  if (stations.length === 1) {
    const only = stations[0];
    projected.set(only.id, {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    });
    return projected;
  }

  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const station of stations) {
    minLng = Math.min(minLng, station.lng);
    maxLng = Math.max(maxLng, station.lng);
    minLat = Math.min(minLat, station.lat);
    maxLat = Math.max(maxLat, station.lat);
  }

  const spanLng = Math.max(0.001, maxLng - minLng);
  const spanLat = Math.max(0.001, maxLat - minLat);
  const padLng = spanLng * 0.08;
  const padLat = spanLat * 0.08;
  const paddedMinLng = minLng - padLng;
  const paddedMaxLng = maxLng + padLng;
  const paddedMinLat = minLat - padLat;
  const paddedMaxLat = maxLat + padLat;
  const paddedSpanLng = paddedMaxLng - paddedMinLng;
  const paddedSpanLat = paddedMaxLat - paddedMinLat;

  const scale = Math.min(rect.width / paddedSpanLng, rect.height / paddedSpanLat);
  const offsetX = rect.x + (rect.width - paddedSpanLng * scale) / 2;
  const offsetY = rect.y + (rect.height - paddedSpanLat * scale) / 2;

  for (const station of stations) {
    projected.set(station.id, {
      x: offsetX + (station.lng - paddedMinLng) * scale,
      y: offsetY + (paddedMaxLat - station.lat) * scale,
    });
  }

  return projected;
}

function relaxStationPositions(
  stations: StationRecord[],
  neighbors: Map<string, Set<string>>,
  initial: Map<string, Point>,
  rect: Rect,
  tuning: LayoutTuning,
): Map<string, Point> {
  const positions = clonePointMap(initial);

  for (let iteration = 0; iteration < tuning.iterations; iteration++) {
    const next = new Map<string, Point>();

    for (const station of stations) {
      const base = initial.get(station.id)!;
      const current = positions.get(station.id)!;
      const adjacent = Array.from(neighbors.get(station.id) ?? []);

      if (adjacent.length === 0) {
        next.set(station.id, { ...current });
        continue;
      }

      let avgX = 0;
      let avgY = 0;
      let count = 0;

      for (const neighborId of adjacent) {
        const point = positions.get(neighborId);
        if (!point) continue;
        avgX += point.x;
        avgY += point.y;
        count++;
      }

      if (count === 0) {
        next.set(station.id, { ...current });
        continue;
      }

      avgX /= count;
      avgY /= count;

      const anchorWeight = station.degree >= 3 ? 0.34 : station.degree === 2 ? 0.49 : 0.58;
      let x = mix(base.x, avgX, tuning.neighborWeight);
      let y = mix(base.y, avgY, tuning.neighborWeight);

      x = mix(x, snapToGrid(x, rect.x, tuning.grid), tuning.snapWeight);
      y = mix(y, snapToGrid(y, rect.y, tuning.grid), tuning.snapWeight);

      next.set(station.id, {
        x: mix(x, base.x, anchorWeight),
        y: mix(y, base.y, anchorWeight),
      });
    }

    fitPointsToRect(next, rect, tuning.inset);
    resolveCollisions(stations, next, rect, tuning.minStationDistance);
    fitPointsToRect(next, rect, tuning.inset);

    positions.clear();
    for (const [stationId, point] of next) positions.set(stationId, point);
  }

  return positions;
}

function clonePointMap(source: Map<string, Point>): Map<string, Point> {
  return new Map(Array.from(source.entries(), ([id, point]) => [id, { ...point }]));
}

function fitPointsToRect(points: Map<string, Point>, rect: Rect, inset: number): void {
  if (points.size === 0) return;

  const target: Rect = {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(1, rect.width - inset * 2),
    height: Math.max(1, rect.height - inset * 2),
  };

  const bounds = getPointBounds(points);
  if (!bounds) return;

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;

  if (spanX < 0.001 && spanY < 0.001) {
    for (const point of points.values()) {
      point.x = target.x + target.width / 2;
      point.y = target.y + target.height / 2;
    }
    return;
  }

  const scale = Math.min(
    target.width / Math.max(spanX, 1),
    target.height / Math.max(spanY, 1),
  );

  for (const point of points.values()) {
    point.x = target.x + (point.x - bounds.minX) * scale + (target.width - spanX * scale) / 2;
    point.y = target.y + (point.y - bounds.minY) * scale + (target.height - spanY * scale) / 2;
  }
}

function getPointBounds(points: Map<string, Point>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  if (points.size === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points.values()) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
}

function resolveCollisions(
  stations: StationRecord[],
  points: Map<string, Point>,
  rect: Rect,
  minDistance: number,
): void {
  const iterations = 10;

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        const a = points.get(stations[i].id);
        const b = points.get(stations[j].id);
        if (!a || !b) continue;

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);

        if (distance >= minDistance) continue;

        if (distance < 0.001) {
          const angle = ((i + 1) * 37 + (j + 1) * 17) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const push = (minDistance - distance) / 2;
        const ux = dx / distance;
        const uy = dy / distance;

        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;

        clampPointToRect(a, rect, 14);
        clampPointToRect(b, rect, 14);
      }
    }
  }
}

function clampPointToRect(point: Point, rect: Rect, inset: number): void {
  point.x = clamp(point.x, rect.x + inset, rect.x + rect.width - inset);
  point.y = clamp(point.y, rect.y + inset, rect.y + rect.height - inset);
}

function buildSharedTrackRegistry(
  lines: ExportLine[],
  theme: ExportTheme,
  style: ExportStyle,
): Map<string, SharedTrackGroup> {
  const lineOrder = new Map(lines.map((line, index) => [line.id, index]));
  const groups = new Map<string, { startId: string; endId: string; lineIds: Set<string> }>();
  const laneGap =
    style === 'lu'
      ? Math.max(8, theme.routeWidth * 0.95)
      : style === 'paris'
        ? Math.max(6, theme.routeWidth * 0.8)
        : Math.max(6.5, theme.routeWidth * 0.78);

  for (const line of lines) {
    for (let index = 0; index < line.stations.length - 1; index++) {
      const start = line.stations[index];
      const end = line.stations[index + 1];
      const key = canonicalSegmentKey(start.id, end.id);
      const group = groups.get(key);

      if (group) {
        group.lineIds.add(line.id);
      } else {
        groups.set(key, {
          startId: start.id,
          endId: end.id,
          lineIds: new Set([line.id]),
        });
      }
    }
  }

  const registry = new Map<string, SharedTrackGroup>();

  for (const [key, group] of groups) {
    if (group.lineIds.size < 2) continue;

    const orderedLineIds = Array.from(group.lineIds).sort(
      (a, b) => (lineOrder.get(a) ?? 0) - (lineOrder.get(b) ?? 0),
    );
    const midpoint = (orderedLineIds.length - 1) / 2;
    const laneOffsets = new Map<string, number>();

    orderedLineIds.forEach((lineId, index) => {
      laneOffsets.set(lineId, (index - midpoint) * laneGap);
    });

    registry.set(key, {
      key,
      startId: group.startId,
      endId: group.endId,
      lineIds: orderedLineIds,
      laneOffsets,
    });
  }

  return registry;
}

function canonicalSegmentKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function getSharedTrackOffset(
  sharedTracks: Map<string, SharedTrackGroup>,
  lineId: string,
  startId: string,
  endId: string,
): number {
  const group = sharedTracks.get(canonicalSegmentKey(startId, endId));
  if (!group) return 0;

  const laneOffset = group.laneOffsets.get(lineId) ?? 0;
  if (Math.abs(laneOffset) < 0.01) return 0;

  return group.startId === startId && group.endId === endId ? laneOffset : -laneOffset;
}

function offsetPolyline(points: Point[], offset: number): Point[] {
  if (Math.abs(offset) < 0.01 || points.length < 2) {
    return points.map((point) => ({ ...point }));
  }

  const segments = points.slice(1).map((point, index) => {
    const start = points[index];
    const normal = computeUnitNormal(start, point);

    return {
      a: { x: start.x + normal.x * offset, y: start.y + normal.y * offset },
      b: { x: point.x + normal.x * offset, y: point.y + normal.y * offset },
    };
  });

  if (segments.length === 1) {
    return [segments[0].a, segments[0].b];
  }

  const result: Point[] = [{ ...segments[0].a }];

  for (let index = 1; index < segments.length; index++) {
    const prev = segments[index - 1];
    const next = segments[index];
    const intersection = intersectInfiniteLines(prev.a, prev.b, next.a, next.b);
    result.push(intersection ?? { ...next.a });
  }

  result.push({ ...segments[segments.length - 1].b });
  return dedupeSegmentPoints(result);
}

function computeUnitNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);

  if (length < 0.001) return { x: 0, y: 0 };
  return { x: -dy / length, y: dx / length };
}

function intersectInfiniteLines(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const denominator = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(denominator) < 0.0001) return null;

  const detA = a1.x * a2.y - a1.y * a2.x;
  const detB = b1.x * b2.y - b1.y * b2.x;

  return {
    x: (detA * (b1.x - b2.x) - (a1.x - a2.x) * detB) / denominator,
    y: (detA * (b1.y - b2.y) - (a1.y - a2.y) * detB) / denominator,
  };
}

function buildLayoutLine(
  line: ExportLine,
  positioned: Map<string, Point>,
  tuning: LayoutTuning,
  sharedTracks: Map<string, SharedTrackGroup>,
): LayoutLine {
  const points: Point[] = [];

  if (line.stations.length === 1) {
    const point = positioned.get(line.stations[0].id);
    if (point) points.push({ ...point });
  }

  for (let index = 0; index < line.stations.length - 1; index++) {
    const start = positioned.get(line.stations[index].id);
    const end = positioned.get(line.stations[index + 1].id);
    if (!start || !end) continue;

    const offset = getSharedTrackOffset(
      sharedTracks,
      line.id,
      line.stations[index].id,
      line.stations[index + 1].id,
    );
    const segment = offsetPolyline(buildOctilinearSegment(start, end, tuning), offset);
    for (let segmentIndex = 0; segmentIndex < segment.length; segmentIndex++) {
      const point = segment[segmentIndex];
      const isDuplicate = points.length > 0 && pointsAlmostEqual(points[points.length - 1], point);
      if (!isDuplicate) points.push(point);
    }
  }

  return {
    id: line.id,
    name: line.name,
    color: line.color,
    routeBullet: line.routeBullet,
    bulletTextColor: line.bulletTextColor,
    points,
  };
}

function buildOctilinearSegment(start: Point, end: Point, tuning: LayoutTuning): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < 0.75 || absDy < 0.75) return [{ ...start }, { ...end }];

  if (Math.abs(absDx - absDy) / Math.max(absDx, absDy) <= tuning.diagonalTolerance) {
    return [{ ...start }, { ...end }];
  }

  if (absDx > absDy) {
    const flat = (absDx - absDy) / 2;
    if (flat < tuning.segmentFlatMin) return [{ ...start }, { ...end }];
    const signX = Math.sign(dx) || 1;
    const first: Point = { x: start.x + signX * flat, y: start.y };
    const second: Point = { x: end.x - signX * flat, y: end.y };
    return dedupeSegmentPoints([start, first, second, end]);
  }

  const flat = (absDy - absDx) / 2;
  if (flat < tuning.segmentFlatMin) return [{ ...start }, { ...end }];

  const signY = Math.sign(dy) || 1;
  const first: Point = { x: start.x, y: start.y + signY * flat };
  const second: Point = { x: end.x, y: end.y - signY * flat };
  return dedupeSegmentPoints([start, first, second, end]);
}

function dedupeSegmentPoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length > 0 && pointsAlmostEqual(result[result.length - 1], point)) continue;
    result.push({ ...point });
  }
  return result;
}

function pointsAlmostEqual(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function buildLayoutStation(
  station: StationRecord,
  lineLookup: Map<string, ExportLine>,
  positioned: Map<string, Point>,
  style: ExportStyle,
): LayoutStation {
  const point = positioned.get(station.id)!;
  const angle = computeStationAngle(station, lineLookup, positioned);

  return {
    id: station.id,
    name: station.name,
    x: point.x,
    y: point.y,
    lineIds: station.lineIds,
    colors: station.colors,
    angle,
    symbol:
      station.lineIds.length > 1
        ? 'interchange'
        : station.degree <= 1
          ? 'terminal'
          : style === 'lu'
            ? 'tick'
            : 'dot',
  };
}

function computeStationAngle(
  station: StationRecord,
  lineLookup: Map<string, ExportLine>,
  positioned: Map<string, Point>,
): number {
  let bestAngle = 0;
  let bestLength = -1;

  for (const lineId of station.lineIds) {
    const line = lineLookup.get(lineId);
    const index = station.indexByLine[lineId];
    if (!line || typeof index !== 'number') continue;

    const current = positioned.get(station.id);
    if (!current) continue;

    const candidates: Array<{ angle: number; length: number }> = [];

    if (index > 0) {
      const prev = positioned.get(line.stations[index - 1].id);
      if (prev) {
        candidates.push({
          angle: Math.atan2(current.y - prev.y, current.x - prev.x),
          length: Math.hypot(current.x - prev.x, current.y - prev.y),
        });
      }
    }

    if (index < line.stations.length - 1) {
      const next = positioned.get(line.stations[index + 1].id);
      if (next) {
        candidates.push({
          angle: Math.atan2(next.y - current.y, next.x - current.x),
          length: Math.hypot(next.x - current.x, next.y - current.y),
        });
      }
    }

    for (const candidate of candidates) {
      if (candidate.length > bestLength) {
        bestLength = candidate.length;
        bestAngle = candidate.angle;
      }
    }
  }

  return bestAngle;
}

function placeLabels(
  stations: LayoutStation[],
  lines: LayoutLine[],
  rect: Rect,
  style: ExportStyle,
  tuning: LayoutTuning,
): LayoutLabel[] {
  const labels: LayoutLabel[] = [];
  const placedRects: Array<Rect & { stationId: string }> = [];
  const routeSegments = collectRouteSegments(lines);
  const stationObstacles = stations.map((station) => ({
    stationId: station.id,
    x: station.x - 10,
    y: station.y - 10,
    width: 20,
    height: 20,
  }));

  const orderedStations = [...stations].sort((a, b) => {
    const lineDiff = b.lineIds.length - a.lineIds.length;
    if (lineDiff !== 0) return lineDiff;
    return b.name.length - a.name.length;
  });

  for (const station of orderedStations) {
    const width = estimateLabelWidth(station.name, style);
    const height = style === 'lu' ? 24 : 26;
    const offset =
      (station.symbol === 'interchange' ? tuning.labelInterchangeOffset : tuning.labelBaseOffset)
      + (station.lineIds.length > 2 ? tuning.labelDenseBoost : 0);

    let bestLabel: LayoutLabel | null = null;
    let bestRect: Rect | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    const candidates = buildLabelCandidates(station, offset);

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const label: LayoutLabel = {
        stationId: station.id,
        text: station.name,
        x: candidate.x,
        y: candidate.y,
        align: candidate.align,
        width,
        height,
      };
      const labelRect = labelToRect(label);

      let score = index * 12;
      score += outOfBoundsPenalty(labelRect, rect);

      for (const obstacle of stationObstacles) {
        if (obstacle.stationId === station.id) continue;
        if (rectsIntersect(labelRect, obstacle)) score += 4000;
      }

      for (const placed of placedRects) {
        if (rectsIntersect(labelRect, placed)) score += 9000;
      }

      score += getRoutePenalty(labelRect, { x: station.x, y: station.y }, routeSegments, tuning.routeAvoidance);

      if (score < bestScore) {
        bestScore = score;
        bestLabel = label;
        bestRect = labelRect;
      }
    }

    if (bestLabel && bestRect) {
      labels.push(bestLabel);
      placedRects.push({ ...bestRect, stationId: station.id });
    }
  }

  return labels;
}

function buildLabelCandidates(
  station: LayoutStation,
  offset: number,
): Array<{ x: number; y: number; align: TextAlign }> {
  const orientation = normalizeAxisAngle(station.angle);

  let order: Array<{ dx: number; dy: number; align: TextAlign }>;
  if (orientation < 22.5 || orientation >= 157.5) {
    order = [
      { dx: 0, dy: -offset, align: 'center' },
      { dx: 0, dy: offset, align: 'center' },
      { dx: offset, dy: 0, align: 'left' },
      { dx: -offset, dy: 0, align: 'right' },
      { dx: offset * 0.82, dy: -offset * 0.7, align: 'left' },
      { dx: offset * 0.82, dy: offset * 0.7, align: 'left' },
      { dx: -offset * 0.82, dy: -offset * 0.7, align: 'right' },
      { dx: -offset * 0.82, dy: offset * 0.7, align: 'right' },
    ];
  } else if (orientation > 67.5 && orientation < 112.5) {
    order = [
      { dx: offset, dy: 0, align: 'left' },
      { dx: -offset, dy: 0, align: 'right' },
      { dx: 0, dy: -offset, align: 'center' },
      { dx: 0, dy: offset, align: 'center' },
      { dx: offset * 0.82, dy: -offset * 0.7, align: 'left' },
      { dx: offset * 0.82, dy: offset * 0.7, align: 'left' },
      { dx: -offset * 0.82, dy: -offset * 0.7, align: 'right' },
      { dx: -offset * 0.82, dy: offset * 0.7, align: 'right' },
    ];
  } else {
    order = [
      { dx: offset, dy: -offset * 0.65, align: 'left' },
      { dx: offset, dy: offset * 0.65, align: 'left' },
      { dx: -offset, dy: -offset * 0.65, align: 'right' },
      { dx: -offset, dy: offset * 0.65, align: 'right' },
      { dx: 0, dy: -offset, align: 'center' },
      { dx: 0, dy: offset, align: 'center' },
      { dx: offset, dy: 0, align: 'left' },
      { dx: -offset, dy: 0, align: 'right' },
    ];
  }

  return order.map((candidate) => ({
    x: station.x + candidate.dx,
    y: station.y + candidate.dy,
    align: candidate.align,
  }));
}

function estimateLabelWidth(text: string, style: ExportStyle): number {
  const factor = style === 'lu' ? 7.1 : 7.35;
  return Math.max(44, text.length * factor + 10);
}

function labelToRect(label: LayoutLabel): Rect {
  const paddedWidth = label.width + 14;
  const paddedHeight = label.height;
  let x = label.x - paddedWidth / 2;

  if (label.align === 'left') x = label.x - 4;
  if (label.align === 'right') x = label.x - paddedWidth + 4;

  return {
    x,
    y: label.y - paddedHeight / 2,
    width: paddedWidth,
    height: paddedHeight,
  };
}

function outOfBoundsPenalty(labelRect: Rect, rect: Rect): number {
  let penalty = 0;
  if (labelRect.x < rect.x) penalty += (rect.x - labelRect.x) * 40;
  if (labelRect.y < rect.y) penalty += (rect.y - labelRect.y) * 40;
  if (labelRect.x + labelRect.width > rect.x + rect.width) {
    penalty += (labelRect.x + labelRect.width - (rect.x + rect.width)) * 40;
  }
  if (labelRect.y + labelRect.height > rect.y + rect.height) {
    penalty += (labelRect.y + labelRect.height - (rect.y + rect.height)) * 40;
  }
  return penalty;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function collectRouteSegments(lines: LayoutLine[]): Array<{ a: Point; b: Point }> {
  const segments: Array<{ a: Point; b: Point }> = [];

  for (const line of lines) {
    for (let index = 1; index < line.points.length; index++) {
      segments.push({ a: line.points[index - 1], b: line.points[index] });
    }
  }

  return segments;
}

function getRoutePenalty(
  labelRect: Rect,
  stationPoint: Point,
  routeSegments: Array<{ a: Point; b: Point }>,
  routeAvoidance: number,
): number {
  let penalty = 0;
  const expanded = inflateRect(labelRect, 3);
  const samplePoints = [
    stationPoint,
    { x: labelRect.x, y: labelRect.y },
    { x: labelRect.x + labelRect.width, y: labelRect.y },
    { x: labelRect.x, y: labelRect.y + labelRect.height },
    { x: labelRect.x + labelRect.width, y: labelRect.y + labelRect.height },
    { x: labelRect.x + labelRect.width / 2, y: labelRect.y + labelRect.height / 2 },
  ];

  for (const segment of routeSegments) {
    if (pointToSegmentDistance(stationPoint, segment.a, segment.b) <= 4) continue;

    if (segmentIntersectsRect(expanded, segment.a, segment.b)) {
      penalty += 2400;
      continue;
    }

    let minDistance = Number.POSITIVE_INFINITY;
    for (const point of samplePoints) {
      minDistance = Math.min(minDistance, pointToSegmentDistance(point, segment.a, segment.b));
    }

    if (minDistance < routeAvoidance) {
      penalty += (routeAvoidance - minDistance) * 85;
    }
  }

  return penalty;
}

function inflateRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function segmentIntersectsRect(rect: Rect, a: Point, b: Point): boolean {
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;

  const topLeft = { x: rect.x, y: rect.y };
  const topRight = { x: rect.x + rect.width, y: rect.y };
  const bottomLeft = { x: rect.x, y: rect.y + rect.height };
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height };

  return (
    lineSegmentsIntersect(a, b, topLeft, topRight)
    || lineSegmentsIntersect(a, b, topRight, bottomRight)
    || lineSegmentsIntersect(a, b, bottomRight, bottomLeft)
    || lineSegmentsIntersect(a, b, bottomLeft, topLeft)
  );
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height
  );
}

function lineSegmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const denominator = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(denominator) < 0.0001) return false;

  const ua = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denominator;
  const ub = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );

  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function buildDebug(
  style: ExportStyle,
  lines: LayoutLine[],
  stations: LayoutStation[],
  labels: LayoutLabel[],
  theme: ExportTheme,
  brandingText: string,
  sharedTracks: Map<string, SharedTrackGroup>,
): ExportDebug {
  const segmentAngles = lines.map((line) => {
    const angles: number[] = [];
    for (let index = 1; index < line.points.length; index++) {
      const a = line.points[index - 1];
      const b = line.points[index];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < 0.5) continue;
      angles.push(normalizeSegmentAngle(Math.atan2(b.y - a.y, b.x - a.x)));
    }
    return {
      lineId: line.id,
      angles,
      allOctilinear: angles.every((angle) => angle % 45 === 0),
    };
  });

  return {
    style,
    header: style === 'lu' ? 'roundel' : style === 'paris' ? 'metro-placard' : 'route-bullets',
    decorationKinds:
      style === 'lu'
        ? ['roundel', 'river-band']
        : style === 'paris'
          ? ['metro-placard', 'water-band', 'park-block']
          : ['route-bullets', 'water-band', 'park-block'],
    brandingText,
    fontStack: theme.uiFontFamily,
    routeBullets: lines.map((line) => ({ lineId: line.id, bullet: line.routeBullet })),
    stationSymbols: stations.map((station) => ({
      id: station.id,
      symbol: station.symbol,
      x: station.x,
      y: station.y,
      lineCount: station.lineIds.length,
    })),
    segmentAngles,
    allOctilinear: segmentAngles.every((segment) => segment.allOctilinear),
    labelCollisions: hasLabelCollisions(labels),
    parallelSharedSegments: Array.from(sharedTracks.values()).map((group) => ({
      key: group.key,
      lineIds: group.lineIds,
      laneOffsets: group.lineIds.map((lineId) => ({
        lineId,
        offset: group.laneOffsets.get(lineId) ?? 0,
      })),
    })),
  };
}

function hasLabelCollisions(labels: LayoutLabel[]): boolean {
  for (let i = 0; i < labels.length; i++) {
    const a = labelToRect(labels[i]);
    for (let j = i + 1; j < labels.length; j++) {
      const b = labelToRect(labels[j]);
      if (rectsIntersect(a, b)) return true;
    }
  }
  return false;
}

function normalizeSegmentAngle(angle: number): number {
  const degrees = ((angle * 180) / Math.PI + 360) % 360;
  return ((Math.round(degrees / 45) * 45) + 360) % 360;
}

function normalizeAxisAngle(angle: number): number {
  const degrees = Math.abs((angle * 180) / Math.PI) % 180;
  return degrees;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function snapToGrid(value: number, origin: number, grid: number): number {
  return origin + Math.round((value - origin) / grid) * grid;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildExportHTML(doc: ExportDocument, options: BuildHtmlOptions = {}): string {
  const preview = Boolean(options.preview);
  const docJson = JSON.stringify(doc);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transit Map Export — High Speed Too</title>
<style>
  :root {
    color-scheme: light;
    --page-bg: ${doc.theme.pageBackground};
    --panel-bg: ${doc.theme.panelBackground};
    --panel-border: ${doc.theme.panelBorder};
    --accent: ${doc.theme.toolbarAccent};
    --accent-text: ${doc.theme.toolbarAccentText};
    --ghost-bg: ${doc.theme.toolbarGhostBackground};
    --ghost-text: ${doc.theme.toolbarGhostText};
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: ${preview ? '0' : '24px'};
    background:
      radial-gradient(circle at 20% 20%, rgba(255,255,255,0.05), transparent 34%),
      radial-gradient(circle at 80% 0%, rgba(255,255,255,0.05), transparent 28%),
      var(--page-bg);
    color: #fff;
    font-family: ${doc.theme.uiFontFamily};
    overflow: hidden;
  }

  .toolbar {
    display: ${preview ? 'none' : 'flex'};
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--panel-border);
    border-radius: 999px;
    background: var(--panel-bg);
    backdrop-filter: blur(18px);
  }

  .toolbar button {
    appearance: none;
    border: 0;
    border-radius: 999px;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: transform 0.12s ease, opacity 0.12s ease, background 0.12s ease;
  }

  .toolbar button:hover {
    transform: translateY(-1px);
  }

  .toolbar button.primary {
    background: var(--accent);
    color: var(--accent-text);
  }

  .toolbar button.ghost {
    background: var(--ghost-bg);
    color: var(--ghost-text);
  }

  .canvas-shell {
    padding: ${preview ? '0' : '14px'};
    border-radius: ${preview ? '0' : '24px'};
    border: ${preview ? '0' : '1px solid var(--panel-border)'};
    background: ${preview ? 'transparent' : 'rgba(255,255,255,0.04)'};
    backdrop-filter: ${preview ? 'none' : 'blur(20px)'};
    box-shadow: ${preview ? 'none' : '0 26px 64px rgba(0, 0, 0, 0.35)'};
    width: ${preview ? '100%' : 'auto'};
    height: ${preview ? '100%' : 'auto'};
    display: grid;
    place-items: center;
  }

  canvas {
    display: block;
    width: ${preview ? '100%' : 'min(100%, ' + doc.width + 'px)'};
    height: auto;
    max-width: ${doc.width}px;
    border-radius: ${preview ? '0' : '16px'};
    box-shadow: ${preview ? 'none' : '0 10px 30px rgba(0, 0, 0, 0.18)'};
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" id="btn-download">Download PNG</button>
    <button class="ghost" id="btn-close">Close</button>
  </div>
  <div class="canvas-shell">
    <canvas id="export-canvas" width="${doc.width}" height="${doc.height}"></canvas>
  </div>
<script>
(function() {
  var DOC = ${docJson};
  var THEME = DOC.theme;
  var canvas = document.getElementById('export-canvas');
  var ctx = canvas.getContext('2d');

  window.__EXPORT_DEBUG__ = DOC.debug;

  function hexToRgba(hex, alpha) {
    var cleaned = String(hex || '').replace('#', '');
    if (cleaned.length === 3) {
      cleaned = cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2];
    }
    if (cleaned.length !== 6) return hex;
    var r = parseInt(cleaned.slice(0, 2), 16);
    var g = parseInt(cleaned.slice(2, 4), 16);
    var b = parseInt(cleaned.slice(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  }

  function drawRoundedRect(x, y, width, height, radius, fillStyle, strokeStyle, lineWidth) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function drawRoundedPolyline(points, radius) {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, 1, 0, Math.PI * 2);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (var i = 1; i < points.length - 1; i++) {
      var prev = points[i - 1];
      var current = points[i];
      var next = points[i + 1];
      var prevLen = Math.hypot(current.x - prev.x, current.y - prev.y);
      var nextLen = Math.hypot(next.x - current.x, next.y - current.y);
      var r = Math.min(radius, prevLen / 2, nextLen / 2);

      if (r < 0.01) {
        ctx.lineTo(current.x, current.y);
        continue;
      }

      var ux1 = (current.x - prev.x) / prevLen;
      var uy1 = (current.y - prev.y) / prevLen;
      var ux2 = (next.x - current.x) / nextLen;
      var uy2 = (next.y - current.y) / nextLen;

      var p1x = current.x - ux1 * r;
      var p1y = current.y - uy1 * r;
      var p2x = current.x + ux2 * r;
      var p2y = current.y + uy2 * r;

      ctx.lineTo(p1x, p1y);
      ctx.quadraticCurveTo(current.x, current.y, p2x, p2y);
    }

    var last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function drawRouteBullet(x, y, radius, line) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = line.color;
    ctx.fill();
    ctx.fillStyle = line.bulletTextColor;
    ctx.font = '700 ' + (radius + 4) + 'px ' + THEME.uiFontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(line.routeBullet, x, y + 0.5);
  }

  function drawMetroPill(x, y, width, height, text) {
    drawRoundedRect(x, y, width, height, height / 2, '#163B75', null, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px ' + THEME.uiFontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
  }

  function renderBackdrop() {
    ctx.fillStyle = THEME.canvasBackground;
    ctx.fillRect(0, 0, DOC.width, DOC.height);

    if (DOC.style === 'lu') {
      renderLUBackdrop();
    } else if (DOC.style === 'paris') {
      renderParisBackdrop();
    } else {
      renderMTABackdrop();
    }
  }

  function renderLUBackdrop() {
    var barX = 60;
    var barY = 62;
    var barW = 180;
    var barH = 30;
    var centerX = 150;
    var centerY = 77;

    ctx.lineWidth = 12;
    ctx.strokeStyle = THEME.roundelRed;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 36, 0, Math.PI * 2);
    ctx.stroke();

    drawRoundedRect(barX, barY, barW, barH, 10, THEME.roundelBlue, null, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 12px ' + THEME.uiFontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(DOC.brandingText || 'HIGH SPEED TOO', centerX, centerY + 0.5);

    ctx.strokeStyle = hexToRgba(THEME.water, 0.8);
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(DOC.contentRect.x - 10, DOC.contentRect.y + DOC.contentRect.height * 0.58);
    ctx.bezierCurveTo(
      DOC.contentRect.x + DOC.contentRect.width * 0.18,
      DOC.contentRect.y + DOC.contentRect.height * 0.46,
      DOC.contentRect.x + DOC.contentRect.width * 0.42,
      DOC.contentRect.y + DOC.contentRect.height * 0.72,
      DOC.contentRect.x + DOC.contentRect.width * 0.58,
      DOC.contentRect.y + DOC.contentRect.height * 0.63
    );
    ctx.bezierCurveTo(
      DOC.contentRect.x + DOC.contentRect.width * 0.74,
      DOC.contentRect.y + DOC.contentRect.height * 0.54,
      DOC.contentRect.x + DOC.contentRect.width * 0.9,
      DOC.contentRect.y + DOC.contentRect.height * 0.69,
      DOC.contentRect.x + DOC.contentRect.width + 24,
      DOC.contentRect.y + DOC.contentRect.height * 0.6
    );
    ctx.stroke();
  }

  function renderMTABackdrop() {
    drawRoundedRect(
      DOC.contentRect.x + 18,
      DOC.contentRect.y + 26,
      138,
      52,
      20,
      THEME.park,
      null,
      0
    );
    drawRoundedRect(
      DOC.contentRect.x + DOC.contentRect.width - 190,
      DOC.contentRect.y + DOC.contentRect.height - 98,
      162,
      54,
      20,
      THEME.park,
      null,
      0
    );

    ctx.fillStyle = hexToRgba(THEME.water, 0.92);
    ctx.beginPath();
    ctx.moveTo(-40, DOC.height * 0.79);
    ctx.bezierCurveTo(
      DOC.width * 0.18,
      DOC.height * 0.68,
      DOC.width * 0.34,
      DOC.height * 0.9,
      DOC.width * 0.52,
      DOC.height * 0.82
    );
    ctx.bezierCurveTo(
      DOC.width * 0.72,
      DOC.height * 0.72,
      DOC.width * 0.88,
      DOC.height * 0.9,
      DOC.width + 40,
      DOC.height * 0.8
    );
    ctx.lineTo(DOC.width + 40, DOC.height + 40);
    ctx.lineTo(-40, DOC.height + 40);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = hexToRgba(THEME.waterAccent, 0.95);
    ctx.beginPath();
    ctx.moveTo(DOC.width * 0.72, 100);
    ctx.bezierCurveTo(
      DOC.width * 0.84,
      78,
      DOC.width * 0.93,
      144,
      DOC.width + 30,
      118
    );
    ctx.lineTo(DOC.width + 30, 0);
    ctx.lineTo(DOC.width * 0.7, 0);
    ctx.closePath();
    ctx.fill();
  }

  function renderParisBackdrop() {
    drawRoundedRect(48, 48, DOC.width - 96, DOC.height - 96, 28, hexToRgba('#FFFFFF', 0.38), hexToRgba('#D5DED7', 0.95), 1.4);

    ctx.fillStyle = hexToRgba(THEME.park, 0.95);
    ctx.beginPath();
    ctx.ellipse(DOC.contentRect.x + 110, DOC.contentRect.y + 110, 82, 54, -0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = hexToRgba(THEME.water, 0.96);
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(DOC.contentRect.x - 16, DOC.contentRect.y + DOC.contentRect.height * 0.68);
    ctx.bezierCurveTo(
      DOC.contentRect.x + DOC.contentRect.width * 0.16,
      DOC.contentRect.y + DOC.contentRect.height * 0.52,
      DOC.contentRect.x + DOC.contentRect.width * 0.42,
      DOC.contentRect.y + DOC.contentRect.height * 0.78,
      DOC.contentRect.x + DOC.contentRect.width * 0.64,
      DOC.contentRect.y + DOC.contentRect.height * 0.62
    );
    ctx.bezierCurveTo(
      DOC.contentRect.x + DOC.contentRect.width * 0.76,
      DOC.contentRect.y + DOC.contentRect.height * 0.56,
      DOC.contentRect.x + DOC.contentRect.width * 0.88,
      DOC.contentRect.y + DOC.contentRect.height * 0.7,
      DOC.contentRect.x + DOC.contentRect.width + 18,
      DOC.contentRect.y + DOC.contentRect.height * 0.58
    );
    ctx.stroke();
  }

  function renderHeader() {
    if (DOC.style === 'mta') {
      for (var i = 0; i < Math.min(3, DOC.lines.length); i++) {
        drawRouteBullet(70 + i * 30, 78, 12, DOC.lines[i]);
      }
      ctx.fillStyle = THEME.titleColor;
      ctx.font = THEME.titleFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(DOC.title, 170, 82);
      ctx.fillStyle = THEME.subtitleColor;
      ctx.font = THEME.subtitleFont;
      ctx.fillText(DOC.subtitle, 170, 106);
      ctx.fillText('Not to scale', 170, 126);
      return;
    }

    if (DOC.style === 'paris') {
      drawMetroPill(64, 58, 108, 42, 'METRO');
      ctx.fillStyle = THEME.titleColor;
      ctx.font = THEME.titleFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(DOC.title, 198, 82);
      ctx.fillStyle = THEME.subtitleColor;
      ctx.font = THEME.subtitleFont;
      ctx.fillText(DOC.subtitle, 198, 106);
      ctx.fillText('Plan schématique', 198, 126);
      return;
    }

    ctx.fillStyle = THEME.titleColor;
    ctx.font = THEME.titleFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(DOC.title, 278, 82);
    ctx.fillStyle = THEME.subtitleColor;
    ctx.font = THEME.subtitleFont;
    ctx.fillText(DOC.subtitle, 278, 106);
  }

  function renderRoutes() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (var i = 0; i < DOC.lines.length; i++) {
      var line = DOC.lines[i];
      if (!line.points || line.points.length < 2) continue;

      ctx.strokeStyle = DOC.style === 'lu' ? 'rgba(255,255,255,0.92)' : DOC.style === 'paris' ? 'rgba(255,255,255,0.98)' : 'rgba(247,243,233,0.96)';
      ctx.lineWidth = THEME.routeWidth + THEME.routeCasingWidth;
      drawRoundedPolyline(line.points, THEME.routeCornerRadius);
      ctx.stroke();

      ctx.strokeStyle = line.color;
      ctx.lineWidth = THEME.routeWidth;
      drawRoundedPolyline(line.points, THEME.routeCornerRadius);
      ctx.stroke();
    }
  }

  function renderStations() {
    for (var i = 0; i < DOC.stations.length; i++) {
      var station = DOC.stations[i];
      if (station.symbol === 'interchange') {
        renderInterchange(station);
      } else if (DOC.style === 'lu') {
        renderTubeTick(station);
      } else if (DOC.style === 'paris') {
        renderParisDot(station);
      } else {
        renderMTADot(station);
      }
    }
  }

  function renderInterchange(station) {
    var outerRadius = DOC.style === 'lu' ? 10.5 : 11.5;
    var innerRadius = DOC.style === 'lu' ? 7 : 7.5;
    var segmentAngle = (Math.PI * 2) / station.colors.length;

    for (var i = 0; i < station.colors.length; i++) {
      ctx.beginPath();
      ctx.strokeStyle = station.colors[i];
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      ctx.arc(
        station.x,
        station.y,
        outerRadius,
        -Math.PI / 2 + segmentAngle * i,
        -Math.PI / 2 + segmentAngle * (i + 1)
      );
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(station.x, station.y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = THEME.stationFill;
    ctx.fill();
    ctx.strokeStyle = THEME.stationOutline;
    ctx.lineWidth = DOC.style === 'lu' ? 1.7 : 2;
    ctx.stroke();
  }

  function renderTubeTick(station) {
    var tickLength = station.symbol === 'terminal' ? 18 : 14;
    var angle = station.angle + Math.PI / 2;
    var dx = Math.cos(angle) * tickLength / 2;
    var dy = Math.sin(angle) * tickLength / 2;

    ctx.beginPath();
    ctx.moveTo(station.x - dx, station.y - dy);
    ctx.lineTo(station.x + dx, station.y + dy);
    ctx.strokeStyle = 'rgba(255,255,255,0.96)';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(station.x - dx, station.y - dy);
    ctx.lineTo(station.x + dx, station.y + dy);
    ctx.strokeStyle = THEME.stationOutline;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  function renderMTADot(station) {
    var radius = station.symbol === 'terminal' ? 6.2 : 5;
    ctx.beginPath();
    ctx.arc(station.x, station.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = THEME.stationOutline;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(station.x, station.y, radius - 2.2, 0, Math.PI * 2);
    ctx.fillStyle = THEME.stationFill;
    ctx.fill();
  }

  function renderParisDot(station) {
    var radius = station.symbol === 'terminal' ? 5.6 : 4.7;
    ctx.beginPath();
    ctx.arc(station.x, station.y, radius + 1.4, 0, Math.PI * 2);
    ctx.fillStyle = '#163B75';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(station.x, station.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(station.x, station.y, radius - 2, 0, Math.PI * 2);
    ctx.fillStyle = THEME.stationOutline;
    ctx.fill();
  }

  function renderLabels() {
    for (var i = 0; i < DOC.labels.length; i++) {
      var label = DOC.labels[i];
      var rect = labelToRect(label);

      drawRoundedRect(rect.x, rect.y, rect.width, rect.height, 10, THEME.labelBackground, null, 0);

      ctx.fillStyle = THEME.labelText;
      ctx.font = THEME.labelFont;
      ctx.textAlign = label.align;
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, label.x, label.y + 0.5);
    }
  }

  function labelToRect(label) {
    var width = label.width + 14;
    var x = label.x - width / 2;
    if (label.align === 'left') x = label.x - 4;
    if (label.align === 'right') x = label.x - width + 4;
    return {
      x: x,
      y: label.y - label.height / 2,
      width: width,
      height: label.height
    };
  }

  function renderLegend() {
    if (!DOC.showLegend) return;

    var legendWidth = DOC.style === 'paris' ? 232 : 206;
    var legendX = DOC.width - legendWidth - 36;
    var legendY = 144;
    var rowHeight = DOC.style === 'lu' ? 34 : DOC.style === 'paris' ? 32 : 36;
    var symbolRows = 2;
    var legendHeight = 78 + DOC.lines.length * rowHeight + symbolRows * 24;

    drawRoundedRect(
      legendX,
      legendY,
      legendWidth,
      legendHeight,
      20,
      THEME.legendBackground,
      hexToRgba(THEME.legendBorder, 0.28),
      1.2
    );

    ctx.fillStyle = THEME.legendTitle;
    ctx.font = '700 15px ' + THEME.uiFontFamily;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(DOC.style === 'mta' ? 'Services' : DOC.style === 'lu' ? 'Key to lines' : 'Lines', legendX + 18, legendY + 28);

    for (var i = 0; i < DOC.lines.length; i++) {
      var line = DOC.lines[i];
      var rowY = legendY + 54 + i * rowHeight;

      if (DOC.style === 'lu') {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(legendX + 20, rowY);
        ctx.lineTo(legendX + 58, rowY);
        ctx.stroke();
      } else if (DOC.style === 'paris') {
        drawRoundedRect(legendX + 18, rowY - 10, 38, 18, 9, line.color, null, 0);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 10px ' + THEME.uiFontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(line.routeBullet, legendX + 37, rowY - 0.5);
      } else {
        drawRouteBullet(legendX + 30, rowY - 1, 11, line);
      }

      ctx.fillStyle = THEME.legendText;
      ctx.font = THEME.legendFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(line.name, legendX + 70, rowY);
    }

    var symbolsY = legendY + 58 + DOC.lines.length * rowHeight;
    ctx.fillStyle = THEME.legendTitle;
    ctx.font = '700 12px ' + THEME.uiFontFamily;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Symbols', legendX + 18, symbolsY);

    if (DOC.style === 'lu') {
      renderTubeTick({ x: legendX + 30, y: symbolsY + 20, angle: 0, symbol: 'tick' });
      renderInterchange({ x: legendX + 30, y: symbolsY + 44, colors: ['#0019A8', '#DC241F'] });
    } else if (DOC.style === 'paris') {
      renderParisDot({ x: legendX + 30, y: symbolsY + 20, symbol: 'dot' });
      renderInterchange({ x: legendX + 30, y: symbolsY + 44, colors: ['#163B75', '#0E6B5B'] });
    } else {
      renderMTADot({ x: legendX + 30, y: symbolsY + 20, symbol: 'dot' });
      renderInterchange({ x: legendX + 30, y: symbolsY + 44, colors: ['#0039A6', '#EE352E'] });
    }

    ctx.fillStyle = THEME.legendText;
    ctx.font = THEME.legendFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Station', legendX + 52, symbolsY + 20);
    ctx.fillText('Interchange', legendX + 52, symbolsY + 44);
  }

  function renderFooter() {
    ctx.fillStyle = THEME.subtitleColor;
    ctx.font = '12px ' + THEME.uiFontFamily;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Generated by High Speed Too', 88, DOC.height - 34);
    ctx.textAlign = 'right';
    ctx.fillText(DOC.lines.length + ' line' + (DOC.lines.length === 1 ? '' : 's'), DOC.width - 88, DOC.height - 34);
  }

  function render() {
    renderBackdrop();
    renderHeader();
    renderRoutes();
    renderStations();
    renderLabels();
    renderLegend();
    renderFooter();
  }

  render();

  var downloadButton = document.getElementById('btn-download');
  if (downloadButton) {
    downloadButton.addEventListener('click', function() {
      var link = document.createElement('a');
      link.download = 'transit-map-' + DOC.style + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    });
  }

  var closeButton = document.getElementById('btn-close');
  if (closeButton) {
    closeButton.addEventListener('click', function() {
      window.close();
    });
  }
})();
</script>
</body>
</html>`;
}
