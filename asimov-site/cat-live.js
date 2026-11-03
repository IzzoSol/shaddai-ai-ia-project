/* cat-live.js — mounts the live 3D Asimov (cat3d.js) into any [data-cat3d] host. Follows the pointer, breathes,
   blinks, swishes; renders only while on screen. Without WebGL the host's <img> still stays. */
(function () {
  'use strict';
  var T = window.THREE; if (!T || !window.AsimovCat) return;
  function hasGL() { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } }
  if (!hasGL()) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mount(host) {
    var r = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.domElement.className = 'cat3d-gl'; host.appendChild(r.domElement);
    var env = new T.PMREMGenerator(r).fromScene(new T.RoomEnvironment(), 0.04).texture, scene = new T.Scene();
    var key = new T.DirectionalLight(0xfff0dc, 1.7); key.position.set(-1.2, 2, 2); scene.add(key);
    var rim = new T.DirectionalLight(0xffc27a, 1.6); rim.position.set(1.5, 1.2, -1.6); scene.add(rim);
    scene.add(new T.HemisphereLight(0xdfe8ff, 0x3a2a1a, 0.4));
    var small = Math.min(innerWidth, innerHeight) < 700;
    var cat = AsimovCat.create({ envMap: env, shells: small ? 8 : 14, quality: small ? 0.8 : 1 }); scene.add(cat.group);
    var cam = new T.PerspectiveCamera(30, 1, 0.01, 20);
    var look = { x: 0.2, y: 0.05 }, on = false, raf = 0, t0 = performance.now();
    window.addEventListener('pointermove', function (e) { var b = host.getBoundingClientRect(); look.x = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / (innerWidth / 2))); look.y = Math.max(-1, Math.min(1, -(e.clientY - (b.top + b.height * 0.3)) / (innerHeight / 2))); }, { passive: true });
    function size() { var w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; r.setSize(w, h, false); cam.aspect = w / h; var d = cam.aspect < 0.8 ? 1.6 : 1.42; cam.position.set(0.32, 0.5, d); cam.lookAt(0, 0.38, 0); cam.updateProjectionMatrix(); }
    new ResizeObserver(size).observe(host); size();
    function frame() { raf = 0; if (!on || document.hidden) return; var t = reduce ? 1.2 : (performance.now() - t0) / 1000; cat.update(t, { lookX: look.x, lookY: look.y }); r.render(scene, cam); raf = requestAnimationFrame(frame); }
    new IntersectionObserver(function (es) { on = es[0].isIntersecting; if (on && !raf) raf = requestAnimationFrame(frame); }, { rootMargin: '100px' }).observe(host);
    host.classList.add('is-3d');
  }
  function boot() { document.querySelectorAll('[data-cat3d]').forEach(function (h) { try { mount(h); } catch (e) { console.warn('cat3d off:', e); } }); }
  if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 2500 }); else setTimeout(boot, 600);
})();
