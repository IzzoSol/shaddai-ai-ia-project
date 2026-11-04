"""
Confirm that ``data/growth_reference.csv`` still matches a fresh digitisation
of the source PNGs.

This is the reproducibility guard for the reference curve: if the digitiser's
logic or the source graphs ever drift, this fails loudly.

Usage:  python tools/check_reference_current.py [--pics DIR]
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(PKG))

import digitize_reference as dg  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pics", default=None,
                    help="directory holding the source graphs (default: the vendored copy)")
    args = ap.parse_args()

    csv_path = PKG / "data" / "growth_reference.csv"
    if not csv_path.exists():
        print(f"FAIL: {csv_path} not found")
        return 1

    with csv_path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    committed = {(r["scenario"], int(r["year"])): r for r in rows}

    graphs = dg.resolve_graphs(Path(args.pics) if args.pics else None)
    for key, p in graphs.items():
        print(f"source graph '{key}': {p}")

    years = list(range(0, 16))

    canopy_img = dg.load_rgb(graphs["canopy"])
    cy_of, cx_of, _ = dg.build_transforms(canopy_img, dg.CANOPY_Y_TICKS)
    carbon_img = dg.load_rgb(graphs["carbon"])
    ry_of, rx_of, _ = dg.build_transforms(carbon_img, dg.CARBON_Y_TICKS)

    worst = 0.0
    mismatches = []
    for name, colour in dg.SERIES.items():
        cm = dg.colour_mask(canopy_img, colour)
        cchain, cdiag = dg.trace_chain(cm, int(round(cx_of(0))), int(round(cx_of(15))))
        canopy = dg.sample_curve(cm, cchain, cx_of, cy_of, years)

        rm = dg.colour_mask(carbon_img, colour)
        rchain, rdiag = dg.trace_chain(rm, int(round(rx_of(0))), int(round(rx_of(15))))
        carbon = dg.sample_curve(rm, rchain, rx_of, ry_of, years)

        print(f"{name}: canopy trace {cdiag['covered']}/{cdiag['span']} cols  |  "
              f"carbon trace {rdiag['covered']}/{rdiag['span']} cols")

        for y in years:
            key = (name, y)
            row = committed.get(key)
            if row is None:
                mismatches.append(f"{name} y{y}: missing from CSV")
                continue
            exp_can = round(canopy[y], 2)
            exp_tc = round(carbon[y], 2)
            exp_co2 = round(carbon[y] * (44.0 / 12.0), 2)
            got_can = float(row["canopy_pct"])
            got_tc = float(row["carbon_tc"])
            got_co2 = float(row["carbon_tco2e"])
            for label, got, exp in (
                ("canopy_pct", got_can, exp_can),
                ("carbon_tc", got_tc, exp_tc),
                ("carbon_tco2e", got_co2, exp_co2),
            ):
                d = abs(got - exp)
                worst = max(worst, d)
                if d > 0.011:
                    mismatches.append(
                        f"{name} y{y} {label}: CSV={got} fresh={exp} (delta {d:.4f})"
                    )

    print(f"\nworst |committed - fresh| across all values: {worst:.4f}")
    if mismatches:
        print("FAIL — CSV is stale:")
        for m in mismatches:
            print("  " + m)
        return 1
    print("PASS — data/growth_reference.csv matches a fresh digitisation exactly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
