/* motion.js — scroll choreography (GSAP + ScrollTrigger, vendor/) and button feel.
   Everything has a visible resting state; with reduced motion or without GSAP nothing here runs. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── buttons: magnetic pull + click ripple (CSS does depth, shine and press) ── */
  document.querySelectorAll('.btn, .plate .buy a, .spin').forEach(function (b) {
    b.addEventListener('pointerdown', function (e) {
      var r = b.getBoundingClientRect(), s = document.createElement('span'); s.className = 'ripple';
      s.style.left = (e.clientX - r.left) + 'px'; s.style.top = (e.clientY - r.top) + 'px'; b.appendChild(s);
      setTimeout(function () { s.remove(); }, 650);
    });
    if (reduce) return;
    b.addEventListener('pointermove', function (e) {
      var r = b.getBoundingClientRect(); b.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5) * 8 + 'px'); b.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5) * 6 + 'px');
    });
    b.addEventListener('pointerleave', function () { b.style.setProperty('--mx', '0px'); b.style.setProperty('--my', '0px'); });
  });

  if (reduce || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  gsap.ticker.lagSmoothing(0);  // keep real time even when 3D frames are slow, so nothing freezes mid-reveal
  document.documentElement.classList.add('gsap-on');

  // reading progress: a rust page-edge along the top of the newsstand bar
  var bar = document.createElement('div'); bar.className = 'progress'; document.querySelector('.stand').appendChild(bar);
  gsap.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

  // section titles: split into letters that rise out of a slot
  document.querySelectorAll('.head h2, .sheet h2, .card h2').forEach(function (h) {
    var txt = h.textContent; h.setAttribute('aria-label', txt); h.textContent = '';
    txt.split('').forEach(function (ch) { var o = document.createElement('span'); o.className = 'ch'; o.setAttribute('aria-hidden', 'true'); o.textContent = ch === ' ' ? ' ' : ch; var w = document.createElement('span'); w.className = 'slot'; w.appendChild(o); h.appendChild(w); });
    gsap.fromTo(h.querySelectorAll('.ch'), { yPercent: 110, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 0.7, ease: 'power3.out', stagger: 0.025, scrollTrigger: { trigger: h, start: 'top 88%' } });
  });

  // hero: as you leave, the cover tips back and the editorial drifts up
  gsap.to('.hero .stage', { yPercent: 12, rotateX: 14, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.hero > div:last-child', { yPercent: -10, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });

  // the pair: cards slide in from opposite sides, the coins rise between them
  gsap.fromTo('.pcard:first-of-type', { xPercent: -30, rotate: -6, opacity: 0 }, { xPercent: 0, rotate: -0.8, opacity: 1, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: '.pair', start: 'top 75%' } });
  gsap.fromTo('.pcard:last-of-type', { xPercent: 30, rotate: 6, opacity: 0 }, { xPercent: 0, rotate: 0.8, opacity: 1, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: '.pair', start: 'top 75%' } });
  gsap.fromTo('#orbit', { y: 60, scale: 0.7, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 1, ease: 'back.out(1.6)', scrollTrigger: { trigger: '.pair', start: 'top 80%' } });

  // the cast: issues tossed from a pile onto the carpet
  gsap.utils.toArray('.lore li').forEach(function (li) { gsap.fromTo(li, { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: li, start: 'top 85%' } }); });
  gsap.fromTo('.whycat-cat', { y: 60, rotate: -3, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.whycat', start: 'top 75%' } });

  // the laws: stamped one at a time
  gsap.fromTo('.laws li', { scale: 1.25, rotate: -2, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.45, ease: 'back.out(2)', stagger: 0.12, scrollTrigger: { trigger: '.laws', start: 'top 80%' } });

  // the shelf rises onto its stage, the buy card rows slide in
  gsap.fromTo('#swivel', { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '#swivel', start: 'top 85%' } });
  gsap.fromTo('.row', { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: 'power3.out', stagger: 0.1, scrollTrigger: { trigger: '.rows', start: 'top 85%' } });

  // neon marquee bands move with the scroll
  document.querySelectorAll('.marquee .track').forEach(function (t, i) {
    gsap.fromTo(t, { xPercent: i % 2 ? -50 : 0 }, { xPercent: i % 2 ? 0 : -50, ease: 'none', scrollTrigger: { trigger: t.parentElement, start: 'top bottom', end: 'bottom top', scrub: 0.5 } });
  });

  // 3D canvases, covers and fonts change the page height after load: re-measure every trigger then
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  setTimeout(function () { ScrollTrigger.refresh(); }, 1500);

  // the cats arrive
  gsap.fromTo('.peek-cover', { y: 70 }, { y: 0, duration: 0.9, delay: 1.6, ease: 'back.out(1.8)' });
  // featured feline: the case photo drops, the stamp slams, the index cards deal out
  gsap.fromTo('.case-cat', { y: -60, rotate: -10, opacity: 0 }, { y: 0, rotate: -2, opacity: 1, duration: 0.9, ease: 'back.out(1.7)', scrollTrigger: { trigger: '.case', start: 'top 78%' } });
  gsap.fromTo('.case-stamp', { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, delay: 0.7, ease: 'power4.in', scrollTrigger: { trigger: '.case', start: 'top 78%' } });
  gsap.fromTo('.fcard', { y: 90, rotate: function (i) { return (i % 2 ? 1 : -1) * 9; }, opacity: 0 }, { y: 0, rotate: function (i) { return i % 2 ? 0.5 : -0.6; }, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.07, clearProps: 'transform', scrollTrigger: { trigger: '.fellow', start: 'top 85%' } });
  gsap.fromTo('.sit-shelf', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'back.out(1.6)', scrollTrigger: { trigger: '#originals', start: 'top 70%' } });
})();
