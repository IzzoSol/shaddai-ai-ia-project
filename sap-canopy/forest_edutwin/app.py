"""
SAP Forest EduTwin — Gradio app
================================
Lightweight educational urban/mangrove growth explainer + mini digital twin.

Tabs
  1. Scenario & Projections   sliders → charts → narrated walkthrough
  2. Asimov Agent (local)     what-if Q&A, impact stories, scene code
  3. Planting Planner         staggered cohorts → intervention design
  4. 3D Plot Twin              Three.js viewer with NVIDIA SimReady assets
  5. About & Explainability   when/where explainability is needed

Everything runs locally. Model narration is optional (Ollama); the numbers
never depend on a model.
"""

from __future__ import annotations

import os
import traceback
from pathlib import Path

import gradio as gr

import agent as asimov
import model as llm
import plots
import scenarios as sc

HERE = Path(__file__).parent

AGENT = asimov.AsimovAgent()

QUICK_QUESTIONS = [
    "Why does canopy cover matter for a hot city?",
    "Compare mangrove and urban street canopy",
    "What does the carbon number NOT tell me?",
    "How would Treegens Proof of Tree verify this?",
    "Tell me an impact story",
    "Write me a Three.js scene for this plot",
]

EXPLAINABILITY_MD = """
# Where and when explainability is needed

This demo separates **numbers** (deterministic, auditable, in `scenarios.py`) from **narration**
(local LLM, optional, in `agent.py`). Explainability is requested at specific moments, not sprayed
everywhere.

| Moment | What the user just did | Explainability needed | How this demo answers |
|---|---|---|---|
| **Projection produced** | moved a slider / picked a scenario | *What is this number and what is it not?* | Headline card + metric glossary + the caveat on every answer |
| **A number surprises them** | mangrove canopy climbs from ~66% to ~88% between year 5 and 15 | *Why?* | "Explain metric" tool: the survival, crown-growth and overlap equations |
| **Comparing two options** | mangrove vs urban | *On what basis?* | Side-by-side chart + a table with the same rows and the same assumptions |
| **Cost question** | asks "is this worth it?" | *What is excluded from this cost?* | Cost tool explains what is *not* included (land, maintenance, monitoring, co-benefits) |
| **Funding / claim moment** | ambassador prepares a Treegens claim | *How does this become evidence?* | Proof of Tree link, verification explainer, local-first privacy note |
| **Digital-twin question** | asks "can a camera verify this?" | *How does the simulation meet reality?* | Omniverse/Cosmos bridge text + the "3D Plot Twin" tab with SimReady assets |
| **Scenario changed** | plants in cohorts across years | *What did my change do?* | Planting planner diff: canopy/carbon before vs after phasing |

## Non-negotiable rules in the narration

1. Every answer carries **"illustrative averages, not site-specific predictions"**.
2. Numbers are never invented — the model may only narrate numbers it was given.
3. Treegens **Proof of Tree** (verified planting) and NVIDIA **Omniverse / Cosmos** physical-AI twins
   are always referenced as the verification and high-fidelity layers.
4. The local demo is explicitly *not* a production simulation.

## Where the numbers come from

The curve is the deterministic model in `scenarios.py` (survival → height → crown → overlap →
biomass → carbon), **corrected year by year against a reference curve** digitised from the
published SAP graphs (`data/growth_reference.csv`):

```
k(t)          = reference(t) / model_reference(t)
calibrated(t) = model(t) * k(t)
```

`model_reference(t)` is the model's own prediction for 1 ha, full stocking, one cohort at
year 0. So at full stocking the app reproduces the published graphs curve-for-curve
(mangrove ≈88% canopy / ≈426 tCO₂e per ha and urban ≈46% / ≈126 tCO₂e per ha by year 15),
while planting density, plot area and cohort timing still drive the result. Year 0 stays
0% canopy / 0 carbon — "the day you plant" — because the published curves assume a little
pre-existing canopy this planting model does not include. Uploading a CSV overrides the
built-in reference.

## Privacy

* Ollama / transformers run on-device. No prompt, slider value or upload leaves the machine.
* No telemetry, no API keys, no account.
* Any calibration CSV is read locally and never uploaded.

## Hardware envelope (8 GB ThinkPad)

| Component | Budget |
|---|---|
| Gradio app + model | ~1.2 GB RAM (Qwen2.5-1.5B) |
| Plotly charts | < 200 MB |
| 3D plot twin | < 250 MB (GPU-less friendly, ~5k instances) |
| Asset downloads on demand | ~1 MB per GLB, ~120 KB per CSV |

## Hugging Face sources

* NVIDIA SimReady Central OpenUSD assets — `nvidia/simready-assets`, `nvidia/PhysicalAI-SimReady-Warehouse-01`
* CAD / parametric — `0x3/Zero-To-CAD-1m` (streamed), `VladPyatov/CADFS`, `qq456cvb/img2cad-dataset`,
  `HuggingAI4Engineering/cadgenbench-data`
* Generative / reverse-engineering — `qq456cvb/img2cad`, `hi3d-official/Hi3Dv1.0`,
  `ccore/Qwen3.5-4B-3D-Coder`
* Gaussian / reconstruction — `GaussianWorld/scene_splat_49k` (gated; optional)
"""

