/**
 * SAP Canopy Digital Twin — main.js
 * ---------------------------------------------------------------------------
 * Three.js world-scale urban forest twin + Leaflet map bridge + local explainer.
 * TURTLE design: feel-first, motion with purpose, tokens aligned to Treegens v2.
 *
 * Data model (see adapter.js):
 *   Treegens AirlinesDB claim  ->  derived tree cohort  ->  instanced grove
 *   Treegens Dashboard v2 map  ->  LeafletBridge         ->  shared camera
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TreegensAdapter } from './adapter.js';
import { LeafletBridge } from './leaflet-bridge.js';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const CONFIG = {
  kmPerUnit: 1,                 // 1 world unit = 1 km
  lat0: 30,                     // equirectangular reference latitude
  maxInstancesPerGrove: 90,     // perf ceiling for 8GB hardware
  minInstancesPerGrove: 14,
  targetInstances: 5200,        // global budget
  manifestUrl: './assets/trees.manifest.json',
  ollamaUrl: 'http://localhost:11434/api/generate',
  ollamaModel: 'qwen2.5:1.5b',
  treeSeedBaseline: 2024
};

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
const adapter = new TreegensAdapter({
  jsonUrl: new URLSearchParams(location.search).get('treegens')
});
await adapter.load();
const cohorts = adapter.cohorts;
const summary = adapter.summary();

/* ------------------------------------------------------------------ */
/* Renderer / scene                                                    */
/* ------------------------------------------------------------------ */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.FogExp2(0x0b0f14, 0.00035);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 60000);
camera.position.set(0, 2600, 5200);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('three-canvas').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 40;
controls.maxDistance = 22000;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 0, 0);

/* Lights */
scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x081018, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.15);
sun.position.set(1800, 3200, 1400);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x4caf50, 0.25);
rim.position.set(-1500, 900, -1200);
scene.add(rim);

/* Equirectangular helpers — 1 unit = 1 km */
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.320 * Math.cos(CONFIG.lat0 * Math.PI / 180);

function latLngToXZ(lat, lng) {
  return { x: lng * KM_PER_DEG_LNG, z: -lat * KM_PER_DEG_LAT };
}
function xzToLatLng(x, z) {
  return { lat: -z / KM_PER_DEG_LAT, lng: x / KM_PER_DEG_LNG };
}
function zoomToDistance(zoom) {
  // Leaflet zoom -> camera height (km), matched to ~256 px tile scale
  return Math.max(60, 42000 / Math.pow(2, zoom - 1));
}
function distanceToZoom(dist) {
  return Math.max(2, Math.min(17, 1 + Math.log2(42000 / Math.max(dist, 60))));
}

/* Ground */
const groundMat = new THREE.MeshStandardMaterial({ color: 0x131c25, roughness: 0.95, metalness: 0.05 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(42000, 21000), groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(42000, 140, 0x1d2b38, 0x16212b);
grid.position.y = 2;
scene.add(grid);

/* ------------------------------------------------------------------ */
/* Groves — one instanced grove per Treegens claim                     */
/* ------------------------------------------------------------------ */
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1, 6);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9, roughnessMap: null });
const foliageGeo = new THREE.IcosahedronGeometry(1, 0);
const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02, vertexColors: false });

const MAX_INSTANCES = CONFIG.targetInstances;
const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_INSTANCES);
const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, MAX_INSTANCES);
trunkInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
foliageInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
trunkInst.castShadow = false;
foliageInst.receiveShadow = false;
scene.add(trunkInst, foliageInst);

/* Instance bookkeeping: instanceId -> cohort */
const instanceCohort = new Array(MAX_INSTANCES).fill(null);
const instanceTree = new Array(MAX_INSTANCES).fill(null);

/* Sacred geometry overlay (Metatron's cube nodes) */
const sacredGroup = new THREE.Group();
scene.add(sacredGroup);
const sacredGeo = new THREE.OctahedronGeometry(14, 0);
const sacredMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, wireframe: true, transparent: true, opacity: 0.55 });

