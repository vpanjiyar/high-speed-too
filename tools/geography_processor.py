"""
Geography Processor for High Speed Too.

Downloads ONS boundary files (LSOA/MSOA polygons) and simplifies them
into TopoJSON for efficient browser rendering.

Usage:
    python geography_processor.py --output ../public/data/geography/

Requirements:
    pip install geopandas topojson requests shapely
"""

import argparse
import json
import os
from pathlib import Path
from zipfile import ZipFile

import geopandas as gpd
import requests
import topojson

# ONS LSOA boundaries (generalised/clipped to coastline)
LSOA_URL = (
    "https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/"
    "4bfcd8af6b0d4568b3e7e4e746b3e9b0/geojson?layers=0"
)

# ONS MSOA boundaries (generalised/clipped)
MSOA_URL = (
    "https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/"
    "1dfd2b3d2c204e65b8e2c8c31fc8c3a2/geojson?layers=0"
)

# Fallback: simpler boundary file
LSOA_SHAPEFILE_URL = (
    "https://geoportal.statistics.gov.uk/datasets/"
    "da831f80764346889837c72508f046fa_0.zip"
)


def download_file(url: str, dest: Path, label: str) -> Path:
    """Download a file if it doesn't already exist."""
    if dest.exists():
        print(f"  {label}: already downloaded")
        return dest

    print(f"  {label}: downloading...")
    resp = requests.get(url, stream=True, timeout=600)
    resp.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"  {label}: saved to {dest}")
    return dest


def process_boundaries(cache_dir: Path, tolerance: float = 0.001):  # returns GeoDataFrame or dict
    """Download and simplify LSOA boundary polygons."""
    print("\n[1/2] Downloading boundary data...")

    geojson_path = cache_dir / "lsoa_boundaries.geojson"

    try:
        download_file(LSOA_URL, geojson_path, "LSOA GeoJSON")
        gdf = gpd.read_file(geojson_path)
    except Exception as e:
        print(f"  Warning: GeoJSON download failed ({e}), trying shapefile...")
        zip_path = cache_dir / "lsoa_boundaries.zip"
        try:
            download_file(LSOA_SHAPEFILE_URL, zip_path, "LSOA Shapefile")
            with ZipFile(zip_path) as zf:
                zf.extractall(cache_dir / "lsoa_shp")
            shp_files = list((cache_dir / "lsoa_shp").glob("*.shp"))
            if not shp_files:
                raise FileNotFoundError("No .shp file found in archive")
            gdf = gpd.read_file(shp_files[0])
        except Exception as e2:
            print(f"  Error: Could not load boundaries: {e2}")
            print("  Generating placeholder boundaries.")
            return _placeholder_topojson()

    print(f"  Loaded {len(gdf)} boundary polygons")

    # Ensure WGS84
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        print("  Reprojecting to WGS84...")
        gdf = gdf.to_crs(epsg=4326)

    # Simplify geometry
    print(f"  Simplifying with tolerance={tolerance}...")
    gdf["geometry"] = gdf["geometry"].simplify(tolerance, preserve_topology=True)

    # Standardise column names
    code_col = None
    name_col = None
    for col in gdf.columns:
        cl = col.lower()
        if "lsoa" in cl and "cd" in cl:
            code_col = col
        elif "lsoa" in cl and "nm" in cl:
            name_col = col

    if code_col:
        gdf = gdf.rename(columns={code_col: "code"})
    if name_col:
        gdf = gdf.rename(columns={name_col: "name"})

    # Keep only essential columns
    keep = [c for c in ["code", "name", "geometry"] if c in gdf.columns]
    gdf = gdf[keep]

    return gdf


def to_topojson(gdf, quantization: int = 100_000) -> dict:
    """Convert GeoDataFrame to TopoJSON dict."""
    print("\n[2/2] Converting to TopoJSON...")
    tp = topojson.Topology(gdf, toposimplify=0.0001, quantization=int(quantization))
    return json.loads(tp.to_json())


def _placeholder_topojson() -> dict:
    """Return minimal placeholder TopoJSON if real data can't be loaded."""
    return {
        "type": "Topology",
        "objects": {
            "regions": {
                "type": "GeometryCollection",
                "geometries": [],
            }
        },
        "arcs": [],
    }


def main():
    parser = argparse.ArgumentParser(
        description="Process ONS boundary files into TopoJSON"
    )
    parser.add_argument(
        "--output",
        default="../public/data/geography/",
        help="Output directory",
    )
    parser.add_argument(
        "--cache",
        default=".cache/geography/",
        help="Cache directory for raw downloads",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.001,
        help="Simplification tolerance in degrees (~100m)",
    )
    args = parser.parse_args()

    output_dir = Path(args.output)
    cache_dir = Path(args.cache)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    print("=== Geography Processor ===")

    result = process_boundaries(cache_dir, args.tolerance)

    if isinstance(result, dict):
        # Already a TopoJSON dict (placeholder)
        topo = result
    else:
        topo = to_topojson(result)

    output_path = output_dir / "boundaries.topojson"
    with open(output_path, "w") as f:
        json.dump(topo, f, separators=(",", ":"))

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\n✓ Output: {output_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
