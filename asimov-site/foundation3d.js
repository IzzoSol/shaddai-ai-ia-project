/* foundation3d.js — Trantor, in our own hand (three.js r128). Mounts into #trantor.
   A greebled megatower with pods, rings and an energy seam; disc-topped spires in a violet haze; a nebula sky with a
   ringed planet; drifting ships; a city of lights; the cloaked watcher and the cat on a ledge.
   Scroll drives the camera up the tower. Without WebGL a painted version (cover-paint "tower") stands in. */
(function () {
  'use strict';
  var host = document.getElementById('trantor'); if (!host) return;
  var T = window.THREE, reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fallback() { var c = document.createElement('canvas'); c.className = 'fallback'; host.prepend(c); if (window.CoverPaint) CoverPaint.paintTo(c, { scene: 'tower', seed: 76 }, 1200, 900); }
  var ok = false; try { var tc = document.createElement('canvas'); ok = !!(T && (tc.getContext('webgl') || tc.getContext('experimental-webgl'))); } catch (e) {}
  if (!ok) return fallback();

  function rng(seed) { var s = seed >>> 0; return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; }; }
  var r = rng(1951);
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function ease(v) { v = clamp(v); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; }

  var W = host.clientWidth, H = host.clientHeight;
  var renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, W < 700 ? 1 : 1.5)); renderer.setSize(W, H);
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  host.prepend(renderer.domElement);
  var scene = new T.Scene(); scene.fog = new T.FogExp2(0x161a36, 0.0105);
  var camera = new T.PerspectiveCamera(40, W / H, 0.1, 900);
  var composer = null;
  if (T.EffectComposer && T.UnrealBloomPass) { composer = new T.EffectComposer(renderer); composer.addPass(new T.RenderPass(scene, camera)); composer.addPass(new T.UnrealBloomPass(new T.Vector2(W, H), 0.85, 0.6, 0.72)); }

  /* ── sky: nebula shader on a big sphere ── */
  var skyMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: [
      'uniform float uTime; varying vec3 vP;',
      'float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }',
      'float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }',
      'float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }',
      'void main(){ vec3 p = vP*3.0 + vec3(0., uTime*.01, 0.);',
      ' float q = fbm(p + fbm(p*1.7));',
      ' vec3 deep = vec3(.03,.05,.12), teal = vec3(.2,.8,.9), pink = vec3(.9,.38,.65), violet = vec3(.32,.25,.7);',
      ' vec3 c = mix(deep, violet, smoothstep(.35,.75,q));',
      ' c = mix(c, teal, smoothstep(.55,.9,fbm(p*1.3+3.))*.8);',
      ' c = mix(c, pink, smoothstep(.55,.95,fbm(p*1.1-5.))*.65*(1.-vP.y*.6));',
      ' float st = step(.9975, h(floor(vP*900.))); c += st*vec3(1.);',
      ' c *= .55 + .45*smoothstep(-.2,.6,vP.y+.3);',
      ' gl_FragColor = vec4(c,1.); }'
    ].join('\n')
  });
  scene.add(new T.Mesh(new T.SphereGeometry(600, 48, 32), skyMat));

  // the ringed planet arc behind the tower
  var planet = new T.Mesh(new T.SphereGeometry(70, 64, 48), new T.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-max(dot(vN,vV),0.), 3.); vec3 c = mix(vec3(.08,.1,.2), vec3(.5,1.,1.), f); gl_FragColor = vec4(c*(.2+f*1.8), .35+f*.5); }'
  }));
  planet.position.set(10, 75, -260); scene.add(planet);
  var pring = new T.Mesh(new T.TorusGeometry(118, 0.6, 8, 200), new T.MeshBasicMaterial({ color: 0x9ff8ff, transparent: true, opacity: 0.7, fog: false }));
  pring.position.copy(planet.position); pring.rotation.set(1.25, 0.25, 0.4); scene.add(pring);

  /* ── materials ── */
  var steel = new T.MeshStandardMaterial({ color: 0x0c141e, metalness: 0.85, roughness: 0.5 });
  var steelL = new T.MeshStandardMaterial({ color: 0x18283a, metalness: 0.85, roughness: 0.42 });
  var lightCyan = new T.MeshBasicMaterial({ color: 0x8ff6ff, toneMapped: false });
  var lightAmber = new T.MeshBasicMaterial({ color: 0xffb070, toneMapped: false });
  var lilac = new T.MeshStandardMaterial({ color: 0x2e2a52, metalness: 0.5, roughness: 0.6 });

  /* ── the megatower ── */
  var tower = new T.Group(); scene.add(tower);
  var SEG = [[0, 10, 9.5], [10, 10, 8.2], [20, 12, 7.0], [32, 14, 6.4], [46, 18, 5.6], [64, 40, 4.6]];          // [y, height, radius]
  var greebles = [], lights = [];
  SEG.forEach(function (s, i) {
    var cyl = new T.Mesh(new T.CylinderGeometry(s[2], s[2] * 1.03, s[1], 48), i % 2 ? steelL : steel); cyl.position.y = s[0] + s[1] / 2; tower.add(cyl);
    var band = new T.Mesh(new T.CylinderGeometry(s[2] * 1.06, s[2] * 1.06, 0.6, 48), steelL); band.position.y = s[0] + 0.3; tower.add(band);
    var ring = new T.Mesh(new T.TorusGeometry(s[2] * 1.18, 0.12, 8, 80), lightCyan); ring.rotation.x = Math.PI / 2; ring.position.y = s[0] + 0.8; tower.add(ring);
    var n = Math.round(s[1] * s[2] * 3.2);
    for (var k = 0; k < n; k++) { greebles.push({ a: r() * Math.PI * 2, y: s[0] + r() * s[1], rad: s[2], w: 0.3 + r() * 1.6, h: 0.15 + r() * 1.1, d: 0.15 + r() * 0.6 }); }
    for (var j = 0; j < s[1] * 6; j++) lights.push({ a: r() * Math.PI * 2, y: s[0] + r() * s[1], rad: s[2] + 0.02, amber: r() > 0.7 });
  });
  var gb = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), steelL, greebles.length), m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), pos = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  greebles.forEach(function (g, i) { pos.set(Math.cos(g.a) * (g.rad + g.d / 2), g.y, Math.sin(g.a) * (g.rad + g.d / 2)); q.setFromAxisAngle(up, -g.a); sc.set(g.d, g.h, g.w); m4.compose(pos, q, sc); gb.setMatrixAt(i, m4); });
  tower.add(gb);
  var lb = new T.InstancedMesh(new T.BoxGeometry(0.05, 0.08, 0.35), lightCyan, lights.length), la = [];
  lights.forEach(function (l, i) { pos.set(Math.cos(l.a) * l.rad, l.y, Math.sin(l.a) * l.rad); q.setFromAxisAngle(up, -l.a); sc.set(1, 1, 1); m4.compose(pos, q, sc); lb.setMatrixAt(i, m4); if (l.amber) la.push(i); });
  tower.add(lb);
  var lbA = new T.InstancedMesh(new T.BoxGeometry(0.06, 0.1, 0.4), lightAmber, la.length);
  la.forEach(function (idx, i) { lb.getMatrixAt(idx, m4); lbA.setMatrixAt(i, m4); }); tower.add(lbA);
  // side pods
  [[-14, 12, 0, 6, 9], [14, 12, 0, 6, 9], [-10, 34, 2, 4.5, 8], [10, 36, -2, 4.5, 8]].forEach(function (p) {
    var pod = new T.Mesh(new T.CylinderGeometry(p[3], p[3], p[4], 32), steel); pod.position.set(p[0], p[1], p[2]); tower.add(pod);
    var cap = new T.Mesh(new T.CylinderGeometry(p[3] * 1.08, p[3] * 1.08, 0.5, 32), steelL); cap.position.set(p[0], p[1] + p[4] / 2, p[2]); tower.add(cap);
    var arm = new T.Mesh(new T.BoxGeometry(Math.abs(p[0]) - 4, 1.2, 1.6), steelL); arm.position.set(p[0] / 2, p[1], p[2]); tower.add(arm);
    var glow = new T.Mesh(new T.TorusGeometry(p[3] * 1.02, 0.08, 8, 64), lightCyan); glow.rotation.x = Math.PI / 2; glow.position.set(p[0], p[1] - p[4] / 2 + 0.6, p[2]); tower.add(glow);
  });
  // the energy seam: a column of light up the tower's face
  var seamTex = (function () { var c = document.createElement('canvas'); c.width = 64; c.height = 256; var g = c.getContext('2d'); var gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(120,255,255,0)'); gr.addColorStop(0.5, 'rgba(200,255,255,1)'); gr.addColorStop(1, 'rgba(120,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); return new T.CanvasTexture(c); })();
  var seam = new T.Mesh(new T.PlaneGeometry(3.2, 70), new T.MeshBasicMaterial({ map: seamTex, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
  seam.position.set(0, 35, 9.9); tower.add(seam);

  /* ── Whelan-style spires in the haze ── */
  for (var i = 0; i < 26; i++) {
    var ang = r() * Math.PI * 2, dist = 70 + r() * 160, hgt = 25 + r() * 70, rad = 0.8 + r() * 2.2;
    var g = new T.Group(); g.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist - 40);
    var col = new T.Mesh(new T.CylinderGeometry(rad * 0.8, rad, hgt, 16), lilac); col.position.y = hgt / 2; g.add(col);
    if (r() > 0.35) { var disc = new T.Mesh(new T.CylinderGeometry(rad * 4.5, rad * 2.2, rad * 0.9, 32), lilac); disc.position.y = hgt; g.add(disc); }
    if (r() > 0.6) for (var k2 = 0; k2 < 3; k2++) { var rr = new T.Mesh(new T.TorusGeometry(rad * 2.4, rad * 0.12, 6, 40), lilac); rr.rotation.x = Math.PI / 2; rr.position.y = hgt * 0.7 + k2 * rad * 0.9; g.add(rr); }
    scene.add(g);
  }

  /* ── the city: a sea of lights ── */
  var ground = new T.Mesh(new T.PlaneGeometry(1200, 1200), new T.MeshStandardMaterial({ color: 0x0a1020, metalness: 0.4, roughness: 0.8 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  var CL = 2400, cg = new T.BufferGeometry(), cp = new Float32Array(CL * 3), cc = new Float32Array(CL * 3), ca = new T.Color(0xffb070), ct = new T.Color(0x8ff6ff);
  for (var c1 = 0; c1 < CL; c1++) { var a2 = r() * Math.PI * 2, d2 = 14 + Math.pow(r(), 0.6) * 220; cp[c1 * 3] = Math.cos(a2) * d2; cp[c1 * 3 + 1] = 0.3 + r() * 3; cp[c1 * 3 + 2] = Math.sin(a2) * d2; var cl = r() > 0.55 ? ca : ct; cc[c1 * 3] = cl.r; cc[c1 * 3 + 1] = cl.g; cc[c1 * 3 + 2] = cl.b; }
  cg.setAttribute('position', new T.BufferAttribute(cp, 3)); cg.setAttribute('color', new T.BufferAttribute(cc, 3));
  scene.add(new T.Points(cg, new T.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })));
  for (var b2 = 0; b2 < 140; b2++) { var a3 = r() * Math.PI * 2, d3 = 18 + r() * 120, bh = 1 + r() * 9; var blk = new T.Mesh(new T.BoxGeometry(2 + r() * 6, bh, 2 + r() * 6), steel); blk.position.set(Math.cos(a3) * d3, bh / 2, Math.sin(a3) * d3); scene.add(blk); }

  /* ── ships ── */
  var ships = [];
  for (var s2 = 0; s2 < 9; s2++) {
    var sh = new T.Group(), len = 1.6 + r() * 3;
    var hull = new T.Mesh(new T.CylinderGeometry(len * 0.12, len * 0.22, len, 10), steelL); hull.rotation.z = Math.PI / 2; sh.add(hull);
    var eng = new T.Mesh(new T.SphereGeometry(len * 0.1, 8, 6), lightAmber); eng.position.x = -len / 2; sh.add(eng);
    sh.userData = { y: 14 + r() * 50, z: -10 + r() * 40, sp: 0.6 + r() * 1.4, off: r() * 200, dir: r() > 0.5 ? 1 : -1 };
    scene.add(sh); ships.push(sh);
  }

  /* ── the ledge, the watcher, the cat ── */
  var ledge = new T.Group(); ledge.position.set(0, 0, 34); scene.add(ledge);
  [[16, 3, 10, 1.5], [9, 2, 6, 4], [4, 1.2, 3, 5.6]].forEach(function (b) { var m = new T.Mesh(new T.BoxGeometry(b[0], b[1], b[2]), steel); m.position.y = b[3] - b[1] / 2 + (b[3] === 1.5 ? 0 : 0); m.position.y = b[3]; ledge.add(m); });
  var dark = new T.MeshStandardMaterial({ color: 0x05070a, roughness: 0.9 });
  var watcher = new T.Group(); watcher.position.set(0, 6.2, 0); ledge.add(watcher);
  var cape = new T.Mesh(new T.ConeGeometry(0.55, 1.75, 16, 1, true), dark); cape.position.y = 0.88; watcher.add(cape);
  watcher.add(new T.Mesh(new T.SphereGeometry(0.17, 16, 12), dark)).children[1].position.set(0, 1.92, 0);
  var tail = new T.Mesh(new T.PlaneGeometry(0.7, 1.3), new T.MeshStandardMaterial({ color: 0x05070a, side: T.DoubleSide })); tail.position.set(-0.45, 0.7, 0.1); tail.rotation.set(0, 0.4, 0.35); watcher.add(tail);
  if (true) {
    var img = new Image(), catTex = new T.Texture(img); catTex.encoding = T.sRGBEncoding; img.onload = function () { catTex.needsUpdate = true; };
    img.src = 'assets/cat-front.png';
    var cat = new T.Sprite(new T.SpriteMaterial({ map: catTex, color: 0x7a8aa0 })); cat.center.set(0.5, 0); cat.scale.set(0.48, 0.63, 1); cat.position.set(0.75, 6.2, 0.2); ledge.add(cat);
  }

  /* ── lights ── */
  scene.add(new T.HemisphereLight(0x3a6a8a, 0x120c22, 0.35));
  var back = new T.DirectionalLight(0x6ff0ff, 1.6); back.position.set(10, 60, -120); scene.add(back);
  var magenta = new T.DirectionalLight(0xff5ab0, 0.7); magenta.position.set(90, 20, -40); scene.add(magenta);
  var key = new T.DirectionalLight(0x9fc8ff, 0.45); key.position.set(-60, 80, 60); scene.add(key);
  var seamLight = new T.PointLight(0x8ff6ff, 3.2, 60); seamLight.position.set(0, 20, 16); scene.add(seamLight);

  /* ── camera: scroll rises from behind the watcher up the tower ── */
  var k = 0, kT = 0;
  function progress() { var b = host.getBoundingClientRect(), vh = window.innerHeight; return clamp((vh - b.top) / (vh + b.height)); }
  window.addEventListener('scroll', function () { kT = progress(); kick(); }, { passive: true });
  function frame(t) {
    k += (kT - k) * 0.08;
    var e = ease(k);
    var camPos = new T.Vector3(lerp(3.5, -9, e), lerp(7.6, 46, e), lerp(44, 30, e));
    var look = new T.Vector3(lerp(0, 0, e), lerp(16, 58, e), 0);
    if (!reduce) { camPos.x += Math.sin(t * 0.15) * 0.6; camPos.y += Math.sin(t * 0.2) * 0.3; }
    camera.position.copy(camPos); camera.lookAt(look);
    skyMat.uniforms.uTime.value = t;
    tower.rotation.y = reduce ? 0.2 : 0.2 + t * 0.01;
    seam.material.opacity = 0.7 + Math.sin(t * 2.2) * 0.15;
    ships.forEach(function (s) { var u = s.userData, x = (((t * u.sp * 4 + u.off) % 260) - 130) * u.dir; s.position.set(x, u.y, u.z); s.rotation.y = u.dir > 0 ? 0 : Math.PI; });
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  var on = false, raf = 0, t0 = performance.now();
  function tick(now) { raf = 0; if (!on || document.hidden) return; frame((now - t0) / 1000); if (!reduce) raf = requestAnimationFrame(tick); }
  function kick() { if (!raf && on) raf = requestAnimationFrame(tick); }
  new IntersectionObserver(function (es) { on = es[0].isIntersecting; if (on) kT = progress(); kick(); }, { rootMargin: '100px' }).observe(host);
  new ResizeObserver(function () { W = host.clientWidth; H = host.clientHeight; if (!W || !H) return; renderer.setSize(W, H); if (composer) composer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); kick(); }).observe(host);
  document.addEventListener('visibilitychange', kick);
  kT = k = progress(); frame(0);
})();
