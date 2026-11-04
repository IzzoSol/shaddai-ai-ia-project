"""
SAP Forest EduTwin — Asimov explainability agent
------------------------------------------------
A local-first, tool-using explainer. Deterministic numbers come from
`scenarios.py`; the local LLM only narrates them under strict rules.

Tools
  project_forest   canopy + carbon trajectory for one scenario
  compare          mangrove vs urban side by side
  explain_metric   what a number means and what it does NOT mean
  planting_plan    staggered cohorts -> intervention design
  impact_story     place-based narrative for a region
  build_scene_code generate a Three.js snippet for the plot twin

Every answer ends with the caveat: "illustrative averages, not site-specific
predictions" and references Treegens Proof of Tree + NVIDIA Omniverse/Cosmos.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

import model as llm
import scenarios as sc

CAVEAT = sc.CAVEAT

SYSTEM_PROMPT = f"""You are ASIMOV, the local explainer for the Shaddai Asimov Project (SAP) Forest EduTwin.

Your job: explain urban-forest and mangrove growth to curious non-specialists, using ONLY the
facts supplied to you. You never invent site data.

Hard rules:
1. Every answer MUST contain the phrase "illustrative averages, not site-specific predictions"
   (or an equivalent sentence).
2. Always connect the answer to:
   - Treegens "Proof of Tree" — verified planting is what turns a claim into evidence.
   - NVIDIA Omniverse / Cosmos-style physical-AI digital twins — the high-fidelity, simulation-grade
     counterpart used for smart-city planning (shade, heat, air quality, robotics).
