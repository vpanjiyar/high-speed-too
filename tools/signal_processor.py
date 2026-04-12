#!/usr/bin/env python3
"""
Signal Processor
================
Downloads railway signal positions from OpenStreetMap (Overpass API) for the
GB rail network and outputs a GeoJSON file for use by SignalSystem.

Usage:
    python tools/signal_processor.py

Output:
    public/data/signals.geojson
"""

import json
import sys
import urllib.request
import urllib.error

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Query for railway signals in Great Britain (rough bbox)
OVERPASS_QUERY = """
[out:json][timeout:120];
(
  node["railway"="signal"](49.5,-8.5,61.0,2.0);
);
out body;
"""


def fetch_signals() -> list[dict]:
    """Fetch railway signal nodes from Overpass API."""
    data = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8")
    req = urllib.request.Request(OVERPASS_URL, data=data, method="POST")
    req.add_header("User-Agent", "high-speed-too/signal-processor")

    print("Fetching signals from Overpass API...")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        print(f"Error fetching from Overpass: {e}", file=sys.stderr)
        sys.exit(1)

    elements = result.get("elements", [])
    print(f"  Received {len(elements)} signal nodes")
    return elements


def to_geojson(elements: list[dict]) -> dict:
    """Convert Overpass elements to GeoJSON FeatureCollection."""
    features = []
    for el in elements:
        if el.get("type") != "node":
            continue
        lat = el.get("lat")
        lon = el.get("lon")
        if lat is None or lon is None:
            continue

        tags = el.get("tags", {})
        props = {
            "osm_id": el["id"],
            "signal_type": tags.get("railway:signal:main", tags.get("railway:signal:distant", "")),
            "direction": tags.get("railway:signal:direction", ""),
            "ref": tags.get("ref", ""),
        }

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat],
            },
            "properties": props,
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def main():
    elements = fetch_signals()
    geojson = to_geojson(elements)

    out_path = "public/data/signals.geojson"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))

    print(f"Wrote {len(geojson['features'])} signals to {out_path}")


if __name__ == "__main__":
    import urllib.parse
    main()
