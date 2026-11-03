/* shelf.js — the swivel: a turntable of items you can spin, drag, click and buy from.
   One component, three shelves on the page (Asimov's books, the Foundation novels, the painters).
   3D (three.js r128) when WebGL is available, a CSS 3D ring otherwise. Both drive the same plate below.

   Swivel({
     host:  element (.swivel),  plate: element (.plate with .spin-prev .spin-next .ob-title .ob-meta .ob-buy),
     kind:  'book' | 'canvas',            // a paperback with spine and pages, or a framed painting
     items: [{ title, meta, scene, sky, accent, seed, author, links:[{label, href}], cover:'openlibrary'|null, query }]
   })                                                                                            */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DISPLAY = "'Anton','Impact','Arial Narrow Bold',sans-serif", COND = "'Oswald','Arial Narrow',sans-serif";
  var hasGL = (function () { try { var c = document.createElement('canvas'); return !!(window.THREE && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; } })();
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cacheGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function cacheSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function cnv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function wrapLines(ctx, text, max) { var words = text.split(' '), lines = [], line = ''; words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }); if (line) lines.push(line); return lines; }

  // Real covers: Open Library first, Google Books as a fallback. Looked up once per browser and cached
  // (a failed network call is never cached, so the next visit tries again). We hotlink, never rehost.
  function coverId(item, done) {
    var key = 'cover2:' + item.title, hit = cacheGet(key);
    if (hit) return done(hit);
    var who = item.author || 'Isaac Asimov';
    function google() {
      fetch('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent('intitle:"' + item.title + '" inauthor:' + who.split(' ').pop()) + '&maxResults=5&fields=items(volumeInfo/imageLinks)')
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) { var v = (j.items || []).find(function (x) { return x.volumeInfo && x.volumeInfo.imageLinks; }); var u = v ? 'gb:' + v.volumeInfo.imageLinks.thumbnail.replace(/^http:/, 'https:').replace('&edge=curl', '') : 'none'; cacheSet(key, u); done(u); })
        .catch(function () { done('none'); });
    }
    fetch('https://openlibrary.org/search.json?title=' + encodeURIComponent(item.title) + '&author=' + encodeURIComponent(who) + '&fields=cover_i,edition_count&limit=8')
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { var d = (j.docs || []).filter(function (x) { return x.cover_i; }).sort(function (x, y) { return (y.edition_count || 0) - (x.edition_count || 0); })[0]; if (d) { cacheSet(key, String(d.cover_i)); done(String(d.cover_i)); } else google(); })
      .catch(google);
  }
  // cover id → image URL (size 'M' or 'L')
  function coverSrc(id, size) { return id.indexOf('gb:') === 0 ? id.slice(3).replace(/zoom=\d/, 'zoom=' + (size === 'L' ? 2 : 1)) : 'https://covers.openlibrary.org/b/id/' + id + '-' + size + '.jpg'; }
  function queue(list, worker) { var q = list.slice(); function next() { var x = q.shift(); if (x === undefined) return; worker(x, function () { setTimeout(next, 120); }); } next(); next(); }

  // the painted face of an item (cover or canvas), title lettered on for books
  function face(item, k, kind, w, h) {
    var c = cnv(w, h), ctx = window.CoverPaint.paintTo(c, { scene: item.scene, seed: item.seed || 300 + k, sky: item.sky, accent: item.accent }, w, h);
    if (kind === 'book') {
      var g = ctx.createLinearGradient(0, 0, 0, h * 0.38); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.38);
      ctx.font = '400 ' + Math.round(w * 0.12) + 'px ' + DISPLAY; ctx.textBaseline = 'top';
      var lines = wrapLines(ctx, item.title.toUpperCase(), w * 0.86);
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4; ctx.fillStyle = '#fff';
      lines.forEach(function (l, i) { ctx.fillText(l, w * 0.07, w * 0.07 + i * w * 0.125); });
      ctx.shadowColor = 'transparent'; ctx.font = '600 ' + Math.round(w * 0.042) + 'px ' + COND; ctx.fillStyle = '#ffd98a';
      ctx.fillText((item.author || 'ISAAC ASIMOV').toUpperCase().split('').join(' '), w * 0.07, w * 0.1 + lines.length * w * 0.125);
    }
    ctx.globalAlpha = kind === 'book' ? 0.12 : 0.06; ctx.fillStyle = '#000';
    for (var y = 0; y < h; y += 5) for (var x = (y / 5) % 2 ? 2.5 : 0; x < w; x += 5) { ctx.beginPath(); ctx.arc(x, y, 1.1, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
    return c;
  }

  function Swivel(cfg) {
    var host = cfg.host, plateEl = cfg.plate, items = cfg.items, kind = cfg.kind || 'book', N = items.length;
    if (!host || !plateEl || !N || !window.CoverPaint) return;
    var api = { turn: null, front: 0 };

    function plate(f) {
      var it = items[f];
      plateEl.querySelector('.ob-title').textContent = it.title;
      plateEl.querySelector('.ob-meta').textContent = it.meta;
      plateEl.querySelector('.ob-buy').innerHTML = (it.links || []).map(function (l) { return '<a href="' + esc(l.href) + '" target="_blank" rel="noopener' + (l.sponsored ? ' sponsored' : '') + '">' + esc(l.label) + '</a>'; }).join('');
    }
    plateEl.querySelector('.spin-prev').addEventListener('click', function () { api.turn(-1); });
    plateEl.querySelector('.spin-next').addEventListener('click', function () { api.turn(1); });
    host.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); api.turn(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); api.turn(-1); } });

    if (hasGL) { try { gl(); return api; } catch (err) { console.warn('swivel 3D off:', err); } }
    css(); return api;

    /* ── CSS fallback: a ring of covers ── */
    function css() {
      var STEP = 360 / N, rot = 0, ring = document.createElement('div'); ring.className = 'ring' + (kind === 'canvas' ? ' ring-art' : ''); host.prepend(ring);
      ring.innerHTML = items.map(function (it, k) { return '<div class="ob" style="--a:' + (k * STEP) + 'deg" data-k="' + k + '"><div class="cover"></div><div class="gloss"></div></div>'; }).join('');
      var obs = [].slice.call(ring.children);
      obs.forEach(function (o, k) { var c = face(items[k], k, kind, 300, kind === 'canvas' ? 380 : 450); c.className = 'art'; o.querySelector('.cover').appendChild(c); });
      function radius() { var w = obs[0].getBoundingClientRect().width || 150; return Math.round((w / 2) / Math.tan(Math.PI / N)) + 24; }
      function front() { return ((Math.round(-rot / STEP) % N) + N) % N; }
      function apply() { ring.style.setProperty('--rz', radius() + 'px'); ring.style.transform = 'translateZ(' + (-radius()) + 'px) rotateY(' + rot + 'deg)'; var f = front(); obs.forEach(function (o, k) { o.classList.toggle('front', k === f); }); plate(f); }
      api.turn = function (d) { rot -= d * STEP; apply(); };
      var x0 = null, r0 = 0;
      host.addEventListener('pointerdown', function (e) { x0 = e.clientX; r0 = rot; ring.classList.add('dragging'); });
      window.addEventListener('pointermove', function (e) { if (x0 === null) return; rot = r0 + (e.clientX - x0) * 0.35; apply(); });
      window.addEventListener('pointerup', function () { if (x0 === null) return; x0 = null; ring.classList.remove('dragging'); rot = Math.round(rot / STEP) * STEP; apply(); });
      window.addEventListener('resize', apply); apply();
      if (kind === 'book') new IntersectionObserver(function (es, io) {
        if (!es[0].isIntersecting) return; io.disconnect();
        queue(obs.filter(function (o) { return items[+o.dataset.k].cover === 'openlibrary'; }), function (o, next) {
          coverId(items[+o.dataset.k], function (id) { if (id !== 'none') { var img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.onload = function () { if (img.naturalWidth > 20) { o.querySelector('.cover').prepend(img); o.classList.add('has-img'); } }; img.src = coverSrc(id, 'M'); } next(); });
        });
      }, { rootMargin: '400px' }).observe(host);
    }

    /* ── WebGL: lit turntable ── */
    function gl() {
      var T = window.THREE, STEP = Math.PI * 2 / N;
      var art = kind === 'canvas', BW = art ? 1.3 : 1.25, BH = art ? 1.65 : 1.875, BD = art ? 0.07 : 0.22, R = Math.max(3.2, N * 0.3);
      function tex(c) { var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
      var pagesTex = tex((function () { var c = cnv(64, 256), x = c.getContext('2d'); x.fillStyle = art ? '#3a2a14' : '#efe2c6'; x.fillRect(0, 0, 64, 256); for (var i = 0; i < 64; i += 2) { x.fillStyle = i % 4 ? 'rgba(120,90,50,.18)' : 'rgba(255,255,255,.2)'; x.fillRect(i, 0, 1, 256); } return c; })());
      var backTex = tex((function () { var c = cnv(256, 384), x = c.getContext('2d'); x.fillStyle = art ? '#2a1d10' : '#1d1410'; x.fillRect(0, 0, 256, 384); if (!art) { x.fillStyle = '#fff'; x.fillRect(150, 300, 80, 50); } return c; })());
      var shadowTex = new T.CanvasTexture((function () { var c = cnv(128, 128), x = c.getContext('2d'); var g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,.65)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c; })());

      var renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputEncoding = T.sRGBEncoding;
      renderer.domElement.className = 'gl'; host.appendChild(renderer.domElement);
      var scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 2, 0.1, 80);
      scene.add(new T.AmbientLight(0xfff1dc, art ? 0.45 : 0.55));
      var key = new T.DirectionalLight(0xffe2b8, 1.0); key.position.set(3, 5, 9); scene.add(key);
      var rim = new T.PointLight(cfg.rim || 0xd8322b, 2.2, 22); rim.position.set(-5, 2.5, -2); scene.add(rim);
      var gold = new T.PointLight(0xe8a21c, 1.2, 16); gold.position.set(5, -1, 3); scene.add(gold);
      var spot = new T.SpotLight(0xfff6e6, art ? 1.6 : 1.1, 24, 0.38, 0.6); spot.position.set(0, 5, R + 5); spot.target.position.set(0, 0, R); scene.add(spot); scene.add(spot.target);
      var disc = new T.Mesh(new T.CylinderGeometry(R + 1.1, R + 1.25, 0.12, 96), new T.MeshStandardMaterial({ color: cfg.disc || 0x2a1d16, roughness: 0.35, metalness: 0.25 }));
      disc.position.y = -BH / 2 - 0.07; scene.add(disc);
      var trim = new T.Mesh(new T.TorusGeometry(R + 1.18, 0.025, 8, 128), new T.MeshStandardMaterial({ color: cfg.trim || 0xa5302a, emissive: cfg.trimGlow || 0x5a1010, roughness: 0.4 }));
      trim.rotation.x = Math.PI / 2; trim.position.y = -BH / 2 - 0.01; scene.add(trim);

      var group = new T.Group(); scene.add(group);
      var frameMat = new T.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.9, roughness: 0.3 });
      var objs = [], meshes = [];
      items.forEach(function (it, k) {
        var faceC = face(it, k, kind, 512, art ? 650 : 768), faceT = tex(faceC);
        var spineC = cnv(96, 768), sx = spineC.getContext('2d'), base = (it.sky || '#151515').split(',')[1] || '#151515';
        sx.fillStyle = base; sx.fillRect(0, 0, 96, 768);
        if (!art) { sx.save(); sx.translate(60, 46); sx.rotate(Math.PI / 2); sx.font = '400 40px ' + DISPLAY; sx.fillStyle = '#fff'; sx.fillText(it.title.toUpperCase(), 0, 0); sx.font = '600 22px ' + COND; sx.fillStyle = '#ffd98a'; sx.fillText((it.spine || 'ASIMOV'), 560, 0); sx.restore(); }
        var mats = [
          new T.MeshStandardMaterial({ map: pagesTex, roughness: 0.9 }), new T.MeshStandardMaterial({ map: tex(spineC), roughness: 0.55 }),
          new T.MeshStandardMaterial({ map: pagesTex, roughness: 0.9 }), new T.MeshStandardMaterial({ map: pagesTex, roughness: 0.9 }),
          new T.MeshStandardMaterial({ map: faceT, roughness: art ? 0.62 : 0.42, metalness: 0.04 }), new T.MeshStandardMaterial({ map: backTex, roughness: 0.6 })
        ];
        var mesh = new T.Mesh(new T.BoxGeometry(BW, BH, BD), mats); mesh.userData.k = k;
        if (art) { // a gilt frame around the canvas
          var fw = 0.07;
          [[0, BH / 2 + fw / 2, BW + fw * 2, fw], [0, -BH / 2 - fw / 2, BW + fw * 2, fw], [-BW / 2 - fw / 2, 0, fw, BH], [BW / 2 + fw / 2, 0, fw, BH]].forEach(function (f) {
            var fr = new T.Mesh(new T.BoxGeometry(f[2], f[3], BD + 0.06), frameMat); fr.position.set(f[0], f[1], 0.0); mesh.add(fr);
          });
        }
        var holder = new T.Group(), a = k * STEP;
        holder.position.set(Math.sin(a) * R, 0, Math.cos(a) * R); holder.rotation.y = a;
        var sh = new T.Mesh(new T.PlaneGeometry(BW * 1.6, 0.9), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
        sh.rotation.x = -Math.PI / 2; sh.position.y = -BH / 2 - 0.005;
        holder.add(mesh); holder.add(sh); group.add(holder);
        objs.push({ mesh: mesh, face: faceC, faceT: faceT, mats: mats, lift: 0, push: 0 }); meshes.push(mesh);
      });
      var DUST = 220, dg = new T.BufferGeometry(), dp = new Float32Array(DUST * 3);
      for (var i = 0; i < DUST; i++) { dp[i * 3] = (Math.random() - 0.5) * 16; dp[i * 3 + 1] = (Math.random() - 0.3) * 6; dp[i * 3 + 2] = (Math.random() - 0.5) * 12; }
      dg.setAttribute('position', new T.BufferAttribute(dp, 3));
      var dust = new T.Points(dg, new T.PointsMaterial({ color: 0xffd9a0, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false })); scene.add(dust);
      host.classList.add('is-3d');

      var rot = 0, target = 0, front = -1, hovered = -1, idle = 0, dragging = false, x0 = 0, t0 = 0, moved = false, vel = 0, lastX = 0, lastT = 0;
      function frontIndex() { return ((Math.round(-rot / STEP) % N) + N) % N; }
      function snap(v) { return Math.round(v / STEP) * STEP; }
      api.turn = function (d) { target = snap(target) - d * STEP; idle = 0; kick(); };
      function size() {
        var w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
        renderer.setSize(w, h, false); camera.aspect = w / h;
        var far = w < 560 ? 15.5 : w < 900 ? 12.5 : 10.8;
        camera.position.set(0, 1.25, R + far - 4); camera.lookAt(0, 0.05, R - 1.2); camera.updateProjectionMatrix(); kick();
      }
      new ResizeObserver(size).observe(host);
      var ray = new T.Raycaster(), ptr = new T.Vector2(), el = renderer.domElement;
      function pick(e) { var r = el.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera); var hit = ray.intersectObjects(meshes, false)[0]; return hit ? hit.object.userData.k : -1; }
      el.addEventListener('pointerdown', function (e) { dragging = true; moved = false; x0 = lastX = e.clientX; t0 = target; lastT = performance.now(); vel = 0; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', function (e) {
        if (dragging) { var dx = e.clientX - x0; if (Math.abs(dx) > 4) moved = true; var now = performance.now(); vel = (e.clientX - lastX) / Math.max(1, now - lastT); lastX = e.clientX; lastT = now; target = rot = t0 + dx * 0.0065; kick(); }
        else { var k = pick(e); if (k !== hovered) { hovered = k; el.style.cursor = k >= 0 ? 'pointer' : 'grab'; kick(); } }
      });
      function release(e) {
        if (!dragging) return; dragging = false; idle = 0;
        if (!moved) { var k = pick(e); if (k >= 0) { var d = ((k - frontIndex()) % N + N) % N; if (d > N / 2) d -= N; api.turn(d); } return; }
        target = snap(target + vel * 0.35); kick();
      }
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('pointerleave', function () { hovered = -1; });
      if (!reduce) setInterval(function () { if (document.hidden || dragging || host.matches(':hover') || host.contains(document.activeElement)) { idle = 0; return; } if (++idle >= 5) { api.turn(1); idle = 0; } }, 1000);

      var on = false, raf = 0, last = performance.now();
      function tick(now) {
        raf = 0; if (!on || document.hidden) return;
        var dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;
        rot += (target - rot) * (dragging ? 1 : 1 - Math.pow(0.0015, dt)); group.rotation.y = rot;
        var f = frontIndex(); if (f !== front) { front = f; api.front = f; plate(f); }
        objs.forEach(function (b, k) {
          var isF = k === f, isH = k === hovered && !isF;
          b.lift += ((isF ? 0.16 : 0) - b.lift) * Math.min(1, dt * 7); b.push += ((isF ? 0.35 : isH ? 0.18 : 0) - b.push) * Math.min(1, dt * 7);
          b.mesh.position.set(0, b.lift + (isF && !reduce ? Math.sin(t * 1.6) * 0.03 : 0), b.push); b.mesh.rotation.x = isF ? -0.05 : 0;
          var dim = isF ? 1 : isH ? 0.85 : 0.6; b.mats[4].color.setScalar(b.mats[4].color.r + (dim - b.mats[4].color.r) * Math.min(1, dt * 6)); b.mats[1].color.copy(b.mats[4].color);
        });
        if (!reduce) { dust.rotation.y = t * 0.02; dust.position.y = Math.sin(t * 0.3) * 0.15; }
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      }
      function kick() { if (!raf && on && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } }
      new IntersectionObserver(function (es) { on = es[0].isIntersecting; kick(); }, { rootMargin: '120px' }).observe(host);
      document.addEventListener('visibilitychange', kick);
      size(); plate(0);

      // real covers for books, when Open Library allows cross-origin textures
      if (!art) new IntersectionObserver(function (es, io) {
        if (!es[0].isIntersecting) return; io.disconnect();
        queue(items.map(function (_, k) { return k; }).filter(function (k) { return items[k].cover === 'openlibrary'; }), function (k, next) {
          coverId(items[k], function (id) {
            if (id !== 'none') { var img = new Image(); img.crossOrigin = 'anonymous'; img.onload = function () { if (img.naturalWidth < 20) return; var b = objs[k], ctx = b.face.getContext('2d'), cw = b.face.width, ch = b.face.height, s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight); ctx.drawImage(img, (cw - img.naturalWidth * s) / 2, (ch - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s); b.faceT.needsUpdate = true; kick(); }; img.src = coverSrc(id, 'L'); }
            next();
          });
        });
      }, { rootMargin: '400px' }).observe(host);
    }
  }
  window.Swivel = Swivel;
})();