/* ------------------------------------------------------------------ */
/* Grove building                                                      */
/* ------------------------------------------------------------------ */
function buildGroves(densityScale = 1) {
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let idx = 0;

  const totalStems = cohorts.reduce((s, c) => s + c.stems, 0) || 1;

  for (const cohort of cohorts) {
    if (idx >= MAX_INSTANCES) break;
    // Budget-aware instance count: share of total stems, clamped
    const share = cohort.stems / totalStems;
    let n = Math.round(
      Math.max(CONFIG.minInstancesPerGrove, Math.min(CONFIG.maxInstancesPerGrove, share * CONFIG.targetInstances))
      * densityScale
    );
    n = Math.max(4, Math.min(n, MAX_INSTANCES - idx));

    const { x, z } = latLngToXZ(cohort.lat, cohort.lng);
    const radiusKm = Math.max(0.6, Math.sqrt(cohort.stems) * 0.012); // grove footprint in km
    const radiusM = radiusKm * 1000;

    const baseColor = new THREE.Color(cohort.biome === 'mangrove' ? 0x2e7d32 : 0x66bb6a);

    for (let i = 0; i < n; i++) {
      if (idx >= MAX_INSTANCES) break;
      // deterministic jitter inside the grove
      const a = (i / n) * Math.PI * 2 * 1.6180339887;
      const rr = radiusM * Math.sqrt((i + 0.5) / n);
      const jx = Math.cos(a) * rr + Math.sin(i * 12.9898) * radiusM * 0.08;
      const jz = Math.sin(a) * rr + Math.cos(i * 78.233) * radiusM * 0.08;

      const px = x + jx / 1000;
      const pz = z + jz / 1000;

      const h = cohort.height * (0.72 + ((i * 37) % 100) / 100 * 0.5);
      const crown = cohort.canopy * (0.75 + ((i * 53) % 100) / 100 * 0.5);
      const health = cohort.health;

      dummy.position.set(px, h * 0.5, pz);
      dummy.scale.set(h * 0.08, h, h * 0.08);
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);
      trunkInst.setColorAt(idx, color.setHex(0x5d4037));

      dummy.position.set(px, h + crown * 0.55, pz);
      dummy.scale.set(crown, crown * 0.85, crown);
      dummy.rotation.set(0, a * 1.7, 0);
      dummy.updateMatrix();
      foliageInst.setMatrixAt(idx, dummy.matrix);

      const c = baseColor.clone();
      c.offsetHSL(0, 0, (health - 0.5) * 0.24 + (((i * 91) % 100) / 100 - 0.5) * 0.08);
      foliageInst.setColorAt(idx, c);

      instanceCohort[idx] = cohort;
      instanceTree[idx] = { height: h, crown, health, position: { lat: cohort.lat, lng: cohort.lng } };
      idx++;
    }

    // Metatron nodes for this grove (13 points) — toggleable overlay
    for (let n2 = 0; n2 < 13; n2++) {
      const ang = (n2 / 13) * Math.PI * 2;
      const rad = radiusM * 0.62;
      const node = new THREE.Mesh(sacredGeo, sacredMat);
      node.position.set(x + Math.cos(ang) * rad / 1000, radiusM * 0.35, z + Math.sin(ang) * rad / 1000);
      node.userData.cohortId = cohort.id;
      sacredGroup.add(node);
    }
  }

  trunkInst.count = idx;
  foliageInst.count = idx;
  trunkInst.instanceMatrix.needsUpdate = true;
  foliageInst.instanceMatrix.needsUpdate = true;
  if (foliageInst.instanceColor) foliageInst.instanceColor.needsUpdate = true;
  if (trunkInst.instanceColor) trunkInst.instanceColor.needsUpdate = true;
  return idx;
}

let instanceCount = buildGroves(1);

/* ------------------------------------------------------------------ */
/* Plot twin — NVIDIA SimReady assets (OpenUSD → GLB) + procedural grove */
/* ------------------------------------------------------------------ */
const plotGroup = new THREE.Group();
scene.add(plotGroup);

