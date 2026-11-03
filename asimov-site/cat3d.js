/* cat3d.js — Asimov, the editor-in-chief, in three.js (r128). A sitting tabby-and-white cat with green eyes
   and a red collar, after the cat in I, Robot (2004).
   Sculpted from signed distance fields (smooth unions of ellipsoids and capsules) meshed with surface nets,
   coat painted per vertex (mackerel tabby, forehead M, white blaze, bib and socks), shell-rendered fur,
   glossy slit-pupil eyes with lids, whiskers, collar and tag.

   var cat = AsimovCat.create({ envMap, shells: 14 });  scene.add(cat.group);
   cat.update(t, { lookX, lookY })   // t in seconds (deterministic: same t → same pose); look in -1..1
   Units: the cat sits on y = 0 and is about 1 unit tall, facing +z. */
(function () {
  'use strict';
  var T = window.THREE; if (!T) return;

  /* ── SDF toolkit ── */
  function len(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }
  function ell(px, py, pz, cx, cy, cz, rx, ry, rz) {
    var x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz, k0 = len(x, y, z), k1 = len(x / rx, y / ry, z / rz);
    return k1 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
  }
  function cap(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
    var pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
    var h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
    return len(pax - bax * h, pay - bay * h, paz - baz * h) - (r1 + (r2 - r1) * h);
  }
  function smin(a, b, k) { var h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  function ssub(a, b, k) { return -smin(-a, b, k); } // a minus b

  // Surface nets: SDF → smooth BufferGeometry (normals from the SDF gradient)
  function mesh(sdf, min, max, step, paint) {
    var nx = Math.ceil((max[0] - min[0]) / step) + 1, ny = Math.ceil((max[1] - min[1]) / step) + 1, nz = Math.ceil((max[2] - min[2]) / step) + 1;
    var f = new Float32Array(nx * ny * nz), i, j, k, idx = function (i, j, k) { return i + nx * (j + ny * k); };
    for (k = 0; k < nz; k++) for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) f[idx(i, j, k)] = sdf(min[0] + i * step, min[1] + j * step, min[2] + k * step);
    var vid = new Int32Array(nx * ny * nz).fill(-1), pos = [], cols = [], nor = [], ind = [];
    var corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    var edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    var e = step * 0.5, col = new T.Color();
    for (k = 0; k < nz - 1; k++) for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
      var v = [], inside = 0;
      for (var c = 0; c < 8; c++) { var val = f[idx(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; v.push(val); if (val < 0) inside++; }
      if (inside === 0 || inside === 8) continue;
      var sx = 0, sy = 0, sz = 0, n = 0;
      for (var q = 0; q < 12; q++) {
        var a = edges[q][0], b = edges[q][1]; if ((v[a] < 0) === (v[b] < 0)) continue;
        var tt = v[a] / (v[a] - v[b]);
        sx += corners[a][0] + (corners[b][0] - corners[a][0]) * tt; sy += corners[a][1] + (corners[b][1] - corners[a][1]) * tt; sz += corners[a][2] + (corners[b][2] - corners[a][2]) * tt; n++;
      }
      var px = min[0] + (i + sx / n) * step, py = min[1] + (j + sy / n) * step, pz = min[2] + (k + sz / n) * step;
      vid[idx(i, j, k)] = pos.length / 3; pos.push(px, py, pz);
      var gx = sdf(px + e, py, pz) - sdf(px - e, py, pz), gy = sdf(px, py + e, pz) - sdf(px, py - e, pz), gz = sdf(px, py, pz + e) - sdf(px, py, pz - e), gl = len(gx, gy, gz) || 1;
      nor.push(gx / gl, gy / gl, gz / gl);
      paint(px, py, pz, col); cols.push(col.r, col.g, col.b);
    }
    // one quad per sign-changing grid edge, between the four cells around it
    for (k = 1; k < nz - 1; k++) for (j = 1; j < ny - 1; j++) for (i = 1; i < nx - 1; i++) {
      var f0 = f[idx(i, j, k)] < 0;
      if (i < nx - 1 && (f[idx(i + 1, j, k)] < 0) !== f0) quad(vid[idx(i, j - 1, k - 1)], vid[idx(i, j, k - 1)], vid[idx(i, j, k)], vid[idx(i, j - 1, k)], f0);
      if (j < ny - 1 && (f[idx(i, j + 1, k)] < 0) !== f0) quad(vid[idx(i - 1, j, k - 1)], vid[idx(i - 1, j, k)], vid[idx(i, j, k)], vid[idx(i, j, k - 1)], f0);
      if (k < nz - 1 && (f[idx(i, j, k + 1)] < 0) !== f0) quad(vid[idx(i - 1, j - 1, k)], vid[idx(i, j - 1, k)], vid[idx(i, j, k)], vid[idx(i - 1, j, k)], f0);
    }
    function quad(a, b, c, d, flip) { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) ind.push(a, b, c, a, c, d); else ind.push(a, c, b, a, d, c); }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    g.setIndex(ind); return g;
  }

  /* ── coat: colours and noise ── */
  function lin(h) { return new T.Color(h).convertSRGBToLinear(); }
  var FUR = lin('#7b6c58'), FUR_L = lin('#ab9a80'), STRIPE = lin('#221c17'), WHITE = lin('#f3efe7'), PINK = lin('#e3a0a6'), NOSE = lin('#d4868d');
  /* Coats (owner reference sheets, refs/cat/): the paint functions read the active coat K, set in create() before meshing.
     asimov: grey agouti tabby, tabby forehead "M" (no blaze up the forehead), white muzzle, irregular soft-edged chest blaze,
             white front paws, dark tail bands with a darker tip, pale green-hazel eyes, red collar + $ASIMOV tag.
     orange: fluffy orange tabby (Asimov's best friend), soft banding, cream chest and muzzle, ear tufts, very full tail, no collar yet. */
  var COATS = {
    asimov: { fur: '#5f5a52', furL: '#8d877b', stripe: '#141210', white: '#f2efe9', skin: '#8a6a6c', nose: '#c08a8c',
              stripeK: 1.0, blazeTop: 0.0, bib: 1.0, socks: 1.0, legsW: 0.12, fluff: 1.0, tuft: 0.65, tailR: 1.0, collar: true,
              iris: [[0.62, 0.84, 0.74], [0.2, 0.46, 0.4]] }, // pale blue-green: refs differ (green-hazel vs blue); owner can overrule
    orange: { fur: '#c06a22', furL: '#eeb06a', stripe: '#8a3e10', white: '#f5e2c4', skin: '#b07a72', nose: '#c78579',
              stripeK: 0.55, blazeTop: 0.0, bib: 0.6, socks: 0.25, legsW: 0.25, fluff: 1.9, tuft: 1.0, tailR: 1.45, collar: false,
              iris: [[0.95, 0.74, 0.28], [0.6, 0.36, 0.08]] }
  };
  var K = COATS.asimov;
  function useCoat(name) {
    K = COATS[name] || COATS.asimov;
    FUR = lin(K.fur); FUR_L = lin(K.furL); STRIPE = lin(K.stripe); WHITE = lin(K.white); NOSE = lin(K.nose);
  }
  function hash(x, y, z) { var h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
  function vnoise(x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    function L(a, b, t) { return a + (b - a) * t; }
    return L(L(L(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx), L(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy),
             L(L(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx), L(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy), fz);
  }
  function fbm(x, y, z) { return vnoise(x, y, z) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.1; }
  function sm(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function stripeK(phase, width) { var s = Math.sin(phase); return sm(1 - width - 0.12, 1 - width + 0.12, s); } // 0..1, dark band where sin peaks

  /* ── body (sitting), feet on y = 0, chest toward +z ── */
  function bodySDF(x, y, z) { // anatomy: broad deep chest, head on the shoulders, pear seat, haunches back, short straight front legs
    var ax = Math.abs(x);
    var d = cap(x, y, z, 0, 0.19, -0.11, 0, 0.41, 0.03, 0.125, 0.11);                          // ribcage, leaning forward
    d = smin(d, ell(x, y, z, 0, 0.35, 0.065, 0.118, 0.13, 0.085), 0.05);                        // broad chest
    d = smin(d, ell(x, y, z, 0, 0.14, -0.15, 0.14, 0.13, 0.15), 0.08);                          // seat
    d = smin(d, ell(ax, y, z, 0.108, 0.155, -0.1, 0.088, 0.145, 0.19), 0.05);                   // haunches
    d = smin(d, cap(ax, y, z, 0.112, 0.035, -0.1, 0.112, 0.024, 0.06, 0.03, 0.026), 0.03);       // hind feet, flat on the floor
    d = smin(d, ell(ax, y, z, 0.11, 0.022, 0.075, 0.035, 0.022, 0.045), 0.02);                  // hind toes
    d = smin(d, ell(ax, y, z, 0.068, 0.43, 0.0, 0.06, 0.07, 0.07), 0.045);                      // shoulder blades
    d = smin(d, cap(ax, y, z, 0.064, 0.4, 0.07, 0.058, 0.25, 0.1, 0.042, 0.034), 0.035);        // upper arms, muscled
    d = smin(d, cap(ax, y, z, 0.058, 0.25, 0.1, 0.055, 0.05, 0.11, 0.032, 0.024), 0.018);       // forearms down to a narrow wrist
    d = smin(d, ell(ax, y, z, 0.056, 0.024, 0.128, 0.034, 0.024, 0.04), 0.016);                 // front paws, under the shoulders
    [-0.018, 0, 0.018].forEach(function (o) { d = smin(d, ell(ax, y, z, 0.056 + o, 0.018, 0.158 - Math.abs(o) * 0.4, 0.011, 0.014, 0.012), 0.008); }); // toes
    d = smin(d, cap(x, y, z, 0, 0.42, 0.03, 0, 0.5, 0.06, 0.082, 0.074), 0.05);                 // short neck
    return Math.max(d, -y);
  }
  function bodyPaint(x, y, z, c) {
    var ax = Math.abs(x), n = fbm(x * 10, y * 10, z * 10);
    c.copy(FUR).lerp(FUR_L, sm(-0.05, 0.1, z) * 0.35 + (n - 0.5) * 0.3).multiplyScalar(1 - sm(0.0, -0.2, z) * 0.25);
    var ang = Math.atan2(x, -z);
    // mackerel: thin wavy stripes falling from the spine, broken into dashes toward the belly, plus a dark dorsal line
    var brk = sm(0.32, 0.55, fbm(x * 16 + 3, y * 7, z * 16));
    var torso = Math.max(stripeK(ang * 30 + y * 6 + n * 7, 0.3) * (0.45 + 0.55 * brk), sm(-0.1, -0.15, z) * sm(0.05, 0.02, ax) * sm(0.2, 0.3, y));
    var hip = sm(0.06, 0.1, ax) * sm(0.3, 0.2, y) * sm(0.06, -0.02, z);
    var ring = stripeK(y * 90 + n * 4 + z * 18, 0.42);
    c.lerp(STRIPE, Math.max(torso * (1 - hip), ring * hip) * 0.85 * K.stripeK * sm(0.03, 0.06, y));
    var axn = ax + (n - 0.5) * 0.035; // ragged, furry edge where the white meets the tabby (no straight seam)
    var bib = sm(0.06, 0.1, z) * sm(0.082, 0.04, axn) * sm(0.5, 0.44, y) * sm(0.18, 0.26, y);
    var legs = sm(0.08, 0.1, z) * sm(0.105, 0.08, axn) * sm(0.24, 0.17, y);
    var feet = sm(0.045, 0.03, y) * sm(0.0, 0.05, z);
    c.lerp(WHITE, Math.min(1, Math.max(bib * K.bib, legs * K.legsW, feet * K.socks) * 1.15) * (0.92 + n * 0.08));
    var armBars = stripeK(y * 110 + n * 3, 0.45) * sm(0.04, 0.07, ax) * sm(0.08, 0.1, z) * sm(0.2, 0.26, y) * sm(0.42, 0.36, y);
    c.lerp(STRIPE, armBars * 0.7);
    var gap = sm(0.014, 0.0, ax) * sm(0.08, 0.11, z) * sm(0.3, 0.24, y);
    c.multiplyScalar(0.94 + 0.12 * sm(0.0, 0.5, y) - gap * 0.45);
  }

  /* ── head, local origin at the top of the neck, face toward +z ── */
  var EYE = { x: 0.047, y: 0.03, z: 0.093, r: 0.021 }, LID_OPEN = -0.98, LID_SHUT = 1.35;
  function headSDF(x, y, z) { // a wedge: rounded cranium, cheeks no wider than the skull allows, a defined muzzle
    var ax = Math.abs(x);
    var d = ell(x, y, z, 0, 0.045, -0.015, 0.095, 0.088, 0.1);                                 // cranium
    d = smin(d, ell(ax, y, z, 0.058, -0.006, 0.035, 0.058, 0.054, 0.062), 0.04);              // cheeks (narrower: reads cat, not plush toy)
    d = smin(d, ell(ax, y, z, 0.045, 0.06, 0.068, 0.04, 0.018, 0.03), 0.02);                  // brow ridge, shades the eyes
    d = smin(d, ell(ax, y, z, 0.022, -0.026, 0.104, 0.03, 0.026, 0.032), 0.025);              // whisker pads
    d = smin(d, ell(x, y, z, 0, -0.05, 0.088, 0.026, 0.017, 0.026), 0.02);                     // chin
    d = smin(d, cap(x, y, z, 0, 0.045, 0.08, 0, 0.004, 0.125, 0.026, 0.019), 0.03);            // nose bridge
    d = ssub(d, ell(ax, y, z, EYE.x, EYE.y, EYE.z + 0.01, 0.023, 0.017, 0.016), 0.008);        // eye sockets
    return d;
  }
  function headPaint(x, y, z, c) {
    var ax = Math.abs(x), n = fbm(x * 14, y * 14, z * 14);
    c.copy(FUR).lerp(FUR_L, 0.25 + (n - 0.5) * 0.3);
    // tabby M on the forehead, brow lines, cheek stripes
    var fore = sm(0.05, 0.08, y) * sm(0.0, 0.05, z);
    var m = stripeK(x * 120 + n * 2, 0.62) * fore * sm(0.085, 0.03, ax);
    var brow = stripeK(Math.atan2(y - 0.03, ax - 0.05) * 6 + n, 0.55) * sm(0.05, 0.09, ax) * sm(0.02, 0.06, y) * sm(0.02, 0.06, z);
    var cheek = stripeK((y + ax * 0.3) * 70 + n * 2, 0.45) * sm(0.09, 0.115, ax) * sm(0.04, -0.01, y) * sm(-0.02, 0.03, z);
    var crown = stripeK(x * 60 + n * 3, 0.45) * sm(0.11, 0.14, y) * sm(0.04, -0.04, z);
    c.lerp(STRIPE, Math.min(0.9, m + brow * 0.8 + cheek + crown * 0.8) * K.stripeK);
    // white blaze: narrow between the eyes, widening into the muzzle and chin
    var blazeW = 0.006 + Math.max(0, 0.045 - y) * 0.42;
    var blaze = sm(blazeW + 0.005, blazeW, ax) * sm(0.05, 0.09, z) * sm(0.1, 0.06, y) * (y < 0.015 ? 1 : K.blazeTop); // the M forehead stays tabby
    var muzzle = sm(0.06, 0.09, z) * sm(0.01, -0.012, y) * sm(0.07, 0.05, ax);
    var chin = sm(-0.03, -0.045, y) * sm(0.03, 0.06, z);
    c.lerp(WHITE, Math.min(1, Math.max(blaze, muzzle, chin)));
    // mouth: a dark line under the nose and the two curves
    var mouth = sm(0.0028, 0.001, ax) * sm(-0.008, -0.012, y) * sm(-0.03, -0.026, y) * sm(0.105, 0.112, z);
    var curve = sm(0.0045, 0.0015, Math.abs((y + 0.031) - (ax - 0.012) * (ax - 0.012) * 14)) * sm(0.03, 0.02, ax) * sm(0.004, 0.008, ax) * sm(0.1, 0.11, z);
    c.lerp(STRIPE, Math.max(mouth, curve) * 0.9);
    // dark rims around the eyes
    var er = len(ax - EYE.x, (y - EYE.y) * 1.25, (z - EYE.z) * 0.8);
    c.lerp(STRIPE, sm(0.04, 0.03, er) * 0.75);
  }

  /* ── ear, local: base at y = 0 (sunk into the skull), tip up, cupped opening toward +z ── */
  function earSDF(x, y, z) {
    var S = 0.42, outer = cap(x, y, z / S, 0, -0.018, 0, 0, 0.1, 0, 0.05, 0.003) * S;           // thick tapered blade
    var inner = cap(x, y, (z - 0.013) / S, 0, 0.004, 0, 0, 0.092, 0, 0.038, 0.001) * S;        // the cup, opened to the front
    return ssub(outer, inner, 0.006);
  }
  function earPaint(x, y, z, c) {
    var ax = Math.abs(x), n = fbm(x * 40, y * 40, z * 40), w = 0.04 * (1 - y / 0.1);
    c.copy(FUR).lerp(FUR_L, 0.2 + (n - 0.5) * 0.3);
    var inside = sm(0.002, 0.009, z) * sm(w * 0.95, w * 0.6, ax);
    var skin = lin(K.skin), tuft = sm(0.06, 0.0, y) * (0.5 + 0.5 * Math.sin(x * 260 + n * 6));
    c.lerp(skin, inside).lerp(WHITE, inside * tuft * K.tuft);                                     // dusky inner ear, pale tufts at the base
    c.lerp(STRIPE, sm(0.07, 0.095, y) * 0.85);                                                  // dark tip
  }

  /* ── shell fur (onBeforeCompile on MeshStandardMaterial) ── */
  function furMaterial(envMap, shell, shells, length, density) {
    var m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMap: envMap || null, envMapIntensity: 0.55 });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uShell = { value: shell / Math.max(1, shells) }; sh.uniforms.uLen = { value: length }; sh.uniforms.uDen = { value: density };
      sh.vertexShader = 'uniform float uShell; uniform float uLen; varying vec3 vBase;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vBase = position; transformed += normal * uShell * uLen;');
      sh.fragmentShader = 'uniform float uShell; uniform float uDen; varying vec3 vBase;\n' +
        'float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }\n' + sh.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        ' if (uShell > 0.0) { vec3 q = vBase * uDen; vec3 cell = floor(q); vec3 f = fract(q) - 0.5;\n' +
        '   float r = h3(cell); float strand = (1.0 - uShell) * (0.35 + 0.3 * r) - length(f.xy + f.z * 0.3) ;\n' +
        '   if (r < uShell * 0.95 || strand < 0.0) discard; }\n' +
        ' diffuseColor.rgb *= mix(0.55, 1.08, uShell);');
    };
    m.customProgramCacheKey = function () { return 'fur' + shell; };
    if (shell > 0) { m.transparent = false; }
    return m;
  }
  function furred(geo, envMap, shells, length, density) {
    var g = new T.Group();
    for (var s = 0; s <= shells; s++) { var me = new T.Mesh(geo, furMaterial(envMap, s, shells, length, density)); me.renderOrder = s; if (s === 0) { me.castShadow = true; } g.add(me); }
    return g;
  }

  /* ── eyes: iris shader with a slit pupil, glossy cornea, lids ── */
  function eyeMaterial() {
    return new T.ShaderMaterial({
      uniforms: { uDil: { value: 0.18 }, uIn: { value: new T.Vector3().fromArray(K.iris[0]) }, uOut: { value: new T.Vector3().fromArray(K.iris[1]) } },
      vertexShader: 'varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normalMatrix * normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform float uDil; uniform vec3 uIn; uniform vec3 uOut; varying vec3 vP; varying vec3 vN;',
        'float h(float x){ return fract(sin(x*91.7)*437.5); }',
        'void main(){ vec3 p = normalize(vP); vec2 uv = p.xy / 0.9; float d = length(uv); vec3 c;',
        ' float a = atan(uv.y, uv.x); float fib = 0.85 + 0.15 * sin(a * 40.0 + h(floor(a * 12.0)) * 6.0);',
        ' vec3 inner = uIn, outer = uOut;',
        ' c = mix(inner, outer, smoothstep(0.1, 0.75, d)) * fib;',
        ' c = mix(c, vec3(0.08, 0.12, 0.03), smoothstep(0.72, 0.86, d));',
        ' float slit = abs(uv.x) - uDil * (1.0 - uv.y * uv.y * 0.9);',
        ' c = mix(vec3(0.01), c, smoothstep(-0.01, 0.02, slit));',
        ' if (p.z < 0.2) c = vec3(0.05);',
        ' float l = 0.55 + 0.45 * max(dot(normalize(vN), normalize(vec3(-0.3, 0.6, 1.0))), 0.0);',
        ' gl_FragColor = vec4(c * l * 1.15, 1.0); }'].join('\n')
    });
  }

  function tagTexture() {
    // the tag is stamped with the full ticker: a lone "A" (or "$A") reads as "SA"
    var cv = document.createElement('canvas'); cv.width = cv.height = 256; var x = cv.getContext('2d');
    var g = x.createRadialGradient(100, 88, 12, 128, 128, 128); g.addColorStop(0, '#ffe7a0'); g.addColorStop(0.6, '#e8b04a'); g.addColorStop(1, '#a46c14');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(90,56,10,.55)'; x.lineWidth = 6; x.beginPath(); x.arc(128, 128, 104, 0, 6.283); x.stroke(); // engraved rim
    x.fillStyle = '#3a2408'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 64px Anton, Impact, sans-serif';
    // "$" drawn as an S with a tall bar through it, so at tag size it can't blur into "SASIMOV"
    var sw = x.measureText('S').width, w = sw * 1.15 + x.measureText('ASIMOV').width, k = Math.min(1, 184 / w);
    x.save(); x.translate(128 - w * k / 2, 132); x.scale(k, 1); x.textAlign = 'left';
    x.font = 'bold 52px Anton, Impact, sans-serif'; x.fillText('S', sw * 0.06, 2);
    x.fillRect(sw * 0.5 - 4, -44, 8, 88);                                            // the bar, taller than the caps
    x.font = 'bold 64px Anton, Impact, sans-serif'; x.fillText('ASIMOV', sw * 1.15, 0); x.restore();
    var t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; return t;
  }

  function create(opts) {
    opts = opts || {};
    useCoat(opts.coat);
    var env = opts.envMap || null, shells = opts.shells == null ? 14 : opts.shells, q = opts.quality || 1, fl = K.fluff;
    var root = new T.Group(), body = new T.Group(), headPivot = new T.Group(), head = new T.Group();
    root.add(body); body.add(headPivot); headPivot.position.set(0, 0.535, 0.08); headPivot.add(head); head.scale.setScalar(0.86);

    var bodyGeo = mesh(bodySDF, [-0.24, 0, -0.32], [0.24, 0.6, 0.2], 0.0065 / q, bodyPaint);
    body.add(furred(bodyGeo, env, shells, 0.008 * fl, 420 / Math.sqrt(fl)));
    var headGeo = mesh(headSDF, [-0.17, -0.09, -0.13], [0.17, 0.17, 0.15], 0.0045 / q, headPaint);
    head.add(furred(headGeo, env, shells, 0.0055 * fl, 560 / Math.sqrt(fl)));

    // ears: sculpted cups (thick rim, furred outside, dusky inside with pale tufts), one mesh shared by both sides
    var earGeo = mesh(earSDF, [-0.062, -0.03, -0.035], [0.062, 0.115, 0.045], 0.0025 / q, earPaint), ears = [];
    [-1, 1].forEach(function (s) {
      var ear = new T.Group(); ear.position.set(0.062 * s, 0.098, -0.022); ear.rotation.set(-0.12, 0.28 * s, -0.26 * s);
      ear.add(furred(earGeo, env, Math.min(shells, 10), 0.0035 * (0.5 + fl * 0.5), 900));
      head.add(ear); ears.push(ear);
    });

    // eyes, corneas and lids
    var eyeMat = eyeMaterial(), eyes = [], lids = [];
    var cornea = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.18, envMap: env, envMapIntensity: 2.2 });
    var lidMat = new T.MeshStandardMaterial({ color: lin('#1c1612'), roughness: 0.6 });
    [-1, 1].forEach(function (s) {
      var e = new T.Group(); e.position.set(EYE.x * s, EYE.y, EYE.z + 0.002); // set into the socket, under the brow e.rotation.set(0, 0.14 * s, -0.22 * s); e.scale.set(1.18, 0.8, 1);
      var ball = new T.Mesh(new T.SphereGeometry(EYE.r, 40, 28), eyeMat); e.add(ball);
      var c = new T.Mesh(new T.SphereGeometry(EYE.r * 1.035, 40, 28), cornea); e.add(c);
      var lidPivot = new T.Group(); e.add(lidPivot);
      var lid = new T.Mesh(new T.SphereGeometry(EYE.r * 1.05, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), lidMat); lidPivot.add(lid);
      // almond shape: the lid rests tilted over the top of the eye
      lidPivot.rotation.set(LID_OPEN, 0, 0.22 * s);
      head.add(e); eyes.push(ball); lids.push(lidPivot);
    });

    // nose
    var nose = new T.Mesh(new T.SphereGeometry(0.0105, 24, 16), new T.MeshStandardMaterial({ color: lin('#9a5a60'), roughness: 0.62, envMap: env, envMapIntensity: 0.4 }));
    nose.scale.set(1.15, 0.66, 0.72); nose.position.set(0, -0.001, 0.149); head.add(nose);

    // whiskers: thin curved tubes
    var wMat = new T.MeshStandardMaterial({ color: lin('#f7f3ea'), roughness: 0.4 });
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 5; i++) {
        var y0 = -0.012 - i * 0.006, z0 = 0.11 - i * 0.002;
        var curve = new T.QuadraticBezierCurve3(new T.Vector3(0.03 * s, y0, z0), new T.Vector3(0.12 * s, y0 + 0.012 - i * 0.004, z0 + 0.02), new T.Vector3((0.2 + i * 0.01) * s, y0 - 0.02 - i * 0.012, z0 - 0.02));
        head.add(new T.Mesh(new T.TubeGeometry(curve, 16, 0.0011, 5, false), wMat));
      }
      for (var b = 0; b < 2; b++) { // eyebrow whiskers
        var cb = new T.QuadraticBezierCurve3(new T.Vector3(0.045 * s, 0.066 + b * 0.008, 0.082), new T.Vector3(0.085 * s, 0.09 + b * 0.008, 0.09), new T.Vector3(0.125 * s, 0.098 + b * 0.01, 0.06)); // short brow whiskers, swept out, not up
        head.add(new T.Mesh(new T.TubeGeometry(cb, 10, 0.0009, 4, false), wMat));
      }
    });

    // collar and tag
    var collar = new T.Mesh(new T.TorusGeometry(0.108, 0.0085, 12, 64), new T.MeshStandardMaterial({ color: lin('#a3221d'), roughness: 0.6, envMap: env, envMapIntensity: 0.4 }));
    collar.position.set(0, 0.47, 0.06); collar.rotation.x = Math.PI / 2 + 0.4; collar.scale.set(1, 0.92, 0.7); body.add(collar);
    var tagPivot = new T.Group(); tagPivot.position.set(0, 0.425, 0.168); body.add(tagPivot);
    collar.visible = tagPivot.visible = K.collar; // Orange has no collar (yet)
    var ringM = new T.Mesh(new T.TorusGeometry(0.007, 0.0018, 8, 20), new T.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.25, envMap: env }));
    ringM.position.y = -0.008; tagPivot.add(ringM);
    var tagMats = [new T.MeshStandardMaterial({ color: 0xc9902e, metalness: 1, roughness: 0.3, envMap: env }), new T.MeshStandardMaterial({ map: tagTexture(), metalness: 0.85, roughness: 0.3, envMap: env }), new T.MeshStandardMaterial({ color: 0xc9902e, metalness: 1, roughness: 0.3, envMap: env })];
    var tag = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.004, 32), tagMats); tag.rotation.x = Math.PI / 2; tag.position.y = -0.03; tagPivot.add(tag);

    // tail: a tapered tube that curls around the front feet; rebuilt each frame
    var tailMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMap: env, envMapIntensity: 0.5 });
    var tail = furred(new T.BufferGeometry(), env, Math.min(shells, 10), 0.008 * fl, 380 / Math.sqrt(fl)); body.add(tail);
    var tipBall = new T.Mesh(new T.SphereGeometry(1, 16, 12), new T.MeshStandardMaterial({ color: STRIPE, roughness: 0.9 })); body.add(tipBall);
    function buildTail(t) {
      var sw = Math.sin(t * 0.9) * 0.05, flick = Math.max(0, Math.sin(t * 2.3 - 1)) * 0.03;
      var pts = [new T.Vector3(0.0, 0.06, -0.27), new T.Vector3(0.12, 0.025, -0.27), new T.Vector3(0.2, 0.02, -0.1), new T.Vector3(0.19, 0.02, 0.07), new T.Vector3(0.12 + sw, 0.025 + flick, 0.17), new T.Vector3(0.03 + sw * 1.6, 0.035 + flick * 1.8, 0.19)];
      var curve = new T.CatmullRomCurve3(pts), segs = 70, rad = 12, pos = [], nor = [], col = [], ind = [], c = new T.Color();
      var frames = curve.computeFrenetFrames(segs, false);
      for (var i = 0; i <= segs; i++) {
        var u = i / segs, p = curve.getPointAt(u), r = (0.028 - 0.01 * u) * K.tailR * (1 - 0.75 * sm(0.86, 1, u)), N = frames.normals[i], B = frames.binormals[i]; // tapers to a soft tip
        var ring = Math.sin(u * 38) > 0.25, tip = u > 0.88;
        c.copy(FUR).lerp(STRIPE, tip ? 0.95 : ring ? 0.8 : 0);
        for (var j = 0; j <= rad; j++) {
          var a = j / rad * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a);
          var nx = cx * N.x + sy * B.x, ny = cx * N.y + sy * B.y, nz = cx * N.z + sy * B.z;
          pos.push(p.x + r * nx, p.y + r * ny, p.z + r * nz); nor.push(nx, ny, nz); col.push(c.r, c.g, c.b);
        }
      }
      for (i = 0; i < segs; i++) for (j = 0; j < rad; j++) { var a0 = i * (rad + 1) + j, b0 = a0 + rad + 1; ind.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(ind);
      var old = tail.children[0].geometry; tail.children.forEach(function (m) { m.geometry = g; }); old.dispose();
      var end = curve.getPointAt(1); tipBall.position.copy(end); tipBall.scale.setScalar(0.0045);
    }

    // soft contact shadow
    var sc = document.createElement('canvas'); sc.width = sc.height = 128; var sx = sc.getContext('2d'), sg = sx.createRadialGradient(64, 64, 4, 64, 64, 64);
    sg.addColorStop(0, 'rgba(0,0,0,.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
    var shadow = new T.Mesh(new T.PlaneGeometry(0.9, 0.75), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0.02, 0.001, -0.05); root.add(shadow);

    var look = { x: 0, y: 0 };
    function update(t, o) {
      o = o || {};
      var tx = o.lookX != null ? o.lookX : Math.sin(t * 0.35) * 0.4, ty = o.lookY != null ? o.lookY : Math.sin(t * 0.23) * 0.2;
      look.x += (tx - look.x) * (o.snap ? 1 : 0.08); look.y += (ty - look.y) * (o.snap ? 1 : 0.08);
      headPivot.rotation.y = look.x * 0.55; headPivot.rotation.x = -look.y * 0.3 + Math.sin(t * 0.5) * 0.02; headPivot.rotation.z = -look.x * 0.08 + Math.sin(t * 0.31) * 0.03 + (o.tilt || 0);
      eyes.forEach(function (e) { e.rotation.y = look.x * 0.35; e.rotation.x = -look.y * 0.25; });
      var breath = Math.sin(t * 1.7) * 0.008; body.scale.set(1 + breath * 0.6, 1 + breath * 0.4, 1 + breath);
      // blink every few seconds, sometimes a slow blink (a cat's "I trust you")
      var bt = t % 4.6, slow = Math.floor(t / 4.6) % 3 === 2, dur = slow ? 0.9 : 0.18;
      var close = o.lid != null ? o.lid : (bt < dur ? Math.sin(bt / dur * Math.PI) : 0);
      lids.forEach(function (l) { l.rotation.x = LID_OPEN + close * (LID_SHUT - LID_OPEN); });
      eyeMat.uniforms.uDil.value = o.dilate != null ? o.dilate : 0.16 + 0.05 * Math.sin(t * 0.4);
      // ear twitches
      var tw = Math.max(0, Math.sin(t * 1.3) - 0.92) * 6;
      ears[0].rotation.z = 0.32 + tw * 0.25; ears[1].rotation.z = -0.32 - Math.max(0, Math.sin(t * 1.1 + 2) - 0.94) * 4;
      tagPivot.rotation.x = Math.sin(t * 1.7) * 0.06 + look.y * 0.1; tagPivot.rotation.z = -look.x * 0.15;
      buildTail(t);
    }
    update(0, { snap: true });
    return { group: root, update: update, head: headPivot, tag: tagPivot };
  }

  window.AsimovCat = { create: create };
})();
