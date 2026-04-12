#!/usr/bin/env python3
"""
Simplify GeoJSON geometries by rounding coordinates until file size < 25 MiB.

Usage:
  python scripts/simplify_geojson.py public/data/lsoa_boundaries.geojson

This script makes a backup of the original file at `<file>.orig` the first time
it runs. It then tries a series of coordinate precisions (6,5,4,3) and writes
a compact JSON (no extra whitespace). It stops and replaces the original file
on the first precision that produces an output under 25 MiB.
"""
import json
import sys
import os
import shutil
from copy import deepcopy


def is_number(x):
    return isinstance(x, (int, float))


def round_coords_list(coords, ndigits):
    if isinstance(coords, list):
        if coords and all(is_number(el) for el in coords):
            return [round(float(el), ndigits) for el in coords]
        else:
            return [round_coords_list(c, ndigits) for c in coords]
    else:
        return coords


def process_geometry(geom, ndigits):
    if geom is None:
        return
    gtype = geom.get('type')
    if gtype == 'GeometryCollection':
        geoms = geom.get('geometries', [])
        for g in geoms:
            process_geometry(g, ndigits)
    elif 'coordinates' in geom:
        geom['coordinates'] = round_coords_list(geom['coordinates'], ndigits)


def shrink_file(path, ndigits, out_path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    data2 = deepcopy(data)

    if isinstance(data2, dict) and data2.get('type') == 'FeatureCollection' and 'features' in data2:
        for feat in data2['features']:
            geom = feat.get('geometry')
            if geom:
                process_geometry(geom, ndigits)
    elif isinstance(data2, dict) and data2.get('type') == 'Feature':
        geom = data2.get('geometry')
        if geom:
            process_geometry(geom, ndigits)
    elif isinstance(data2, dict) and 'coordinates' in data2:
        process_geometry(data2, ndigits)

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data2, f, separators=(',', ':'), ensure_ascii=False)

    return os.path.getsize(out_path)


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/simplify_geojson.py path/to/file.geojson")
        sys.exit(2)

    in_path = sys.argv[1]
    if not os.path.exists(in_path):
        print("File not found:", in_path)
        sys.exit(1)

    threshold = 25 * 1024 * 1024  # 25 MiB
    precisions = [6, 5, 4, 3]
    backup = in_path + '.orig'
    tmp_template = in_path + '.tmp.{nd}'

    if not os.path.exists(backup):
        shutil.copy2(in_path, backup)
        print("Backed up original to", backup)
    else:
        print("Backup already exists:", backup)

    for nd in precisions:
        out_path = tmp_template.format(nd=nd)
        print(f"Trying rounding to {nd} decimals -> writing {out_path} ...")
        try:
            size = shrink_file(in_path, nd, out_path)
        except Exception as e:
            print("Error while processing:", e)
            if os.path.exists(out_path):
                os.remove(out_path)
            continue

        print("Result size:", size, "bytes")
        if size < threshold:
            shutil.move(out_path, in_path)
            print(f"Success: wrote {in_path} (size {size} bytes) with {nd} decimals.")
            sys.exit(0)
        else:
            os.remove(out_path)
            print(f"Still too large at {size} bytes, trying next precision...")

    print("Could not shrink below 25 MiB with rounding to decimals", precisions)
    print("Consider using mapshaper/topojson for more aggressive simplification.")
    sys.exit(3)


if __name__ == '__main__':
    main()
