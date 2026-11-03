/* intro.js: plays the opening film from video, so it starts at once and cannot freeze while the site loads
   behind it. Skippable, once per browser session, off for reduced motion. Source: tools/intro-film.js. */
(function () {
  'use strict';
  var KEY = 'asimov-intro-seen', forced = location.hash === '#intro';
  function seen() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  if (!forced && (seen() || matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  window.__introActive = true;

  var root = document.createElement('div');
  root.className = 'cine'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Opening film');
  root.innerHTML = '<video class="cine-gl cine-video" muted playsinline autoplay preload="auto"></video><button type="button" class="cine-skip" id="cine-skip">Skip intro \u203a</button>';
  document.body.insertBefore(root, document.body.firstChild);
  document.documentElement.classList.add('cine-on');
  var video = root.querySelector('video'), finished = false, booted = false;
  video.src = innerHeight > innerWidth ? 'assets/intro-portrait.mp4' : 'assets/intro-wide.mp4';

  function boot() { if (!booted && window.__afterIntro) { booted = true; window.__afterIntro(); } else if (!booted) setTimeout(boot, 50); }
  function finish() {
    if (finished) return; finished = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    root.classList.add('out');
    setTimeout(function () {
      root.remove(); document.documentElement.classList.remove('cine-on'); boot();
      var hero = document.getElementById('hero-cover');
      if (hero) { hero.classList.remove('print'); void hero.offsetWidth; hero.classList.add('print'); }
    }, 900);
  }
  video.addEventListener('playing', function () { clearTimeout(give); video.classList.add('on'); });
  video.addEventListener('ended', finish);
  video.addEventListener('error', finish);
  // A slow connection or blocked autoplay goes straight to the site instead of a black screen.
  var give = setTimeout(finish, 2500);
  root.querySelector('#cine-skip').addEventListener('click', finish);
  document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') { finish(); document.removeEventListener('keydown', onKey); } });
  root.querySelector('#cine-skip').focus({ preventScroll: true });
})();
