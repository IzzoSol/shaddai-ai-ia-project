/* hero3d.js — puts R-7 (robot3d.js) live on the cover, and paints the "Fiction" card from the same model.
   Needs THREE + RoomEnvironment + EffectComposer/UnrealBloomPass (vendor/). Without WebGL the painted cover stays. */
(function () {
  'use strict';
  var T = window.THREE;
  if (!T || !window.AsimovRobot || !window.CoverPaint) return;
  try { var tc = document.createElement('canvas'); if (!(tc.getContext('webgl') || tc.getContext('experimental-webgl'))) return; } catch (e) { return; }
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function lights(scene) {
    var key = new T.DirectionalLight(0xffe2c0, 1.5); key.position.set(-4, 4, 3); scene.add(key);
    var rim = new T.DirectionalLight(0x5ab0ff, 2.2); rim.position.set(4, 2.5, -3); scene.add(rim);
    var red = new T.DirectionalLight(0xff3a1a, 1.4); red.position.set(-3, 0.5, -3); scene.add(red);
    scene.add(new T.AmbientLight(0x402020, 0.4));
  }
  function backdrop(w, h, sky, accent, seed) {
    var c = document.createElement('canvas');
    CoverPaint.paintTo(c, { scene: 'sky', sky: sky, accent: accent, seed: seed }, w, h);
    var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  }
  function renderer(canvas, w, h, keep) {
    var r = new T.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: !!keep, powerPreference: 'high-performance' });
    r.setPixelRatio(window.innerWidth < 700 ? 1 : Math.min(window.devicePixelRatio || 1, 1.6)); r.setSize(w, h, false);
    r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 0.78;
    return r;
  }
  function composer(r, scene, cam, w, h, strength) {
    if (!T.EffectComposer || !T.UnrealBloomPass) return null;
    var c = new T.EffectComposer(r); c.addPass(new T.RenderPass(scene, cam));
    c.addPass(new T.UnrealBloomPass(new T.Vector2(w, h), strength, 0.5, 0.86)); return c;
  }

  /* ── live cover ── */
  function liveCover() {
    var cover = document.getElementById('hero-cover'); if (!cover) return;
    var painted = cover.querySelector('.art'); if (!painted) return;
    var canvas = document.createElement('canvas'); canvas.className = 'art gl-hero'; canvas.setAttribute('aria-hidden', 'true');
    painted.after(canvas);
    var w = cover.clientWidth, h = cover.clientHeight;
    var r = renderer(canvas, w, h), scene = new T.Scene();
    scene.environment = AsimovRobot.studio(r);
    scene.background = backdrop(512, 716, '#2a0410,#7a1028,#c2402a,#f0a050', '#b0402a', 1950);
    scene.fog = new T.Fog(0x2a0410, 7, 16);
    lights(scene);
    var bot = AsimovRobot.create({ eye: 0x76ff1a }); scene.add(bot.root);
    bot.root.position.set(0.25, -0.2, 0); bot.root.rotation.y = -0.32;
    var cam = new T.PerspectiveCamera(26, w / h, 0.1, 50); cam.position.set(-0.6, 3.0, 6.4); cam.lookAt(0.1, 2.7, 0);
    var comp = composer(r, scene, cam, w, h, 0.95);
    cover.classList.add('is-3d');

    var tx = 0, ty = 0, x = 0, y = 0, scrollK = 0, on = true, raf = 0, t0 = performance.now();
    cover.parentElement.addEventListener('pointermove', function (e) { var b = cover.getBoundingClientRect(); tx = (e.clientX - b.left) / b.width - 0.5; ty = (e.clientY - b.top) / b.height - 0.5; kick(); });
    cover.parentElement.addEventListener('pointerleave', function () { tx = ty = 0; });
    window.addEventListener('scroll', function () { scrollK = Math.min(1, window.scrollY / (window.innerHeight * 0.9)); kick(); }, { passive: true });
    new IntersectionObserver(function (es) { on = es[0].isIntersecting; kick(); }).observe(cover);
    new ResizeObserver(function () { w = cover.clientWidth; h = cover.clientHeight; if (!w || !h) return; r.setSize(w, h, false); if (comp) comp.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); kick(); }).observe(cover);

    function frame(now) {
      raf = 0; if (!on || document.hidden) return;
      var t = (now - t0) / 1000;
      x += (tx - x) * 0.08; y += (ty - y) * 0.08;
      var breathe = reduce ? 0 : Math.sin(t * 1.4) * 0.025;
      bot.pose({
        headYaw: x * 0.9 + 0.25, headPitch: y * 0.45 + scrollK * 0.45 + breathe * 0.5, headRoll: -x * 0.08,
        chestYaw: x * 0.25, chestPitch: breathe, lift: breathe * 0.2,
        armL: { shoulder: [0.08, 0, -0.14], elbow: -0.3 }, armR: { shoulder: [0.12 - scrollK * 0.4, 0, 0.16], elbow: -0.35 - scrollK * 0.6 }
      });
      var blink = reduce ? 1 : ((t % 4.3) < 0.12 ? 0.12 : 1);
      bot.joints.eyes.forEach(function (e) { e.scale.y = 0.012 * blink; });
      bot.setEye(0x76ff1a, 0.85 + (reduce ? 0 : Math.sin(t * 2.2) * 0.12));
      if (comp) comp.render(); else r.render(scene, cam);
      if (!reduce) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    kick();
  }

  function boot() { try { liveCover(); } catch (e) { console.warn('hero3d off:', e); }  }
  if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot);
})();
