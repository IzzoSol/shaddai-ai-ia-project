"""
Verify the calibrated model against the digitised reference curve.

Checks, for each scenario:
  * the calibrated canopy/carbon curve tracks the reference year by year
  * the year-15 endpoints match the published bar graph
  * the calibration still responds correctly to planting density and area
    (it must not simply paste the reference values over the model)
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
sys.path.insert(0, str(PKG))

import scenarios as sc  # noqa: E402

# Values measured independently from the "Year 15" bar graph (image.png).
BAR_CANOPY = {"mangrove": 88.14, "urban": 45.58}
BAR_CO2E = {"mangrove": 427.08, "urban": 127.08}

AREA_HA = 1.0


def main() -> int:
    cal = sc.load_calibration(sc.reference_csv_path())
    if not cal:
        print("FAIL: could not load reference CSV")
        return 1
    print(f"loaded {len(cal)} reference rows from {sc.reference_csv_path()}\n")

    ok = True
    for key in ("mangrove", "urban"):
        scn = sc.resolve(key)
        rows = sc.project(key, AREA_HA, 15, 1.0)
        cal_rows = sc.apply_calibration(rows, cal, key)
        ref = {c["year"]: c for c in cal if c["scenario"] == key}

        print(f"--- {key} ---")
        print(f"{'yr':>3} | {'model can%':>10} {'ref can%':>9} {'cal can%':>9} | "
              f"{'model CO2e':>10} {'ref CO2e':>9} {'cal CO2e':>9}")
        worst_can = worst_car = 0.0
        for r in cal_rows:
            y = r["year"]
            m = rows[y]
            rc = ref[y]["canopy_pct"]
            rk = ref[y]["carbon_tco2e"]
            dc = abs(r["canopy_pct"] - rc)
            dk = abs(r["carbon_tco2e"] - rk)
            worst_can = max(worst_can, dc)
            worst_car = max(worst_car, dk)
            print(f"{y:>3} | {m['canopy_pct']:>10.2f} {rc:>9.2f} {r['canopy_pct']:>9.2f} | "
                  f"{m['carbon_tco2e']:>10.2f} {rk:>9.2f} {r['carbon_tco2e']:>9.2f}")
        print(f"  max |calibrated - reference|  canopy={worst_can:.2f} pp   carbon={worst_car:.2f} tCO2e/ha")

        # Year 0 is a deliberate semantic difference, not an error: the model
        # means "the day you plant" (0% canopy, 0 carbon) while the published
        # curves assume a little pre-existing canopy on the site.
        y0 = cal_rows[0]
        print(f"  year 0 is intentionally not matched: model {y0['canopy_pct']:.2f}% / "
              f"{y0['carbon_tco2e']:.2f} tCO2e vs reference {ref[0]['canopy_pct']:.2f}% / "
              f"{ref[0]['carbon_tco2e']:.2f} tCO2e "
              "(reference includes pre-existing site canopy)")

        # Years 1..15 must match the reference essentially exactly.
        drift_can = max(abs(r["canopy_pct"] - ref[r["year"]]["canopy_pct"])
                        for r in cal_rows if r["year"] >= 1)
        drift_car = max(abs(r["carbon_tco2e"] - ref[r["year"]]["carbon_tco2e"])
                        for r in cal_rows if r["year"] >= 1)
        print(f"  max drift years 1-15: canopy={drift_can:.4f} pp   carbon={drift_car:.4f} tCO2e/ha")
        if drift_can > 0.05 or drift_car > 0.05:
            ok = False
            print("  ** calibrated curve does not track the reference **")

        end = cal_rows[-1]
        ec, ek = BAR_CANOPY[key], BAR_CO2E[key]
        print(f"  year-15 calibrated: canopy {end['canopy_pct']:.2f}% (bar {ec:.2f}, "
              f"err {abs(end['canopy_pct'] - ec):.2f} pp) | "
              f"carbon {end['carbon_tco2e']:.2f} tCO2e/ha (bar {ek:.2f}, "
              f"err {abs(end['carbon_tco2e'] - ek):.2f})")
        if abs(end["canopy_pct"] - ec) > 0.5 or abs(end["carbon_tco2e"] - ek) > 2.0:
            ok = False
            print("  ** endpoint does not match the published bar graph **")

        # --- responsiveness checks: the calibration must NOT flatten the model
        half = sc.apply_calibration(sc.project(key, AREA_HA, 15, 0.5), cal, key)
        zero = sc.apply_calibration(sc.project(key, AREA_HA, 15, 0.0), cal, key)
        wide = sc.apply_calibration(sc.project(key, 10.0, 15, 1.0), cal, key)
        print(f"  start x0.50 -> year15 canopy {half[-1]['canopy_pct']:.2f}%  "
              f"carbon {half[-1]['carbon_tco2e']:.2f} tCO2e/ha")
        print(f"  start x0.00 -> year15 canopy {zero[-1]['canopy_pct']:.2f}%  "
              f"carbon {zero[-1]['carbon_tco2e']:.2f} tCO2e/ha")
        print(f"  10 ha x1.00 -> year15 carbon {wide[-1]['carbon_tco2e']:.2f} tCO2e "
              f"({wide[-1]['carbon_tco2e'] / 10:.2f} tCO2e/ha)")
        if zero[-1]["canopy_pct"] > 0.01 or zero[-1]["carbon_tco2e"] > 0.01:
            ok = False
            print("  ** planting nothing must produce nothing **")
        if abs(wide[-1]["carbon_tco2e"] / 10 - end["carbon_tco2e"]) > 0.05:
            ok = False
            print("  ** carbon must scale linearly with area **")
        if not (0 < half[-1]["canopy_pct"] < end["canopy_pct"]):
            ok = False
            print("  ** half stocking must land between zero and full **")
        print()

    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