CSS = """
.sap-note {background:#111922;border:1px solid #223141;border-left:4px solid #4caf50;
  border-radius:12px;padding:12px 14px;color:#9fb0c3;font-size:12px;line-height:1.6}
.sap-title {font-weight:800;letter-spacing:.02em}
"""


# ---------------------------------------------------------------------------
# Calibration state (uploaded CSV)
# ---------------------------------------------------------------------------
def _calibration_from_file(file_obj):
    """
    Return the calibration rows to use.

    * No upload  -> None, which means "use the built-in reference curve"
                    (data/growth_reference.csv, digitised from the published
                    SAP graphs).
    * Upload     -> the uploaded rows, which override the built-in reference.
    """
    if not file_obj:
        return None
    path = getattr(file_obj, "name", file_obj)
    return sc.load_calibration(path)


def _calibration_text(file_obj):
    if file_obj:
        cal = _calibration_from_file(file_obj)
        if not cal:
            return ("Calibration file could not be read — falling back to the built-in reference "
                    "curve. Expected CSV columns: `scenario,year,canopy_pct,carbon_tco2e`.")
        kinds = sorted({c["scenario"] or "any" for c in cal})
        return (f"**Uploaded calibration active** — {len(cal)} reference points for "
                f"`{', '.join(kinds)}`. It overrides the built-in reference curve; the model "
                "output is corrected year by year against it.")

    built_in = sc.default_calibration()
    if not built_in:
        return "Using the built-in illustrative model (no reference curve found)."
    return (
        "**Built-in reference curve active** — digitised from the published SAP graphs "
        "(`data/growth_reference.csv`). At full stocking the model reproduces those curves "
        "year by year: mangrove ≈88% canopy / ≈426 tCO₂e per hectare and urban ≈46% / "
        "≈126 tCO₂e per hectare by year 15. Planting density, area and cohort timing still "
        "drive the result. Upload a CSV to override."
    )


# ---------------------------------------------------------------------------
# Tab 1 — Scenario & Projections
# ---------------------------------------------------------------------------
def _both_scenarios(key, area_ha, years, start_condition, cal):
    out = {}
    for k in ("mangrove", "urban"):
        rows = sc.project(k, area_ha, years, start_condition)
        rows = sc.apply_calibration(rows, cal, k)
        out[k] = {"rows": rows, "summary": sc.summarize(rows, sc.resolve(k), area_ha, start_condition)}
    return out


