"""
High Speed Too — Run All Data Processors

Convenience script to run all data pipeline processors in order.

Usage:
    python run_pipeline.py
"""

import subprocess
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).parent


def run(script: str) -> None:
    print(f"\n{'='*60}")
    print(f"Running {script}...")
    print(f"{'='*60}\n")

    result = subprocess.run(
        [sys.executable, str(TOOLS_DIR / script)],
        cwd=str(TOOLS_DIR),
    )

    if result.returncode != 0:
        print(f"\n[ERROR] {script} failed with code {result.returncode}")
        sys.exit(1)


def main() -> None:
    print("╔══════════════════════════════════════════════╗")
    print("║  High Speed Too — Data Pipeline              ║")
    print("║  Generating game data from UK open datasets   ║")
    print("╚══════════════════════════════════════════════╝")

    run("geography_processor.py")
    run("census_processor.py")
    run("naptan_processor.py")

    print("\n" + "=" * 60)
    print("✓ All data processing complete!")
    print("  Output files in: ../data/")
    print("=" * 60)


if __name__ == "__main__":
    main()
