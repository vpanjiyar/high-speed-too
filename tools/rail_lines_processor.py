#!/usr/bin/env python3
"""
rail_lines_processor.py

Downloads UK national rail line geometry from OpenStreetMap via the Overpass API,
applies Douglas-Peucker simplification, and outputs a compact GeoJSON file for
display at all zoom levels (including national overview).

Output: public/data/rail_lines.geojson

Usage: python tools/rail_lines_processor.py
"""

import json
import urllib.request
import urllib.parse
import sys
from pathlib import Path

OUT_PATH = Path(__file__).parent.parent / "public" / "data" / "rail_lines.geojson"

# UK bounding box: [min_lon, min_lat, max_lon, max_lat]
UK_BBOX = "49.5,-8.0,61.0,2.0"  # Overpass uses south,west,north,east

# Overpass query: UK national rail lines, excluding service/yard/siding tracks.
# Uses a bbox for speed instead of area lookup.
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY = f"""
[out:json][timeout:300][bbox:{UK_BBOX}];
(
  way["railway"="rail"]["service"!~"yard|siding|crossover|maintenance|depot"];
);
out geom qt;
"""


# ── Pure-Python Douglas-Peucker simplification ────────────────────────────────

def _pt_line_dist(px, py, ax, ay, bx, by):
    """Perpendicular distance from point P to line AB."""
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5


def simplify(coords, tolerance):
    """Recursive Douglas-Peucker simplification."""
    if len(coords) <= 2:
        return coords
    ax, ay = coords[0]
    bx, by = coords[-1]
    dmax, idx = 0.0, 0
    for i in range(1, len(coords) - 1):
        d = _pt_line_dist(coords[i][0], coords[i][1], ax, ay, bx, by)
        if d > dmax:
            dmax, idx = d, i
    if dmax > tolerance:
        left = simplify(coords[: idx + 1], tolerance)
        right = simplify(coords[idx:], tolerance)
        return left[:-1] + right
    return [coords[0], coords[-1]]


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Querying Overpass API for UK national rail lines …")
    print("(This may take 1–3 minutes for a full UK download)")

    data = urllib.parse.urlencode({"data": QUERY}).encode()
    req = urllib.request.Request(
        OVERPASS_URL,
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "high-speed-too/1.0 (rail_lines_processor)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=360) as resp:
            raw = resp.read()
    except Exception as exc:
        print(f"ERROR downloading from Overpass: {exc}", file=sys.stderr)
        sys.exit(1)

    result = json.loads(raw)
    elements = result.get("elements", [])
    print(f"  Downloaded {len(elements)} rail way elements.")

    features = []
    skipped = 0
    for el in elements:
        if el.get("type") != "way" or "geometry" not in el:
            skipped += 1
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in el["geometry"]]
        if len(coords) < 2:
            skipped += 1
            continue

        # Simplify: tolerance ~100 m in degrees (0.001° ≈ 111 m at equator)
        simplified = simplify(coords, tolerance=0.001)
        if len(simplified) < 2:
            skipped += 1
            continue

        tags = el.get("tags", {})
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": simplified},
                "properties": {
                    "tunnel": tags.get("tunnel") == "yes",
                    "bridge": tags.get("bridge") == "yes",
                    "usage": tags.get("usage", ""),
                },
            }
        )

    print(f"  Processed {len(features)} features ({skipped} skipped).")

    geojson = {"type": "FeatureCollection", "features": features}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"  Written to {OUT_PATH}  ({size_kb:.0f} KB)")
    print("Done.")


if __name__ == "__main__":
    main()
