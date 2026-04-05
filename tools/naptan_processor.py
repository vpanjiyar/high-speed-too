#!/usr/bin/env python3
"""
NaPTAN Processor — downloads the NaPTAN bulk dataset from DfT and extracts
UK rail and metro/LRT stations into public/data/stations.geojson.

Run:
    python tools/naptan_processor.py

Re-run any time to refresh station data from the latest NaPTAN release.

Output:
    public/data/stations.geojson  — GeoJSON FeatureCollection, one point per station
        Properties: name, stopType (RLY | MET), atco, locality

Data source:
    NaPTAN (National Public Transport Access Nodes) — Department for Transport
    Licence: Open Government Licence v3.0
    URL: https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv
"""

import csv
import io
import json
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────────────────────

NAPTAN_URL = "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv"

# StopTypes to include:
#   RLY = Railway station entrance/exit (one or a few per mainline station)
#   MET = Metro, underground, light rail station entrance/exit
#   TMU = Tram / Metro / Underground stopping point
INCLUDED_STOP_TYPES = {"RLY", "MET", "TMU"}

OUTPUT_PATH = Path(__file__).parent.parent / "public" / "data" / "stations.geojson"


# ── Download ──────────────────────────────────────────────────────────────────

def download_naptan_zip() -> bytes:
    """Download the NaPTAN bulk CSV (or ZIP) from DfT and return raw bytes."""
    print(f"Downloading NaPTAN data from {NAPTAN_URL} ...")
    req = urllib.request.Request(
        NAPTAN_URL,
        headers={"User-Agent": "high-speed-too/naptan-processor (github.com)"},
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        data = response.read()
    print(f"  Downloaded {len(data) / 1_000_000:.1f} MB")
    return data


# ── Parse ─────────────────────────────────────────────────────────────────────

def parse_stops(data: bytes) -> list[dict]:
    """Parse stops from either a ZIP (containing Stops.csv) or a plain CSV blob."""
    # Try ZIP first
    if data[:2] == b'PK':
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            stops_name = next(
                (n for n in zf.namelist() if n.lower().endswith("stops.csv")),
                None,
            )
            if not stops_name:
                print("ERROR: Could not find Stops.csv in the ZIP. Files found:")
                for name in zf.namelist():
                    print(f"  {name}")
                sys.exit(1)
            print(f"  Parsing {stops_name} from ZIP ...")
            with zf.open(stops_name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                rows = list(reader)
    else:
        # Plain CSV response
        print("  Parsing CSV response directly ...")
        text = data.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)

    print(f"  Total NaPTAN stops: {len(rows):,}")

    filtered = [
        r for r in rows
        if r.get("StopType", "").strip() in INCLUDED_STOP_TYPES
        and r.get("Status", "").strip().lower() == "active"
        and r.get("Latitude", "").strip()
        and r.get("Longitude", "").strip()
    ]
    print(f"  Active RLY/MET stops before deduplication: {len(filtered):,}")
    return filtered


# ── Deduplicate ───────────────────────────────────────────────────────────────

def deduplicate(stops: list[dict]) -> list[dict]:
    """
    One station can have several entrance/exit stops (e.g. London Paddington
    might appear as PADTONM, PADTONE, PADTONW).  Deduplicate by
    (CommonName, LocalityName, StopType); keep the averaged lat/lon.
    """
    groups: dict[tuple, list[dict]] = {}
    for stop in stops:
        key = (
            stop.get("CommonName", "").strip().lower(),
            stop.get("LocalityName", "").strip().lower(),
            stop.get("StopType", "").strip(),
        )
        groups.setdefault(key, []).append(stop)

    result = []
    for key, group in groups.items():
        lats = [float(s["Latitude"]) for s in group if s.get("Latitude")]
        lons = [float(s["Longitude"]) for s in group if s.get("Longitude")]
        if not lats:
            continue
        representative = group[0]
        result.append({
            "name": representative.get("CommonName", "").strip(),
            "stopType": representative.get("StopType", "").strip(),
            "atco": representative.get("ATCOCode", "").strip(),
            "locality": representative.get("LocalityName", "").strip(),
            "lat": sum(lats) / len(lats),
            "lon": sum(lons) / len(lons),
        })

    return result


# ── Output ────────────────────────────────────────────────────────────────────

def to_geojson(stations: list[dict]) -> dict:
    features = []
    for s in stations:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(s["lon"], 6), round(s["lat"], 6)],
            },
            "properties": {
                "name": s["name"],
                "stopType": s["stopType"],
                "atco": s["atco"],
                "locality": s["locality"],
            },
        })
    return {"type": "FeatureCollection", "features": features}


def write_output(geojson: dict) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"\nWrote {len(geojson['features']):,} stations → {OUTPUT_PATH}  ({size_kb:.0f} KB)")


# ── Summary ───────────────────────────────────────────────────────────────────

def print_summary(stations: list[dict]) -> None:
    by_type: dict[str, int] = {}
    for s in stations:
        by_type[s["stopType"]] = by_type.get(s["stopType"], 0) + 1
    print("\nStation breakdown:")
    labels = {"RLY": "Mainline rail (RLY)", "MET": "Metro / LRT   (MET)"}
    for stop_type, count in sorted(by_type.items()):
        print(f"  {labels.get(stop_type, stop_type):<28} {count:>5,}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("NaPTAN Rail & Metro Station Processor")
    print("=" * 60)

    zip_bytes = download_naptan_zip()
    stops = parse_stops(zip_bytes)
    stations = deduplicate(stops)

    print(f"  After deduplication:                 {len(stations):,}")
    print_summary(stations)

    geojson = to_geojson(stations)
    write_output(geojson)

    print("\nDone. Re-run any time to refresh from the latest NaPTAN release.")


if __name__ == "__main__":
    main()