def run_projection(scenario_label, area_ha, years, start_condition, calib_file):
    cal = _calibration_from_file(calib_file)
    key = sc.LABEL_TO_KEY.get(scenario_label, "mangrove")
    rows = sc.project(key, area_ha, years, start_condition)
    rows = sc.apply_calibration(rows, cal, key)
    scn = sc.resolve(key)
    summary = sc.summarize(rows, scn, area_ha, start_condition)
    cmp = _both_scenarios(key, area_ha, years, start_condition, cal)

    canopy = plots.canopy_chart(rows, scn.label)
    carbon = plots.carbon_chart(rows, scn.label)
    stems = plots.stems_chart(rows, scn.label)
    compare = plots.compare_chart(cmp)
    table = plots.summary_cards(cmp, area_ha, years)

    headline = (
        f"**{scn.label}** · {area_ha:g} ha · {years} years · starting condition x{start_condition:.2f}\n\n"
        f"- Canopy cover **{summary['canopy_start_pct']:.1f}% → {summary['canopy_end_pct']:.1f}%**\n"
        f"- Cumulative carbon **{summary['carbon_tco2e']:,.0f} tCO2e** "
        f"({summary['carbon_tco2e_per_ha']:.2f} tCO2e/ha)\n"
        f"- Living stems **{summary['living_stems']:,}** · mean height **{summary['mean_height_m']:.1f} m**\n"
        f"- Indicative cost **${summary['cost_estimate']:,.0f}** "
        f"(~ **${summary['cost_per_tco2e']:,.0f} per tCO2e**)\n\n"
        f"*{sc.CAVEAT}*"
    )
    return headline, canopy, carbon, stems, compare, table, _calibration_text(calib_file)


def make_walkthrough(scenario_label, area_ha, years, start_condition, calib_file):
    cal = _calibration_from_file(calib_file)
    key = sc.LABEL_TO_KEY.get(scenario_label, "mangrove")
    try:
        return AGENT.walkthrough(key, area_ha, years, start_condition, cal)
    except Exception:
        return f"Walkthrough failed:\n```\n{traceback.format_exc()}\n```"


def make_impact_story(scenario_label, area_ha, years, start_condition, calib_file):
    cal = _calibration_from_file(calib_file)
    key = sc.LABEL_TO_KEY.get(scenario_label, "mangrove")
    try:
        return AGENT.impact_story(key, area_ha, years, start_condition)
    except Exception:
        return f"Story failed:\n```\n{traceback.format_exc()}\n```"


# ---------------------------------------------------------------------------
# Tab 2 — Asimov Agent
# ---------------------------------------------------------------------------
def agent_chat(message, history, scenario_label, area_ha, years, start_condition):
    if not message or not message.strip():
        return history, ""
    history = list(history or [])
    history.append({"role": "user", "content": message})
    key = sc.LABEL_TO_KEY.get(scenario_label, "mangrove")
    try:
        reply = AGENT.ask(message, key, area_ha, years, start_condition)
    except Exception:
        reply = f"The local explainer hit an error:\n```\n{traceback.format_exc()}\n```"
    history.append({"role": "assistant", "content": reply})
    return history, ""


# ---------------------------------------------------------------------------
# Tab 3 — Planting Planner
# ---------------------------------------------------------------------------
def run_plan(cohorts_text, scenario_label, area_ha, years, start_condition):
    cohorts = []
    for line in (cohorts_text or "").strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p for p in line.replace(";", ",").split(",") if p.strip() != ""]
        if len(parts) < 2:
            continue
        try:
            cohorts.append({"year": int(float(parts[0])), "stems_per_ha": float(parts[1])})
        except ValueError:
            continue
    key = sc.LABEL_TO_KEY.get(scenario_label, "mangrove")
    if not cohorts:
        cohorts = [{"year": 0, "stems_per_ha": sc.resolve(key).stems_per_ha}]

    plan = asimov.tool_planting_plan(area_ha, cohorts, years, start_condition, key)
    rows = plan["rows"]
    scn = sc.resolve(key)
    chart = plots.canopy_chart(rows, f"{scn.label} — phased planting")
    carbon = plots.carbon_chart(rows, f"{scn.label} — phased planting")
    summary = sc.summarize(rows, scn, area_ha, start_condition)
    md = (
        "### Phased planting plan\n\n"
        + "\n".join(f"- **Year {c['year']}** — {c['stems_per_ha']:,.0f} stems/ha" for c in cohorts)
        + f"\n\nBy year {years}: canopy **{summary['canopy_end_pct']:.1f}%**, "
          f"carbon **{summary['carbon_tco2e']:,.0f} tCO2e**, "
          f"**{summary['living_stems']:,}** living stems.\n\n"
        f"*{sc.CAVEAT}* Phasing spreads both cost and heat stress; it also delays canopy closure."
    )
    return md, chart, carbon


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------
def _gradio_major() -> int:
    try:
        return int(str(getattr(gr, "__version__", "4")).split(".")[0])
    except Exception:
        return 4


