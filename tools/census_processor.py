#!/usr/bin/env python3
"""
Census Processor — downloads ONS Census 2021 LSOA and MSOA population data
from the NOMIS API and outputs JSON files suitable for use as map overlays.

Run:
    python tools/census_processor.py

Re-run any time to refresh from the latest NOMIS release.

Output:
    public/data/lsoa_census.json  — JSON object keyed by LSOA code
    public/data/msoa_census.json  — JSON object keyed by MSOA code
        {
          "E01000001": { "pop": 1473, "work_pop": 976 },
          ...
        }
        "pop"      = total usual residents (all ages)
        "work_pop" = working-age population (15–64, groups 4–13 from TS007a)

Data sources:
    NM_2021_1 (TS001) — total usual residents
    NM_2020_1 (TS007a) — age by 5-year groups (summed for 15–64)
    Licence: Open Government Licence v3.0
    https://www.nomisweb.co.uk/sources/census_2021
"""

import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────────────────────

NOMIS_API = "https://www.nomisweb.co.uk/api/v01/dataset"

# NM_2021_1: Census 2021 TS001 "Number of usual residents"
#   Filter C2021_RESTYPE_3=0 → Total: All usual residents
DS_TOTAL   = "NM_2021_1"
FILTER_TOT = "C2021_RESTYPE_3=0"

# NM_2020_1: Census 2021 TS007a "Age by 5-year groups"
#   Age codes 4–13 cover ages 15–19 through 60–64 (≈ working-age population)
#   Code 4=15-19, 5=20-24, 6=25-29, 7=30-34, 8=35-39, 9=40-44,
#        10=45-49, 11=50-54, 12=55-59, 13=60-64
DS_AGE     = "NM_2020_1"
FILTER_AGE = "C2021_AGE_19=4,5,6,7,8,9,10,11,12,13"

# Geography type codes
TYPE_LSOA = "TYPE151"   # 2021 Lower Layer Super Output Areas
TYPE_MSOA = "TYPE152"   # 2021 Middle Layer Super Output Areas

DATA_DIR     = Path(__file__).parent.parent / "public" / "data"
LSOA_OUT     = DATA_DIR / "lsoa_census.json"
MSOA_OUT     = DATA_DIR / "msoa_census.json"

PAGE_SIZE = 25000   # NOMIS maximum rows per request


# ── Download helpers ──────────────────────────────────────────────────────────

def _get(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "high-speed-too/census-processor (github.com)"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def fetch_total_pop(geo_type: str) -> dict[str, int]:
    """Fetch total usual residents for all areas of geo_type (TYPE151 or TYPE152)."""
    base_url = (
        f"{NOMIS_API}/{DS_TOTAL}.data.csv"
        f"?geography={geo_type}"
        f"&{FILTER_TOT}"
        f"&measures=20100"
        f"&select=GEOGRAPHY_CODE,OBS_VALUE"
        f"&recordlimit={PAGE_SIZE}"
    )
    out: dict[str, int] = {}
    offset = 0
    while True:
        url = base_url + f"&recordoffset={offset}"
        print(f"  total_pop offset={offset} ...", flush=True)
        raw = _get(url)
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        rows = list(reader)
        if not rows:
            break
        for row in rows:
            code = row.get("GEOGRAPHY_CODE", "").strip().strip('"')
            val  = row.get("OBS_VALUE", "").strip().strip('"')
            if code and val:
                try:
                    out[code] = int(float(val))
                except ValueError:
                    pass
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.3)
    return out


def fetch_working_age(geo_type: str) -> dict[str, int]:
    """Fetch working-age population (ages 15–64) by summing TS007a groups 4–13."""
    base_url = (
        f"{NOMIS_API}/{DS_AGE}.data.csv"
        f"?geography={geo_type}"
        f"&{FILTER_AGE}"
        f"&measures=20100"
        f"&select=GEOGRAPHY_CODE,OBS_VALUE"
        f"&recordlimit={PAGE_SIZE}"
    )
    accum: dict[str, int] = {}
    offset = 0
    while True:
        url = base_url + f"&recordoffset={offset}"
        print(f"  working_age offset={offset} ...", flush=True)
        raw = _get(url)
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        rows = list(reader)
        if not rows:
            break
        for row in rows:
            code = row.get("GEOGRAPHY_CODE", "").strip().strip('"')
            val  = row.get("OBS_VALUE", "").strip().strip('"')
            if code and val:
                try:
                    accum[code] = accum.get(code, 0) + int(float(val))
                except ValueError:
                    pass
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.3)
    return accum


# ── Main ──────────────────────────────────────────────────────────────────────

def _merge_and_write(total: dict[str, int], working: dict[str, int],
                     output: Path, label: str) -> None:
    all_codes = set(total) | set(working)
    merged: dict[str, dict[str, int]] = {}
    for code in sorted(all_codes):
        entry: dict[str, int] = {}
        if code in total:
            entry["pop"] = total[code]
        if code in working:
            entry["work_pop"] = working[code]
        merged[code] = entry
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(merged, f, separators=(",", ":"))
    size_kb = output.stat().st_size / 1024
    print(f"Written {len(merged):,} {label} records → {output} ({size_kb:.0f} KB)")


def main() -> None:
    print("=== Census Processor (ONS Census 2021 via NOMIS) ===\n")

    print("── LSOA (TYPE151) ───────────────────────────────────")
    print("Fetching total population ...")
    lsoa_tot = fetch_total_pop(TYPE_LSOA)
    print(f"  → {len(lsoa_tot):,} LSOAs")
    print("Fetching working-age population (ages 15–64) ...")
    lsoa_age = fetch_working_age(TYPE_LSOA)
    print(f"  → {len(lsoa_age):,} LSOAs")
    _merge_and_write(lsoa_tot, lsoa_age, LSOA_OUT, "LSOA")

    print()
    print("── MSOA (TYPE152) ───────────────────────────────────")
    print("Fetching total population ...")
    msoa_tot = fetch_total_pop(TYPE_MSOA)
    print(f"  → {len(msoa_tot):,} MSOAs")
    print("Fetching working-age population (ages 15–64) ...")
    msoa_age = fetch_working_age(TYPE_MSOA)
    print(f"  → {len(msoa_age):,} MSOAs")
    _merge_and_write(msoa_tot, msoa_age, MSOA_OUT, "MSOA")

    print("\n=== Done ===")
    print("Next step: run geography_processor.py --merge-census to embed")
    print("population data into the boundary GeoJSON files.")


if __name__ == "__main__":
    main()
