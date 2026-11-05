"""
SAP Forest EduTwin — scenario model
Illustrative growth + carbon model for mangrove restoration and urban street canopy.

IMPORTANT: Every number produced here is an ILLUSTRATIVE AVERAGE built from
generic allometric reasoning. It is NOT a site-specific prediction and must
never be presented as one.

Model shape (deliberately simple, explainable, and auditable):
  1. survival(t)   = S_max * exp(-k_s * t)          -> stocking loss
  2. height(t)     = H_max * (1 - exp(-k_h * t^p))  -> Weibull-ish height growth
  3. crown(t)      = R_max * (1 - exp(-k_c * t))    -> crown radius growth
  4. cover(t)      = 100 * (1 - exp(-2 * A_crown / A_plot))  -> overlap-aware canopy cover
  5. biomass(t)    = a * DBH^2 * H                  -> generic allometric proxy
  6. carbon(t)     = 0.5 * biomass; CO2e = C * 44/12

Reference curves (illustrative averages) live in data/growth_reference.csv and can be
overridden by a user-supplied calibration CSV (e.g. digitised from published graphs).
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional

DATA_DIR = Path(__file__).parent / "data"

CAVEAT = "Illustrative averages, not site-specific predictions."


@dataclass
class Scenario:
    key: str
    label: str
    blurb: str
    # stocking
    stems_per_ha: float          # initial planting density
    survival_floor: float        # long-term survival fraction
    survival_k: float            # survival decay
    # growth
    height_max: float            # metres
    height_k: float
    height_p: float
    crown_max: float             # metres radius
    crown_k: float
    # allometry
    dbh_a: float                 # DBH = a * (height)^b
    dbh_b: float
    biomass_a: float
    biomass_b: float
    biomass_c: float
    carbon_fraction: float
    # economics / narrative
    cost_per_tree: float
    co_benefit_note: str
    treegens_claim: str
    species_examples: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return asdict(self)


MANGROVE = Scenario(
    key="mangrove",
    label="Mangrove restoration (Treegens-style)",
    blurb=(
        "Dense mixed mangrove plantings on tidal flats. Very high stem density, fast crown "
        "closure, high per-stem carbon density, and strong blue-carbon co-benefits "
        "(wave attenuation, nursery habitat, coastal erosion control)."
    ),
    stems_per_ha=1200,
    survival_floor=0.55,
    survival_k=0.045,
    height_max=14.0,
    height_k=0.26,
    height_p=0.85,
    crown_max=3.2,
    crown_k=0.12,
    dbh_a=1.25,
    dbh_b=1.02,
    biomass_a=0.20,
    biomass_b=2.0,
    biomass_c=1.0,
    carbon_fraction=0.47,
    cost_per_tree=2.40,
    co_benefit_note="blue carbon, coastal protection, fish nursery, carbon banking",
    treegens_claim="Proof of Tree: each verified stem anchors a regeneration claim",
    species_examples=["Rhizophora mangle", "Avicennia germinans", "Laguncularia racemosa"],
)

URBAN = Scenario(
    key="urban",
    label="Urban street canopy",
    blurb=(
        "Street trees at typical municipal spacing with a formal tree pit. Slower, thinner "
        "crowns, lower stem counts per hectare, but located where people actually experience "
        "the benefit: shade, surface temperature, air quality, walkability."
    ),
    stems_per_ha=50,
    survival_floor=0.68,
    survival_k=0.022,
    height_max=19.0,
    height_k=0.18,
    height_p=0.95,
    crown_max=4.6,
    crown_k=0.16,
    dbh_a=1.8,
    dbh_b=1.0,
    biomass_a=0.20,
    biomass_b=2.0,
    biomass_c=1.0,
    carbon_fraction=0.47,
    cost_per_tree=145.00,
    co_benefit_note="shade, surface temperature, air quality, walkability, property value",
    treegens_claim="Proof of Tree: each verified stem anchors a regeneration claim",
    species_examples=["Quercus alba", "Acer saccharum", "Tilia americana", "Platanus x acerifolia"],
)

# Canopy overlap coefficient for the saturating cover curve (Beer-Lambert style)
COVER_K = 1.0

SCENARIOS: Dict[str, Scenario] = {MANGROVE.key: MANGROVE, URBAN.key: URBAN}

SCENARIO_LABELS = [s.label for s in SCENARIOS.values()]
LABEL_TO_KEY = {s.label: s.key for s in SCENARIOS.values()}


def resolve(scenario_key_or_label: str) -> Scenario:
    if scenario_key_or_label in SCENARIOS:
        return SCENARIOS[scenario_key_or_label]
    return SCENARIOS[LABEL_TO_KEY.get(scenario_key_or_label, MANGROVE.key)]


def survival(scn: Scenario, t: float) -> float:
    """Fraction of originally planted stems still alive at year t."""
    base = scn.survival_floor + (1.0 - scn.survival_floor) * math.exp(-scn.survival_k * t)
    return max(0.0, min(1.0, base))


def height(scn: Scenario, t: float) -> float:
    return scn.height_max * (1.0 - math.exp(-scn.height_k * (t ** scn.height_p)))


def crown_radius(scn: Scenario, t: float) -> float:
    return scn.crown_max * (1.0 - math.exp(-scn.crown_k * t))


def canopy_cover(scn: Scenario, t: float, area_ha: float, start_condition: float) -> float:
    """Overlap-aware canopy cover percent for the plot."""
    plot_area_m2 = area_ha * 10_000.0
    stems = scn.stems_per_ha * area_ha * start_condition
    alive = stems * survival(scn, t)
    r = crown_radius(scn, t)
    crown_area = math.pi * r * r
    total_crown = alive * crown_area
    # Beer-Lambert style saturating overlap
    cover = 100.0 * (1.0 - math.exp(-COVER_K * total_crown / max(plot_area_m2, 1.0)))
    return max(0.0, min(100.0, cover))


def biomass_kg(scn: Scenario, t: float) -> float:
    h = height(scn, t)
    dbh = scn.dbh_a * (h ** scn.dbh_b)
    return scn.biomass_a * (dbh ** scn.biomass_b) * (h ** scn.biomass_c)


def carbon_tonnes(scn: Scenario, t: float, area_ha: float, start_condition: float) -> float:
    """Cumulative carbon stored (t C) in the plot at year t."""
    stems = scn.stems_per_ha * area_ha * start_condition
    alive = stems * survival(scn, t)
    b = biomass_kg(scn, t)
    return alive * b * scn.carbon_fraction / 1000.0


def co2e_tonnes(scn: Scenario, t: float, area_ha: float, start_condition: float) -> float:
    return carbon_tonnes(scn, t, area_ha, start_condition) * (44.0 / 12.0)


def project(
    scenario_key: str,
    area_ha: float,
    years: int,
    start_condition: float,
    planting_events: Optional[List[Dict]] = None,
) -> List[Dict]:
    """
    Produce a year-by-year projection.

    planting_events: optional list of {"year": int, "stems_per_ha": float}
    representing staggered planting cohorts (used by the interactive planner).
    """
    scn = resolve(scenario_key)
    rows = []
    cohorts = planting_events or [{"year": 0, "stems_per_ha": scn.stems_per_ha}]
    for t in range(0, years + 1):
        cover = 0.0
        carbon = 0.0
        stems = 0.0
        for cohort in cohorts:
            cy = cohort.get("year", 0)
            dt = t - cy
            if dt < 0:
                continue
            density = cohort.get("stems_per_ha", scn.stems_per_ha)
            alive = density * area_ha * start_condition * survival(scn, dt)
            stems += alive
            r = crown_radius(scn, dt)
            cover += math.pi * r * r * alive
            carbon += alive * biomass_kg(scn, dt) * scn.carbon_fraction / 1000.0
        plot_area_m2 = area_ha * 10_000.0
        cover_pct = 100.0 * (1.0 - math.exp(-COVER_K * cover / max(plot_area_m2, 1.0)))
        rows.append(
            {
                "year": t,
                "canopy_pct": round(max(0.0, min(100.0, cover_pct)), 2),
                "carbon_tco2e": round(carbon * (44.0 / 12.0), 2),
                "carbon_tc": round(carbon, 2),
                "living_stems": int(round(stems)),
                "mean_height_m": round(height(scn, t), 2),
            }
        )
    return rows


# --------------------------------------------------------------------------------------
# Calibration against published / digitised curves
# --------------------------------------------------------------------------------------

def load_calibration(csv_path: Optional[str]) -> Optional[List[Dict]]:
    """
    Load a calibration CSV with columns: scenario,year,canopy_pct,carbon_tco2e
    Returns rows list, or None if no usable file.
    """
    if not csv_path:
        return None
    p = Path(csv_path)
    if not p.exists():
        return None
    try:
        with p.open("r", newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        out = []
        for r in rows:
            if "year" not in r:
                continue
            out.append(
                {
                    "scenario": (r.get("scenario") or "").strip().lower(),
                    "year": int(float(r["year"])),
                    "canopy_pct": float(r.get("canopy_pct") or 0),
                    "carbon_tco2e": float(r.get("carbon_tco2e") or 0),
                }
            )
        return out or None
    except Exception:
        return None


def _model_reference_rows(scenario_key: str, years: int) -> List[Dict]:
    """
    The model's own prediction under the *canonical* reference conditions:
    1 hectare, full stocking, a single cohort planted at year 0.

    This is the baseline the published reference curve is measured against.
    """
    return project(scenario_key, area_ha=1.0, years=max(0, years), start_condition=1.0)


_DEFAULT_CALIBRATION_LOADED = False
_DEFAULT_CALIBRATION: Optional[List[Dict]] = None


def default_calibration() -> Optional[List[Dict]]:
    """
    The built-in reference curve, digitised from the published SAP graphs by
    ``tools/digitize_reference.py`` (see data/growth_reference.csv).

    Returns None when the CSV is absent, in which case the raw model output is
    used unchanged.
    """
    global _DEFAULT_CALIBRATION_LOADED, _DEFAULT_CALIBRATION
    if not _DEFAULT_CALIBRATION_LOADED:
        _DEFAULT_CALIBRATION = load_calibration(reference_csv_path())
        _DEFAULT_CALIBRATION_LOADED = True
    return _DEFAULT_CALIBRATION


def apply_calibration(rows: List[Dict], calibration: Optional[List[Dict]], scenario_key: str) -> List[Dict]:
    """
    Ground the model in a reference curve (e.g. digitised from the published
    SAP graphs) *without* throwing away the model's response to the user's
    inputs.

    Passing ``calibration=None`` uses the built-in reference curve; pass an
    empty list to switch the correction off entirely.

    For every year we derive a correction factor

        k(t) = reference(t) / model_reference(t)

    where ``model_reference(t)`` is the model's own prediction for canonical
    conditions (1 ha, full stocking, one cohort at year 0). The calibrated
    output is then

        calibrated(t) = model(t) * k(t)

    Consequences, which is exactly what we want:

    * At canonical conditions the app reproduces the published curve year by
      year, not just at the horizon endpoint (the old endpoint-only scaling
      matched the year-15 bar but had the wrong curve *shape*).
    * Planting density, plot area and cohort timing still move the result the
      way the underlying model says they should, because only the correction
      factor is imported from the reference, never the absolute values.
    * Year 0 keeps the model's own meaning ("the day you plant"): the
      published curves assume a little pre-existing canopy at year 0
      (5.8% mangrove / 8.4% urban) that this planting model does not include.

    The reference carbon values are per hectare; the ratio is therefore taken
    against a 1 ha reference projection and applied to the plot total.
    """
    if calibration is None:
        calibration = default_calibration()
    if not calibration:
        return rows
    ref = [c for c in calibration if c["scenario"] in (scenario_key, "", "any")]
    if len(ref) < 2:
        return rows
    ref.sort(key=lambda c: c["year"])
    ref_min, ref_max = ref[0]["year"], ref[-1]["year"]

    def interp(year, key):
        if year <= ref[0]["year"]:
            return ref[0][key]
        if year >= ref[-1]["year"]:
            return ref[-1][key]
        for a, b in zip(ref, ref[1:]):
            if a["year"] <= year <= b["year"]:
                span = max(b["year"] - a["year"], 1e-9)
                f = (year - a["year"]) / span
                return a[key] + f * (b[key] - a[key])
        return ref[-1][key]

    max_year = max([r["year"] for r in rows] + [ref_max])
    model_ref = {r["year"]: r for r in _model_reference_rows(scenario_key, max_year)}

    out = []
    for r in rows:
        t = r["year"]
        nr = dict(r)
        if ref_min <= t <= ref_max:
            mref = model_ref.get(t)

            # --- canopy cover (already a percentage of the plot) -------------
            model_ref_canopy = (mref or {}).get("canopy_pct", 0.0)
            k_canopy = (interp(t, "canopy_pct") / model_ref_canopy) if model_ref_canopy > 1e-6 else 1.0
            nr["canopy_pct"] = round(min(100.0, max(0.0, r["canopy_pct"] * k_canopy)), 2)

            # --- carbon (reference is per hectare) ---------------------------
            model_ref_carbon = (mref or {}).get("carbon_tco2e", 0.0)
            k_carbon = (interp(t, "carbon_tco2e") / model_ref_carbon) if model_ref_carbon > 1e-6 else 1.0
            nr["carbon_tco2e"] = round(max(0.0, r["carbon_tco2e"] * k_carbon), 2)
            nr["carbon_tc"] = round(nr["carbon_tco2e"] * (12.0 / 44.0), 2)
        out.append(nr)
    return out


def summarize(rows: List[Dict], scn: Scenario, area_ha: float, start_condition: float) -> Dict:
    final = rows[-1]
    year15 = next((r for r in rows if r["year"] == 15), final)
    cost = scn.stems_per_ha * area_ha * start_condition * scn.cost_per_tree
    return {
        "canopy_start_pct": rows[0]["canopy_pct"],
        "canopy_end_pct": final["canopy_pct"],
        "canopy_year15_pct": year15["canopy_pct"],
        "carbon_tco2e": final["carbon_tco2e"],
        "carbon_tco2e_per_ha": final["carbon_tco2e"] / area_ha if area_ha else 0,
        "cost_estimate": cost,
        "cost_per_tco2e": (cost / final["carbon_tco2e"]) if final["carbon_tco2e"] > 0 else 0,
        "living_stems": final["living_stems"],
        "mean_height_m": final["mean_height_m"],
    }


def reference_csv_path() -> Optional[str]:
    p = DATA_DIR / "growth_reference.csv"
    return str(p) if p.exists() else None
