// ── Map Export ────────────────────────────────────────────────────────────────
// Renders user-created lines as a schematic transit map in either
// NY Metro (MTA) style or London Underground (LU) style.

import type { Station, Network } from './network';

export type ExportStyle = 'mta' | 'lu';

export interface ExportOptions {
  style: ExportStyle;
  lineIds: string[];
  showLegend: boolean;
}

// ── Data gathering ───────────────────────────────────────────────────────────

interface ExportLine {
  name: string;
  color: string;
  stations: Station[];
}

function gatherExportData(network: Network, lineIds: string[]): ExportLine[] {
  const result: ExportLine[] = [];
  for (const id of lineIds) {
    const line = network.getLine(id);
    if (!line) continue;
    const stations = line.stationIds
      .map((sid) => network.getStation(sid))
      .filter((s): s is Station => !!s);
    result.push({ name: line.name, color: line.color, stations });
  }
  return result;
}

// ── Interchange detection ────────────────────────────────────────────────────

function buildInterchangeMap(lines: ExportLine[]): Map<string, string[]> {
  // stationId -> list of line colors that serve it
  const map = new Map<string, string[]>();
  for (const line of lines) {
    for (const stn of line.stations) {
      const existing = map.get(stn.id) ?? [];
      if (!existing.includes(line.color)) existing.push(line.color);
      map.set(stn.id, existing);
    }
  }
  return map;
}

// ── Export page generation ───────────────────────────────────────────────────

export function openExportPage(network: Network, options: ExportOptions): void {
  const lines = gatherExportData(network, options.lineIds);
  if (lines.length === 0) return;

  const interchanges = buildInterchangeMap(lines);

  // Canvas dimensions
  const canvasW = 1400;
  const canvasH = 900;

  // Build standalone HTML page
  const html = buildExportHTML(lines, interchanges, canvasW, canvasH, options);

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');

  // Clean up blob URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  if (!tab) {
    alert('Pop-up blocked. Please allow pop-ups for this site.');
  }
}

