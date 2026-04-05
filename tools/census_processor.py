"""
Census Data Processor for High Speed Too.

Downloads ONS Census 2021 LSOA-level population data and travel-to-work
origin-destination matrices from NOMIS. Outputs compressed JSON for the game.

Usage:
    python census_processor.py --output ../public/data/census/

Requirements:
    pip install requests pandas
"""

import argparse
import json
import os
from pathlib import Path

import pandas as pd
import requests

# ONS Census 2021 population estimates by LSOA (England & Wales)
# Bulk download URL from NOMIS
POPULATION_URL = (
    "https://www.nomisweb.co.uk/api/v01/dataset/NM_2021_1.bulk.csv?"
    "time=2021&measures=20100&geography=TYPE150"
)

# Travel to work OD data (Census 2021 table WU03EW)
# This is a large file — origin-destination flows by LSOA
OD_URL = (
    "https://www.nomisweb.co.uk/api/v01/dataset/NM_2100_1.bulk.csv?"
    "time=2021&measures=20100"
)

# LSOA centroids (population weighted)
CENTROIDS_URL = (
    "https://geoportal.statistics.gov.uk/datasets/"
    "b7c49538f0464f748dd7137247bbc41c_0.csv"
)


def download_file(url: str, dest: Path, label: str) -> Path:
    """Download a file if it doesn't already exist."""
    if dest.exists():
        print(f"  {label}: already downloaded ({dest})")
        return dest

    print(f"  {label}: downloading...")
    resp = requests.get(url, stream=True, timeout=300)
    resp.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"  {label}: saved to {dest}")
    return dest


def process_population(cache_dir: Path) -> dict:
    """Download and process LSOA population data."""
    print("\n[1/3] Processing population data...")

    csv_path = cache_dir / "population_raw.csv"

    try:
        download_file(POPULATION_URL, csv_path, "Population CSV")
        df = pd.read_csv(csv_path, low_memory=False)
    except Exception as e:
        print(f"  Warning: Could not download population data: {e}")
        print("  Using fallback placeholder data.")
        return {}

    zones = {}
    for _, row in df.iterrows():
        code = str(row.get("GEOGRAPHY_CODE", row.get("geography_code", "")))
        if not code.startswith("E0") and not code.startswith("W0"):
            continue
        name = str(row.get("GEOGRAPHY_NAME", row.get("geography_name", code)))
        pop = int(row.get("OBS_VALUE", row.get("obs_value", 0)))
        zones[code] = {
            "code": code,
            "name": name,
            "population": pop,
            "workingPopulation": int(pop * 0.65),  # rough estimate
            "centroid": {"lat": 0, "lon": 0},  # filled in later
        }

    print(f"  Loaded {len(zones)} zones")
    return zones


def process_centroids(zones: dict, cache_dir: Path) -> dict:
    """Add centroids to zone data."""
    print("\n[2/3] Processing LSOA centroids...")

    csv_path = cache_dir / "centroids_raw.csv"

    try:
        download_file(CENTROIDS_URL, csv_path, "Centroids CSV")
        df = pd.read_csv(csv_path, low_memory=False)
    except Exception as e:
        print(f"  Warning: Could not download centroids: {e}")
        return zones

    for _, row in df.iterrows():
        code = str(row.get("LSOA21CD", row.get("lsoa21cd", "")))
        if code in zones:
            lat = float(row.get("Y", row.get("y", row.get("LAT", 0))))
            lon = float(row.get("X", row.get("x", row.get("LONG", 0))))
            zones[code]["centroid"] = {"lat": lat, "lon": lon}

    return zones


def process_od_flows(cache_dir: Path, max_flows: int = 50000) -> list:
    """Download and process origin-destination commute flows."""
    print("\n[3/3] Processing OD flow data...")

    csv_path = cache_dir / "od_flows_raw.csv"

    try:
        download_file(OD_URL, csv_path, "OD flows CSV")
        df = pd.read_csv(csv_path, low_memory=False, nrows=max_flows * 10)
    except Exception as e:
        print(f"  Warning: Could not download OD flows: {e}")
        print("  Using empty flow data.")
        return []

    flows = []
    for _, row in df.iterrows():
        origin = str(row.get("GEOGRAPHY_CODE", row.get("geography_code", "")))
        dest = str(
            row.get("GEOGRAPHY_CODE_DEST", row.get("geography_code_dest", ""))
        )
        count = int(row.get("OBS_VALUE", row.get("obs_value", 0)))
        if count < 5:
            continue  # Skip very small flows
        flows.append(
            {"originCode": origin, "destinationCode": dest, "count": count}
        )

    # Sort by count descending, take top N
    flows.sort(key=lambda x: x["count"], reverse=True)
    flows = flows[:max_flows]

    print(f"  Retained {len(flows)} OD flows")
    return flows


def main():
    parser = argparse.ArgumentParser(description="Process ONS Census 2021 data")
    parser.add_argument(
        "--output",
        default="../public/data/census/",
        help="Output directory for processed data",
    )
    parser.add_argument(
        "--cache",
        default=".cache/census/",
        help="Cache directory for raw downloads",
    )
    args = parser.parse_args()

    output_dir = Path(args.output)
    cache_dir = Path(args.cache)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    print("=== Census Data Processor ===")

    zones = process_population(cache_dir)
    zones = process_centroids(zones, cache_dir)
    flows = process_od_flows(cache_dir)

    result = {"zones": zones, "odFlows": flows}

    output_path = output_dir / "census.json"
    with open(output_path, "w") as f:
        json.dump(result, f, separators=(",", ":"))

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\n✓ Output: {output_path} ({size_mb:.1f} MB)")
    print(f"  Zones: {len(zones)}, OD flows: {len(flows)}")


if __name__ == "__main__":
    main()
