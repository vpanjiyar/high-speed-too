"""
OSM Processor for High Speed Too.

Extracts simplified coastline, major roads, rivers, and rail lines from
a UK OpenStreetMap PBF extract. Outputs as TopoJSON line geometry.

Usage:
    python osm_processor.py --output ../public/data/osm/

Requirements:
    pip install geopandas topojson requests pyrosm
    (pyrosm requires a PBF file — download from Geofabrik)

If pyrosm is not available, falls back to downloading a pre-processed
GeoJSON of UK features.
"""

import argparse
import json
import os
from pathlib import Path

import requests

GEOFABRIK_UK_URL = (
    "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf"
)

# Fallback: Natural Earth simplified data
COASTLINE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_110m_coastline.geojson"
)


def try_pyrosm(cache_dir: Path):
    """Try to use pyrosm to extract features from PBF."""
    try:
        import pyrosm
    except ImportError:
        print("  pyrosm not installed — using fallback data")
        return None

    pbf_path = cache_dir / "great-britain-latest.osm.pbf"
    if not pbf_path.exists():
        print("  PBF file not found. Download it manually from Geofabrik:")
        print(f"    {GEOFABRIK_UK_URL}")
        print(f"    Save to: {pbf_path}")
        return None

    print("  Loading PBF with pyrosm...")
    osm = pyrosm.OSM(str(pbf_path))

    features = []

    # Railways
    print("  Extracting railways...")
    try:
        railways = osm.get_data_by_custom_criteria(
            custom_filter={"railway": ["rail", "light_rail", "subway", "tram"]},
            osm_keys_to_keep=["railway", "name"],
        )
        if railways is not None:
            railways = railways.to_crs(epsg=4326)
            railways["geometry"] = railways["geometry"].simplify(0.001)
            for _, row in railways.iterrows():
                coords = list(row.geometry.coords)
                features.append(
                    {
                        "type": "rail",
                        "coordinates": [[round(c[0], 4), round(c[1], 4)] for c in coords],
                    }
                )
    except Exception as e:
        print(f"  Warning: Railway extraction failed: {e}")

    # Motorways
    print("  Extracting motorways...")
    try:
        roads = osm.get_data_by_custom_criteria(
            custom_filter={"highway": ["motorway"]},
            osm_keys_to_keep=["highway", "name", "ref"],
        )
        if roads is not None:
            roads = roads.to_crs(epsg=4326)
            roads["geometry"] = roads["geometry"].simplify(0.001)
            for _, row in roads.iterrows():
                coords = list(row.geometry.coords)
                features.append(
                    {
                        "type": "motorway",
                        "coordinates": [[round(c[0], 4), round(c[1], 4)] for c in coords],
                    }
                )
    except Exception as e:
        print(f"  Warning: Road extraction failed: {e}")

    return features


def download_fallback_coastline(cache_dir: Path) -> list:
    """Download simplified Natural Earth coastline as fallback."""
    print("  Downloading Natural Earth coastline...")
    cache_path = cache_dir / "coastline.geojson"

    if not cache_path.exists():
        resp = requests.get(COASTLINE_URL, timeout=120)
        resp.raise_for_status()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w") as f:
            f.write(resp.text)

    with open(cache_path) as f:
        geojson = json.load(f)

    features = []
    for feature in geojson.get("features", []):
        coords = feature["geometry"]["coordinates"]
        # Filter to rough UK area
        uk_coords = [
            c
            for c in coords
            if -8 < c[0] < 2 and 49 < c[1] < 61
        ]
        if len(uk_coords) > 2:
            features.append(
                {
                    "type": "coastline",
                    "coordinates": [[round(c[0], 4), round(c[1], 4)] for c in uk_coords],
                }
            )

    return features


def features_to_topojson(features: list) -> dict:
    """Convert feature list to a simple TopoJSON-like structure."""
    # For simplicity, output as a flat GeoJSON wrapped in TopoJSON-like structure
    # A proper TopoJSON conversion would use the topojson library
    try:
        import geopandas as gpd
        import topojson
        from shapely.geometry import LineString

        geometries = []
        properties = []
        for f in features:
            if len(f["coordinates"]) >= 2:
                try:
                    geom = LineString(f["coordinates"])
                    geometries.append(geom)
                    properties.append({"type": f["type"]})
                except Exception:
                    continue

        if not geometries:
            return {"type": "Topology", "objects": {}, "arcs": []}

        gdf = gpd.GeoDataFrame(properties, geometry=geometries, crs="EPSG:4326")
        tp = topojson.Topology(gdf, quantization=int(1e5))
        return json.loads(tp.to_json())
    except ImportError:
        # Fallback: output as simple GeoJSON-like structure
        geojson_features = []
        for f in features:
            if len(f["coordinates"]) >= 2:
                geojson_features.append(
                    {
                        "type": "Feature",
                        "properties": {"type": f["type"]},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": f["coordinates"],
                        },
                    }
                )

        return {
            "type": "Topology",
            "objects": {
                "basemap": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {
                            "type": "LineString",
                            "properties": feat["properties"],
                            "coordinates": feat["geometry"]["coordinates"],
                        }
                        for feat in geojson_features
                    ],
                }
            },
            "arcs": [],
        }


def main():
    parser = argparse.ArgumentParser(
        description="Extract UK basemap from OpenStreetMap"
    )
    parser.add_argument(
        "--output", default="../public/data/osm/", help="Output directory"
    )
    parser.add_argument(
        "--cache", default=".cache/osm/", help="Cache directory"
    )
    args = parser.parse_args()

    output_dir = Path(args.output)
    cache_dir = Path(args.cache)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    print("=== OSM Processor ===")

    # Try pyrosm first, fall back to Natural Earth
    features = try_pyrosm(cache_dir)
    if features is None:
        features = download_fallback_coastline(cache_dir)

    print(f"\n  Total features: {len(features)}")

    topo = features_to_topojson(features)

    output_path = output_dir / "basemap.topojson"
    with open(output_path, "w") as f:
        json.dump(topo, f, separators=(",", ":"))

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\n✓ Output: {output_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