function buildExportHTML(
  lines: ExportLine[],
  interchanges: Map<string, string[]>,
  canvasW: number,
  canvasH: number,
  options: ExportOptions,
): string {
  // Serialise data for embedding in the page
  const linesJSON = JSON.stringify(lines);
  const interchangeJSON = JSON.stringify(Array.from(interchanges.entries()));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transit Map Export — High Speed Too</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .toolbar button {
    padding: 8px 18px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    background: rgba(255,255,255,0.1);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .toolbar button:hover { background: rgba(255,255,255,0.2); }
  .toolbar button.primary {
    background: #4A90D9;
    border-color: #4A90D9;
  }
  .toolbar button.primary:hover { background: #3A7BC8; }
  .toolbar button.close-btn {
    background: #c0392b;
    border-color: #c0392b;
  }
  .toolbar button.close-btn:hover { background: #a93226; }
  canvas {
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    max-width: 100%;
    height: auto;
  }
</style>
</head>
<body>
<div class="toolbar">
  <button class="primary" id="btn-download">Download PNG</button>
  <button class="close-btn" id="btn-close">Close</button>
</div>
<canvas id="export-canvas" width="${canvasW}" height="${canvasH}"></canvas>
<script>
(function() {
  var STYLE = ${JSON.stringify(options.style)};
  var SHOW_LEGEND = ${JSON.stringify(options.showLegend)};
  var LINES = ${linesJSON};
  var INTERCHANGES_ARR = ${interchangeJSON};
  var INTERCHANGES = new Map(INTERCHANGES_ARR);
  var W = ${canvasW};
  var H = ${canvasH};

  var canvas = document.getElementById('export-canvas');
  var ctx = canvas.getContext('2d');

  // ── Shared helpers ──
  function computeBounds(lines) {
    var minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (var i = 0; i < lines.length; i++) {
      for (var j = 0; j < lines[i].stations.length; j++) {
        var s = lines[i].stations[j];
        if (s.lng < minLng) minLng = s.lng;
        if (s.lng > maxLng) maxLng = s.lng;
        if (s.lat < minLat) minLat = s.lat;
        if (s.lat > maxLat) maxLat = s.lat;
      }
    }
    return { minLng: minLng, maxLng: maxLng, minLat: minLat, maxLat: maxLat };
  }

  function projectPoint(lng, lat, bounds, width, height, padding) {
    var spanLng = bounds.maxLng - bounds.minLng || 0.01;
    var spanLat = bounds.maxLat - bounds.minLat || 0.01;
    var drawW = width - padding * 2;
    var drawH = height - padding * 2;
    var scaleX = drawW / spanLng;
    var scaleY = drawH / spanLat;
    var scale = Math.min(scaleX, scaleY);
    var offsetX = padding + (drawW - spanLng * scale) / 2;
    var offsetY = padding + (drawH - spanLat * scale) / 2;
    return [offsetX + (lng - bounds.minLng) * scale, offsetY + (bounds.maxLat - lat) * scale];
  }

  function snapOctilinear(dx, dy) {
    var angle = Math.atan2(dy, dx);
    var snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    var dist = Math.sqrt(dx * dx + dy * dy);
    return [Math.cos(snapped) * dist, Math.sin(snapped) * dist];
  }

  // ── Legend ──
  function renderLegend(ctx, lines, width, height, style) {
    var legendX = width - 220;
    var legendY = 20;
    var lineHeight = 28;
    var legendW = 200;
    var legendH = 40 + lines.length * lineHeight;

    ctx.fillStyle = style === 'mta' ? 'rgba(245,241,232,0.95)' : 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = style === 'mta' ? '#999' : '#000072';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(legendX, legendY, legendW, legendH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = style === 'mta' ? '#000' : '#000072';
    ctx.font = style === 'mta' ? 'bold 14px Helvetica, Arial, sans-serif' : 'bold 14px "P22 Underground", "Gill Sans", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Key', legendX + 14, legendY + 12);

    for (var i = 0; i < lines.length; i++) {
      var y = legendY + 38 + i * lineHeight;
      ctx.fillStyle = lines[i].color;
      ctx.beginPath();
      ctx.roundRect(legendX + 14, y, 30, 4, 2);
      ctx.fill();
      ctx.fillStyle = style === 'mta' ? '#000' : '#000072';
      ctx.font = style === 'mta' ? '12px Helvetica, Arial, sans-serif' : '12px "P22 Underground", "Gill Sans", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(lines[i].name, legendX + 52, y + 2);
    }
  }

  // ── MTA Renderer ──
  function renderMTA(ctx, lines, interchanges, w, h, showLegend) {
    var padding = showLegend ? 120 : 80;
    var bounds = computeBounds(lines);

    ctx.fillStyle = '#F5F1E8';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 28px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Transit Map', 30, 42);
    ctx.font = '14px Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#555';
    ctx.fillText('New York Metro Style', 30, 62);

    var topPadding = padding + 40;

    function project(s) { return projectPoint(s.lng, s.lat, bounds, w, h - 40, topPadding); }

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line.stations.length < 2) continue;
      ctx.beginPath();
      var sp = project(line.stations[0]);
      ctx.moveTo(sp[0], sp[1]);
      for (var si = 1; si < line.stations.length; si++) {
        var p = project(line.stations[si]);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    var drawn = {};
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      for (var si = 0; si < line.stations.length; si++) {
        var stn = line.stations[si];
        if (drawn[stn.id]) continue;
        drawn[stn.id] = true;
        var pt = project(stn);
        var x = pt[0], y = pt[1];
        var colors = interchanges.get(stn.id) || [line.color];
        var isInt = colors.length > 1;

        if (isInt) {
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          var segAngle = (Math.PI * 2) / colors.length;
          for (var ci = 0; ci < colors.length; ci++) {
            ctx.beginPath();
            ctx.arc(x, y, 7, segAngle * ci - Math.PI / 2, segAngle * (ci + 1) - Math.PI / 2);
            ctx.lineTo(x, y);
            ctx.closePath();
            ctx.fillStyle = colors[ci];
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#000000';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }

        ctx.fillStyle = '#000000';
        ctx.font = '11px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(stn.name, x + 14, y);
      }
    }

    if (showLegend) renderLegend(ctx, lines, w, h, 'mta');
  }

  // ── LU Renderer ──
  function renderLU(ctx, lines, interchanges, w, h, showLegend) {
    var padding = showLegend ? 120 : 80;
    var bounds = computeBounds(lines);

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#000072';
    ctx.font = 'bold 28px "P22 Underground", "Gill Sans", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Transit Map', 30, 42);
    ctx.font = '14px "P22 Underground", "Gill Sans", Arial, sans-serif';
    ctx.fillStyle = '#555';
    ctx.fillText('London Underground Style', 30, 62);

    var topPadding = padding + 40;

    var projected = {};
    for (var li = 0; li < lines.length; li++) {
      for (var si = 0; si < lines[li].stations.length; si++) {
        var s = lines[li].stations[si];
        if (!projected[s.id]) {
          projected[s.id] = projectPoint(s.lng, s.lat, bounds, w, h - 40, topPadding);
        }
      }
    }

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line.stations.length < 2) continue;
      ctx.beginPath();
      var sp = projected[line.stations[0].id];
      ctx.moveTo(sp[0], sp[1]);
      for (var si = 1; si < line.stations.length; si++) {
        var prev = projected[line.stations[si - 1].id];
        var curr = projected[line.stations[si].id];
        var dx = curr[0] - prev[0];
        var dy = curr[1] - prev[1];
        var sn = snapOctilinear(dx, dy);
        var midX = prev[0] + sn[0];
        var midY = prev[1] + sn[1];
        if (Math.abs(midX - curr[0]) > 2 || Math.abs(midY - curr[1]) > 2) {
          var halfX = prev[0] + dx / 2;
          var halfY = prev[1];
          ctx.lineTo(halfX, halfY);
          ctx.lineTo(curr[0], curr[1]);
        } else {
          ctx.lineTo(curr[0], curr[1]);
        }
      }
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    var drawn = {};
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      for (var si = 0; si < line.stations.length; si++) {
        var stn = line.stations[si];
        if (drawn[stn.id]) continue;
        drawn[stn.id] = true;
        var pt = projected[stn.id];
        var x = pt[0], y = pt[1];
        var colors = interchanges.get(stn.id) || [line.color];
        var isInt = colors.length > 1;

        if (isInt) {
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          var angle = 0;
          if (si > 0 && si < line.stations.length - 1) {
            var prevPt = projected[line.stations[si - 1].id];
            var nextPt = projected[line.stations[si + 1].id];
            angle = Math.atan2(nextPt[1] - prevPt[1], nextPt[0] - prevPt[0]);
          } else if (si === 0 && line.stations.length > 1) {
            var nextPt = projected[line.stations[1].id];
            angle = Math.atan2(nextPt[1] - y, nextPt[0] - x);
          } else if (si === line.stations.length - 1 && line.stations.length > 1) {
            var prevPt = projected[line.stations[si - 1].id];
            angle = Math.atan2(y - prevPt[1], x - prevPt[0]);
          }
          var perpAngle = angle + Math.PI / 2;
          var tickLen = 7;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(perpAngle) * tickLen, y - Math.sin(perpAngle) * tickLen);
          ctx.lineTo(x + Math.cos(perpAngle) * tickLen, y + Math.sin(perpAngle) * tickLen);
          ctx.strokeStyle = line.color;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'butt';
          ctx.stroke();
        }

        ctx.fillStyle = '#000072';
        ctx.font = '11px "P22 Underground", "Gill Sans", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(stn.name, x + 14, y);
      }
    }

    if (showLegend) renderLegend(ctx, lines, w, h, 'lu');
  }

  // ── Render ──
  if (STYLE === 'mta') {
    renderMTA(ctx, LINES, INTERCHANGES, W, H, SHOW_LEGEND);
  } else {
    renderLU(ctx, LINES, INTERCHANGES, W, H, SHOW_LEGEND);
  }

  // ── Download PNG ──
  document.getElementById('btn-download').addEventListener('click', function() {
    var link = document.createElement('a');
    link.download = 'transit-map-' + STYLE + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // ── Close tab ──
  document.getElementById('btn-close').addEventListener('click', function() {
    window.close();
  });
})();
</script>
</body>
</html>`;
}
