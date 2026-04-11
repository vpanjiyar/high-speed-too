#!/usr/bin/env python3
"""
Census Processor — downloads ONS Census 2021 LSOA and MSOA data from the
NOMIS API and outputs JSON files suitable for use as map overlays.

Run:
    python tools/census_processor.py

Re-run any time to refresh from the latest NOMIS release.

Output:
    public/data/lsoa_census.json  — JSON object keyed by LSOA code
    public/data/msoa_census.json  — JSON object keyed by MSOA code

    Each record contains:
      "pop"          — total usual residents (TS001)
      "work_pop"     — working-age population 15–64 (TS007a)
      "no_car"       — households with no car/van (TS045)
      "households"   — total households (TS045)
      "travel_train"  — commuters using train (TS061)
      "travel_bus"    — commuters using bus/coach (TS061)
      "travel_drive"  — commuters driving a car/van (TS061)
      "travel_total"  — total commuters excl. WFH/not working (TS061)
      "econ_active"   — economically active residents (TS066)
      "econ_total"    — total residents 16+ (TS066)
      "elderly"       — residents aged 65+ (TS007a)
      "youth"         — residents aged 16–24 (TS007a)
      "renters"       — households renting (private + social) (TS054)
      "disabled"      — residents with activity-limiting condition (TS038)

Data sources:
    NM_2021_1 (TS001)  — total usual residents
    NM_2020_1 (TS007a) — age by 5-year groups
    NM_2073_1 (TS045)  — car/van availability
    NM_2074_1 (TS061)  — method of travel to work
    NM_2075_1 (TS066)  — economic activity status
    NM_2063_1 (TS054)  — housing tenure
    NM_2059_1 (TS038)  — disability
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


def _fetch_csv_paginated(dataset: str, geo_type: str, filters: str,
                         select: str = "GEOGRAPHY_CODE,OBS_VALUE") -> list[dict]:
    """Generic paginated CSV fetch from the NOMIS API."""
    base_url = (
        f"{NOMIS_API}/{dataset}.data.csv"
        f"?geography={geo_type}"
        f"&{filters}"
        f"&measures=20100"
        f"&select={select}"
        f"&recordlimit={PAGE_SIZE}"
    )
    all_rows: list[dict] = []
    offset = 0
    while True:
        url = base_url + f"&recordoffset={offset}"
        print(f"    offset={offset} ...", flush=True)
        raw = _get(url)
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        rows = list(reader)
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.3)
    return all_rows


def _rows_to_single(rows: list[dict]) -> dict[str, int]:
    """Convert rows to {code: value} — single value per code."""
    out: dict[str, int] = {}
    for row in rows:
        code = row.get("GEOGRAPHY_CODE", "").strip().strip('"')
        val  = row.get("OBS_VALUE", "").strip().strip('"')
        if code and val:
            try:
                out[code] = int(float(val))
            except ValueError:
                pass
    return out


def _rows_to_summed(rows: list[dict]) -> dict[str, int]:
    """Convert rows to {code: sum(values)} — multiple rows per code summed."""
    accum: dict[str, int] = {}
    for row in rows:
        code = row.get("GEOGRAPHY_CODE", "").strip().strip('"')
        val  = row.get("OBS_VALUE", "").strip().strip('"')
        if code and val:
            try:
                accum[code] = accum.get(code, 0) + int(float(val))
            except ValueError:
                pass
    return accum


# ── Dataset fetchers ──────────────────────────────────────────────────────────

def fetch_total_pop(geo_type: str) -> dict[str, int]:
    """TS001: total usual residents."""
    print("  Fetching total population (TS001) ...")
    rows = _fetch_csv_paginated("NM_2021_1", geo_type, "C2021_RESTYPE_3=0")
    return _rows_to_single(rows)


def fetch_working_age(geo_type: str) -> dict[str, int]:
    """TS007a: working-age population (ages 15–64, groups 4–13)."""
    print("  Fetching working-age population (TS007a) ...")
    rows = _fetch_csv_paginated("NM_2020_1", geo_type,
                                "C2021_AGE_19=4,5,6,7,8,9,10,11,12,13")
    return _rows_to_summed(rows)


def fetch_elderly(geo_type: str) -> dict[str, int]:
    """TS007a: elderly population (ages 65+, groups 14–18)."""
    print("  Fetching elderly population 65+ (TS007a) ...")
    rows = _fetch_csv_paginated("NM_2020_1", geo_type,
                                "C2021_AGE_19=14,15,16,17,18")
    return _rows_to_summed(rows)


def fetch_youth(geo_type: str) -> dict[str, int]:
    """TS007a: youth population (ages 16–24, groups 4–5)."""
    print("  Fetching youth population 16–24 (TS007a) ...")
    rows = _fetch_csv_paginated("NM_2020_1", geo_type,
                                "C2021_AGE_19=4,5")
    return _rows_to_summed(rows)


def fetch_car_availability(geo_type: str) -> dict[str, dict[str, int]]:
    """TS045: car/van availability. Returns {code: {no_car, households}}."""
    # Category 1 = no cars/vans, Category 0 = total (all categories)
    print("  Fetching car availability (TS045) ...")
    rows_no_car = _fetch_csv_paginated("NM_2073_1", geo_type,
                                       "C2021_CARS_5=1")
    rows_total = _fetch_csv_paginated("NM_2073_1", geo_type,
                                      "C2021_CARS_5=0")
    no_car = _rows_to_single(rows_no_car)
    total = _rows_to_single(rows_total)
    out: dict[str, dict[str, int]] = {}
    for code in set(no_car) | set(total):
        entry: dict[str, int] = {}
        if code in no_car:
            entry["no_car"] = no_car[code]
        if code in total:
            entry["households"] = total[code]
        out[code] = entry
    return out


def fetch_travel_to_work(geo_type: str) -> dict[str, dict[str, int]]:
    """TS061: method of travel to work.
    Returns {code: {travel_train, travel_bus, travel_drive, travel_total}}.
    Categories: 3=bus/coach, 6=train, 4=driving car/van, 0=total.
    Total (0) includes WFH and not in employment so we sum categories 2–11
    for the denominator of active commuters."""
    print("  Fetching travel to work (TS061) ...")
    # Train (code 6)
    rows_train = _fetch_csv_paginated("NM_2074_1", geo_type,
                                      "C2021_TTWMETH_12=6")
    # Bus/coach (code 3)
    rows_bus = _fetch_csv_paginated("NM_2074_1", geo_type,
                                    "C2021_TTWMETH_12=3")
    # Driving a car/van (code 4)
    rows_drive = _fetch_csv_paginated("NM_2074_1", geo_type,
                                      "C2021_TTWMETH_12=4")
    # Total (code 0): all people aged 16+ in employment or unemployed
    rows_total = _fetch_csv_paginated("NM_2074_1", geo_type,
                                      "C2021_TTWMETH_12=0")

    train = _rows_to_single(rows_train)
    bus = _rows_to_single(rows_bus)
    drive = _rows_to_single(rows_drive)
    total = _rows_to_single(rows_total)

    out: dict[str, dict[str, int]] = {}
    all_codes = set(train) | set(bus) | set(drive) | set(total)
    for code in all_codes:
        entry: dict[str, int] = {}
        if code in train:
            entry["travel_train"] = train[code]
        if code in bus:
            entry["travel_bus"] = bus[code]
        if code in drive:
            entry["travel_drive"] = drive[code]
        if code in total:
            entry["travel_total"] = total[code]
        out[code] = entry
    return out


def fetch_economic_activity(geo_type: str) -> dict[str, dict[str, int]]:
    """TS066: economic activity status.
    Returns {code: {econ_active, econ_total}}.
    Category 0 = total 16+, Category 1 = economically active total."""
    print("  Fetching economic activity (TS066) ...")
    rows_active = _fetch_csv_paginated("NM_2075_1", geo_type,
                                       "C2021_EASTAT_6=1")
    rows_total = _fetch_csv_paginated("NM_2075_1", geo_type,
                                      "C2021_EASTAT_6=0")
    active = _rows_to_single(rows_active)
    total = _rows_to_single(rows_total)
    out: dict[str, dict[str, int]] = {}
    for code in set(active) | set(total):
        entry: dict[str, int] = {}
        if code in active:
            entry["econ_active"] = active[code]
        if code in total:
            entry["econ_total"] = total[code]
        out[code] = entry
    return out


def fetch_tenure(geo_type: str) -> dict[str, dict[str, int]]:
    """TS054: housing tenure — renters (social + private).
    Category 4 = social rented, Category 5 = private rented.
    We also re-use 'households' from TS045 as the denominator."""
    print("  Fetching housing tenure / renters (TS054) ...")
    rows_social = _fetch_csv_paginated("NM_2063_1", geo_type,
                                       "C2021_TENURE_9=4")
    rows_private = _fetch_csv_paginated("NM_2063_1", geo_type,
                                        "C2021_TENURE_9=5")
    social = _rows_to_single(rows_social)
    private = _rows_to_single(rows_private)
    out: dict[str, dict[str, int]] = {}
    for code in set(social) | set(private):
        out[code] = {
            "renters": social.get(code, 0) + private.get(code, 0),
        }
    return out


def fetch_disability(geo_type: str) -> dict[str, int]:
    """TS038: disability (activity-limited a lot + a little).
    Category 2 = limited a lot, Category 3 = limited a little.
    We sum both to get total with some activity limitation."""
    print("  Fetching disability (TS038) ...")
    rows = _fetch_csv_paginated("NM_2059_1", geo_type,
                                "C2021_DISABILITY_4=2,3")
    return _rows_to_summed(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def _merge_and_write(datasets: dict[str, dict], output: Path, label: str) -> None:
    """Merge all dataset dicts into a single JSON file keyed by geography code."""
    # Collect all codes across all datasets
    all_codes: set[str] = set()
    for ds in datasets.values():
        all_codes.update(ds.keys())

    merged: dict[str, dict] = {}
    for code in sorted(all_codes):
        entry: dict[str, int] = {}
        for ds_name, ds_data in datasets.items():
            val = ds_data.get(code)
            if val is None:
                continue
            if isinstance(val, dict):
                entry.update(val)
            else:
                entry[ds_name] = val
        merged[code] = entry

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(merged, f, separators=(",", ":"))
    size_kb = output.stat().st_size / 1024
    print(f"Written {len(merged):,} {label} records → {output} ({size_kb:.0f} KB)")


def _fetch_all(geo_type: str, label: str) -> dict[str, dict]:
    """Fetch all census datasets for a given geography type."""
    print(f"\n── {label} ({geo_type}) ───────────────────────────────────")

    pop = fetch_total_pop(geo_type)
    print(f"    → {len(pop):,} areas")

    work = fetch_working_age(geo_type)
    print(f"    → {len(work):,} areas")

    elderly = fetch_elderly(geo_type)
    print(f"    → {len(elderly):,} areas")

    youth = fetch_youth(geo_type)
    print(f"    → {len(youth):,} areas")

    car = fetch_car_availability(geo_type)
    print(f"    → {len(car):,} areas")

    travel = fetch_travel_to_work(geo_type)
    print(f"    → {len(travel):,} areas")

    econ = fetch_economic_activity(geo_type)
    print(f"    → {len(econ):,} areas")

    tenure = fetch_tenure(geo_type)
    print(f"    → {len(tenure):,} areas")

    disabled = fetch_disability(geo_type)
    print(f"    → {len(disabled):,} areas")

    return {
        "pop": pop,
        "work_pop": work,
        "elderly": elderly,
        "youth": youth,
        "car": car,           # dict of dicts: {no_car, households}
        "travel": travel,     # dict of dicts: {travel_train, travel_bus, ...}
        "econ": econ,         # dict of dicts: {econ_active, econ_total}
        "tenure": tenure,     # dict of dicts: {renters}
        "disabled": disabled,
    }


def main() -> None:
    print("=== Census Processor (ONS Census 2021 via NOMIS) ===")

    lsoa_data = _fetch_all(TYPE_LSOA, "LSOA")
    _merge_and_write(lsoa_data, LSOA_OUT, "LSOA")

    msoa_data = _fetch_all(TYPE_MSOA, "MSOA")
    _merge_and_write(msoa_data, MSOA_OUT, "MSOA")

    print("\n=== Done ===")
    print("Next step: run geography_processor.py --merge-census to embed")
    print("census data into the boundary GeoJSON files.")


if __name__ == "__main__":
    main()
