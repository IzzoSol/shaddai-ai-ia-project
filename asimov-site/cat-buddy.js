/* Page companion: the cat finds pages, dances, quotes, chases your cursor and minimizes. */
(function () {
  'use strict';
  var KEY = 'asimov-cat-min';
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var QUOTES = [
    ['A robot may not injure a human being or, through inaction, allow a human being to come to harm.', 'Isaac Asimov, 1942'],
    ['A robot must obey the orders given it by human beings. I am not a robot.', 'The cat'],
    ['Violence is the last refuge of the incompetent.', 'Isaac Asimov, Foundation'],
    ['You treat ideas like cats: you make them follow you.', 'Ray Bradbury'],
    ['In Ulthar, which lies beyond the river Skai, no man may kill a cat.', 'H. P. Lovecraft, 1920'],
    ['Read the book. Then feed me.', 'The cat'],
    ['Check the contract address twice. I only check things once, but I am a cat.', 'The cat']
  ];
  var CAUGHT = ['Got it.', 'Mine.', 'Too slow.', 'Again.', 'Is this the mouse?'];

  var css = document.createElement('style');
  css.textContent = [
    '#catb{position:fixed;right:18px;bottom:14px;z-index:60;font:14px/1.35 "Courier Prime","Courier New",monospace;color:#f4efff}',
    '#catb button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}',
    '#catb :focus-visible{outline:2px solid #ffd34a;outline-offset:2px}',
    '#catb-btn{display:block;width:62px;height:104px;padding:0;margin-left:auto;transform-origin:50% 100%;transition:transform .15s}',
    '#catb-btn:hover{transform:translateY(-3px) scale(1.04)}',
    '#catb-btn img,#catb-runner img{display:block;height:100%;width:auto;margin:auto;filter:drop-shadow(0 3px 6px #0009)}',
    '#catb-menu,#catb-say{position:absolute;right:0;bottom:112px;width:250px;background:#110c2eF5;border:1px solid #ffd34a;box-shadow:0 6px 24px #0008}',
    '#catb-menu{padding:8px;display:grid;gap:2px}',
    '#catb-menu>button,#catb-menu a{display:flex;align-items:center;min-height:38px;padding:0 10px;text-align:left;color:#f4efff;text-decoration:none}',
    '#catb-menu>button:hover,#catb-menu a:hover{background:#ffd34a;color:#07051a}',
    '#catb-pages{display:grid;grid-template-columns:1fr 1fr;gap:0 4px;max-height:44vh;overflow:auto;padding:0 0 6px;margin-bottom:4px;border-bottom:1px solid #ffffff33}',
    '#catb-pages a{font-size:12.5px;min-height:34px;padding:0 6px}',
    '#catb-menu h4{margin:6px 10px;font:400 12px "Courier Prime",monospace;letter-spacing:.08em;text-transform:uppercase;color:#ffd34a}',
    '#catb-say{padding:12px 14px}#catb-say small{display:block;margin-top:6px;color:#ffd34a}',
    '#catb.dance #catb-btn{animation:catb-dance .62s ease-in-out infinite}',
    '@keyframes catb-dance{0%,100%{transform:rotate(-9deg) translateY(0) scaleY(1)}25%{transform:rotate(0) translateY(-16px) scaleY(1.05)}50%{transform:rotate(9deg) translateY(0) scaleY(.94)}75%{transform:rotate(0) translateY(-16px) scaleY(1.05)}}',
    '#catb.min #catb-btn{width:46px;height:40px;overflow:hidden;background:#110c2e;border:1px solid #ffd34a;border-radius:23px 23px 0 0}',
    '#catb.min #catb-btn img{height:40px;object-fit:cover}',
    '#catb-runner{position:fixed;left:0;top:0;width:110px;height:112px;z-index:61;pointer-events:none;will-change:transform}',
    '#catb-runner img{transition:none}',
    '#catb-stop{position:fixed;right:18px;bottom:18px;z-index:62;min-height:44px;padding:0 16px;background:#ffd34a!important;color:#07051a!important;font-weight:700!important}',
    '@media (max-width:760px){#catb-btn{width:38px;height:64px}#catb-menu,#catb-say{bottom:92px;width:min(250px,calc(100vw - 36px))}}',
    '@media (prefers-reduced-motion:reduce){#catb.dance #catb-btn{animation:none}}'
  ].join('');
  document.head.appendChild(css);

  var root = document.createElement('div'); root.id = 'catb';
  root.innerHTML = '<button id="catb-btn" type="button" aria-expanded="false" aria-controls="catb-menu" aria-label="Open the cat menu"><img src="assets/cat-front.png" alt=""></button>' +
    '<div id="catb-menu" hidden><h4>Where to?</h4><div id="catb-pages"></div>' +
    '<button type="button" data-a="quote">Say something</button><button type="button" data-a="dance">Dance</button>' +
    '<button type="button" data-a="chase">Cat and mouse</button><button type="button" data-a="min">Minimize</button></div>' +
    '<div id="catb-say" role="status" hidden></div>';
  document.body.appendChild(root);
  var $ = function (i) { return document.getElementById(i); };
  var btn = $('catb-btn'), menu = $('catb-menu'), say = $('catb-say'), sayT = 0, danceT = 0, q = Math.floor(Math.random() * QUOTES.length);

  // Page finder: mirrors the site's own navigation, so it can't drift out of date.
  var seen = {};
  document.querySelectorAll('header nav a[href], .nav a[href]').forEach(function (a) {
    var h = a.getAttribute('href'); if (seen[h]) return; seen[h] = 1;
    var l = document.createElement('a'); l.href = h; l.textContent = a.textContent.trim();
    if (l.textContent) $('catb-pages').appendChild(l);
  });
  if (!$('catb-pages').children.length) $('catb-pages').previousElementSibling.hidden = true;

  function openMenu(on) { menu.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) say.hidden = true; }
  function speak(text, who, ms) {
    say.textContent = text; if (who) { var s = document.createElement('small'); s.textContent = who; say.appendChild(s); }
    openMenu(false); say.hidden = false; clearTimeout(sayT); sayT = setTimeout(function () { say.hidden = true; }, ms || 6000);
  }
  function setMin(on) {
    root.classList.toggle('min', on); openMenu(false); say.hidden = true;
    btn.setAttribute('aria-label', on ? 'Bring the cat back' : 'Open the cat menu');
    try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) {}
  }
  function dance() {
    openMenu(false); root.classList.add('dance'); speak(reduced ? '♪ Dancing on the inside. ♪' : '♪ ♪ ♪', '', 4000);
    clearTimeout(danceT); danceT = setTimeout(function () { root.classList.remove('dance'); }, 4000);
  }

  /* ── cat and mouse ── */
  var chase = null;
  function startChase() {
    openMenu(false); say.hidden = true; root.classList.remove('dance');
    var r = btn.getBoundingClientRect(), run = document.createElement('div'), stop = document.createElement('button');
    run.id = 'catb-runner'; run.setAttribute('aria-hidden', 'true'); run.innerHTML = '<img src="assets/cat-side.png" alt="">';
    stop.id = 'catb-stop'; stop.type = 'button'; stop.textContent = 'Stop the chase';
    document.body.appendChild(run); document.body.appendChild(stop); stop.addEventListener('click', endChase); stop.focus();
    root.style.visibility = 'hidden';
    chase = { run: run, stop: stop, img: run.firstChild, x: r.left, y: r.bottom - 112, tx: r.left, ty: r.bottom - 112, last: performance.now(), caught: 0, bubble: null, raf: 0, face: 1 };
    addEventListener('pointermove', chaseMove, { passive: true }); addEventListener('pointerdown', chaseMove, { passive: true });
    chase.raf = requestAnimationFrame(chaseTick);
  }
  function chaseMove(e) { if (chase) { chase.tx = e.clientX - 55; chase.ty = e.clientY - 90; } }
  function chaseTick(now) {
    if (!chase) return;
    var c = chase, dt = Math.min(0.05, (now - c.last) / 1000), dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy); c.last = now;
    if (now < c.caught) { /* sits on it for a moment */ }
    else if (d < 16) {
      c.caught = now + 1100; var b = document.createElement('div');
      b.textContent = CAUGHT[Math.floor(Math.random() * CAUGHT.length)];
      b.style.cssText = 'position:absolute;left:50%;top:-30px;transform:translateX(-50%);padding:3px 9px;white-space:nowrap;background:#ffd34a;color:#07051a;font:700 13px "Courier Prime",monospace';
      c.run.appendChild(b); setTimeout(function () { b.remove(); }, 1100);
    } else {
      var v = Math.min(d, (reduced ? 300 : 560) * dt); c.x += dx / d * v; c.y += dy / d * v;
      if (Math.abs(dx) > 4) c.face = dx > 0 ? -1 : 1;
    }
    var bob = reduced || d < 16 ? 0 : Math.abs(Math.sin(now / 90)) * -7;
    c.run.style.transform = 'translate(' + c.x + 'px,' + (c.y + bob) + 'px)';
    c.img.style.transform = 'scaleX(' + c.face + ')';
    c.raf = requestAnimationFrame(chaseTick);
  }
  function endChase() {
    if (!chase) return;
    cancelAnimationFrame(chase.raf); chase.run.remove(); chase.stop.remove(); chase = null;
    removeEventListener('pointermove', chaseMove); removeEventListener('pointerdown', chaseMove);
    root.style.visibility = ''; btn.focus();
  }

  btn.addEventListener('click', function () {
    if (root.classList.contains('min')) { setMin(false); return; }
    openMenu(menu.hidden);
  });
  menu.addEventListener('click', function (e) {
    if (e.target.closest('#catb-pages a')) { openMenu(false); return; }
    var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
    if (a === 'quote') { var x = QUOTES[q++ % QUOTES.length]; speak(x[0], x[1], 7000); }
    if (a === 'dance') dance();
    if (a === 'chase') startChase();
    if (a === 'min') setMin(true);
  });
  document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return; if (chase) endChase(); else if (!menu.hidden) { openMenu(false); btn.focus(); } else say.hidden = true; });
  document.addEventListener('click', function (e) { if (!menu.hidden && !root.contains(e.target)) openMenu(false); });
  try { if (localStorage.getItem(KEY)) setMin(true); } catch (e) {}
})();
