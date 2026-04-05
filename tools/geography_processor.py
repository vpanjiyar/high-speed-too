#!/usr/bin/env python3
"""
Geography Processor — downloads ONS Census 2021 LSOA and MSOA boundary files
from the ONS Open Geography Portal, simplifies geometry with
Ramer-Douglas-Peucker, optionally merges census population data, and outputs
GeoJSON files for use as map overlays.

Run (boundaries only):
    python tools/geography_processor.py

Run (with census data merged in — run census_processor.py first):
    python tools/geography_processor.py --merge-census

Requirements:
    pip install shapely       (optional but recommended — ~10x faster simplification)

Output:
    public/data/lsoa_boundaries.geojson  — simplified LSOA polygons for city zoom
    public/data/msoa_boundaries.geojson  — simplified MSOA polygons for regional zoom

    When --merge-census is used, each LSOA feature gains:
        "pop"      — total usual residents
        "work_pop" — working-age population (16–64)
        "area_ha"  — polygon area in hectares (for density calculation)

Data source:
    ONS Open Geography Portal — Generalised Clipped boundaries
    Licence: Open Government Licence v3.0
    https://geoportal.statistics.gov.uk/
"""

import json
import math
import sys
import urllib.request
from pathlib import Path
from typing import Any

# ── Configuration ─────────────────────────────────────────────────────────────

# ONS Hub direct GeoJSON downloads — confirmed working, no auth required.
# LSOA Dec 2021 BGC (Boundary Generalised Clipped) England & Wales
LSOA_DOWNLOAD_URL = (
    "https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/"
    "b976e08d5c894df3901963469bd4f84f/geojson?layers=0"
)
# MSOA Dec 2021 BGC England & Wales
MSOA_DOWNLOAD_URL = (
    "https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/"
    "833747fa0a9f4fdc8344c98ff14c83d6/geojson?layers=0"
)

# Additional simplification tolerance (degrees) applied on top of the BGC
# pre-simplification. Use smaller values for higher fidelity.
SIMPLIFY_TOLERANCE_LSOA = 0.0002   # ~20 m
SIMPLIFY_TOLERANCE_MSOA = 0.0001   # ~10 m

DATA_DIR      = Path(__file__).parent.parent / "public" / "data"
LSOA_CENSUS   = DATA_DIR / "lsoa_census.json"
MSOA_CENSUS   = DATA_DIR / "msoa_census.json"
LSOA_OUT      = DATA_DIR / "lsoa_boundaries.geojson"
MSOA_OUT      = DATA_DIR / "msoa_boundaries.geojson"


# ── HTTP helper ───────────────────────────────────────────────────────────────

def _get_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "high-speed-too/geography-processor (github.com)"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ── ONS Hub bulk GeoJSON download ─────────────────────────────────────────────

def download_geojson(url: str) -> list[dict]:
    """Download a full GeoJSON FeatureCollection from the ONS Hub API."""
    print(f"  GET {url[:80]} ...", flush=True)
    data = _get_json(url)
    features = data.get("features") or []
    print(f"  Downloaded {len(features):,} features")
    return features


# ── Pure-Python RDP geometry simplification ───────────────────────────────────

def _pt_line_dist(px: float, py: float,
                  ax: float, ay: float,
                  bx: float, by: float) -> float:
    """Perpendicular distance from point (px,py) to segment (ax,ay)-(bx,by)."""
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    return math.hypot(ax + t * dx - px, ay + t * dy - py)


