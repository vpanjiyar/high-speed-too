"""
NaPTAN Processor for High Speed Too.

Downloads the NaPTAN (National Public Transport Access Nodes) dataset
and filters it to essential fields for the game.

Usage:
    python naptan_processor.py --output ../public/data/naptan/

Requirements:
    pip install requests pandas
"""

import argparse
import json
import os
from pathlib import Path

import pandas as pd
import requests

# NaPTAN CSV download (all stops in Great Britain)
NAPTAN_URL = "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv"

# Stop type mapping
STOP_TYPE_MAP = {
    "RSE": "rail",   # Rail station entrance
    "RLY": "rail",   # Railway
    "MET": "metro",  # Metro/Underground
    "PLT": "metro",  # Platform (often metro)
    "TMU": "tram",   # Tram/Metro/Underground
    "BCE": "bus",    # Bus/Coach entrance
    "BCT": "bus",    # Bus/Coach bay/stand
    "BCS": "bus",    # Bus/Coach station
    "BCQ": "bus",    # Bus/Coach variable bay
    "BST": "bus",    # Bus stop
    "FER": "rail",   # Ferry (map to rail for now)
    "GAT": "rail",   # Airport gate (map to rail)
}


def download_naptan(cache_dir: Path) -> Path:
    """Download the NaPTAN CSV file."""
    csv_path = cache_dir / "naptan_raw.csv"
    if csv_path.exists():
        print("  NaPTAN CSV: already downloaded")
        return csv_path

    print("  Downloading NaPTAN data...")
    resp = requests.get(NAPTAN_URL, timeout=300)
    resp.raise_for_status()

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "wb") as f:
        f.write(resp.content)

    print(f"  Saved to {csv_path}")
    return csv_path


def process_stops(csv_path: Path) -> list:
    """Process NaPTAN CSV into filtered stop list."""
    print("  Reading CSV...")
    df = pd.read_csv(csv_path, low_memory=False)

    print(f"  Raw stops: {len(df)}")

    # Identify columns (NaPTAN uses specific column names)
    atco_col = "ATCOCode" if "ATCOCode" in df.columns else "atcoCode"
    name_col = "CommonName" if "CommonName" in df.columns else "commonName"
    lat_col = "Latitude" if "Latitude" in df.columns else "latitude"
    lon_col = "Longitude" if "Longitude" in df.columns else "longitude"
    type_col = "StopType" if "StopType" in df.columns else "stopType"
    indicator_col = (
        "Indicator" if "Indicator" in df.columns else "indicator"
    )
    status_col = "Status" if "Status" in df.columns else "status"

    # Filter to active stops only
    if status_col in df.columns:
        df = df[df[status_col].str.lower().isin(["active", "act"])]

    stops = []
    for _, row in df.iterrows():
        stop_type_raw = str(row.get(type_col, ""))
        stop_type = STOP_TYPE_MAP.get(stop_type_raw)
        if not stop_type:
            continue

        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
        except (ValueError, TypeError):
            continue

        # Skip invalid coordinates
        if lat < 49 or lat > 61 or lon < -8 or lon > 2:
            continue

        stops.append(
            {
                "atcoCode": str(row[atco_col]),
                "name": str(row[name_col]),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "type": stop_type,
                "indicator": str(row.get(indicator_col, ""))
                if pd.notna(row.get(indicator_col))
                else None,
            }
        )

    print(f"  Filtered stops: {len(stops)}")

    # Count by type
    type_counts = {}
    for s in stops:
        type_counts[s["type"]] = type_counts.get(s["type"], 0) + 1
    for t, c in sorted(type_counts.items()):
        print(f"    {t}: {c}")

    return stops


def main():
    parser = argparse.ArgumentParser(description="Process NaPTAN stop data")
    parser.add_argument(
        "--output",
        default="../public/data/naptan/",
        help="Output directory",
    )
    parser.add_argument(
        "--cache",
        default=".cache/naptan/",
        help="Cache directory for raw downloads",
    )
    args = parser.parse_args()

    output_dir = Path(args.output)
    cache_dir = Path(args.cache)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    print("=== NaPTAN Processor ===")

    try:
        csv_path = download_naptan(cache_dir)
        stops = process_stops(csv_path)
    except Exception as e:
        print(f"  Error: {e}")
        print("  Using empty stop list.")
        stops = []

    output_path = output_dir / "stops.json"
    with open(output_path, "w") as f:
        json.dump(stops, f, separators=(",", ":"))

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\n✓ Output: {output_path} ({size_mb:.1f} MB)")
    print(f"  Total stops: {len(stops)}")


if __name__ == "__main__":
    main()