def _make_blocks():
    """
    Gradio 4.x takes theme/css on Blocks(); Gradio 6 moved them to launch()/
    mount_gradio_app() and only warns if they are passed here.
    """
    kwargs = {"title": "SAP Forest EduTwin"}
    if _gradio_major() < 6:
        kwargs["theme"] = gr.themes.Soft()
        kwargs["css"] = CSS
    return gr.Blocks(**kwargs)


def _make_chatbot():
    """Gradio 4.x accepts type="messages"; Gradio 6 removed the kwarg."""
    try:
        return gr.Chatbot(label="Asimov", type="messages", height=460)
    except TypeError:
        return gr.Chatbot(label="Asimov", height=460)


def _launch_kwargs():
    """Gradio 6 moved theme/css from Blocks() to launch()."""
    import inspect
    try:
        params = inspect.signature(gr.Blocks.launch).parameters
    except Exception:
        return {}
    kwargs = {}
    if "theme" in params:
        kwargs["theme"] = gr.themes.Soft()
    if "css" in params:
        kwargs["css"] = CSS
    return kwargs


def _mount_kwargs():
    """Gradio 6 also accepts theme/css on gr.mount_gradio_app()."""
    import inspect
    try:
        params = inspect.signature(gr.mount_gradio_app).parameters
    except Exception:
        return {}
    kwargs = {}
    if "theme" in params:
        kwargs["theme"] = gr.themes.Soft()
    if "css" in params:
        kwargs["css"] = CSS
    return kwargs


def build_server():
    """
    Assemble the FastAPI app: Gradio UI at "/" plus two static mounts.

      /plot         -> static/plot_twin.html   (the Three.js plot twin)
      /plot-assets  -> ../assets               (vendored SimReady GLB + data files)

    Gradio 6 does not expose a public static-file route for sibling HTML, so we
    mount them explicitly. Falls back to the plain demo.launch() path if
    gr.mount_gradio_app is unavailable.
    """
    import fastapi
    from fastapi.staticfiles import StaticFiles

    static_dir = HERE / "static"
    assets_dir = HERE.parent / "assets"

    api = fastapi.FastAPI()
    if static_dir.is_dir():
        api.mount("/plot", StaticFiles(directory=str(static_dir)), name="plot")
    if assets_dir.is_dir():
        api.mount("/plot-assets", StaticFiles(directory=str(assets_dir)), name="plot-assets")

    return gr.mount_gradio_app(
        api, demo, path="/", server_name="127.0.0.1",
        allowed_paths=[str(HERE)], **_mount_kwargs(),
    )


demo = _make_blocks()

