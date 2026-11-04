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

## Reference curve: how `growth_reference.csv` was made

The reference curves are **not hand-waved numbers**. They were digitised from the three
published SAP graphs by `tools/digitize_reference.py`. The source PNGs are vendored in
`data/reference_graphs/` (~140 KB total), so the whole chain runs from a fresh clone with no
external files:

| Vendored file | Original | What it gives |
|---|---|---|
| `canopy_growth.png` | `image (2).png` — *Educational 15-Year Canopy Growth Projection* | canopy cover (%) vs years 0–15 |
| `cumulative_carbon.png` | `image (1).png` — *Illustrative Cumulative Carbon Storage* | cumulative carbon (tC per hectare) vs years 0–15 |
| `year15_bars.png` | `image.png` — *Year 15 Canopy Cover* + *Year 15 Illustrative CO₂e* | independent bar cross-check of the year-15 endpoints |

Method (fully reproducible — `python tools/digitize_reference.py --write`):

1. **Axis recovery.** Tick *marks* (dark pixels just outside the axes spines) are located
   programmatically; the tick *values* are read off the rendered axis labels and fitted with
   least squares. Gridlines are never used for calibration, so legend-box artefacts cannot
   poison it.
2. **Series isolation.** The series are the exact matplotlib colours — green `(0,128,0)` for
   mangrove, blue `(0,0,255)` for urban.
3. **Trace.** A dynamic program scores paths by *uncovered columns*. The matplotlib legend
   swatch occupies only ~35 columns, so any path that teleports from the swatch to the real
   curve leaves hundreds of columns uncovered and loses. The genuine curve wins; dashed
   series still trace correctly because their gaps are short.
4. **Sampling.** Each year is sampled from the traced path, refined to the sub-pixel centre
   of the drawn line, with the dashed tail extrapolated to year 15.

**Validation.** The digitised year-15 endpoints are checked against the *bar* graph, which is
an entirely separate rendering:

| | digitised | bar graph | error |
|---|---|---|---|
| mangrove canopy | 88.07 % | 88.14 % | 0.08 % |
| urban canopy | 45.55 % | 45.58 % | 0.07 % |
| mangrove CO₂e | 426.25 t/ha | 427.08 t/ha | 0.20 % |
| urban CO₂e | 126.16 t/ha | 127.08 t/ha | 0.73 % |

Regenerating the CSV from the vendored graphs reproduces it **byte for byte**.

### How the calibration is applied

`apply_calibration()` never pastes the reference over the model. For each year it derives a
correction factor and applies it multiplicatively:

```
k(t)         = reference(t) / model_reference(t)
calibrated(t) = model(t) * k(t)
```

`model_reference(t)` is the model's own prediction for canonical conditions (1 ha, full
stocking, one cohort at year 0). So:

* at full stocking the app reproduces the published curve **year by year**, not just at the
  endpoint (the previous endpoint-only scaling matched the year-15 bar but had the wrong
  curve *shape* — mangrove canopy rose 4.7 % in year 1 where the graph shows ≈24 %);
* planting density, plot area and cohort timing still move the result the way the underlying
  model says they should, because only the *factor* is imported, never the absolute values;
* year 0 keeps the model's meaning — "the day you plant" is 0 % canopy and 0 carbon. The
  published curves assume a little pre-existing canopy at year 0 (5.8 % mangrove / 8.4 %
  urban) that this planting model does not include.

Upload your own CSV in the UI to override the built-in reference.

---

## Files

```
forest_edutwin/
  app.py                 Gradio UI (5 tabs)
  scenarios.py           deterministic growth + carbon model + calibration
  agent.py               Asimov explainability agent + tools
  model.py               Ollama / transformers-4bit / template backends
  plots.py               Plotly figures (Treegens palette)
  static/plot_twin.html  Three.js 3D plot twin (SimReady assets) — served at /plot/plot_twin.html
  hf_sample_fetch.py     selective Hugging Face sample fetcher
  data/growth_reference.csv  reference curves digitised from the published graphs
  data/reference_graphs/     the three source PNGs the curves were digitised from
  tools/digitize_reference.py     reproduces data/growth_reference.csv from the PNGs
  tools/verify_calibration.py     checks the calibrated model against the published bars
  tools/check_reference_current.py  confirms the committed CSV still matches a fresh digitisation
  EXPLAINABILITY (in app.py)
```

### Verify the whole chain

```bash
python tools/check_reference_current.py   # CSV == fresh digitisation
python tools/verify_calibration.py        # calibrated curve == published curve + responsiveness
```

Both must print `PASS`. The first guards the *source data*, the second guards the
*calibration algebra*.

MIT licensed. Designed as the citizen-facing on-ramp to the full SAP Three.js canopy twin
(`../index.html`) and the Treegens Dashboard v2.
