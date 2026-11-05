// Structural sanity check for the SAP showcase page. No dependencies.
//
// Run:  node sap-canopy/tools/check_showcase.js
//
// Checks the page's structure (balanced tags, resolvable anchors, existing
// images), the content markers the project requires (the illustrative-averages
// caveat, Treegens Proof of Tree, NVIDIA Omniverse/Cosmos, the 40/40/20 fee
// policy, the GPU honesty note), and -- crucially -- that the NVIDIA skill
// counts and category tiles on the page still agree with the canonical
// manifest. The counts drifted once already; this check makes that loud.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const p = path.join(ROOT, 'sap-canopy', 'showcase.html');
const raw = fs.readFileSync(p, 'utf8');

// The canonical manifest. Prefer the repo-local copy of the same manifest; fall
// back to the agents-MCP manifest, which is the single source of truth.
const MANIFEST_CANDIDATES = [
  path.join(ROOT, 'sap-canopy', 'nvidia-skills.json'),
  'C:/Users/Brittany/mcp-servers/shaddai-agents/nvidia-skills.json',
  'C:/Users/Brittany/shaddai-mcp-repo/skills/nvidia-skills.json',
];

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  (cond ? pass++ : fail++);
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
};

// --- ASCII ---
const nonAscii = raw.match(/[^\x00-\x7F]/g) || [];
ok('file is pure ASCII', nonAscii.length === 0, nonAscii.length ? 'found ' + nonAscii.length : '');

// --- void elements that legitimately have no closing tag ---
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

// strip comments, script and style bodies (their contents are not markup)
let m = raw.replace(/<!--[\s\S]*?-->/g, '')
           .replace(/<script[\s\S]*?<\/script>/gi, '')
           .replace(/<style[\s\S]*?<\/style>/gi, '');

// tokenize tags
const stack = [];
const errors = [];
const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
let mm;
while ((mm = re.exec(m)) !== null) {
  const full = mm[0], name = mm[1].toLowerCase(), attrs = mm[2] || '';
  if (full.startsWith('</')) {
    if (!stack.length) { errors.push('close with empty stack: ' + name); continue; }
    const top = stack.pop();
    if (top !== name) errors.push('mismatch: expected </' + top + '> got </' + name + '>');
  } else {
    if (attrs.trim().endsWith('/')) continue; // self-closing
    if (VOID.has(name)) continue;
    stack.push(name);
  }
}
ok('all tags balanced', stack.length === 0 && errors.length === 0,
   stack.length ? 'unclosed: ' + stack.join(',') : (errors.length ? errors.slice(0,3).join(' | ') : ''));