with demo:
    gr.HTML(
        "<div class='sap-title'>🌳 SAP Forest EduTwin</div>"
        "<div class='sap-note'>A privacy-first, on-device educational companion to high-end NVIDIA urban-forest "
        "digital twins. Bridges <b>Treegens Proof of Tree</b> real planting with <b>NVIDIA Omniverse / Cosmos</b> "
        "physical-AI storytelling. All numbers are <i>illustrative averages, not site-specific predictions</i>.</div>"
    )

    with gr.Row():
        backend_box = gr.Markdown()
        ref_box = gr.Markdown()

    # ---------------- TAB 1 ----------------
    with gr.Tabs():
        with gr.Tab("Scenario & Projections"):
            with gr.Row():
                with gr.Column(scale=3):
                    scenario_dd = gr.Dropdown(
                        choices=sc.SCENARIO_LABELS,
                        value=sc.MANGROVE.label,
                        label="Scenario",
                        info="Mangrove restoration (Treegens-style) vs urban street canopy",
                    )
                    area_sl = gr.Slider(0.1, 100.0, value=10.0, step=0.1, label="Area (hectares)")
                    years_sl = gr.Slider(0, 15, value=15, step=1, label="Years (0-15)")
                    start_sl = gr.Slider(0.2, 1.5, value=1.0, step=0.05,
                                         label="Starting condition (stocking multiplier)")
                    calib_file = gr.File(label="Calibration CSV (optional — overrides built-in reference)",
                                         file_types=[".csv"], file_count="single")
                    gr.Markdown(
                        "<div class='sap-note' style='font-size:11px'>Columns: "
                        "<code>scenario,year,canopy_pct,carbon_tco2e</code>. Leave empty to use the "
                        "built-in reference curve digitised from the published SAP graphs.</div>"
                    )
                    go_btn = gr.Button("Project 15-year trajectory", variant="primary")
                with gr.Column(scale=6):
                    headline_md = gr.Markdown()
                    canopy_plot = gr.Plot(label="Canopy cover")
                    carbon_plot = gr.Plot(label="Cumulative carbon")

            with gr.Accordion("More charts & comparison", open=True):
                stems_plot = gr.Plot(label="Living stems & mean height")
                compare_plot = gr.Plot(label="Mangrove vs urban")
                table_md = gr.Markdown()

            with gr.Accordion("Narrative (local model)", open=True):
                walk_btn = gr.Button("Narrated walkthrough", variant="secondary")
                story_btn = gr.Button("Impact story", variant="secondary")
                walk_md = gr.Markdown()
                story_md = gr.Markdown()

            go_btn.click(run_projection,
                         inputs=[scenario_dd, area_sl, years_sl, start_sl, calib_file],
                         outputs=[headline_md, canopy_plot, carbon_plot, stems_plot,
                                  compare_plot, table_md, ref_box])
            walk_btn.click(make_walkthrough,
                           inputs=[scenario_dd, area_sl, years_sl, start_sl, calib_file],
                           outputs=[walk_md])
            story_btn.click(make_impact_story,
                            inputs=[scenario_dd, area_sl, years_sl, start_sl, calib_file],
                            outputs=[story_md])
            demo.load(run_projection,
                      inputs=[scenario_dd, area_sl, years_sl, start_sl, calib_file],
                      outputs=[headline_md, canopy_plot, carbon_plot, stems_plot,
                               compare_plot, table_md, ref_box])

        # ---------------- TAB 2 ----------------
        with gr.Tab("Asimov Agent (local)"):
            gr.Markdown(
                "Ask anything about the scenario. Numbers come from the deterministic model; the local model "
                "only narrates them and is instructed to always flag them as illustrative."
            )
            with gr.Row():
                with gr.Column(scale=4):
                    agent_scn = gr.Dropdown(choices=sc.SCENARIO_LABELS, value=sc.MANGROVE.label, label="Scenario")
                    agent_area = gr.Slider(0.1, 100.0, value=10.0, step=0.1, label="Area (hectares)")
                    agent_years = gr.Slider(0, 15, value=15, step=1, label="Years")
                    agent_start = gr.Slider(0.2, 1.5, value=1.0, step=0.05, label="Starting condition")
                with gr.Column(scale=8):
                    chat = _make_chatbot()
                    chat_in = gr.Textbox(placeholder="Ask about canopy, carbon, cost, verification, digital twins...",
                                         label="Question")
                    send_btn = gr.Button("Send", variant="primary")

            gr.Markdown("**Quick prompts**")
            with gr.Row():
                quick_btns = [gr.Button(q, scale=1) for q in QUICK_QUESTIONS]

            send_btn.click(agent_chat,
                           inputs=[chat_in, chat, agent_scn, agent_area, agent_years, agent_start],
                           outputs=[chat, chat_in])
            chat_in.submit(agent_chat,
                           inputs=[chat_in, chat, agent_scn, agent_area, agent_years, agent_start],
                           outputs=[chat, chat_in])
            for btn, q in zip(quick_btns, QUICK_QUESTIONS):
                btn.click(lambda q=q: q, inputs=None, outputs=chat_in).then(
                    agent_chat,
                    inputs=[chat_in, chat, agent_scn, agent_area, agent_years, agent_start],
                    outputs=[chat, chat_in],
                )

        # ---------------- TAB 3 ----------------
        with gr.Tab("Planting Planner"):
            gr.Markdown("Design a phased intervention. One cohort per line: `year, stems_per_ha`.")
            cohorts_box = gr.Textbox(value="0, 1200\n5, 700\n10, 450",
                                     label="Cohorts (year, stems per hectare)", lines=5)
            with gr.Row():
                with gr.Column(scale=3):
                    plan_scn = gr.Dropdown(choices=sc.SCENARIO_LABELS, value=sc.MANGROVE.label, label="Scenario")
                    plan_area = gr.Slider(0.1, 100.0, value=10.0, step=0.1, label="Area (hectares)")
                    plan_years = gr.Slider(0, 15, value=15, step=1, label="Years")
                    plan_start = gr.Slider(0.2, 1.5, value=1.0, step=0.05, label="Starting condition")
                    plan_btn = gr.Button("Design plan", variant="primary")
                with gr.Column(scale=6):
                    plan_md = gr.Markdown()
                    plan_canopy = gr.Plot(label="Canopy under phased planting")
                    plan_carbon = gr.Plot(label="Carbon under phased planting")
            plan_btn.click(run_plan,
                           inputs=[cohorts_box, plan_scn, plan_area, plan_years, plan_start],
                           outputs=[plan_md, plan_canopy, plan_carbon])

        # ---------------- TAB 4 ----------------
        with gr.Tab("3D Plot Twin"):
            gr.Markdown(
                "A lightweight Three.js plot twin carrying **NVIDIA SimReady** assets (OpenUSD to GLB): "
                "a barrier fence (plot boundary), a plywood crate used as a planter, and a waste bin "
                "(street furniture). Trees are procedural and instanced so the scene stays small and "
                "runs on modest hardware."
            )
            gr.HTML(
                "<iframe src='/plot/plot_twin.html' style='width:100%;height:560px;border:1px solid #223141;"
                "border-radius:16px;background:#0b0f14'></iframe>"
            )
            gr.Markdown(
                "Asset manifest: `assets/trees.manifest.json` · assets vendored in `assets/plot/` · "
                "source: [codepawl/simready-glb](https://huggingface.co/datasets/codepawl/simready-glb) "
                "(web-ready GLB conversions of "
                "[nvidia/simready-assets](https://huggingface.co/datasets/nvidia/simready-assets))."
            )

        # ---------------- TAB 5 ----------------
        with gr.Tab("About & Explainability"):
            gr.Markdown(EXPLAINABILITY_MD)

    demo.load(lambda: llm.backend_status_markdown(), outputs=[backend_box])


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "7860"))
    try:
        server = build_server()
        import uvicorn
        print(f"[SAP] Forest EduTwin -> http://127.0.0.1:{port}  (plot twin: /plot/plot_twin.html)")
        uvicorn.run(server, host="127.0.0.1", port=port, log_level="warning")
    except Exception as exc:  # pragma: no cover - fallback for older Gradio
        print(f"[SAP] mount_gradio_app unavailable ({exc}); falling back to demo.launch()")
        demo.launch(server_name="127.0.0.1", server_port=port, share=False,
                    allowed_paths=[str(HERE)], **_launch_kwargs())