3. Be warm, concrete and educational. Max 220 words. Use short paragraphs and a couple of bullet points.
4. If a number is missing, say what would be needed instead of guessing.
5. Never imply the local demo equals a production-grade simulation.
"""

METRIC_EXPLANATIONS = {
    "canopy": (
        "**Canopy cover %** is the share of the ground area shaded by crowns once overlapping crowns are "
        "accounted for. It is the number residents actually feel as shade, and it is the same quantity "
        "urban heat-island models (and NVIDIA Omniverse-style scene twins) use as an input.\n\n"
        "What it does NOT tell you: microclimate at your specific street, tree health, or the species mix."
    ),
    "carbon": (
        "**Cumulative carbon (tCO2e)** is the carbon stored in tree biomass, expressed as CO2-equivalent, "
        "accumulated up to the selected year. It uses a generic allometric proxy (DBH² × height), so treat it "
        "as order-of-magnitude.\n\n"
        "What it does NOT tell you: soil carbon, mangrove sediment carbon, avoided emissions, or permanence "
        "over decades beyond the modelled horizon."
    ),
    "survival": (
        "**Establishment / survival** is the fraction of originally planted stems still alive. It is the single "
        "biggest driver of a restoration budget — replanting costs dominate mangrove projects when survival "
        "is low.\n\n"
        "Treegens Proof of Tree matters here: verified survival over time is the evidence that a funded claim "
        "actually produced living stems."
    ),
    "cost": (
        "**Cost per tCO2e** divides a rough planting cost by modelled carbon. It is a screening number for "
        "comparing interventions, not an appraisal.\n\n"
        "It excludes land, maintenance, monitoring, verification overhead and the value of co-benefits "
        "(coastal protection, cooling, health) which often dominate the real business case."
    ),
    "height": (
        "**Mean height** drives both shade quality and structural load. In a physical-AI twin, height plus "
        "crown geometry is what a vision agent measures from street-level camera feeds to check that the "
        "growth model matches reality."
    ),
}


def _fmt_pct(v: float) -> str:
    return f"{v:.1f}%"


def _fmt_t(v: float) -> str:
    if v >= 1000:
        return f"{v:,.0f} tCO2e"
    return f"{v:.1f} tCO2e"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
def tool_project_forest(scenario_key: str, area_ha: float, years: int,
                        start_condition: float, calibration=None) -> Dict:
    rows = sc.project(scenario_key, area_ha, years, start_condition)
    rows = sc.apply_calibration(rows, calibration, scenario_key)
    s = sc.summarize(rows, sc.resolve(scenario_key), area_ha, start_condition)
    return {"rows": rows, "summary": s, "scenario": sc.resolve(scenario_key)}


def tool_compare(area_ha: float, years: int, start_condition: float,
                 calibration=None) -> Dict:
    out = {}
    for key in ("mangrove", "urban"):
        rows = sc.project(key, area_ha, years, start_condition)
        rows = sc.apply_calibration(rows, calibration, key)
        out[key] = {"rows": rows, "summary": sc.summarize(rows, sc.resolve(key), area_ha, start_condition)}
    return out


def tool_planting_plan(area_ha: float, cohorts: List[Dict], years: int,
                        start_condition: float, scenario_key: str = "mangrove",
                        calibration=None) -> Dict:
    """cohorts: [{'year': int, 'stems_per_ha': float}, ...]"""
    rows = sc.project(scenario_key, area_ha, years, start_condition, planting_events=cohorts)
    rows = sc.apply_calibration(rows, calibration, scenario_key)
    return {"rows": rows, "cohorts": cohorts}


def tool_impact_story(region: str, area_ha: float, years: int,
                       start_condition: float, scenario_key: str = "mangrove") -> Dict:
    region_map = {
        "mangrove": {
            "coastal": ("Wave attenuation and coastal erosion control are the co-benefits that make mangrove "
                        "restoration financeable beyond carbon alone — the roots bind sediment, the canopy "
                        "dampens storm surge, and the root labyrinth is nursery habitat for fish."),
        },
        "urban": {
            "coastal": ("Street canopy works at human scale: shade on the walk, cooler pavement, less heat "
                        "in the canyon, and cleaner air where people actually breathe."),
        },
    }
    key = sc.resolve(scenario_key).key
    return {"region": region, "story": region_map[key]["coastal"]}


# ---------------------------------------------------------------------------
# Intent routing
# ---------------------------------------------------------------------------
def detect_intent(q: str) -> str:
    ql = q.lower()
    if any(k in ql for k in ("compare", " vs ", "versus", "difference", "better", "which one")):
        return "compare"
    if any(k in ql for k in ("code", "three.js", "threejs", "scene", "glb", "usd", "build a")):
        return "build_scene"
    if any(k in ql for k in ("plan", "schedule", "cohort", "stagger", "phased", "plant over")):
        return "planting_plan"
    if any(k in ql for k in ("cost", "price", "expensive", "per tco2", "budget", "roi")):
        return "cost"
    if any(k in ql for k in ("carbon", "co2", "sequest", "blue carbon")):
        return "carbon"
    if any(k in ql for k in ("surviv", "mortality", "establish", "health")):
        return "survival"
    if any(k in ql for k in ("height", "tall", "mature", "growth rate")):
        return "height"
    if any(k in ql for k in ("story", "narrative", "tell me about", "region", "coastal", "mangrove story")):
        return "impact_story"
    if any(k in ql for k in ("canopy", "shade", "cover")):
        return "canopy"
    return "project"


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------
class AsimovAgent:
    def __init__(self, backend: Optional[llm.LocalModel] = None):
        self.backend = backend or llm.resolve_backend()
        self.history: List[Dict] = []

    # -- deterministic answer builder (always available) ------------------------
    def _facts(self, intent: str, scenario_key: str, area_ha: float, years: int,
               start_condition: float, calibration) -> str:
        if intent == "compare":
            cmp = tool_compare(area_ha, years, start_condition, calibration)
            m, u = cmp["mangrove"], cmp["urban"]
            lines = [
                f"Scenario A — {sc.MANGROVE.label}: canopy {_fmt_pct(m['summary']['canopy_end_pct'])}, "
                f"carbon {_fmt_t(m['summary']['carbon_tco2e'])}, cost/tCO2e ${m['summary']['cost_per_tco2e']:.0f}.",
                f"Scenario B — {sc.URBAN.label}: canopy {_fmt_pct(u['summary']['canopy_end_pct'])}, "
                f"carbon {_fmt_t(u['summary']['carbon_tco2e'])}, cost/tCO2e ${u['summary']['cost_per_tco2e']:.0f}.",
                f"Plot area {area_ha} ha, horizon {years} years, starting condition x{start_condition:.2f}.",
            ]
            return "\n".join(lines)

        if intent in ("planting_plan",):
            cohorts = [
                {"year": 0, "stems_per_ha": sc.resolve(scenario_key).stems_per_ha},
                {"year": 5, "stems_per_ha": sc.resolve(scenario_key).stems_per_ha * 0.6},
                {"year": 10, "stems_per_ha": sc.resolve(scenario_key).stems_per_ha * 0.4},
            ]
            plan = tool_planting_plan(area_ha, cohorts, years, start_condition, scenario_key)
            final = plan["rows"][-1]
            return (
                "Phased plan (years 0 / 5 / 10) -> "
                f"canopy {_fmt_pct(final['canopy_pct'])}, carbon {_fmt_t(final['carbon_tco2e'])} "
                f"by year {years}. Cohorts: " +
                ", ".join(f"y{c['year']} @ {c['stems_per_ha']:.0f}/ha" for c in cohorts)
            )

        res = tool_project_forest(scenario_key, area_ha, years, start_condition, calibration)
        s = res["summary"]
        return (
            f"Scenario: {res['scenario'].label}\n"
            f"Area {area_ha} ha | horizon {years} y | starting condition x{start_condition:.2f}\n"
            f"Canopy cover {_fmt_pct(s['canopy_start_pct'])} -> {_fmt_pct(s['canopy_end_pct'])}\n"
            f"Cumulative carbon {_fmt_t(s['carbon_tco2e'])} ({s['carbon_tco2e_per_ha']:.2f} tCO2e/ha)\n"
            f"Living stems {s['living_stems']:,} | mean height {s['mean_height_m']} m\n"
            f"Indicative cost ${s['cost_estimate']:,.0f} (${s['cost_per_tco2e']:.0f} per tCO2e)"
        )

    def _template(self, intent: str, facts: str) -> str:
        metric_block = METRIC_EXPLANATIONS.get(
            {"canopy": "canopy", "carbon": "carbon", "cost": "cost",
             "survival": "survival", "height": "height"}.get(intent, "")
        )
        header = {
            "compare": "### Mangrove vs urban street canopy",
            "planting_plan": "### Phased planting plan",
            "impact_story": "### Place-based impact story",
            "build_scene": "### Three.js plot-twin snippet",
            "cost": "### What the cost number means",
        }.get(intent, "### Forest projection walkthrough")

        body = [
            header,
            "",
            "**Modelled numbers**",
            "",
            "```",
            facts,
            "```",
            "",
        ]
        if metric_block:
            body += [metric_block, ""]
        body += [
            "**Why this matters for Treegens and NVIDIA-style twins**",
            "",
            "- Treegens *Proof of Tree* is the verification layer: a claim becomes evidence when stems are "
            "confirmed alive over time. The numbers above assume that verification succeeds at the stated "
            "establishment rate.",
            "- NVIDIA Omniverse / Cosmos physical-AI twins are the high-fidelity counterpart — simulation-grade "
            "geometry and physics used to test shade, heat, air quality and robot behaviour before anything "
            "is built.",
            "- This local demo is the citizen-facing, on-device teaching layer of that same story: fast, "
            "private, and honest about uncertainty.",
            "",
            f"*{CAVEAT}*",
        ]
        return "\n".join(body)

    # -- public API ------------------------------------------------------------
    def ask(self, question: str, scenario_key: str = "mangrove", area_ha: float = 10.0,
            years: int = 15, start_condition: float = 1.0, calibration=None) -> str:
        intent = detect_intent(question or "")

        if intent == "build_scene":
            code_prompt = (
                "Write a minimal, self-contained Three.js (r160, ES modules, importmap) scene showing a small "
                "urban tree plot with instanced trees, a ground plane, and one orbit control. Keep it under 120 "
                "lines. Return only code in a ```javascript block."
            )
            code = llm.generate(code_prompt, SYSTEM_PROMPT, self.backend)
            if code:
                return ("### Three.js plot-twin snippet\n\n"
                        f"{code}\n\n"
                        f"*{CAVEAT}* Generated on-device with `{self.backend.name}` "
                        f"({self.backend.backend}). Validate before use.")
            return self._template(intent, "No local code model available — enable Ollama to generate scene code.")

        facts = self._facts(intent, scenario_key, area_ha, years, start_condition, calibration)
        narrative_prompt = (
            f"Facts:\n{facts}\n\n"
            f"Question: {question}\n\n"
            "Write the answer. Keep every number exactly as given. Do not add new numbers."
        )
        out = llm.generate(narrative_prompt, SYSTEM_PROMPT, self.backend,
                           context=self.history[-6:] if self.history else None)
        self.history.append({"role": "user", "content": question})
        self.history.append({"role": "assistant", "content": (out or "")[:1200]})

        if out:
            text = out.strip()
            if "illustrative averages" not in text.lower():
                text += f"\n\n*{CAVEAT}*"
            return text
        return self._template(intent, facts)

    def walkthrough(self, scenario_key: str, area_ha: float, years: int,
                    start_condition: float, calibration=None) -> str:
        """Narrated step-by-step walkthrough of the projection."""
        res = tool_project_forest(scenario_key, area_ha, years, start_condition, calibration)
        rows = res["rows"]
        s = res["summary"]
        milestones = [r for r in rows if r["year"] in {0, 3, 5, 10, 15} or r["year"] == rows[-1]["year"]]
        ms_text = "\n".join(
            f"- Year {r['year']}: canopy {_fmt_pct(r['canopy_pct'])}, "
            f"cumulative carbon {_fmt_t(r['carbon_tco2e'])}, "
            f"{r['living_stems']:,} living stems, mean height {r['mean_height_m']} m"
            for r in milestones
        )
        facts = (
            f"Scenario: {res['scenario'].label}\n"
            f"Area {area_ha} ha | horizon {years} y | starting condition x{start_condition:.2f}\n"
            f"Milestones:\n{ms_text}\n"
            f"Indicative cost ${s['cost_estimate']:,.0f} (${s['cost_per_tco2e']:.0f} per tCO2e)"
        )
        prompt = (
            "Write a narrated 5-beat walkthrough of this 15-year trajectory: (1) what happens in year 0, "
            "(2) the early establishment years, (3) the canopy-closure moment, (4) the maturity phase, "
            "(5) what the numbers mean for a city and for a ReFi claim. Use the milestone lines verbatim."
        )
        out = llm.generate(facts + "\n\n" + prompt, SYSTEM_PROMPT, self.backend)
        if out:
            return out.strip() + (f"\n\n*{CAVEAT}*" if "illustrative averages" not in out.lower() else "")
        return self._template("project", facts)

    def impact_story(self, scenario_key: str, area_ha: float, years: int,
                     start_condition: float, region: str = "coastal") -> str:
        res = tool_project_forest(scenario_key, area_ha, years, start_condition)
        s = res["summary"]
        biome = res["scenario"]
        facts = (
            f"Biome: {biome.label}\n"
            f"Area {area_ha} ha | horizon {years} y\n"
            f"Canopy {_fmt_pct(s['canopy_end_pct'])} | carbon {_fmt_t(s['carbon_tco2e'])}\n"
            f"Co-benefits: {biome.co_benefit_note}\n"
            f"Treegens claim mechanism: {biome.treegens_claim}"
        )
        prompt = (
            "Turn these facts into a short, vivid 200-word impact story for a community audience. "
            "One person, one place, one visible change over the 15 years. Then two short 'how this is verified' "
            "and 'how a digital twin checks it' lines."
        )
        out = llm.generate(facts + "\n\n" + prompt, SYSTEM_PROMPT, self.backend)
        if out:
            return out.strip() + (f"\n\n*{CAVEAT}*" if "illustrative averages" not in out.lower() else "")
        return self._template("impact_story", facts)
