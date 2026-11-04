/**
 * SAP Canopy Digital Twin - main.js
 * Three.js 3D urban forest canopy with Treegens integration
 * TURTLE design: feel-first, motion with purpose, CSS tokens aligned.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TreegensAdapter } from './adapter.js';

const adapter = new TreegensAdapter();
await adapter.load();

/* ---------- Scene ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.FogExp2(0x0b0f14, 0.02);

const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 2000);
camera.position.set(0, 80, 120);

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('three-canvas').appendChild(renderer.domElement);

/* Controls */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 20;
controls.maxDistance = 400;
controls.target.set(0,20,0);

/* Lights */
scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x081018, 1.1));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(50,100,30);
scene.add(dir);

/* Ground plane - urban grid */
const groundGeo = new THREE.PlaneGeometry(1000,1000,64,64);
const groundMat = new THREE.MeshStandardMaterial({ color:0x18232e, roughness:0.9, metalness:0.1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI/2;
ground.position.y = 0;
scene.add(ground);

/* Grid helper */
const grid = new THREE.GridHelper(1000, 100, 0x223141, 0x223141);
grid.position.y = 0.1;
scene.add(grid);

/* ---------- Procedural Instanced Trees ---------- */
const trunkGeo = new THREE.CylinderGeometry(0.3,0.5,1,8);
const trunkMat = new THREE.MeshStandardMaterial({ color:0x5d4037, roughness:0.85 });
const foliageGeo = new THREE.IcosahedronGeometry(1,0);
const foliageMat = new THREE.MeshStandardMaterial({ color:0x4caf50, roughness:0.8, metalness:0.02 });

const TREE_COUNT = 800;
const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, TREE_COUNT);
scene.add(trunkInst, foliageInst);

/* LOD for distant trees */
const lod = new THREE.LOD();
lod.addLevel(new THREE.Group().add(trunkInst, foliageInst), 0);
const lodLow = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
scene.add(lod);

/* Sacred geometry placement */
const centerLat = 40.7128, centerLng = -74.0060;
const positions = adapter.generateMetatronPositions(TREE_COUNT, centerLat, centerLng, 600);

// Simple lat/lng -> XZ projection
function latLngToXZ(lat,lng){
  const scale = 111320; // meters per deg approx
  const x = (lng - centerLng) * scale * Math.cos(centerLat*Math.PI/180);
  const z = (lat - centerLat) * scale;
  return {x,y:0,z};
}

/* Populate instances */
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const records = [];

for(let i=0;i<TREE_COUNT;i++){
  const pt = positions[i % positions.length];
  const {x,z} = latLngToXZ(pt.lat, pt.lng);
  
  // Simulate Treegens claim mapping
  const mockRecord = {
    id:`CLAIM-${String(i+1).padStart(4,'0')}`,
    lat:pt.lat,
    lng:pt.lng,
    species:['Quercus alba','Acer saccharum','Tilia americana','Pinus strobus'][i%4],
    health:0.5 + Math.random()*0.5,
    height:6 + Math.random()*18,
    canopy:3 + Math.random()*7,
    age:10 + Math.floor(Math.random()*90),
    carbon:2 + Math.random()*10
  };
  const tree = adapter.mapToTree(mockRecord);
  records.push(tree);

  dummy.position.set(x, tree.height*0.5, z);
  dummy.scale.set(...tree.trunkScale);
  dummy.updateMatrix();
  trunkInst.setMatrixAt(i, dummy.matrix);
  trunkInst.setColorAt(i, color.setHex(tree.color));

  dummy.position.set(x, tree.height*0.9, z);
  dummy.scale.set(...tree.foliageScale);
  dummy.updateMatrix();
  foliageInst.setMatrixAt(i, dummy.matrix);
  const foliageColor = new THREE.Color(tree.color);
  foliageColor.offsetHSL(0,0, (tree.health-0.5)*0.2);
  foliageInst.setColorAt(i, foliageColor);
}

trunkInst.instanceMatrix.needsUpdate = true;
foliageInst.instanceMatrix.needsUpdate = true;
trunkInst.instanceColor.needsUpdate = true;
foliageInst.instanceColor.needsUpdate = true;

/* ---------- Leaflet ↔ Three sync concept ---------- */
// NOTE: Leaflet overlay is conceptual here. In production:
// 1. Initialize Leaflet map in #leaflet-overlay with same center/zoom
// 2. Sync camera: on OrbitControls change -> update Leaflet view via latLng conversion
// 3. On map drag/zoom -> update Three.js camera position
// 4. Use a shared mercator projection util to keep alignment pixel-perfect.
// 5. Pointer events: leaf map pointer-events:auto for UI, three canvas pointer-events:auto for orbit.

document.getElementById('leaflet-overlay').innerHTML = `
  <div class="pill">Leaflet ↔ Three sync active (concept)</div>
`;

/* ---------- UI Bindings ---------- */
const kpiCarbon = document.getElementById('kpi-carbon');
const kpiTrees = document.getElementById('kpi-trees');
const kpiHealth = document.getElementById('kpi-health');

function updateKPIs(){
  const totalCarbon = records.reduce((s,t)=>s+t.carbon,0).toFixed(1);
  const avgHealth = (records.reduce((s,t)=>s+t.health,0)/records.length).toFixed(2);
  kpiCarbon.textContent = `${totalCarbon} tCO₂e`;
  kpiTrees.textContent = records.length.toLocaleString();
  kpiHealth.textContent = `${Math.round(avgHealth*100)}%`;
}
updateKPIs();

/* ---------- Hugging Face CAD Tree Model Integration Brief ---------- */
// ProSceneverse GLB trees via DRACOLoader
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

// Example load (commented for starter scaffold):
// gltfLoader.load('https://huggingface.co/.../tree_oak.glb', gltf => {
//   const model = gltf.scene;
//   model.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true } })
//   scene.add(model);
// });

/* ---------- Animation ---------- */
const clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  // gentle foliage sway
  foliageInst.rotation.y = Math.sin(t*0.1)*0.02;
  controls.update();
  renderer.render(scene,camera);
}
animate();

/* Resize */
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* Export for debugging */
window.SAP = { scene, camera, renderer, records, adapter };