async function loadPlotTwin() {
  let manifest = null;
  try {
    const res = await fetch(CONFIG.manifestUrl);
    manifest = await res.json();
  } catch (e) {
    console.warn('[SAP] manifest unavailable, running procedural-only plot twin');
  }

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  if (manifest?.plotTwin?.assets) {
    for (const asset of manifest.plotTwin.assets) {
      const local = new URL(asset.file, document.baseURI).href;
      gltfLoader.load(
        local,
        (gltf) => {
          const obj = gltf.scene;
          obj.traverse(o => {
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
          });
          obj.position.set(...(asset.position || [0, 0, 0]));
          obj.rotation.y = asset.rotationY || 0;
          const s = asset.scale || 1;
          obj.scale.set(s, s, s);
          obj.userData.assetId = asset.id;
          obj.userData.assetLabel = asset.label;
          plotGroup.add(obj);
          console.info(`[SAP] loaded SimReady asset: ${asset.label}`);
        },
        undefined,
        () => console.warn(`[SAP] could not load ${asset.file} — procedural fallback active`)
      );
    }
  }

  // Procedural plot trees (mangrove cluster + street row) around the SimReady props
  const plotTrees = new THREE.Group();
  const pTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, 160);
  const pFoliage = new THREE.InstancedMesh(foliageGeo, foliageMat, 160);
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  for (let i = 0; i < 160; i++) {
    const mangrove = i < 110;
    const px = mangrove ? (Math.random() - 0.5) * 26 : -14 + (i - 110) * 1.1;
    const pz = mangrove ? (Math.random() - 0.5) * 22 : 10 + Math.sin(i) * 0.4;
    const h = mangrove ? 4 + Math.random() * 7 : 6 + Math.random() * 6;
    const crown = mangrove ? 1.6 + Math.random() * 1.6 : 2.0 + Math.random() * 2.2;
    d.position.set(px, h * 0.5, pz); d.scale.set(h * 0.08, h, h * 0.08); d.updateMatrix();
    pTrunk.setMatrixAt(i, d.matrix);
    d.position.set(px, h + crown * 0.5, pz); d.scale.set(crown, crown * 0.8, crown); d.updateMatrix();
    pFoliage.setMatrixAt(i, d.matrix);
    pFoliage.setColorAt(i, c.setHex(mangrove ? 0x2e7d32 : 0x66bb6a));
  }
  plotTrees.add(pTrunk, pFoliage);
  plotGroup.add(plotTrees);

  // Plot pad
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(26, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b2a22, roughness: 1 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.5;
  plotGroup.add(pad);
}
loadPlotTwin();

/* ------------------------------------------------------------------ */
/* Leaflet bridge                                                      */
/* ------------------------------------------------------------------ */
const bridge = new LeafletBridge({
  container: document.getElementById('leaflet-overlay'),
  center: { lat: 30, lng: 0 },
  zoom: 2,
  onCameraChange: ({ lat, lng, zoom }) => {
    const { x, z } = latLngToXZ(lat, lng);
    controls.target.set(x, 0, z);
    camera.position.x = x;
    camera.position.z = z + zoomToDistance(zoom) * 0.75;
    camera.position.y = zoomToDistance(zoom) * 0.55;
    camera.far = Math.max(20000, zoomToDistance(zoom) * 12);
    camera.updateProjectionMatrix();
    document.getElementById('zoom-readout').textContent = `z${zoom}`;
  },
  onSelect: (props) => selectCohort(props.id),
  onHover: (hit) => {
    const tip = document.getElementById('tooltip');
    if (!hit) { tip.style.display = 'none'; return; }
    const p = hit.props;
    tip.innerHTML = `<div class="title">${p.airline || p.id}</div>
      <div class="meta">${p.species} · ${Number(p.stems).toLocaleString()} stems<br>
      ${Number(p.height).toFixed(1)} m · health ${(p.health * 100).toFixed(0)}%<br>
      ~${Number(p.carbon).toFixed(0)} tCO₂e</div>
      <div class="meta dim">Illustrative averages, not site-specific predictions.</div>`;
    tip.style.display = 'block';
  }
});
bridge.init();
bridge.setTrees(adapter.toGeoJSON());

/* Three → Leaflet push (throttled by controls change) */
let pushTimer = null;
controls.addEventListener('change', () => {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const { lat, lng } = xzToLatLng(controls.target.x, controls.target.z);
    const dist = camera.position.distanceTo(controls.target);
    bridge.pushFromThree(lat, lng, distanceToZoom(dist));
  }, 220);
});

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */
const el = (id) => document.getElementById(id);
const kpiCarbon = el('kpi-carbon');
const kpiTrees = el('kpi-trees');
const kpiHealth = el('kpi-health');
const kpiClaims = el('kpi-claims');
const kpiSource = el('kpi-source');

function updateKPIs() {
  kpiCarbon.textContent = `${summary.totalCarbon.toFixed(0)} tCO₂e`;
  kpiTrees.textContent = summary.totalStems.toLocaleString();
  kpiHealth.textContent = `${Math.round(summary.avgHealth * 100)}%`;
  kpiClaims.textContent = summary.claims.toLocaleString();
  kpiSource.textContent = `TREEGENS · ${summary.source}`;
}
updateKPIs();

