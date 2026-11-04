# SAP Canopy Digital Twin — Design Brief
**Project:** S.A.P. = Shaddai Asimov Project  
**Agent:** TURTLE — UI/UX & Creative  
**Version:** 1.0 — implemented

> This brief describes the shipped design. See [`README.md`](README.md) for how to run it
> and [`forest_edutwin/README.md`](forest_edutwin/README.md) for the Gradio explainer.
>
> Changes from the 0.1 scaffold: the world plane is now **equirectangular at world scale**
> (1 unit = 1 km), the Leaflet bridge is **two-way**, groves are **budgeted instanced meshes**
> (≈5 200 trees, 2 draw calls), plot-twin props are **NVIDIA SimReady OpenUSD→GLB**, and the
> explainer drawer runs a **local Ollama model** with a deterministic offline fallback.

## Vision
A feel-first 3D urban forest canopy digital twin that maps Treegens Dashboard v2 claim data to a sacred-geometry forest. Users perceive carbon, health, and species distribution instantly through color, scale, and motion.

## Core Experience Principles
- Start from feeling → layout → pixels
- Motion with purpose: gentle sway, LOD fade, focus zoom
- Brand consistency: CSS tokens --accent:#4caf50, --gold:#ffd54f
- Dashboard tokens match Treegens v2 surface/border typography

## Architecture
```
index.html
styles.css   → CSS variables, Treegens tokens, signal-card accents
main.js      → Three.js scene, OrbitControls, InstancedMesh, LOD, sacred placement
adapter.js   → Treegens AirlinesDB.load() / getByClaim() → 3D attributes
leaflet-bridge.js → Leaflet ⇄ Three.js camera sync + clustered claim markers
```

## Three.js Setup
- Importmap for three@0.160.0
- ES modules
- Scene, PerspectiveCamera, WebGLRenderer, FogExp2
- Hemisphere + Directional light
- Ground plane + grid
- InstancedMesh for trunks + foliage (TREE_COUNT ~800-2000)
- THREE.LOD for distant impostors
- DRACOLoader + GLTFLoader ready for ProSceneverse GLB

## Procedural Instancing & LOD
- Trunk: CylinderGeometry, instanced
- Foliage: IcosahedronGeometry, instanced, color modulated by health
- Per-instance matrix + color
- LOD levels: full mesh < 150m, low-poly > 150m
- Frustum culling + distance fade

## Sacred Geometry Placement
- Fibonacci spiral for natural distribution
- Metatron's cube node overlay for claim anchors
- `adapter.generateMetatronPositions(count, centerLat, centerLng, radiusMeters)`
- Age factor modulates scale variance

## Treegens Integration
- AirlinesDB.load() on init
- AirlinesDB.getByClaim(claimId) → record
- Map record → 3D attributes:
  - species → color palette
  - health → opacity + hue shift
  - height → trunkScale.y
  - canopy → foliageScale
  - carbon → KPI aggregation
- MockDB fallback for offline dev

## UI/UX
- Layout: topbar + sidebar 320px + viewer
- CSS variables: --accent, --gold, --surface, --border, --text, --muted
- Cards with soft shadows, signal-card left accent
- KPIs: Carbon Sequestered, Trees Rendered, Avg Health
- Controls: Claim focus, density, opacity, sacred toggle
- Tooltip on hover for tree details

## Leaflet ↔ Three Sync Concept
1. Leaflet map mounted in #leaflet-overlay with pointer-events:none by default
2. Shared Mercator projection util latLng ↔ XZ
3. OrbitControls change → update Leaflet center/zoom
4. Map drag → lerp Three camera position
5. Hybrid mode: map click → raycast to tree instance → focus
6. Performance: map tiles cached, Three renders on top

## Hugging Face CAD Tree Model Integration
**Goal:** Replace procedural foliage with ProSceneverse GLB trees

Brief:
- Host GLBs on Hugging Face Spaces / S3 with CORS enabled
- Use DRACOLoader decoder path: https://www.gstatic.com/draco/v1/decoders/
- GLTFLoader.load(url) → scene graph
- Normalize scale: `model.scale.setScalar(0.01 * targetHeight)`
- Bake materials to PBR, set roughness/metalness per species
- Instancing option: use `InstancedMesh` with a single GLB mesh via `SkeletonUtils.clone` for low count, or GPU instancing for high count
- LOD: provide three GLB variants per species: high / medium / low
- Health visualization: vertex colors or material emissive tint
- Asset pipeline: JSON manifest mapping species → GLB URLs + LOD thresholds
- Example load:
```js
gltfLoader.load('https://huggingface.co/.../oak.glb', gltf=>{
  const tree = gltf.scene;
  tree.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true }});
  scene.add(tree);
});
```

## Performance Notes
- InstancedMesh keeps draw calls ~2
- Limit TREE_COUNT based on device
- Use frustum culling, occlusion
- Texture atlases for bark/leaf
- Draco compression for GLBs

## Next Steps
- Wire real AirlinesDB endpoint
- Implement Leaflet sync with actual map tiles
- Add ProSceneverse GLB manifest
- Add focus animation & tooltip
- Export snapshot & analytics panel