def _rdp(pts: list, eps: float) -> list:
    """Ramer-Douglas-Peucker point reduction."""
    if len(pts) < 3:
        return pts
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = _pt_line_dist(pts[i][0], pts[i][1],
                          pts[0][0], pts[0][1],
                          pts[-1][0], pts[-1][1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return _rdp(pts[:idx + 1], eps)[:-1] + _rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def _simplify_ring(ring: list, eps: float) -> list:
    simplified = _rdp(ring, eps)
    # A valid polygon ring needs at least 4 points (first == last)
    if len(simplified) < 4:
        return ring
    return simplified


def simplify_geometry_rdp(geometry: dict, tolerance: float) -> dict:
    """Apply RDP simplification to a GeoJSON geometry dict."""
    gtype = geometry.get("type", "")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon":
        geometry["coordinates"] = [_simplify_ring(r, tolerance) for r in coords]
    elif gtype == "MultiPolygon":
        geometry["coordinates"] = [
            [_simplify_ring(r, tolerance) for r in poly]
            for poly in coords
        ]
    return geometry


def simplify_geometry(geometry: dict, tolerance: float) -> dict:
    """Use shapely if available (preserve_topology=True), else fall back to RDP."""
    try:
        from shapely.geometry import shape, mapping  # type: ignore
        geom = shape(geometry)
        simplified = geom.simplify(tolerance, preserve_topology=True)
        return dict(mapping(simplified))
    except ImportError:
        return simplify_geometry_rdp(geometry, tolerance)


# ── Area calculation ──────────────────────────────────────────────────────────

def _polygon_area_ha(coords_wgs84: list) -> float:
    """
    Approximate area in hectares for a polygon ring in WGS-84 (lon/lat).
    Uses the Shoelace formula in metres via a simple equirectangular projection.
    Accurate to ~1% for areas up to county-scale.
    """
    if not coords_wgs84:
        return 0.0
    # Use the centroid latitude for the projection scale factor
    lats = [p[1] for p in coords_wgs84]
    lat0 = math.radians(sum(lats) / len(lats))
    R = 6_371_000.0  # Earth radius in metres
    ra = R * math.cos(lat0)   # radius in lon direction

    area = 0.0
    n = len(coords_wgs84)
    for i in range(n):
        x0 = math.radians(coords_wgs84[i][0]) * ra
        y0 = math.radians(coords_wgs84[i][1]) * R
        x1 = math.radians(coords_wgs84[(i + 1) % n][0]) * ra
        y1 = math.radians(coords_wgs84[(i + 1) % n][1]) * R
        area += x0 * y1 - x1 * y0

    return abs(area) / 2.0 / 10_000.0   # m² → hectares


def geometry_area_ha(geometry: dict) -> float:
    """Return approximate area in hectares for a Polygon or MultiPolygon."""
    gtype = geometry.get("type", "")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon" and coords:
        return _polygon_area_ha(coords[0])   # use outer ring
    if gtype == "MultiPolygon":
        return sum(_polygon_area_ha(poly[0]) for poly in coords if poly)
    return 0.0


# ── Process one boundary type ─────────────────────────────────────────────────

def process_boundaries(
    download_url: str,
    code_field: str,
    name_field: str,
    simplify_tolerance: float,
    census_data: dict[str, dict] | None,
    output_path: Path,
    label: str,
    add_area: bool = False,
) -> None:
    print(f"\n{'='*60}")
    print(f"Fetching {label} boundaries ...")
    features = download_geojson(download_url)
    print(f"Downloaded {len(features):,} {label} features")

    print(f"Simplifying geometry (tolerance={simplify_tolerance}) ...")
    out_features: list[dict] = []
    skipped = 0

    for feat in features:
        props = feat.get("properties") or {}
        code  = props.get(code_field, "").strip()
        name  = props.get(name_field, "").strip()
        geom  = feat.get("geometry")

        if not geom or not code:
            skipped += 1
            continue

        simplified_geom = simplify_geometry(geom, simplify_tolerance)

        out_props: dict[str, Any] = {"code": code, "name": name}

        if add_area:
            out_props["area_ha"] = round(geometry_area_ha(simplified_geom), 2)

        if census_data and code in census_data:
            out_props.update(census_data[code])

        out_features.append({
            "type":       "Feature",
            "geometry":   simplified_geom,
            "properties": out_props,
        })

    if skipped:
        print(f"  Skipped {skipped} features with missing code or geometry")

    geojson = {"type": "FeatureCollection", "features": out_features}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_mb = output_path.stat().st_size / 1_048_576
    print(f"Written {len(out_features):,} features → {output_path} ({size_mb:.1f} MB)")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    merge_census = "--merge-census" in sys.argv

    lsoa_census: dict[str, dict] | None = None
    msoa_census: dict[str, dict] | None = None
    if merge_census:
        if not LSOA_CENSUS.exists():
            print(f"ERROR: {LSOA_CENSUS} not found.")
            print("Run  python tools/census_processor.py  first.")
            sys.exit(1)
        print(f"Loading LSOA census data from {LSOA_CENSUS} ...")
        with open(LSOA_CENSUS, encoding="utf-8") as f:
            lsoa_census = json.load(f)
        print(f"  Loaded {len(lsoa_census):,} LSOA records")

        if MSOA_CENSUS.exists():
            print(f"Loading MSOA census data from {MSOA_CENSUS} ...")
            with open(MSOA_CENSUS, encoding="utf-8") as f:
                msoa_census = json.load(f)
            print(f"  Loaded {len(msoa_census):,} MSOA records")

    print("=== Geography Processor (ONS Open Geography Portal) ===")

    process_boundaries(
        download_url=LSOA_DOWNLOAD_URL,
        code_field="LSOA21CD",
        name_field="LSOA21NM",
        simplify_tolerance=SIMPLIFY_TOLERANCE_LSOA,
        census_data=lsoa_census,
        output_path=LSOA_OUT,
        label="LSOA",
        add_area=True,
    )

    process_boundaries(
        download_url=MSOA_DOWNLOAD_URL,
        code_field="MSOA21CD",
        name_field="MSOA21NM",
        simplify_tolerance=SIMPLIFY_TOLERANCE_MSOA,
        census_data=msoa_census,
        output_path=MSOA_OUT,
        label="MSOA",
        add_area=True,
    )

    print("\n=== Done ===")
    if not merge_census:
        print("Tip: run with --merge-census to embed population data.")
        print("     (requires running census_processor.py first)")


if __name__ == "__main__":
    main()
