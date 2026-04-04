"""
High Speed Too — NaPTAN Processor

Downloads and processes the National Public Transport Access Nodes dataset.
NaPTAN contains every public transport stop/station in Great Britain.

Extracts:
  - Bus stops
  - Rail stations
  - Tram/metro stops
  - Underground stations

Outputs a compressed JSON file for reference display in-game.

Data source: Department for Transport (OGL v3.0)
  https://beta-naptan.dft.gov.uk/

Usage:
    python naptan_processor.py [--output-dir ../data/naptan]
"""

import argparse
import csv
import gzip
import io
import json
import os
import zipfile
from pathlib import Path

import requests
from tqdm import tqdm


OUTPUT_DIR = Path(__file__).parent.parent / "data" / "naptan"

# NaPTAN download URL (CSV format)
NAPTAN_CSV_URL = "https://beta-naptan.dft.gov.uk/Download/National/csv"

# Stop type codes we care about
STOP_TYPES = {
    "BCT": "bus",       # Bus/Coach stop on street
    "BCS": "bus",       # Bus/Coach station bay
    "BCE": "bus",       # Bus/Coach station entrance
    "BST": "bus",       # Bus/Coach station access area
    "RSE": "rail",      # Rail station entrance
    "RLY": "rail",      # Rail platform
    "MET": "metro",     # Metro/Underground station
    "PLT": "tram",      # Tram/Light rail platform
    "TMU": "tram",      # Tram/Metro/Underground
}


def download_naptan(output_dir: Path) -> Path:
    """Download the NaPTAN CSV dataset."""
    dest = output_dir / "naptan_raw.csv"
    if dest.exists():
        print(f"  [skip] {dest.name} already exists")
        return dest

    output_dir.mkdir(parents=True, exist_ok=True)
    print("  Downloading NaPTAN dataset...")

    try:
        resp = requests.get(NAPTAN_CSV_URL, stream=True, timeout=120)
        resp.raise_for_status()

        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

        print(f"  Downloaded → {dest}")
    except Exception as e:
        print(f"  [warn] Could not download NaPTAN: {e}")
        print("  Generating synthetic stop data instead...")
        return generate_synthetic_stops(output_dir)

    return dest


