# SAP Forest EduTwin

**Lightweight educational urban/mangrove forest growth explainer + mini digital twin.**
Runs on an 8 GB ThinkPad. Local-first, privacy-first, open-source friendly.

Bridges **Treegens** real planting (Proof of Tree) with **NVIDIA physical-AI / Omniverse-Cosmos**
smart-city storytelling — as an accessible, on-device companion to high-end urban-forest twins.

> Every number this app produces is an **illustrative average, not a site-specific prediction**.
> The caveat is printed on every answer.

---

## What it does

| Feature | Detail |
|---|---|
| Scenario selector | Mangrove restoration (Treegens-style) **vs** urban street canopy |
| Sliders | area (hectares), years **0–15**, starting condition (stocking multiplier) |
| Charts | canopy cover %, cumulative carbon tCO2e, living stems + mean height, side-by-side comparison |
| Asimov agent | local LLM (Ollama) for what-if Q&A, metric explanations, impact stories, Three.js scene code |
| Planting planner | staggered cohorts → phased intervention design |
| 3D plot twin | Three.js scene with **NVIDIA SimReady** assets (OpenUSD → GLB) + procedural instanced trees |
| Calibration | upload a CSV (e.g. digitised from published graphs) to ground the curves |

## Run it

```bash
cd sap-canopy/forest_edutwin
pip install -r requirements.txt
python app.py
# open http://127.0.0.1:7860
```

The app is served through a small FastAPI wrapper (Gradio 6 has no public static-file
route for sibling HTML), which mounts three things:

| Route | Serves |
|---|---|
| `/` | the Gradio UI (5 tabs) |
| `/plot/plot_twin.html` | the Three.js plot twin (tab 4 iframe) |
| `/plot-assets/…` | the vendored SimReady GLB + CAD sample files from `../assets/` |

On older Gradio (4.x) it falls back to `demo.launch()` automatically.

Optional — enable real narration with a local model (no cloud, no keys):

```bash
ollama serve
ollama pull qwen2.5:1.5b      # ~1 GB RAM. gemma2:2b / phi3:mini also fine.
```

Without Ollama the app still works: the deterministic template explainer takes over.

Optional — 4-bit transformers fallback instead of Ollama:

```bash
pip install "transformers>=4.40" bitsandbytes accelerate
set SAP_BACKEND=transformers
python app.py
```

Optional — fetch the Hugging Face sample assets (already vendored, so this is just a refresh):

```bash
python hf_sample_fetch.py            # small files only
python hf_sample_fetch.py --stream   # + 1 streamed row from Zero-To-CAD-1m
python hf_sample_fetch.py --gated    # + gated datasets (needs HF_TOKEN)
```

---

## Hugging Face sources used

**Simulation-ready assets (NVIDIA SimReady Central / OpenUSD)**
* Blog: <https://huggingface.co/blog/nvidia/simready-central-assets-robotics-ai-factories>
* `nvidia/simready-assets` — OpenUSD packages with physics payloads (PhysX/MuJoCo/Newton)
* `nvidia/PhysicalAI-SimReady-Warehouse-01`
* `codepawl/simready-glb` — web-ready GLB conversions of the SimReady assets (**used in the 3D plot twin**)

**CAD / parametric datasets**
* `0x3/Zero-To-CAD-1m` — streamed (one row), never fully downloaded
* `VladPyatov/CADFS` — CAD sequence sample index (vendored, ~110 KB)
* `qq456cvb/img2cad-dataset`
* `HuggingAI4Engineering/cadgenbench-data` — edit-prompt sample (vendored)

**Generative / reverse-engineering models**
* `qq456cvb/img2cad`
* `hi3d-official/Hi3Dv1.0`
* `ccore/Qwen3.5-4B-3D-Coder` — optional local code-coder for Three.js scene snippets

**Gaussian / reconstruction**
* `GaussianWorld/scene_splat_49k` — gated; fetched only when `HF_TOKEN` is present

Everything vendored into `../assets/` is tiny: ~950 KB of GLB + ~120 KB of data.

---

## Model (explainable by construction)

```
1. survival(t)  = S_floor + (1-S_floor)·exp(-k_s·t)      stocking loss
2. height(t)    = H_max·(1 - exp(-k_h·t^p))              Weibull-ish growth
3. crown(t)     = R_max·(1 - exp(-k_c·t))                crown radius
4. cover(t)     = 100·(1 - exp(-K·A_crown/A_plot))       overlap-aware canopy cover
5. biomass(t)   = a·DBH²·H                               generic allometric proxy
6. carbon(t)    = 0.47·biomass ; CO2e = C·44/12
```

* `scenarios.py` — the numbers (deterministic, auditable)
* `agent.py` — the narration (local LLM, optional) and the tool router
* `model.py` — Ollama → transformers(4-bit) → template backend chain

The LLM never invents numbers: it is given the computed facts and asked to narrate only those.

---

## Where explainability is needed

See the **About & Explainability** tab inside the app (and `EXPLAINABILITY_MD` in `app.py`).
Short version — explainability is requested at *specific moments*:

| Moment | What is explained |
|---|---|
| projection produced | what the number is **and is not** |
| a number surprises | which equation drove it |
| comparing options | the shared assumptions behind both columns |
| cost question | what the cost excludes |
| funding/claim moment | how Treegens Proof of Tree turns a claim into evidence |
| digital-twin question | how a simulation meets street-level reality (Omniverse/Cosmos) |
| scenario changed | what the change actually did |

---

## Hardware envelope (8 GB ThinkPad)

| Piece | Budget |
|---|---|
| Gradio + Plotly + model | ~1.2–1.8 GB RAM (Qwen2.5-1.5B) |
| 3D plot twin | ~250 MB, ~900 instances, GPU optional |
| Vendored assets | < 1.1 MB |
| HF fetch (small) | < 2 MB |

No GPU required. No telemetry. No API keys. No cloud calls.

---

## Files

```
forest_edutwin/
  app.py                 Gradio UI (5 tabs)
  scenarios.py           deterministic growth + carbon model
  agent.py               Asimov explainability agent + tools
  model.py               Ollama / transformers-4bit / template backends
  plots.py               Plotly figures (Treegens palette)
  static/plot_twin.html  Three.js 3D plot twin (SimReady assets) — served at /plot/plot_twin.html
  hf_sample_fetch.py     selective Hugging Face sample fetcher
  data/growth_reference.csv  illustrative reference curves (1 ha)
  EXPLAINABILITY (in app.py)
```

MIT licensed. Designed as the citizen-facing on-ramp to the full SAP Three.js canopy twin
(`../index.html`) and the Treegens Dashboard v2.
