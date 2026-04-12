#!/usr/bin/env python3
"""
rail_lines_processor.py

Downloads UK rail and metro line geometry from OpenStreetMap via the Overpass API,
applies Douglas-Peucker simplification, and outputs a compact GeoJSON file for
display at all zoom levels (including national overview).

Output: public/data/rail_lines.geojson

Usage: python tools/rail_lines_processor.py
"""

import json
import re
import urllib.request
import urllib.parse
import sys
from pathlib import Path

OUT_PATH = Path(__file__).parent.parent / "public" / "data" / "rail_lines.geojson"

# UK bounding box: [min_lon, min_lat, max_lon, max_lat]
UK_BBOX = "49.5,-8.0,61.0,2.0"  # Overpass uses south,west,north,east

# Overpass query: UK rail + metro lines, excluding service/yard/siding tracks.
# Uses a bbox for speed instead of area lookup.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
QUERY = f"""
[out:json][timeout:300][bbox:{UK_BBOX}];
(
    way["railway"~"^(rail|subway|light_rail|tram)$"]["service"!~"yard|siding|crossover|maintenance|depot"];
);
out geom qt;
"""


# ── OSM tag helpers ───────────────────────────────────────────────────────────

def parse_maxspeed_kmh(val):
    """Parse an OSM maxspeed string to km/h (returns None if unrecognised).

    NOTE: After changing this processor to emit maxspeed/electrified/voltage
    fields you must re-run it (python tools/rail_lines_processor.py) to
    regenerate public/data/rail_lines.geojson.  Without re-running, the
    runtime RailSpeedIndex will find no speed data and fall back to curvature
    limits for all segments.
    """
    if not val:
        return None
    val = val.strip()
    # e.g. "75 mph", "125mph"
    m = re.match(r'^(\d+(?:\.\d+)?)\s*mph$', val, re.IGNORECASE)
    if m:
        return round(float(m.group(1)) * 1.60934)
    # e.g. "160", "200" — plain number means km/h per OSM spec
    m = re.match(r'^(\d+(?:\.\d+)?)$', val)
    if m:
        return round(float(m.group(1)))
    return None


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
    print("Querying Overpass API for UK rail + metro lines …")
    print("(This may take 1–3 minutes for a full UK download)")

    data = urllib.parse.urlencode({"data": QUERY}).encode()
    raw = None
    last_exc = None
    for url in OVERPASS_URLS:
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "high-speed-too/1.0 (rail_lines_processor)",
            },
        )
        try:
            print(f"  Trying endpoint: {url}")
            with urllib.request.urlopen(req, timeout=360) as resp:
                raw = resp.read()
            break
        except Exception as exc:
            last_exc = exc
            print(f"  Endpoint failed: {exc}", file=sys.stderr)

    if raw is None:
        print(f"ERROR downloading from Overpass: {last_exc}", file=sys.stderr)
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
        # Resolve maxspeed from multiple possible tag names
        maxspeed_raw = tags.get("maxspeed") or tags.get("maxspeed:railway") or tags.get("railway:maxspeed")
        maxspeed_kmh = parse_maxspeed_kmh(maxspeed_raw)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": simplified},
                "properties": {
                    "railway": tags.get("railway", ""),
                    "tunnel": tags.get("tunnel") == "yes",
                    "bridge": tags.get("bridge") == "yes",
                    "usage": tags.get("usage", ""),
                    "maxspeed": maxspeed_kmh,          # int km/h or null
                    "electrified": tags.get("electrified", ""),  # "rail", "contact_line", "4th_rail", "no", ""
                    "voltage": tags.get("voltage", ""),           # "750", "25000", etc.
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
