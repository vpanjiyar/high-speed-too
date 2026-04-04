"""
High Speed Too — Geography Processor

Downloads and simplifies UK boundary files for rendering in-game:
  1. LSOA/MSOA boundary polygons (simplified for performance)
  2. Country/region outlines
  3. Coastline and major features

Outputs GeoJSON files optimised for Godot rendering.

Data sources:
  - ONS Open Geography Portal (OGL v3.0)
  - OpenStreetMap coastline (ODbL)

Usage:
    python geography_processor.py [--output-dir ../data/geography]
"""

import argparse
import json
import gzip
import math
import os
from pathlib import Path

from tqdm import tqdm


OUTPUT_DIR = Path(__file__).parent.parent / "data" / "geography"

# Simplified UK outline coordinates (WGS84 lon/lat)
# Used as fallback and for coastline rendering
UK_OUTLINE = {
    "great_britain": [
        # Simplified Great Britain outline — ~50 points
        (-5.71, 50.07),  # Land's End area
        (-5.05, 50.05),  # Lizard Point
        (-4.23, 50.35),  # Plymouth
        (-3.55, 50.22),  # Tor Bay
        (-3.07, 50.68),  # Exeter area
        (-2.44, 50.62),  # Weymouth
        (-1.30, 50.77),  # Southampton
        (-1.15, 50.73),  # Isle of Wight area
        (-0.78, 50.76),  # Brighton
        (0.27, 50.75),   # Hastings
        (1.00, 51.08),   # Dover area
        (1.44, 51.38),   # Margate
        (1.18, 51.73),   # Essex coast
        (0.96, 51.81),   # Foulness
        (1.28, 52.08),   # Suffolk coast
        (1.75, 52.48),   # Lowestoft
        (1.60, 52.93),   # Norfolk coast
        (0.33, 53.13),   # The Wash
        (0.05, 53.50),   # Humber
        (-0.08, 53.71),  # Bridlington
        (-0.77, 54.56),  # Scarborough / Whitby
        (-1.15, 54.63),  # Middlesbrough
        (-1.42, 55.00),  # Sunderland
        (-1.60, 55.28),  # Newcastle
        (-1.59, 55.68),  # Berwick
        (-2.14, 56.12),  # Edinburgh area
        (-2.47, 56.71),  # Dundee
        (-1.79, 57.50),  # Aberdeen area
        (-2.07, 57.70),  # Peterhead
        (-3.38, 58.45),  # Wick
        (-3.07, 58.63),  # Duncansby Head
        (-5.00, 58.52),  # N coast
        (-5.30, 58.25),  # NW Scotland
        (-5.73, 57.88),  # Ullapool
        (-5.65, 57.31),  # Wester Ross
        (-5.83, 56.82),  # Skye area
        (-5.67, 56.50),  # Fort William
        (-6.22, 56.30),  # Mull area
        (-5.40, 55.90),  # Kintyre
        (-4.95, 55.77),  # Arran
        (-4.88, 55.50),  # Ayrshire
        (-4.57, 55.06),  # Galloway
        (-3.43, 54.85),  # Dumfries
        (-3.06, 54.70),  # Carlisle area
        (-3.22, 54.10),  # Barrow
        (-3.03, 53.43),  # Liverpool
        (-3.08, 53.27),  # Chester
        (-3.10, 52.78),  # Shrewsbury area
        (-3.18, 51.78),  # S Wales
        (-3.37, 51.61),  # Cardiff area
        (-4.10, 51.60),  # Swansea
        (-4.75, 51.68),  # Pembroke
        (-5.10, 51.83),  # St David's
        (-4.65, 52.10),  # Cardigan
        (-4.06, 52.55),  # Aberystwyth
        (-4.32, 52.87),  # Barmouth
        (-4.40, 53.10),  # Snowdonia
        (-4.16, 53.22),  # Bangor
        (-3.80, 53.32),  # Great Orme
        (-3.42, 53.35),  # Rhyl
        (-3.03, 53.43),  # back toward Liverpool
        (-2.70, 53.48),  # Warrington
        (-3.03, 53.27),  # Chester (closing Welsh loop via sea)
        (-5.71, 50.07),  # close polygon via sea (simplified)
    ],
    "northern_ireland": [
        (-5.43, 55.24),
        (-5.87, 54.60),
        (-6.63, 54.18),
        (-7.33, 54.12),
        (-7.64, 54.23),
        (-8.17, 54.47),
        (-7.88, 55.04),
        (-7.45, 55.17),
        (-6.84, 55.17),
        (-6.15, 55.34),
        (-5.43, 55.24),
    ],
}

