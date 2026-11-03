/* cat.js — Asimov, the editor-in-chief. A tabby-and-white cat with green eyes and a red collar (after the cat in
   I, Robot, 2004), drawn in SVG in three poses. Character sheet: TURTLE.
   <div data-cat="peek"></div>  head and paws over an edge; pupils follow the cursor
   <div data-cat="sit"></div>   sitting, tail swishing; pupils follow the cursor
   <div data-cat="walk"></div>  side view, legs cycle while the page scrolls (place it yourself, e.g. fixed)  */
(function () {
  'use strict';
  var C = { fur: '#8a7f70', furL: '#b3a796', furD: '#4f473e', stripe: '#3b342d', white: '#f6f2ea', whiteS: '#d8cfc0', pink: '#e7a3a8', pinkD: '#c97c83', nose: '#d98a8f', collar: '#c22a24', collarD: '#8e1a16', tag: '#e8b04a', eye: '#b9d36a', eyeD: '#5f8a22', ink: '#1d1410' };
  function sw(d, w) { return '<path d="' + d + '" fill="' + C.stripe + '"' + (w ? ' opacity="' + w + '"' : '') + '/>'; } // tapered stripe, drawn as a fill

  function defs(id) {
    return '<defs>' +
      '<radialGradient id="' + id + 'f" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="' + C.furL + '"/><stop offset=".55" stop-color="' + C.fur + '"/><stop offset="1" stop-color="' + C.furD + '"/></radialGradient>' +
      '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + C.furD + '"/><stop offset=".3" stop-color="' + C.fur + '"/><stop offset=".7" stop-color="' + C.furL + '"/><stop offset="1" stop-color="' + C.furD + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="' + C.whiteS + '"/></linearGradient>' +
      '<radialGradient id="' + id + 'e" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#eaf7a2"/><stop offset=".45" stop-color="' + C.eye + '"/><stop offset="1" stop-color="' + C.eyeD + '"/></radialGradient>' +
      '<linearGradient id="' + id + 'p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + C.pinkD + '"/><stop offset="1" stop-color="' + C.pink + '"/></linearGradient>' +
      '<clipPath id="' + id + 'L"><path d="' + EYE_L + '"/></clipPath><clipPath id="' + id + 'R"><path d="' + EYE_R + '"/></clipPath>' +
      '</defs>';
  }
  var EYE_L = 'M56 86 Q62 71 77 71 Q90 73 93 84 Q85 97 70 95 Q59 93 56 86Z';
  var EYE_R = 'M144 86 Q138 71 123 71 Q110 73 107 84 Q115 97 130 95 Q141 93 144 86Z';

  function eye(id, side, cx) {
    var d = side === 'L' ? EYE_L : EYE_R;
    return '<path d="' + d + '" fill="url(#' + id + 'e)"/>' +
      '<g clip-path="url(#' + id + side + ')">' +
        '<ellipse class="cat-pupil" cx="' + cx + '" cy="84" rx="3.6" ry="10.5" fill="#0d0a08"/>' +
        '<path d="M50 70 Q' + cx + ' 64 150 70 L150 78 Q' + cx + ' 72 50 78Z" fill="rgba(40,30,20,.35)"/>' +   // the upper lid's shadow
        '<circle cx="' + (cx + 4) + '" cy="78" r="3.2" fill="#fff"/><circle cx="' + (cx - 5) + '" cy="90" r="1.4" fill="#fff" opacity=".7"/>' +
        '<rect class="cat-lid" x="50" y="64" width="100" height="0" fill="' + C.fur + '"/>' +
      '</g>' +
      '<path d="' + d + '" fill="none" stroke="' + C.ink + '" stroke-width="2.6" stroke-linejoin="round"/>';
  }

  function head(id) { // front-facing head in a 200-wide box, centred at (100, 85)
    return defs(id) +
      // ears (outer, inner, tufts)
      '<path d="M44 74 Q30 40 36 6 Q62 16 86 40 Z M156 74 Q170 40 164 6 Q138 16 114 40 Z" fill="url(#' + id + 'f)" stroke="' + C.ink + '" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<path d="M50 58 Q42 34 44 18 Q62 28 76 42Z M150 58 Q158 34 156 18 Q138 28 124 42Z" fill="url(#' + id + 'p)"/>' +
      '<path d="M48 44 Q54 36 58 26 M52 50 Q60 42 66 34 M152 44 Q146 36 142 26 M148 50 Q140 42 134 34" stroke="' + C.white + '" stroke-width="1.6" stroke-linecap="round" opacity=".85" fill="none"/>' +
      // skull and cheeks (a little ruff at the jaw)
      '<path d="M44 66 Q60 38 100 36 Q140 38 156 66 Q176 88 170 108 L178 112 L166 118 Q150 146 100 150 Q50 146 34 118 L22 112 L30 108 Q24 88 44 66Z" fill="url(#' + id + 'f)" stroke="' + C.ink + '" stroke-width="2.6" stroke-linejoin="round"/>' +
      // tabby: the M on the forehead, brow and cheek stripes
      sw('M100 36 Q96 47 100 60 Q104 47 100 36Z') +
      sw('M86 40 Q84 52 93 62 Q90 51 91 41Z') + sw('M114 40 Q116 52 107 62 Q110 51 109 41Z') +
      sw('M72 46 Q74 58 84 64 Q80 55 78 46Z', '.9') + sw('M128 46 Q126 58 116 64 Q120 55 122 46Z', '.9') +
      sw('M60 58 Q70 62 76 70 Q66 66 58 64Z', '.8') + sw('M140 58 Q130 62 124 70 Q134 66 142 64Z', '.8') +
      sw('M26 96 Q44 90 60 92 Q44 96 28 102Z') + sw('M30 110 Q46 104 62 104 Q46 110 32 116Z') +
      sw('M174 96 Q156 90 140 92 Q156 96 172 102Z') + sw('M170 110 Q154 104 138 104 Q154 110 168 116Z') +
      // white blaze, muzzle and chin
      '<path d="M100 56 Q96 70 88 84 Q68 98 70 120 Q84 142 100 143 Q116 142 130 120 Q132 98 112 84 Q104 70 100 56Z" fill="url(#' + id + 'w)"/>' +
      '<path d="M78 122 Q100 134 122 122 Q116 140 100 141 Q84 140 78 122Z" fill="' + C.whiteS + '" opacity=".7"/>' +
      // eyes
      '<g class="cat-eyes">' + eye(id, 'L', 74) + eye(id, 'R', 126) + '</g>' +
      // nose, mouth, whisker pads, whiskers
      '<path d="M91 101 Q100 96 109 101 Q105 109 100 111 Q95 109 91 101Z" fill="' + C.nose + '" stroke="' + C.ink + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M95 101 Q99 99.5 102 100.5" stroke="#fff" stroke-width="1.4" opacity=".7" fill="none" stroke-linecap="round"/>' +
      '<path d="M100 111 L100 116 Q97 121 91 120 M100 116 Q103 121 109 120" fill="none" stroke="' + C.ink + '" stroke-width="2" stroke-linecap="round"/>' +
      '<g fill="' + C.furD + '" opacity=".55"><circle cx="86" cy="112" r="1.3"/><circle cx="82" cy="116" r="1.3"/><circle cx="88" cy="118" r="1.3"/><circle cx="114" cy="112" r="1.3"/><circle cx="118" cy="116" r="1.3"/><circle cx="112" cy="118" r="1.3"/></g>' +
      '<g stroke="#fffaf0" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".9">' +
      '<path d="M80 112 Q52 104 22 104 M80 116 Q50 116 18 122 M82 120 Q56 128 28 140"/><path d="M120 112 Q148 104 178 104 M120 116 Q150 116 182 122 M118 120 Q144 128 172 140"/></g>';
  }

  function collar(y, w) { // a red collar across the neck at y, half-width w, with the gold "A" tag
    return '<path d="M' + (100 - w) + ' ' + y + ' Q100 ' + (y + 14) + ' ' + (100 + w) + ' ' + y + ' L' + (100 + w) + ' ' + (y + 9) + ' Q100 ' + (y + 23) + ' ' + (100 - w) + ' ' + (y + 9) + 'Z" fill="' + C.collar + '" stroke="' + C.ink + '" stroke-width="2"/>' +
      '<path d="M' + (100 - w + 4) + ' ' + (y + 3) + ' Q100 ' + (y + 15) + ' ' + (100 + w - 4) + ' ' + (y + 3) + '" stroke="#ff6a5a" stroke-width="1.4" fill="none" opacity=".7"/>' +
      '<g class="cat-tag"><path d="M100 ' + (y + 14) + ' L100 ' + (y + 19) + '" stroke="' + C.ink + '" stroke-width="2"/><circle cx="100" cy="' + (y + 27) + '" r="9" fill="' + C.tag + '" stroke="' + C.ink + '" stroke-width="2"/>' +
      '<circle cx="97" cy="' + (y + 24) + '" r="2.4" fill="#fff4c8" opacity=".8"/><text x="100" y="' + (y + 31) + '" text-anchor="middle" font-size="10" font-family="Anton,Impact,sans-serif" fill="' + C.ink + '">A</text></g>';
  }
  function paw(cx, cy, rx) { return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + (rx * 0.5) + '" fill="url(#PAWID)" stroke="' + C.ink + '" stroke-width="2.4"/><path d="M' + (cx - rx * 0.35) + ' ' + (cy - 2) + ' l0 6 M' + cx + ' ' + (cy - 3) + ' l0 7 M' + (cx + rx * 0.35) + ' ' + (cy - 2) + ' l0 6" stroke="' + C.whiteS + '" stroke-width="1.6" stroke-linecap="round"/>'; }

  var SVG = {
    peek: function (id) {
      return '<svg viewBox="0 0 200 160" role="img" aria-label="Asimov, the editor-in-chief, a tabby cat, peeking over the edge">' + head(id) +
        (paw(56, 147, 21) + paw(144, 147, 21)).replace(/PAWID/g, id + 'w') + '</svg>';
    },
    sit: function (id) {
      var t = 'M140 274 Q186 282 188 252 Q190 222 168 206';
      return '<svg viewBox="0 0 200 300" role="img" aria-label="Asimov, the editor-in-chief, a tabby cat with a red collar, sitting">' + defs(id) +
        // tail, curled around toward the front paws
        '<g class="cat-tail"><path d="' + t + '" fill="none" stroke="' + C.ink + '" stroke-width="19" stroke-linecap="round"/><path d="' + t + '" fill="none" stroke="' + C.fur + '" stroke-width="14" stroke-linecap="round"/>' +
        '<path d="M184 236 l8 -2 M186 252 l8 1 M178 270 l7 5 M168 212 l7 -5" stroke="' + C.stripe + '" stroke-width="6" stroke-linecap="round"/></g>' +
        // body: haunches and chest
        '<defs><clipPath id="' + id + 'B"><path d="M72 96 Q54 118 50 160 Q40 200 36 240 Q34 272 54 288 L146 288 Q166 272 164 240 Q160 200 150 160 Q146 118 128 96Z"/></clipPath></defs>' +
        '<path d="M72 96 Q54 118 50 160 Q40 200 36 240 Q34 272 54 288 L146 288 Q166 272 164 240 Q160 200 150 160 Q146 118 128 96Z" fill="url(#' + id + 'b)" stroke="' + C.ink + '" stroke-width="2.6" stroke-linejoin="round"/>' +
        '<g clip-path="url(#' + id + 'B)">' +
        // mackerel stripes that follow the body
        sw('M38 158 Q52 160 62 152 Q54 166 38 170Z') + sw('M36 188 Q52 190 64 182 Q54 196 36 200Z') + sw('M36 220 Q50 222 60 214 Q52 228 38 232Z') + sw('M42 252 Q54 254 62 246 Q56 260 44 264Z', '.9') +
        sw('M162 158 Q148 160 138 152 Q146 166 162 170Z') + sw('M164 188 Q148 190 136 182 Q146 196 164 200Z') + sw('M164 220 Q150 222 140 214 Q148 228 162 232Z') + sw('M158 252 Q146 254 138 246 Q144 260 156 264Z', '.9') +
        '</g>' +
        '<path d="M38 250 Q40 214 66 212 Q82 236 70 288 L54 288 Q36 276 38 250Z M162 250 Q160 214 134 212 Q118 236 130 288 L146 288 Q164 276 162 250Z" fill="url(#' + id + 'f)" stroke="' + C.ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        sw('M42 238 Q52 236 58 228 Q54 242 44 246Z', '.8') + sw('M158 238 Q148 236 142 228 Q146 242 156 246Z', '.8') +
        // white bib and front legs with white socks
        '<path d="M76 104 Q62 150 70 200 Q78 238 100 250 Q122 238 130 200 Q138 150 124 104Z" fill="url(#' + id + 'w)"/>' +
        '<path d="M79 192 Q75 242 78 282 L97 282 Q98 244 98 202Z M121 192 Q125 242 122 282 L103 282 Q102 244 102 202Z" fill="url(#' + id + 'w)" stroke="' + C.ink + '" stroke-width="2.2" stroke-linejoin="round"/>' +
        '<path d="M100 214 L100 280" stroke="' + C.whiteS + '" stroke-width="2"/>' +
        (paw(87, 284, 13) + paw(113, 284, 13)).replace(/PAWID/g, id + 'w') +
        collar(96, 38) +
        '<g transform="translate(26,-4) scale(.74)">' + head(id + 'h') + '</g></svg>';
    },
    walk: function (id) {
      id = id || 'cw';
      var leg = function (cls, x, y, far) {
        var c = far ? C.furD : C.fur;
        return '<g class="cat-leg ' + cls + '" style="transform-origin:' + x + 'px ' + y + 'px"><path d="M' + x + ' ' + y + ' Q' + (x + 2) + ' ' + (y + 18) + ' ' + (x - 2) + ' ' + (y + 34) + '" stroke="' + C.ink + '" stroke-width="12" stroke-linecap="round" fill="none"/>' +
          '<path d="M' + x + ' ' + y + ' Q' + (x + 2) + ' ' + (y + 18) + ' ' + (x - 2) + ' ' + (y + 30) + '" stroke="' + c + '" stroke-width="7.5" stroke-linecap="round" fill="none"/>' +
          '<path d="M' + (x - 1) + ' ' + (y + 26) + ' L' + (x - 3) + ' ' + (y + 34) + '" stroke="' + C.white + '" stroke-width="7" stroke-linecap="round"/></g>';
      };
      return '<svg viewBox="0 0 170 110" aria-hidden="true">' + defs(id) +
        leg('b2', 50, 60, 1) + leg('f2', 120, 60, 1) +
        '<g class="cat-tail-w"><path d="M36 52 Q10 44 12 20 Q14 8 24 6" fill="none" stroke="' + C.ink + '" stroke-width="10" stroke-linecap="round"/><path d="M36 52 Q10 44 12 20 Q14 8 24 6" fill="none" stroke="' + C.fur + '" stroke-width="5.5" stroke-linecap="round"/>' +
        '<path d="M14 30 l5 1 M16 18 l5 2" stroke="' + C.stripe + '" stroke-width="4" stroke-linecap="round"/></g>' +
        // body
        '<path d="M32 48 Q32 32 56 30 Q84 26 108 30 Q126 33 130 46 Q132 62 118 67 Q90 71 52 69 Q32 66 32 48Z" fill="url(#' + id + 'f)" stroke="' + C.ink + '" stroke-width="2.4" stroke-linejoin="round"/>' +
        sw('M58 31 Q54 42 56 54 Q60 42 64 31Z') + sw('M74 29 Q70 42 72 56 Q76 42 80 29Z') + sw('M90 29 Q86 42 88 56 Q92 42 96 29Z') + sw('M106 31 Q102 42 104 52 Q108 42 111 32Z') +
        '<path d="M112 54 Q122 70 130 56 Q132 66 118 68Z" fill="' + C.white + '"/>' +
        '<g transform="translate(-9,2)">' +
        // head in profile
        '<path d="M120 42 Q118 22 136 18 L138 4 L148 14 Q152 13 157 15 L164 5 L166 22 Q174 30 170 38 Q166 46 152 48 Q134 50 124 46Z" fill="url(#' + id + 'f)" stroke="' + C.ink + '" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<path d="M140 8 L146 15 L139 16Z M162 9 L164 19 L158 16Z" fill="' + C.pink + '"/>' +
        sw('M140 20 Q144 26 142 32 Q140 26 136 22Z', '.8') +
        '<path d="M156 34 Q166 36 170 39 Q162 48 150 47 Q152 40 156 34Z" fill="' + C.white + '"/>' +
        '<path d="M148 27 Q152 22 158 24 Q158 30 152 31 Q148 30 148 27Z" fill="url(#' + id + 'e)" stroke="' + C.ink + '" stroke-width="1.4"/><ellipse cx="154" cy="27" rx="1.3" ry="3" fill="#0d0a08"/>' +
        '<path d="M168 35 L171 37 L168 39Z" fill="' + C.nose + '"/>' +
        '<path d="M164 40 Q172 38 178 39 M164 42 Q172 44 177 47" stroke="#fffaf0" stroke-width="1" opacity=".8" fill="none"/>' +
        '</g>' +
        // collar
        '<path d="M128 34 Q134 44 130 52" stroke="' + C.collar + '" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="130" cy="57" r="4" fill="' + C.tag + '" stroke="' + C.ink + '" stroke-width="1.4"/>' +
        leg('b1', 46, 60) + leg('f1', 124, 60) + '</svg>';
    }
  };

  // other scripts (the intro) can draw the cat too: CatArt.svg('sit'|'peek'|'walk', idPrefix) → SVG markup
  window.CatArt = { svg: function (pose, id) { return SVG[pose](id || ('cx' + pose)); } };

  var n = 0, reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-cat]').forEach(function (el) { el.innerHTML = SVG[el.dataset.cat]('cat' + (n++)); el.classList.add('cat', 'cat-' + el.dataset.cat); });

  // pupils follow the pointer; a slow blink now and then
  var eyes = [].slice.call(document.querySelectorAll('.cat-peek svg, .cat-sit svg'));
  window.addEventListener('pointermove', function (e) {
    eyes.forEach(function (svg) {
      var b = svg.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height * 0.3), d = Math.hypot(dx, dy) || 1;
      var k = Math.min(1, d / 400);
      svg.querySelectorAll('.cat-pupil').forEach(function (p) { p.setAttribute('transform', 'translate(' + (dx / d * 6 * k).toFixed(2) + ',' + (dy / d * 3 * k).toFixed(2) + ')'); });
    });
  }, { passive: true });
  if (!reduce) setInterval(function () {
    eyes.forEach(function (svg, i) {
      setTimeout(function () {
        var lids = svg.querySelectorAll('.cat-lid');
        lids.forEach(function (l) { l.setAttribute('height', '36'); });
        setTimeout(function () { lids.forEach(function (l) { l.setAttribute('height', '0'); }); }, 160);
      }, i * 900);
    });
  }, 5200);

  // the walking cat crosses the page with your scroll; legs move only while you scroll
  var walker = document.querySelector('.cat-walk');
  if (walker) {
    var last = window.scrollY, stopT = 0;
    function place() {
      var max = document.documentElement.scrollHeight - innerHeight, k = max > 0 ? window.scrollY / max : 0;
      walker.style.transform = 'translateX(' + (k * (innerWidth - walker.offsetWidth - 24)).toFixed(1) + 'px)' + (window.scrollY < last ? ' scaleX(-1)' : '');
      if (!reduce) { walker.classList.add('moving'); clearTimeout(stopT); stopT = setTimeout(function () { walker.classList.remove('moving'); }, 180); }
      last = window.scrollY;
    }
    window.addEventListener('scroll', place, { passive: true }); place();
  }
})();
