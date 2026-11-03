/* three-scenes.js — WebGL upgrades for the $ASIMOV page (three.js r128, UMD global THREE).
   PairOrbit: $ASIMOV and NVDAx as two coins orbiting each other, with swap particles flowing between them.
   If THREE or WebGL is missing, nothing here runs and the CSS versions stay in place. */
(function () {
  'use strict';
  if (!window.THREE) return;
  var T = window.THREE;
  function hasGL() { try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; } }
  if (!hasGL()) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DISPLAY = "'Anton','Impact','Arial Narrow Bold',sans-serif";
  var COND = "'Oswald','Arial Narrow',sans-serif";

  /* ── shared helpers ── */
  function makeRenderer(host) {
    var r = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputEncoding = T.sRGBEncoding;
    r.domElement.className = 'gl';
    host.appendChild(r.domElement);
    return r;
  }
  function tex(canvas) { var t = new T.CanvasTexture(canvas); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function wrapLines(ctx, text, max) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line); return lines;
  }
  // Runs `frame` every animation frame while `el` is on screen and the tab is visible.
  function loopWhileVisible(el, frame) {
    var on = false, raf = 0, last = performance.now();
    function tick(now) { raf = 0; if (!on || document.hidden) return; var dt = Math.min(0.05, (now - last) / 1000); last = now; frame(dt, now / 1000); raf = requestAnimationFrame(tick); }
    function start() { if (!raf && on && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } }
    new IntersectionObserver(function (es) { on = es[0].isIntersecting; start(); }, { rootMargin: '120px' }).observe(el);
    document.addEventListener('visibilitychange', start);
    return start;
  }

  /* ═════════════ PairOrbit ═════════════ */
  function PairOrbit() {
    var host = document.getElementById('orbit'); if (!host) return;
    function face(kind) {
      var s = 512, c = canvas(s, s), ctx = c.getContext('2d'), m = s / 2;
      var fic = kind === 'asimov';
      var g = ctx.createRadialGradient(m * 0.7, m * 0.6, 20, m, m, m);
      if (fic) { g.addColorStop(0, '#ffd27a'); g.addColorStop(0.55, '#d8322b'); g.addColorStop(1, '#4a0e0c'); }
      else { g.addColorStop(0, '#d4f58a'); g.addColorStop(0.55, '#3f7a12'); g.addColorStop(1, '#0d1f05'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(m, m, m - 26, 0, 6.283); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m, m, m - 70, 0, 6.283); ctx.stroke();
      // ring lettering
      var ring = fic ? '$ASIMOV · SCIENCE FICTION · 1942 · ' : 'NVDAx · SCIENCE FACT · BACKED 1:1 · ';
      ctx.font = '600 30px ' + COND; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      for (var i = 0; i < ring.length; i++) { var a = i / ring.length * 6.283; ctx.save(); ctx.translate(m + Math.sin(a) * (m - 48), m - Math.cos(a) * (m - 48)); ctx.rotate(a); ctx.fillText(ring[i], 0, 10); ctx.restore(); }
      if (fic) { // robot head
        ctx.fillStyle = '#1d1410'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(m - 70, m - 95, 140, 150, 34) : ctx.rect(m - 70, m - 95, 140, 150); ctx.fill();
        ctx.fillStyle = '#fff4d6'; ctx.shadowColor = '#fff4d6'; ctx.shadowBlur = 20; ctx.fillRect(m - 44, m - 45, 30, 16); ctx.fillRect(m + 14, m - 45, 30, 16); ctx.shadowBlur = 0;
        ctx.fillStyle = '#e8a21c'; ctx.fillRect(m - 30, m + 10, 60, 12); ctx.fillRect(m - 8, m - 120, 16, 26);
        ctx.font = '400 50px ' + DISPLAY; ctx.fillStyle = '#fff'; ctx.fillText('$ASIMOV', m, m + 128); // full ticker, never "$A"
      } else { // chip grid
        ctx.strokeStyle = 'rgba(220,255,160,.5)'; ctx.lineWidth = 3;
        for (var k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(m - 120, m + k * 30); ctx.lineTo(m + 120, m + k * 30); ctx.stroke(); ctx.beginPath(); ctx.moveTo(m + k * 30, m - 120); ctx.lineTo(m + k * 30, m + 120); ctx.stroke(); }
        ctx.fillStyle = '#0d1f05'; ctx.fillRect(m - 92, m - 56, 184, 112);
        ctx.font = '400 72px ' + DISPLAY; ctx.fillStyle = '#e9ffc2'; ctx.fillText('NVDAx', m, m + 26);
      }
      return tex(c);
    }
    var renderer = makeRenderer(host);
    var scene = new T.Scene(), camera = new T.PerspectiveCamera(34, 1, 0.1, 40);
    camera.position.set(0, 1.6, 6.2); camera.lookAt(0, 0, 0);
    scene.add(new T.AmbientLight(0xffffff, 0.6));
    var kl = new T.DirectionalLight(0xfff0d0, 1.2); kl.position.set(2, 4, 5); scene.add(kl);
    var rl = new T.PointLight(0xd8322b, 1.4, 12); rl.position.set(-3, 1, -2); scene.add(rl);
    var gl = new T.PointLight(0x76b900, 1.4, 12); gl.position.set(3, 1, -2); scene.add(gl);
    function coin(kind, edge) {
      var f = face(kind);
      var m = new T.Mesh(new T.CylinderGeometry(0.85, 0.85, 0.14, 72), [
        new T.MeshStandardMaterial({ color: edge, metalness: 0.75, roughness: 0.28 }),
        new T.MeshStandardMaterial({ map: f, metalness: 0.3, roughness: 0.4 }),
        new T.MeshStandardMaterial({ map: f, metalness: 0.3, roughness: 0.4 })
      ]);
      m.rotation.x = Math.PI / 2; var g = new T.Group(); g.add(m); scene.add(g); return g;
    }
    var A = coin('asimov', 0xd9a441), B = coin('nvdax', 0x9cc46a);
    // swap particles: gold flows A→B, green flows B→A
    var P = 70, pg = new T.BufferGeometry(), pp = new Float32Array(P * 3), pc = new Float32Array(P * 3), seeds = [];
    var cg = new T.Color(0xffc75a), cn = new T.Color(0xa8ff4a);
    for (var i = 0; i < P; i++) { seeds.push({ u: Math.random(), sp: 0.25 + Math.random() * 0.35, dir: i % 2, off: Math.random() * 6.283 }); var c = i % 2 ? cn : cg; pc[i * 3] = c.r; pc[i * 3 + 1] = c.g; pc[i * 3 + 2] = c.b; }
    pg.setAttribute('position', new T.BufferAttribute(pp, 3)); pg.setAttribute('color', new T.BufferAttribute(pc, 3));
    var pts = new T.Points(pg, new T.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending }));
    scene.add(pts);
    var lineG = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
    var line = new T.Line(lineG, new T.LineBasicMaterial({ color: 0xf1dcbc, transparent: true, opacity: 0.35 })); scene.add(line);

    host.classList.add('is-3d');
    var tilt = { x: 0, y: 0 };
    host.addEventListener('pointermove', function (e) { var r = host.getBoundingClientRect(); tilt.x = (e.clientX - r.left) / r.width - 0.5; tilt.y = (e.clientY - r.top) / r.height - 0.5; kick(); });
    function size() { var w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; var z = camera.aspect < 1.4 ? 7.4 : 5.3; camera.position.set(0, z * 0.26, z); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); kick(); }
    new ResizeObserver(size).observe(host);
    var pa = new T.Vector3(), pb = new T.Vector3(), mid = new T.Vector3();
    var kick = loopWhileVisible(host, function (dt, t) {
      var a = reduce ? 0.6 : t * 0.7, r = 1.25;
      pa.set(Math.cos(a) * r, Math.sin(a * 2) * 0.12, Math.sin(a) * r * 0.55);
      pb.set(-pa.x, -pa.y, -pa.z);
      A.position.copy(pa); B.position.copy(pb);
      A.rotation.y = reduce ? 0.3 : Math.sin(t * 0.9) * 0.7 + tilt.x; B.rotation.y = reduce ? -0.3 : Math.sin(t * 0.9 + 2) * 0.7 + tilt.x;
      A.rotation.x = B.rotation.x = tilt.y * 0.5;
      line.geometry.attributes.position.setXYZ(0, pa.x, pa.y, pa.z); line.geometry.attributes.position.setXYZ(1, pb.x, pb.y, pb.z); line.geometry.attributes.position.needsUpdate = true;
      for (var i = 0; i < P; i++) {
        var s = seeds[i]; if (!reduce) s.u = (s.u + dt * s.sp) % 1;
        var u = s.dir ? 1 - s.u : s.u, from = pa, to = pb;
        mid.lerpVectors(from, to, u);
        var bulge = Math.sin(u * Math.PI) * 0.35;
        pp[i * 3] = mid.x + Math.cos(s.off + t) * bulge * 0.4;
        pp[i * 3 + 1] = mid.y + Math.sin(s.off + t * 1.3) * bulge * (s.dir ? 1 : -1);
        pp[i * 3 + 2] = mid.z + Math.sin(s.off) * bulge * 0.4;
      }
      pg.attributes.position.needsUpdate = true;
      scene.rotation.y += ((tilt.x * 0.4) - scene.rotation.y) * Math.min(1, dt * 3);
      renderer.render(scene, camera);
    });
    size();
  }

  function boot() { try { PairOrbit(); } catch (e) { console.warn('PairOrbit off:', e); } }
  // Canvas text needs the web fonts loaded before textures are drawn.
  var booted = false; function once() { if (!booted) { booted = true; boot(); } }
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(once); setTimeout(once, 2500); } else once();
})();