# Major UK cities with approximate positions
UK_CITIES = [
    {"name": "London", "lon": -0.1276, "lat": 51.5074, "pop": 8_800_000},
    {"name": "Birmingham", "lon": -1.8904, "lat": 52.4862, "pop": 1_140_000},
    {"name": "Manchester", "lon": -2.2426, "lat": 53.4808, "pop": 550_000},
    {"name": "Leeds", "lon": -1.5491, "lat": 53.8008, "pop": 810_000},
    {"name": "Glasgow", "lon": -4.2518, "lat": 55.8642, "pop": 635_000},
    {"name": "Liverpool", "lon": -2.9916, "lat": 53.4084, "pop": 490_000},
    {"name": "Bristol", "lon": -2.5879, "lat": 51.4545, "pop": 470_000},
    {"name": "Sheffield", "lon": -1.4701, "lat": 53.3811, "pop": 580_000},
    {"name": "Edinburgh", "lon": -3.1883, "lat": 55.9533, "pop": 525_000},
    {"name": "Cardiff", "lon": -3.1791, "lat": 51.4816, "pop": 370_000},
    {"name": "Newcastle", "lon": -1.6178, "lat": 54.9783, "pop": 300_000},
    {"name": "Nottingham", "lon": -1.1581, "lat": 52.9548, "pop": 330_000},
    {"name": "Leicester", "lon": -1.1332, "lat": 52.6369, "pop": 370_000},
    {"name": "Coventry", "lon": -1.5197, "lat": 52.4068, "pop": 370_000},
    {"name": "Bradford", "lon": -1.7594, "lat": 53.7960, "pop": 540_000},
    {"name": "Belfast", "lon": -5.9301, "lat": 54.5973, "pop": 340_000},
    {"name": "Stoke-on-Trent", "lon": -2.1753, "lat": 53.0027, "pop": 260_000},
    {"name": "Wolverhampton", "lon": -2.1247, "lat": 52.5870, "pop": 260_000},
    {"name": "Plymouth", "lon": -4.1427, "lat": 50.3755, "pop": 265_000},
    {"name": "Southampton", "lon": -1.4044, "lat": 50.9097, "pop": 255_000},
    {"name": "Reading", "lon": -0.9781, "lat": 51.4543, "pop": 230_000},
    {"name": "Derby", "lon": -1.4746, "lat": 52.9225, "pop": 250_000},
    {"name": "Swansea", "lon": -3.9436, "lat": 51.6214, "pop": 240_000},
    {"name": "Aberdeen", "lon": -2.0943, "lat": 57.1497, "pop": 230_000},
    {"name": "Dundee", "lon": -2.9707, "lat": 56.4620, "pop": 150_000},
    {"name": "Oxford", "lon": -1.2578, "lat": 51.7520, "pop": 155_000},
    {"name": "Cambridge", "lon": 0.1218, "lat": 52.2053, "pop": 145_000},
    {"name": "York", "lon": -1.0873, "lat": 53.9591, "pop": 210_000},
    {"name": "Brighton", "lon": -0.1373, "lat": 50.8225, "pop": 290_000},
    {"name": "Milton Keynes", "lon": -0.7594, "lat": 52.0406, "pop": 250_000},
]

# UK regions for coarse rendering at low zoom
UK_REGIONS = [
    "North East", "North West", "Yorkshire and The Humber",
    "East Midlands", "West Midlands", "East of England",
    "London", "South East", "South West",
    "Wales", "Scotland", "Northern Ireland",
]


def lonlat_to_game_coords(lon: float, lat: float) -> tuple[float, float]:
    """
    Convert WGS84 lon/lat to game coordinate space.

    Game coordinates:
      x = longitude * 100 (west is negative)
      y = -latitude * 100 (north is up, but screen Y goes down)

    This gives roughly correct proportions for the UK.
    """
    return (lon * 100.0, -lat * 100.0)


def generate_uk_regions_json(output_dir: Path) -> None:
    """Generate the UK regions GeoJSON file for the game."""
    print("Generating UK geography data...")

    features = []

    # Great Britain outline
    gb_coords = [lonlat_to_game_coords(lon, lat) for lon, lat in UK_OUTLINE["great_britain"]]
    features.append({
        "type": "outline",
        "name": "Great Britain",
        "coordinates": gb_coords,
    })

    # Northern Ireland outline
    ni_coords = [lonlat_to_game_coords(lon, lat) for lon, lat in UK_OUTLINE["northern_ireland"]]
    features.append({
        "type": "outline",
        "name": "Northern Ireland",
        "coordinates": ni_coords,
    })

    # City markers
    for city in UK_CITIES:
        x, y = lonlat_to_game_coords(city["lon"], city["lat"])
        features.append({
            "type": "city",
            "name": city["name"],
            "x": round(x, 1),
            "y": round(y, 1),
            "population": city["pop"],
        })

    # Write output
    output_file = output_dir / "uk_regions.json"
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump({
            "source": "built-in",
            "projection": "lonlat_x100_yneg",
            "description": (
                "Simplified UK geography for High Speed Too. "
                "Replace with detailed ONS boundary data for production."
            ),
            "features": features,
        }, f, indent=2)

    print(f"  Written {len(features)} features → {output_file}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Process UK geography data for High Speed Too"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="Output directory for geography files",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("High Speed Too — Geography Processor")
    print("=" * 60)

    generate_uk_regions_json(args.output_dir)

    print("\n✓ Geography processing complete.")
    print(f"  Output: {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
