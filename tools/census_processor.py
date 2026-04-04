"""
High Speed Too — Census Data Processor

Downloads and processes ONS Census 2021 data for England & Wales:
  1. LSOA-level population counts
  2. Travel-to-work origin-destination flows (MSOA level)
  3. Workplace population estimates

Outputs compressed JSON files ready for the Godot game to load.

Data sources (all Open Government Licence v3.0):
  - NOMIS: https://www.nomisweb.co.uk/sources/census_2021
  - ONS Open Geography: https://geoportal.statistics.gov.uk/

Usage:
    python census_processor.py [--output-dir ../data/census]
"""

import argparse
import json
import gzip
import os
import sys
from pathlib import Path

import pandas as pd
import requests
from tqdm import tqdm


# ── Constants ──────────────────────────────────────────────────────────

OUTPUT_DIR = Path(__file__).parent.parent / "data" / "census"

# NOMIS API base
NOMIS_API = "https://www.nomisweb.co.uk/api/v01"

# Census 2021 table IDs on NOMIS
# TS007 — Age by single year (total population)
# TS061 — Method of travel to work
POPULATION_TABLE = "NM_2021_1"  # Census 2021 Total Population by LSOA

# ONS bulk download for travel-to-work OD data (MSOA level)
OD_DATA_URL = (
    "https://www.nomisweb.co.uk/output/census/2021/"
    "census2021-ts061-msoa.zip"
)

# Simpler: use Census 2021 population estimates by LSOA from ONS
LSOA_POPULATION_URL = (
    "https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/"
    "populationandmigration/populationestimates/datasets/"
    "lowersuperoutputareamidyearpopulationestimates/"
    "mid2021sape23dt2/sape23dt2mid2021lsoasyoaestimatesunformatted.xlsx"
)

# Alternative: Census 2021 LSOA population from NOMIS bulk data
CENSUS_LSOA_POP_URL = (
    "https://www.nomisweb.co.uk/output/census/2021/"
    "census2021-ts001-lsoa.zip"
)

# Census 2021 Origin-Destination (workplace) data — MSOA level
# This provides commuter flows: home MSOA → workplace MSOA
CENSUS_OD_URL = (
    "https://wicid.ukdataservice.ac.uk/flowdata/cider/wicid/downloads/"
    "2021/safeguarded/odwp01ew_msoa.zip"
)


def download_file(url: str, dest: Path, desc: str = "") -> Path:
    """Download a file with progress bar, skip if already exists."""
    if dest.exists():
        print(f"  [skip] {dest.name} already exists")
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  Downloading {desc or dest.name}...")

    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length", 0))

    with open(dest, "wb") as f:
        with tqdm(total=total, unit="B", unit_scale=True, desc=dest.name) as pbar:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                pbar.update(len(chunk))

    return dest


def generate_synthetic_population(output_dir: Path) -> None:
    """
    Generate synthetic LSOA population data based on known census totals.

    When the full census download isn't available (e.g. first run without
    network access), this creates a plausible dataset using known stats:
    - England & Wales: ~59.6M people across ~33,755 LSOAs
    - Average LSOA population: ~1,750 (range 1,000–3,000+)

    This is a FALLBACK — the real data pipeline should replace this.
    """
    import random

    print("Generating synthetic LSOA population data...")

    # Known major MSOAs with approximate populations for key cities
    # This gives a realistic spatial distribution
    city_populations = {
        # city: (approx total pop, num_lsoas, centroid_lon, centroid_lat)
        "London": (8_800_000, 4994, -0.12, 51.51),
        "Birmingham": (1_140_000, 639, -1.90, 52.48),
        "Manchester": (550_000, 282, -2.24, 53.48),
        "Leeds": (810_000, 482, -1.55, 53.80),
        "Glasgow": (635_000, 351, -4.25, 55.86),
        "Liverpool": (490_000, 281, -2.98, 53.41),
        "Bristol": (470_000, 264, -2.58, 51.45),
        "Sheffield": (580_000, 329, -1.47, 53.38),
        "Edinburgh": (525_000, 286, -3.19, 55.95),
        "Cardiff": (370_000, 214, -3.18, 51.48),
        "Newcastle": (300_000, 169, -1.61, 54.98),
        "Nottingham": (330_000, 184, -1.15, 52.95),
        "Leicester": (370_000, 195, -1.13, 52.63),
        "Coventry": (370_000, 189, -1.51, 52.41),
        "Bradford": (540_000, 305, -1.75, 53.79),
    }

    lsoa_data = []
    random.seed(42)  # Reproducible

    lsoa_id = 0
    for city, (pop, num_lsoas, lon, lat) in city_populations.items():
        avg_pop = pop // num_lsoas
        for i in range(num_lsoas):
            lsoa_id += 1
            # Jitter position within city area (~0.1 degrees ≈ 10km)
            jlon = lon + random.gauss(0, 0.08)
            jlat = lat + random.gauss(0, 0.06)
            # Vary population around average
            lpop = max(500, int(random.gauss(avg_pop, avg_pop * 0.3)))

            lsoa_data.append({
                "code": f"E0{lsoa_id:07d}",
                "name": f"{city} {i+1:04d}",
                "population": lpop,
                "lon": round(jlon, 4),
                "lat": round(jlat, 4),
                "working_pop": int(lpop * random.uniform(0.45, 0.65)),
            })

    # Fill remaining LSOAs for smaller towns / rural areas
    # England & Wales has ~33,755 LSOAs total
    remaining = 33755 - lsoa_id

    # Distribute remaining across England & Wales grid
    for i in range(remaining):
        lsoa_id += 1
        lon = random.uniform(-5.5, 1.8)
        lat = random.uniform(50.0, 55.8)
        lpop = max(300, int(random.gauss(1500, 600)))

        lsoa_data.append({
            "code": f"E0{lsoa_id:07d}",
            "name": f"Rural {lsoa_id}",
            "population": lpop,
            "lon": round(lon, 4),
            "lat": round(lat, 4),
            "working_pop": int(lpop * random.uniform(0.40, 0.60)),
        })

    # Write output
    output_file = output_dir / "lsoa_population.json.gz"
    output_dir.mkdir(parents=True, exist_ok=True)

    with gzip.open(output_file, "wt", encoding="utf-8") as f:
        json.dump({
            "source": "synthetic",
            "description": "Synthetic LSOA population data — replace with real ONS Census 2021 data",
            "total_population": sum(l["population"] for l in lsoa_data),
            "lsoa_count": len(lsoa_data),
            "lsoas": lsoa_data,
        }, f)

    total_pop = sum(l["population"] for l in lsoa_data)
    print(f"  Written {len(lsoa_data)} LSOAs, total pop {total_pop:,} → {output_file}")


