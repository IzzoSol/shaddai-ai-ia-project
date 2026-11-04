# Shaddai Asimov Project (S.A.P.)

**Asimov** — the local-first explainability companion for Treegens real planting and
NVIDIA-style physical-AI urban-forest digital twins.

> Repo renamed to `shaddai-asimov-project`. Branch: `main`.

## What's inside

| Path | What it is |
|---|---|
| `sap-canopy/` | Three.js urban/mangrove forest digital twin + Leaflet ⇄ Three camera bridge + local explainer drawer |
| `sap-canopy/forest_edutwin/` | Gradio educational explainer & mini digital twin (5 tabs, runs on 8 GB RAM) |
| `asimov-site/` | Asimov static site |
| `asimov-quill-skill/` | QUILL skill for Asimov-style long-form writing |
| `bible/` | Project treatment / canon documents |
| `Isaac_Asimov_Agent.md` | Agent persona + operating rules |

## Quick start

```bash
# 1. the educational explainer (local-first, Ollama optional)
cd sap-canopy/forest_edutwin
pip install -r requirements.txt
python app.py                      # http://127.0.0.1:7860

# 2. the 3D digital twin
cd ..
python -m http.server 8000         # http://localhost:8000/index.html
```

## The idea

Treegens funds and verifies tree planting (Proof of Tree). NVIDIA's physical-AI stack simulates
cities at high fidelity (Omniverse / Cosmos / SimReady). The gap is the **middle**: a fast,
private, understandable layer where a community, a student, or an ambassador can see what a
15-year canopy and carbon trajectory actually means.

S.A.P. is that layer — and it runs on a modest ThinkPad, offline, with no keys.

## Principles

1. **Local-first.** Ollama / transformers-4bit / deterministic fallback. No cloud, no telemetry.
2. **Explainable by construction.** Numbers are deterministic and auditable (`scenarios.py`);
   the model only narrates numbers it was handed (`agent.py`).
3. **Always caveated.** Every answer carries *illustrative averages, not site-specific predictions*.
4. **Honest about the data.** Treegens ships sponsorship claims, not tree geometry. Everything
   derived is labelled as derived.
5. **Small downloads.** Hugging Face assets are fetched selectively — streamed or a few hundred KB.

## Licence

MIT.

## Agents

Built with the SHADDAI council: TURTLE (UI/UX), NEXUS (architecture), ORACLE (research),
QUILL (writing), ZEROX (economics), PIKADON (security), SHADDAI (orchestration).