/* Density / opacity */
el('density').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 800;
  clearTimeout(window.__densityTimer);
  window.__densityTimer = setTimeout(() => {
    instanceCount = buildGroves(Math.max(0.15, v));
    el('kpi-rendered').textContent = instanceCount.toLocaleString();
  }, 180);
});
el('opacity').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  foliageMat.opacity = v;
  foliageMat.transparent = v < 1;
  foliageMat.needsUpdate = true;
});

/* Sacred geometry toggle */
el('toggle-geometry').addEventListener('click', () => {
  sacredGroup.visible = !sacredGroup.visible;
  el('toggle-geometry').textContent = sacredGroup.visible ? 'Hide Sacred Nodes' : 'Show Sacred Nodes';
});

/* Map / 3D split toggle */
const mapBtn = el('btn-map');
const threeBtn = el('btn-3d');
let mapMode = 'split';
function setMapMode(mode) {
  mapMode = mode;
  if (mode === '3d') { bridge.setVisible(false); el('viewer').classList.remove('split'); }
  else if (mode === 'map') { bridge.setVisible(true); el('viewer').classList.add('map-focus'); }
  else { bridge.setVisible(true); el('viewer').classList.remove('map-focus'); }
  mapBtn.classList.toggle('active', mode === 'map');
  threeBtn.classList.toggle('active', mode === '3d');
}
mapBtn.addEventListener('click', () => setMapMode(mapMode === 'map' ? 'split' : 'map'));
threeBtn.addEventListener('click', () => setMapMode(mapMode === '3d' ? 'split' : '3d'));

/* Plot twin jump */
el('btn-plot').addEventListener('click', () => {
  controls.target.set(0, 0, 0);
  camera.position.set(26, 20, 30);
  bridge.focus(0, 0, 13);
  document.getElementById('panel-title').textContent = 'Plot Twin — SimReady assets';
});

/* Focus claim */
el('focus-claim').addEventListener('click', () => {
  const id = el('claim-id').value.trim();
  const cohort = cohorts.find(c => c.id === id || c.airline?.toLowerCase() === id.toLowerCase());
  if (!cohort) { el('panel-body').innerHTML = `<p class="warn">No Treegens claim matches <code>${id || '(empty)'}</code>.</p>`; return; }
  selectCohort(cohort.id);
  const { x, z } = latLngToXZ(cohort.lat, cohort.lng);
  controls.target.set(x, 40, z);
  camera.position.set(x + 90, 120, z + 140);
  bridge.focus(cohort.lat, cohort.lng, 9);
});

/* Reload DB */
el('reload-db').addEventListener('click', async () => {
  await adapter.load();
  bridge.setTrees(adapter.toGeoJSON());
  instanceCount = buildGroves(1);
  updateKPIs();
  el('panel-body').innerHTML = `<p>Reloaded <strong>${adapter.summary().claims}</strong> Treegens claims from source <code>${adapter.source}</code>.</p>`;
});

/* ------------------------------------------------------------------ */
/* Selection panel + local-first explainer                             */
/* ------------------------------------------------------------------ */
function selectCohort(id) {
  const cohort = cohorts.find(c => c.id === id);
  if (!cohort) return;
  el('panel-title').textContent = cohort.airline || cohort.id;
  el('panel-body').innerHTML = `
    <div class="row"><span>Claim</span><code>${cohort.id}</code></div>
    <div class="row"><span>Region</span><b>${cohort.regionName || cohort.region}</b></div>
    <div class="row"><span>Biome</span><b>${cohort.biome === 'mangrove' ? 'Mangrove' : 'Urban street'}</b></div>
    <div class="row"><span>Species</span><i>${cohort.species}</i></div>
    <div class="row"><span>Stems funded</span><b>${cohort.stems.toLocaleString()}</b></div>
    <div class="row"><span>Establishment</span><b>${Math.round(cohort.health * 100)}%</b></div>
    <div class="row"><span>Mean height</span><b>${cohort.height.toFixed(1)} m</b></div>
    <div class="row"><span>Carbon</span><b>~${cohort.carbon.toFixed(0)} tCO₂e</b></div>
    <div class="row"><span>Stage</span><b>${cohort.stage}</b></div>
    <p class="caveat">Illustrative averages derived from the Treegens sponsorship claim — not site-specific predictions.
    Treegens <b>Proof of Tree</b> supplies verification; NVIDIA Omniverse/Cosmos-style twins are the high-fidelity counterpart.</p>`;
}

