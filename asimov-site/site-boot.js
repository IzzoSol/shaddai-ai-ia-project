/* site-boot.js: runs the page's heavy scripts after the intro, one at a time, so the film never freezes.
   Also wires the theme switcher and the click-to-start teardown embed. */
(function () {
  'use strict';
  function nextFrame() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function run(tag) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      var src = tag.getAttribute('data-src');
      if (src) { s.src = src; s.async = false; s.onload = s.onerror = resolve; document.body.appendChild(s); }
      else { s.textContent = tag.textContent; document.body.appendChild(s); resolve(); }
    });
  }
  var started = null;
  function boot() {
    if (started) return started;
    var tags = [].slice.call(document.querySelectorAll('script[type="text/x-after-intro"]'));
    started = tags.reduce(function (p, tag) { return p.then(function () { return run(tag); }).then(nextFrame); }, Promise.resolve()).then(function () {
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    });
    return started;
  }
  window.__afterIntro = boot;
  if (!window.__introActive) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }

  var html = document.documentElement, buttons = [].slice.call(document.querySelectorAll('[data-theme-set]'));
  function mark() { buttons.forEach(function (b) { b.setAttribute('aria-checked', b.dataset.themeSet === html.dataset.theme ? 'true' : 'false'); }); }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      html.dataset.theme = b.dataset.themeSet; mark();
      try { localStorage.setItem('asimov-theme', b.dataset.themeSet); } catch (e) {}
    });
  });
  mark();

  // The cat watches the cursor: the head turns a little and the pupils follow.
  var rig = document.getElementById('cat-rig');
  if (rig) {
    var aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, raf = 0;
    var tick = function () {
      cur.x += (aim.x - cur.x) * 0.12; cur.y += (aim.y - cur.y) * 0.12;
      rig.style.setProperty('--hr', (cur.x * 6).toFixed(2) + 'deg');
      rig.style.setProperty('--hx', (cur.x * 7).toFixed(1) + 'px');
      rig.style.setProperty('--hy', (cur.y * 4).toFixed(1) + 'px');
      rig.style.setProperty('--px', (cur.x * 9).toFixed(1) + 'px');
      rig.style.setProperty('--py', (cur.y * 6).toFixed(1) + 'px');
      raf = Math.abs(aim.x - cur.x) + Math.abs(aim.y - cur.y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    window.addEventListener('pointermove', function (e) {
      var r = rig.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) return;
      var cx = r.left + r.width / 2, cy = r.top + r.height * 0.19;
      aim.x = Math.max(-1, Math.min(1, (e.clientX - cx) / (innerWidth * 0.45)));
      aim.y = Math.max(-1, Math.min(1, (e.clientY - cy) / (innerHeight * 0.55)));
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
  }

  var start = document.getElementById('teardown-start');
  if (start) start.addEventListener('click', function () {
    var f = document.createElement('iframe');
    f.src = 'teardown/?embed=1'; f.title = 'Interactive robot teardown'; f.allow = 'fullscreen';
    var box = document.getElementById('teardown-frame'); box.innerHTML = ''; box.appendChild(f);
  });
})();
