# SAP Urban Forest Growth Explainer

Educational mini-sim bridging Treegens ReFi regeneration with NVIDIA Physical AI smart-city narrative.

> **SUPERSEDED.** This README describes the first matplotlib prototype
> (`urban_forest_explainer.py`). The current, maintained app is
> **`forest_edutwin/app.py`** — see [`forest_edutwin/README.md`](forest_edutwin/README.md)
> and [`README.md`](README.md).
>
> The items that were "Next Steps" below are now **done**:
> - Leaflet ⇄ Three.js camera sync → `leaflet-bridge.js`
> - Hugging Face GLB assets → NVIDIA **SimReady** OpenUSD→GLB in `assets/plot/`
> - Agentic Q&A with a local small model → `forest_edutwin/agent.py` + `model.py`
> - Real Treegens schema bridge → `adapter.js` (AirlinesDB → derived cohorts)

## Concept
Inspired by NVIDIA's coverage of Linker Vision + MVRDV using Omniverse and Nemotron to simulate 15-year urban forest canopy outcomes in 10 minutes. This demo provides the citizen-facing explanation layer: what 15 years of growth looks like, basic carbon/impact estimates, and Treegens-style regeneration scenarios.

## Run locally
```bash
cd sap-canopy
pip install -r requirements.txt
python urban_forest_explainer.py
```
Open http://127.0.0.1:7860

## Features
- Species presets for urban trees and mangroves
- 15-year projection of height and canopy area
- Rough carbon sequestration estimate per tree / portfolio
- Natural-language walkthrough tying Treegens ReFi claims to NVIDIA digital twin narrative
- Lightweight: runs on modest hardware, no GPU required

## Bridge to Treegens + NVIDIA
- Treegens ReFi provides regeneration claims and claims data
- NVIDIA Omniverse / Cosmos provides physical AI simulation and vision verification
- This explainer is the bridge: explainability + education + on-ramp to the full Three.js SAP canopy digital twin

## Next Steps (historical — since completed)
- Connect to real Treegens tree schema when available
- Add Leaflet map sync with Three.js canopy
- Integrate Hugging Face ProSceneverse GLB models for visual fidelity
- Add agentic Q&A using local small model for walkthrough personalization