async function askAsimov(question) {
  const out = el('panel-body');
  const context = {
    claims: adapter.summary(),
    question
  };
  out.innerHTML = `<p class="dim">Thinking locally…</p>`;
  try {
    const res = await fetch(CONFIG.ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.ollamaModel,
        prompt:
`You are Asimov, the local explainer for the Shaddai Asimov Project (SAP) urban forest digital twin.
Context: ${JSON.stringify(context)}
Rules:
- Always state that figures are illustrative averages, not site-specific predictions.
- Connect Treegens Proof of Tree (verified planting) to NVIDIA Omniverse/Cosmos physical-AI digital twins.
- Be concise (max 180 words), warm, and educational. Never invent specific site data.
Question: ${question}`,
        stream: false,
        options: { temperature: 0.4, num_predict: 320 }
      })
    });
    if (!res.ok) throw new Error('ollama http ' + res.status);
    const data = await res.json();
    out.innerHTML = `<div class="answer">${escapeHtml(data.response || '')}</div>
      <p class="caveat">Local model (${CONFIG.ollamaModel}) — illustrative averages, not site-specific predictions.</p>`;
  } catch (e) {
    out.innerHTML = `<p class="warn">Local model unavailable (${escapeHtml(e.message)}).</p>
      <p>Offline explanation: this cohort funds <b>${summary.totalStems.toLocaleString()}</b> stems across
      <b>${summary.claims}</b> Treegens claims, carrying an illustrative <b>${summary.totalCarbon.toFixed(0)} tCO₂e</b>
      and <b>${Math.round(summary.avgHealth * 100)}%</b> average establishment health.</p>
      <p class="caveat">Illustrative averages, not site-specific predictions. Start Ollama with
      <code>ollama serve</code> and pull <code>ollama pull ${CONFIG.ollamaModel}</code> for full narration.</p>`;
  }
}

function escapeHtml(s) {
  const A = String.fromCharCode(38);
  const map = {
    '&': A + 'amp;',
    '<': A + 'lt;',
    '>': A + 'gt;',
    '"': A + 'quot;',
    "'": A + '#39;'
  };
  return String(s).replace(/[&<>"']/g, c => map[c]);
}

el('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = el('ask-input').value.trim();
  if (q) askAsimov(q);
});
el('ask-quick').addEventListener('click', () => {
  el('ask-input').value = 'Why does this grove matter for the city, and how does Proof of Tree verify it?';
  askAsimov(el('ask-input').value);
});

/* ------------------------------------------------------------------ */
/* Raycast tooltip on the 3D canvas                                    */
/* ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false;

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  pointerActive = true;
});
renderer.domElement.addEventListener('pointerleave', () => { pointerActive = false; el('tooltip').style.display = 'none'; });

function updateTooltip() {
  if (!pointerActive) return;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(foliageInst, false);
  if (!hits.length) { el('tooltip').style.display = 'none'; return; }
  const hit = hits[0];
  const cohort = instanceCohort[hit.instanceId];
  if (!cohort) { el('tooltip').style.display = 'none'; return; }
  const tree = instanceTree[hit.instanceId] || {};
  const tip = el('tooltip');
  tip.innerHTML = `<div class="title">${cohort.airline}</div>
    <div class="meta">${cohort.species} · ${cohort.stems.toLocaleString()} stems<br>
    ${(tree.height || cohort.height).toFixed(1)} m · crown ${(tree.crown || cohort.canopy).toFixed(1)} m<br>
    ~${cohort.carbon.toFixed(0)} tCO₂e · ${cohort.regionName}</div>
    <div class="meta dim">Illustrative averages, not site-specific predictions.</div>`;
  tip.style.left = (hit.point.x + 40) + 'px';
  tip.style.top = '120px';
  tip.style.display = 'block';
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  foliageInst.rotation.y = Math.sin(t * 0.08) * 0.012;
  sacredGroup.rotation.y = t * 0.02;
  controls.update();
  updateTooltip();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  bridge.invalidate();
});

el('kpi-rendered').textContent = instanceCount.toLocaleString();
el('zoom-readout').textContent = 'z2';

/* Debug / automation hooks */
window.SAP = { scene, camera, renderer, controls, adapter, cohorts, bridge, CONFIG };