// --- anchors resolve ---
const ids = new Set([...raw.matchAll(/id="([^"]+)"/g)].map(x => x[1]));
const anchors = [...raw.matchAll(/href="#([^"]+)"/g)].map(x => x[1]);
const missing = [...new Set(anchors)].filter(a => !ids.has(a));
ok('all in-page anchors resolve', missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : anchors.length + ' anchors');

// --- nav sections present ---
const sections = [...raw.matchAll(/<section id="([^"]+)"/g)].map(x => x[1]);
ok('8 content sections', sections.length === 8, sections.join(','));

// --- images exist on disk ---
const base = path.join(ROOT, 'sap-canopy') + path.sep;
const imgs = [...raw.matchAll(/src="([^"]+\.png)"/g)].map(x => x[1]);
let bad = [];
for (const i of imgs) if (!fs.existsSync(base + i)) bad.push(i);
ok('all referenced PNGs exist', bad.length === 0, bad.length ? 'missing: ' + bad.join(',') : imgs.length + ' images');

// --- required content markers ---
const markers = [
  ['illustrative averages caveat', 'illustrative averages, not site-specific predictions'],
  ['Treegens Proof of Tree', 'Proof of Tree'],
  ['NVIDIA Omniverse/Cosmos', 'NVIDIA Omniverse'],
  ['40/40/20 policy', 'asimovLiquidityBps 4000'],
  ['year15 mangrove canopy', '88.1%'],
  ['year15 urban canopy', '45.5%'],
  ['calibration formula', 'k(t) = reference(t) / model_reference(t)'],
  ['hyperliquid', 'Hyperliquid'],
  ['solana venue', 'Token-2022'],
  ['no custody', 'No HTTP route can place an order'],
  ['gpu honesty', 'no NVIDIA devices'],
  ['live endpoint', '/api/sap/treasury/report']
];
for (const [label, needle] of markers) ok('content: ' + label, raw.indexOf(needle) >= 0);

// --- js sanity: balanced braces in the script block ---
const script = (raw.match(/<script>([\s\S]*?)<\/script>/) || [,''])[1];
let depth = 0, maxd = 0;
for (const ch of script) { if (ch === '{') { depth++; maxd = Math.max(maxd, depth); } else if (ch === '}') depth--; }
ok('inline script braces balanced', depth === 0, 'net=' + depth + ' max=' + maxd);
ok('script has fallback path', /fallback\(/.test(script));
ok('script has error catch', /\.catch\(/.test(script));

// --- NVIDIA counts must agree with the canonical manifest ---
let manifest = null;
let manifestPath = null;
for (const cand of MANIFEST_CANDIDATES) {
  try {
    if (!fs.existsSync(cand)) continue;
    const j = JSON.parse(fs.readFileSync(cand, 'utf8'));
    const list = Array.isArray(j) ? j : j.skills;
    if (Array.isArray(list) && list.length) { manifest = list; manifestPath = cand; break; }
  } catch (_) { /* try next */ }
}

if (!manifest) {
  ok('canonical manifest found', false, 'looked in: ' + MANIFEST_CANDIDATES.join(', '));
} else {
  ok('canonical manifest found', true, path.basename(manifestPath) + ' (' + manifest.length + ' skills)');

  const gpu = manifest.filter(s => s.requiresGpu).length;
  const cpu = manifest.length - gpu;

  // The stat tiles: <b>N</b><span>...no GPU</span> and <b>N</b><span>...NVIDIA GPU...</span>
  const noGpuTile = raw.match(/<b>(\d+)<\/b><span>[^<]*no GPU/i);
  const gpuTile = raw.match(/<b>(\d+)<\/b><span>[^<]*NVIDIA GPU/i);
  ok('stat tile: no-GPU count matches manifest', !!noGpuTile && Number(noGpuTile[1]) === cpu,
     noGpuTile ? 'tile=' + noGpuTile[1] + ' manifest=' + cpu : 'tile not found');
  ok('stat tile: GPU count matches manifest', !!gpuTile && Number(gpuTile[1]) === gpu,
     gpuTile ? 'tile=' + gpuTile[1] + ' manifest=' + gpu : 'tile not found');

  const installedTile = raw.match(/<b>(\d+)<\/b><span>[^<]*skills installed/i);
  ok('stat tile: installed count matches manifest', !!installedTile && Number(installedTile[1]) === manifest.length,
     installedTile ? 'tile=' + installedTile[1] + ' manifest=' + manifest.length : 'tile not found');

  // The caveat paragraph must quote the same numbers.
  ok('caveat quotes the manifest GPU count', new RegExp('\\b' + gpu + '\\b[^.]*GPU-flagged').test(raw),
     'expected "' + gpu + ' ... GPU-flagged"');
  ok('caveat quotes the manifest no-GPU count', new RegExp('other ' + cpu + '\\b').test(raw),
     'expected "other ' + cpu + '"');

  // Stale counts must be gone (29/19 were the pre-reconciliation numbers).
  const stale = [...raw.matchAll(/\b(29|19) of 48|\b(29|19) GPU-flagged|other 19\b/g)].map(x => x[0]);
  ok('no stale 29/19 GPU counts', stale.length === 0, stale.length ? 'found: ' + stale.join(', ') : '');

  // Category tiles must cover every manifest category with the right count.
  const catCounts = {};
  for (const s of manifest) catCounts[s.category] = (catCounts[s.category] || 0) + 1;
  const tiles = [...raw.matchAll(/<div class="nv-c">([^<]+)<\/div>\s*<div class="nv-t">([^<]*?)(?:,\s*(\d+)\s+skills?)?<\/div>/gi)]
    .map(x => ({ cat: x[1].trim().toLowerCase(), n: x[3] ? Number(x[3]) : null }));

  const missingCats = Object.keys(catCounts).filter(c => !tiles.some(t => t.cat === c));
  ok('every manifest category has a tile', missingCats.length === 0,
     missingCats.length ? 'missing: ' + missingCats.join(',') : Object.keys(catCounts).length + ' categories');

  const wrongCount = tiles.filter(t => t.n !== null && catCounts[t.cat] !== undefined && t.n !== catCounts[t.cat]);
  ok('category tile counts match manifest', wrongCount.length === 0,
     wrongCount.length ? wrongCount.map(t => t.cat + ': tile=' + t.n + ' manifest=' + catCounts[t.cat]).join(' | ') : '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