def generate_synthetic_stops(output_dir: Path) -> Path:
    """Generate synthetic stop data as fallback."""
    import random

    random.seed(42)
    print("  Generating synthetic NaPTAN data...")

    # Major stations with real coordinates
    rail_stations = [
        ("London Euston", -0.1335, 51.5284),
        ("London King's Cross", -0.1240, 51.5320),
        ("London Paddington", -0.1763, 51.5154),
        ("London Victoria", -0.1445, 51.4952),
        ("London Waterloo", -0.1134, 51.5033),
        ("London Liverpool Street", -0.0813, 51.5178),
        ("Birmingham New Street", -1.9000, 52.4778),
        ("Birmingham Moor Street", -1.8923, 52.4791),
        ("Manchester Piccadilly", -2.2310, 53.4774),
        ("Manchester Victoria", -2.2427, 53.4870),
        ("Leeds", -1.5473, 53.7953),
        ("Glasgow Central", -4.2580, 55.8590),
        ("Glasgow Queen Street", -4.2520, 55.8626),
        ("Edinburgh Waverley", -3.1903, 55.9523),
        ("Liverpool Lime Street", -2.9778, 53.4075),
        ("Bristol Temple Meads", -2.5814, 51.4494),
        ("Sheffield", -1.4625, 53.3782),
        ("Newcastle Central", -1.6174, 54.9683),
        ("Cardiff Central", -3.1793, 51.4752),
        ("Nottingham", -1.1474, 52.9472),
        ("Leicester", -1.1250, 52.6319),
        ("Coventry", -1.5148, 52.4003),
        ("Reading", -0.9718, 51.4589),
        ("Oxford", -1.2696, 51.7536),
        ("Cambridge", 0.1371, 52.1943),
        ("York", -1.0932, 53.9580),
        ("Crewe", -2.4323, 53.0887),
        ("Preston", -2.7087, 53.7563),
        ("Peterborough", -0.2499, 52.5747),
        ("Milton Keynes Central", -0.7747, 52.0339),
        ("Wolverhampton", -2.1199, 52.5880),
        ("Stoke-on-Trent", -2.1749, 53.0063),
        ("Derby", -1.4630, 52.9163),
        ("Plymouth", -4.1430, 50.3716),
        ("Southampton Central", -1.4134, 50.9072),
        ("Brighton", -0.1413, 50.8292),
        ("Aberdeen", -2.0987, 57.1434),
        ("Dundee", -2.9710, 56.4563),
        ("Swansea", -3.9419, 51.6232),
        ("Belfast Central", -5.9271, 54.5958),
    ]

    stops = []
    stop_id = 0

    # Add rail stations
    for name, lon, lat in rail_stations:
        stop_id += 1
        stops.append({
            "id": f"9100{stop_id:05d}",
            "name": name,
            "type": "rail",
            "lon": lon,
            "lat": lat,
        })

    # Generate metro stops for London, Glasgow, Newcastle
    metro_cities = [
        ("London", -0.12, 51.51, 270),  # ~270 tube stations
        ("Glasgow", -4.25, 55.86, 15),
        ("Newcastle", -1.62, 54.97, 60),  # Tyne & Wear Metro
    ]

    for city, clon, clat, count in metro_cities:
        for i in range(count):
            stop_id += 1
            stops.append({
                "id": f"9400{stop_id:05d}",
                "name": f"{city} Metro {i+1}",
                "type": "metro",
                "lon": round(clon + random.gauss(0, 0.06), 4),
                "lat": round(clat + random.gauss(0, 0.04), 4),
            })

    # Generate tram stops
    tram_cities = [
        ("Manchester Metrolink", -2.24, 53.48, 99),
        ("West Midlands Metro", -1.90, 52.49, 37),
        ("Sheffield Supertram", -1.47, 53.38, 48),
        ("Nottingham NET", -1.15, 52.95, 51),
        ("Edinburgh Trams", -3.19, 55.95, 15),
        ("Blackpool Tramway", -3.04, 53.82, 38),
        ("London Tramlink", -0.05, 51.38, 39),
    ]

    for name, clon, clat, count in tram_cities:
        for i in range(count):
            stop_id += 1
            stops.append({
                "id": f"9300{stop_id:05d}",
                "name": f"{name} {i+1}",
                "type": "tram",
                "lon": round(clon + random.gauss(0, 0.03), 4),
                "lat": round(clat + random.gauss(0, 0.02), 4),
            })

    # Generate bus stops — major cities only (real NaPTAN has ~400k)
    bus_cities = [
        ("London", -0.12, 51.51, 2000),
        ("Birmingham", -1.89, 52.49, 500),
        ("Manchester", -2.24, 53.48, 400),
        ("Leeds", -1.55, 53.80, 350),
        ("Glasgow", -4.25, 55.86, 350),
        ("Liverpool", -2.98, 53.41, 300),
        ("Bristol", -2.59, 51.45, 300),
        ("Sheffield", -1.47, 53.38, 300),
        ("Edinburgh", -3.19, 55.95, 300),
        ("Newcastle", -1.62, 54.98, 250),
    ]

    for city, clon, clat, count in bus_cities:
        for i in range(count):
            stop_id += 1
            stops.append({
                "id": f"0100{stop_id:06d}",
                "name": f"{city} Bus {i+1}",
                "type": "bus",
                "lon": round(clon + random.gauss(0, 0.05), 4),
                "lat": round(clat + random.gauss(0, 0.04), 4),
            })

    # Write processed output
    output_file = output_dir / "stops.json.gz"
    with gzip.open(output_file, "wt", encoding="utf-8") as f:
        json.dump({
            "source": "synthetic",
            "description": "Synthetic NaPTAN data — replace with real DfT data",
            "stop_count": len(stops),
            "stops": stops,
        }, f)

    type_counts = {}
    for s in stops:
        type_counts[s["type"]] = type_counts.get(s["type"], 0) + 1

    print(f"  Written {len(stops)} stops → {output_file}")
    for t, c in sorted(type_counts.items()):
        print(f"    {t}: {c}")

    return output_file


def process_naptan_csv(csv_path: Path, output_dir: Path) -> None:
    """Process downloaded NaPTAN CSV into game-ready format."""
    print(f"  Processing {csv_path.name}...")

    stops = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            stop_type = row.get("StopType", "")
            if stop_type not in STOP_TYPES:
                continue

            try:
                lon = float(row.get("Longitude", 0))
                lat = float(row.get("Latitude", 0))
            except (ValueError, TypeError):
                continue

            if lon == 0 and lat == 0:
                continue

            stops.append({
                "id": row.get("ATCOCode", ""),
                "name": row.get("CommonName", "Unknown"),
                "type": STOP_TYPES[stop_type],
                "lon": round(lon, 4),
                "lat": round(lat, 4),
            })

    # Write processed output
    output_file = output_dir / "stops.json.gz"
    with gzip.open(output_file, "wt", encoding="utf-8") as f:
        json.dump({
            "source": "NaPTAN",
            "description": "UK public transport stops from NaPTAN (DfT)",
            "stop_count": len(stops),
            "stops": stops,
        }, f)

    type_counts = {}
    for s in stops:
        type_counts[s["type"]] = type_counts.get(s["type"], 0) + 1

    print(f"  Written {len(stops)} stops → {output_file}")
    for t, c in sorted(type_counts.items()):
        print(f"    {t}: {c}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Process NaPTAN stop data for High Speed Too"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="Output directory for stop data",
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        default=True,
        help="Generate synthetic data (fallback)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("High Speed Too — NaPTAN Processor")
    print("=" * 60)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.synthetic:
        generate_synthetic_stops(args.output_dir)
    else:
        csv_path = download_naptan(args.output_dir)
        if csv_path.suffix == ".csv":
            process_naptan_csv(csv_path, args.output_dir)

    print("\n✓ NaPTAN processing complete.")


if __name__ == "__main__":
    main()
