# SAP Canopy — Urban Forest Digital Twin

Three.js digital twin of an urban/mangrove forest, driven by **Treegens** sponsorship claims,
with a **Leaflet ⇄ Three.js** camera bridge and a local-first **Asimov** explainer.

```
sap-canopy/
  index.html            SPA shell (importmap, Leaflet, Treegens tokens)
  styles.css            TURTLE UI system (Treegens v2 tokens)
  main.js               Three.js scene, instanced groves, plot twin, explainer panel
  adapter.js            Treegens AirlinesDB -> derived tree cohorts -> Three attributes
  leaflet-bridge.js     two-way camera sync + clustered claim markers
  assets/
    trees.manifest.json asset + model manifest (SimReady, CAD, models)
    plot/               vendored NVIDIA SimReady GLB assets (~950 KB)
    data/               vendored CAD / CADGenBench samples (~120 KB)
  forest_edutwin/       Gradio educational explainer + mini digital twin (see its README)
```

## Run the 3D twin

```bash
cd sap-canopy
python -m http.server 8000
# open http://localhost:8000/index.html
```

(Any static server works — ES modules + importmap require `http://`, not `file://`.)

## What it does

* **Reads the real Treegens store.** `AirlinesDB` is picked up from `window.AirlinesDB`, then
  `localStorage.treegensAirlines`, then `?treegens=<url>`, then an offline seed.
* **Derives a tree cohort per claim** with a documented, deterministic rule set
  (stems from `dealSize` × phase, health from `stage`, biome from `region`, position from the
  Treegens region centroids). Treegens has **no tree geometry today**, so every derived value is
  flagged `derived: true` and labelled *illustrative averages, not site-specific predictions*.
  If a future Treegens schema ships real tree fields, they automatically win.
* **Renders each cohort as an instanced grove** whose footprint scales with the funded stem
  count, positioned at the claim's true lat/lng on an equirectangular world plane.
* **Syncs Leaflet ⇄ Three.js.** Drag the map, orbit the 3D view — one camera, two projections.
  CartoDB dark tiles, exactly like TREEGENS Dashboard v2.
* **Loads a plot twin** with NVIDIA SimReady assets (OpenUSD → GLB) via `GLTFLoader` +
  `DRACOLoader`, with a procedural instanced fallback if the assets are missing.
* **Explains on-device.** The drawer asks a local Ollama model (Qwen2.5-1.5B / Gemma-2-2B /
  Phi-3-mini). Offline, it falls back to a deterministic explainer. Nothing leaves the machine.

## Controls

| Control | Effect |
|---|---|
| Tree Density | rebuilds groves (instance budget re-applied) |
| Canopy Opacity | foliage material opacity |
| Show Sacred Nodes | Metatron's-cube overlay per grove |
| Jump to Plot Twin | flies to the SimReady plot |
| Focus Claim | jump to a Treegens claim by ID or airline name |
| Map / 3D | split, map-only or 3D-only |
| Ask Asimov | local explainer in the right drawer |

## Data reality check

Verified against the Treegens handoff:

* `AirlinesDB` record shape: `id, name, region, fleet, dealSize, urgency, stage, status,
  claimedBy, ceo, contactEmail, phase, lastContact, nextFollowUp`
* Methods: `load() save() add() update() delete() claim() unclaim() getByClaim() getByRegion() getByStage()`
* Storage: `localStorage['treegensAirlines']`
* Region centroids (from TREEGENS Dashboard v2 `regionCoords`): EU, US, Asia, ME, Africa, LatAm
* **There are no tree fields** (no species / lat / lng / health / height / canopy / carbon).
  That gap is exactly what `adapter.js` fills with a documented, deterministic derivation.

## Performance

* ~5 200 instanced trees max, 2 draw calls
* ~5 000 Leaflet markers clustered
* Pixel ratio capped at 1.75
* Target: comfortable on an 8 GB ThinkPad with integrated graphics