def generate_synthetic_od_matrix(output_dir: Path) -> None:
    """
    Generate a synthetic origin-destination commuter matrix.

    Real data comes from Census 2021 workplace destination data (MSOA level).
    This fallback creates plausible commute patterns where:
    - Most people work near home (distance decay)
    - Big cities attract workers from surrounding areas
    - Some long-distance commuting to London
    """
    import random

    print("Generating synthetic OD commuter matrix...")

    # Load LSOA data to get positions
    pop_file = output_dir / "lsoa_population.json.gz"
    if not pop_file.exists():
        print("  [error] Run population generation first")
        return

    with gzip.open(pop_file, "rt", encoding="utf-8") as f:
        pop_data = json.load(f)

    lsoas = pop_data["lsoas"]

    # For OD matrix, use simplified gravity model
    # Group into ~500 zones (cluster nearby LSOAs) for tractability
    # Each zone = ~60 LSOAs
    zone_size = max(1, len(lsoas) // 500)
    zones = []
    for i in range(0, len(lsoas), zone_size):
        chunk = lsoas[i:i + zone_size]
        zone = {
            "id": len(zones),
            "lsoa_codes": [l["code"] for l in chunk],
            "population": sum(l["population"] for l in chunk),
            "working_pop": sum(l["working_pop"] for l in chunk),
            "lon": sum(l["lon"] for l in chunk) / len(chunk),
            "lat": sum(l["lat"] for l in chunk) / len(chunk),
        }
        zones.append(zone)

    # Build OD flows using gravity model
    # flow(i→j) = k * working_pop_i * jobs_j / distance_ij^2
    random.seed(42)
    od_flows = []
    total_flows = 0

    for origin in tqdm(zones, desc="Building OD matrix"):
        if origin["working_pop"] == 0:
            continue

        # Calculate attraction to each destination
        attractions = []
        for dest in zones:
            if dest["population"] == 0:
                continue
            dx = (origin["lon"] - dest["lon"]) * 70  # rough km conversion
            dy = (origin["lat"] - dest["lat"]) * 111
            dist_km = max(1.0, (dx * dx + dy * dy) ** 0.5)

            # Gravity: jobs * decay(distance)
            # Strong decay: most people work locally
            attraction = dest["population"] * (1.0 / (1.0 + (dist_km / 10.0) ** 2))
            attractions.append((dest["id"], attraction))

        # Normalize and sample flows
        total_attr = sum(a for _, a in attractions)
        if total_attr == 0:
            continue

        workers = origin["working_pop"]
        for dest_id, attr in attractions:
            flow = int(workers * attr / total_attr)
            if flow > 0:
                od_flows.append({
                    "o": origin["id"],
                    "d": dest_id,
                    "flow": flow,
                })
                total_flows += flow

    # Write output
    output_file = output_dir / "od_matrix.json.gz"
    with gzip.open(output_file, "wt", encoding="utf-8") as f:
        json.dump({
            "source": "synthetic",
            "description": "Synthetic OD commuter matrix — replace with real Census 2021 data",
            "zone_count": len(zones),
            "total_flows": total_flows,
            "zones": zones,
            "flows": od_flows,
        }, f)

    print(f"  Written {len(zones)} zones, {len(od_flows)} OD pairs, "
          f"{total_flows:,} total commuters → {output_file}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Process UK Census 2021 data for High Speed Too"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="Output directory for processed data files",
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        default=True,
        help="Generate synthetic data (fallback when real data unavailable)",
    )
    parser.add_argument(
        "--real",
        action="store_true",
        help="Download and process real ONS data (requires internet)",
    )
    args = parser.parse_args()

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("High Speed Too — Census Data Processor")
    print("=" * 60)

    if args.real:
        print("\n[!] Real data download not yet implemented.")
        print("    The data pipeline structure is ready for when you add")
        print("    real ONS Census 2021 API integration.")
        print("    For now, using synthetic data.\n")

    print("\n→ Phase 1: Population data")
    generate_synthetic_population(output_dir)

    print("\n→ Phase 2: Origin-Destination commuter matrix")
    generate_synthetic_od_matrix(output_dir)

    print("\n✓ Census data processing complete.")
    print(f"  Output: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
