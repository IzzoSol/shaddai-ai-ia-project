/* cover-paint.js — paints pulp sci-fi cover art onto <canvas data-scene="..."> elements.
   No dependencies. Seeded, so a cover looks the same each load unless the seed changes.
   Scenes: planet, robot, city, nebula, portal, sun, sketch, split.
   Attributes: data-scene, data-seed, data-sky="#top,#mid,#low", data-accent="#hex". */
(function () {
  'use strict';

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }

  function sky(ctx, w, h, stops) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    stops.forEach(function (c, i) { g.addColorStop(i / (stops.length - 1), c); });
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  // Many soft translucent dabs read as brushwork instead of a flat vector fill.
  function dabs(ctx, r, x, y, rw, rh, color, n, size) {
    ctx.save(); ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = 0.04 + r() * 0.08;
      ctx.beginPath();
      ctx.ellipse(x + (r() - 0.5) * rw, y + (r() - 0.5) * rh, size * (0.4 + r()), size * (0.2 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function stars(ctx, r, w, h, n, maxY) {
    ctx.save();
    for (let i = 0; i < n; i++) {
      const s = r() * 1.6 + 0.3;
      ctx.globalAlpha = 0.3 + r() * 0.7; ctx.fillStyle = r() > 0.85 ? '#ffe9b0' : '#ffffff';
      ctx.fillRect(r() * w, r() * h * maxY, s, s);
    }
    ctx.restore();
  }

  function planet(ctx, x, y, rad, base, light, ring) {
    const g = ctx.createRadialGradient(x - rad * 0.4, y - rad * 0.4, rad * 0.1, x, y, rad);
    g.addColorStop(0, light); g.addColorStop(0.55, base); g.addColorStop(1, '#0b0710');
    if (ring) { ctx.save(); ctx.strokeStyle = ring; ctx.globalAlpha = 0.55; ctx.lineWidth = rad * 0.09;
      ctx.beginPath(); ctx.ellipse(x, y, rad * 1.9, rad * 0.42, -0.35, Math.PI, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.globalAlpha = 0.18; ctx.strokeStyle = light; ctx.lineWidth = rad * 0.05;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(x, y + i * rad * 0.28, rad * 0.95, rad * 0.08, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    if (ring) { ctx.save(); ctx.strokeStyle = ring; ctx.globalAlpha = 0.75; ctx.lineWidth = rad * 0.09;
      ctx.beginPath(); ctx.ellipse(x, y, rad * 1.9, rad * 0.42, -0.35, 0, Math.PI); ctx.stroke(); ctx.restore(); }
  }

  function ridge(ctx, r, w, h, y0, amp, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, h);
    let y = y0;
    for (let x = 0; x <= w + 10; x += w / 18) { y = y0 + (r() - 0.5) * amp; ctx.lineTo(x, y); }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  }

  // A tapered limb segment (capsule) shaded like polished metal: dark edges, a hot highlight off-centre.
  function limb(ctx, x1, y1, x2, y2, w1, w2, shade) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2); ctx.lineTo(x2 + nx * w2 / 2, y2 + ny * w2 / 2);
    ctx.arc(x2, y2, w2 / 2, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
    ctx.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
    ctx.arc(x1, y1, w1 / 2, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
    ctx.closePath();
    if (shade) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ww = Math.max(w1, w2) / 2;
      const g = ctx.createLinearGradient(mx + nx * ww, my + ny * ww, mx - nx * ww, my - ny * ww);
      g.addColorStop(0, shade[0]); g.addColorStop(0.32, shade[1]); g.addColorStop(0.5, shade[2]); g.addColorStop(1, shade[0]);
      ctx.fillStyle = g;
    }
    ctx.fill();
  }
  function joint(ctx, x, y, r, shade) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, shade[1]); g.addColorStop(0.6, shade[2]); g.addColorStop(1, shade[0]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // Chrome humanoid, 8 heads tall, jointed (shoulders, elbows, wrists, hips, knees), light from the upper left.
  // body = [shadow, highlight, mid] colours; eye = glow colour.
  function robot(ctx, cx, base, H, body, eye) {
    const u = H / 8, X = function (v) { return cx + v * u; }, Y = function (v) { return base - v * u; };
    const shade = [body[0], body[1], body[2]], far = [body[0], body[2], body[0]];
    ctx.save();
    // far arm (behind the torso)
    limb(ctx, X(1.02), Y(6.5), X(1.3), Y(5.0), u * 0.3, u * 0.25, far); joint(ctx, X(1.3), Y(5.0), u * 0.16, far);
    limb(ctx, X(1.3), Y(5.0), X(1.2), Y(3.8), u * 0.24, u * 0.18, far);
    ctx.fillStyle = body[0]; ctx.beginPath(); ctx.ellipse(X(1.2), Y(3.55), u * 0.13, u * 0.24, -0.1, 0, Math.PI * 2); ctx.fill();
    // legs: contrapposto, weight on the left leg
    limb(ctx, X(-0.36), Y(4.05), X(-0.42), Y(2.12), u * 0.46, u * 0.32, shade); joint(ctx, X(-0.42), Y(2.12), u * 0.2, shade);
    limb(ctx, X(-0.42), Y(2.12), X(-0.4), Y(0.3), u * 0.32, u * 0.2, shade);
    limb(ctx, X(0.36), Y(4.05), X(0.5), Y(2.15), u * 0.44, u * 0.3, far); joint(ctx, X(0.5), Y(2.15), u * 0.19, far);
    limb(ctx, X(0.5), Y(2.15), X(0.58), Y(0.32), u * 0.3, u * 0.19, far);
    ctx.fillStyle = body[0];
    ctx.beginPath(); ctx.moveTo(X(-0.62), Y(0)); ctx.lineTo(X(-0.2), Y(0)); ctx.lineTo(X(-0.28), Y(0.36)); ctx.lineTo(X(-0.55), Y(0.36)); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(X(0.38), Y(0)); ctx.lineTo(X(0.82), Y(0)); ctx.lineTo(X(0.72), Y(0.36)); ctx.lineTo(X(0.46), Y(0.36)); ctx.closePath(); ctx.fill();
    // pelvis
    let g = ctx.createLinearGradient(X(-0.7), 0, X(0.7), 0); g.addColorStop(0, body[0]); g.addColorStop(0.35, body[1]); g.addColorStop(1, body[0]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(X(-0.6), Y(4.62)); ctx.lineTo(X(0.6), Y(4.62)); ctx.lineTo(X(0.42), Y(3.92)); ctx.lineTo(X(-0.42), Y(3.92)); ctx.closePath(); ctx.fill();
    // abdomen: three stacked rings
    for (let i = 0; i < 3; i++) { const yy = 4.62 + i * 0.22; limb(ctx, X(-0.5 - i * 0.04), Y(yy + 0.1), X(0.5 + i * 0.04), Y(yy + 0.1), u * 0.2, u * 0.2, shade); }
    // chest: tapered, with a pectoral plate
    g = ctx.createLinearGradient(X(-1), Y(6.8), X(1), Y(5.2)); g.addColorStop(0, body[1]); g.addColorStop(0.45, body[2]); g.addColorStop(1, body[0]);
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(X(-1.02), Y(6.72)); ctx.quadraticCurveTo(X(0), Y(6.95), X(1.02), Y(6.72));
    ctx.quadraticCurveTo(X(0.95), Y(5.7), X(0.58), Y(5.25)); ctx.lineTo(X(-0.58), Y(5.25));
    ctx.quadraticCurveTo(X(-0.95), Y(5.7), X(-1.02), Y(6.72)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(1, u * 0.04);
    ctx.beginPath(); ctx.moveTo(X(0), Y(6.8)); ctx.lineTo(X(0), Y(5.35)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(-0.8), Y(6.05)); ctx.quadraticCurveTo(X(0), Y(5.75), X(0.8), Y(6.05)); ctx.stroke();
    ctx.fillStyle = eye; ctx.globalAlpha = 0.85; ctx.shadowColor = eye; ctx.shadowBlur = u * 0.6;
    ctx.beginPath(); ctx.arc(X(0), Y(6.3), u * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; // chest light
    // neck
    limb(ctx, X(0), Y(6.95), X(0), Y(6.6), u * 0.3, u * 0.34, shade);
    // head: domed cranium, tapered jaw, visor
    g = ctx.createRadialGradient(X(-0.2), Y(7.75), u * 0.05, X(0), Y(7.4), u * 0.6); g.addColorStop(0, body[1]); g.addColorStop(0.55, body[2]); g.addColorStop(1, body[0]);
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(X(-0.4), Y(7.4)); ctx.bezierCurveTo(X(-0.42), Y(8.05), X(0.42), Y(8.05), X(0.4), Y(7.4));
    ctx.quadraticCurveTo(X(0.36), Y(6.98), X(0.12), Y(6.92)); ctx.lineTo(X(-0.12), Y(6.92));
    ctx.quadraticCurveTo(X(-0.36), Y(6.98), X(-0.4), Y(7.4)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.beginPath(); ctx.roundRect(X(-0.33), Y(7.55), u * 0.66, u * 0.17, u * 0.08); ctx.fill();
    ctx.shadowColor = eye; ctx.shadowBlur = u * 0.7; ctx.fillStyle = eye;
    ctx.beginPath(); ctx.roundRect(X(-0.27), Y(7.5), u * 0.17, u * 0.07, u * 0.03); ctx.fill();
    ctx.beginPath(); ctx.roundRect(X(0.1), Y(7.5), u * 0.17, u * 0.07, u * 0.03); ctx.fill();
    ctx.shadowBlur = 0;
    // shoulders + near arm (in front)
    joint(ctx, X(-1.02), Y(6.52), u * 0.3, shade); joint(ctx, X(1.02), Y(6.52), u * 0.28, far);
    limb(ctx, X(-1.02), Y(6.5), X(-1.25), Y(5.0), u * 0.3, u * 0.25, shade); joint(ctx, X(-1.25), Y(5.0), u * 0.17, shade);
    limb(ctx, X(-1.25), Y(5.0), X(-1.12), Y(3.78), u * 0.25, u * 0.19, shade);
    ctx.fillStyle = body[2]; ctx.beginPath(); ctx.ellipse(X(-1.1), Y(3.52), u * 0.14, u * 0.26, 0.08, 0, Math.PI * 2); ctx.fill();
    // rim light down the right edge
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,220,180,.18)'; ctx.lineWidth = Math.max(1, u * 0.05);
    ctx.beginPath(); ctx.moveTo(X(0.4), Y(7.6)); ctx.quadraticCurveTo(X(0.42), Y(7.2), X(0.15), Y(6.95)); ctx.moveTo(X(1.02), Y(6.7)); ctx.quadraticCurveTo(X(0.95), Y(5.7), X(0.58), Y(5.28)); ctx.stroke();
    ctx.restore();
  }

  // Human silhouette, 7.5 heads tall: head, neck, sloped shoulders, tapered torso, arms and parted legs.
  function figure(ctx, x, base, h, color) {
    const u = h / 7.5, X = function (v) { return x + v * u; }, Y = function (v) { return base - v * u; };
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(X(0), Y(7.0), u * 0.42, u * 0.5, 0, 0, Math.PI * 2); ctx.fill();          // head
    limb(ctx, X(0), Y(6.5), X(0), Y(6.15), u * 0.32, u * 0.36);                                             // neck
    ctx.beginPath(); ctx.moveTo(X(-0.95), Y(6.05)); ctx.quadraticCurveTo(X(0), Y(6.35), X(0.95), Y(6.05));   // torso
    ctx.lineTo(X(0.62), Y(4.3)); ctx.lineTo(X(0.7), Y(3.75)); ctx.lineTo(X(-0.7), Y(3.75)); ctx.lineTo(X(-0.62), Y(4.3)); ctx.closePath(); ctx.fill();
    limb(ctx, X(-0.86), Y(5.95), X(-1.05), Y(4.55), u * 0.36, u * 0.3); limb(ctx, X(-1.05), Y(4.55), X(-1.0), Y(3.35), u * 0.3, u * 0.24); // arms
    limb(ctx, X(0.86), Y(5.95), X(1.05), Y(4.55), u * 0.36, u * 0.3); limb(ctx, X(1.05), Y(4.55), X(1.0), Y(3.35), u * 0.3, u * 0.24);
    limb(ctx, X(-0.38), Y(3.8), X(-0.42), Y(1.95), u * 0.56, u * 0.4); limb(ctx, X(-0.42), Y(1.95), X(-0.4), Y(0.15), u * 0.4, u * 0.26); // legs
    limb(ctx, X(0.38), Y(3.8), X(0.46), Y(1.95), u * 0.56, u * 0.4); limb(ctx, X(0.46), Y(1.95), X(0.5), Y(0.15), u * 0.4, u * 0.26);
    ctx.beginPath(); ctx.ellipse(X(-0.5), Y(0.08), u * 0.34, u * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(X(0.6), Y(0.08), u * 0.34, u * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Human head and shoulders, three-quarter view. mode 'fill' = shaded silhouette, 'line' = pencil sketch.
  function portrait(ctx, r, cx, cy, S, mode, col) {
    function head() {
      ctx.beginPath();
      ctx.moveTo(cx - S * 0.36, cy - S * 0.1);
      ctx.bezierCurveTo(cx - S * 0.42, cy - S * 0.62, cx + S * 0.34, cy - S * 0.7, cx + S * 0.38, cy - S * 0.12);   // skull
      ctx.quadraticCurveTo(cx + S * 0.4, cy + S * 0.12, cx + S * 0.3, cy + S * 0.3);                                 // cheek
      ctx.quadraticCurveTo(cx + S * 0.14, cy + S * 0.52, cx - S * 0.02, cy + S * 0.52);                              // chin
      ctx.quadraticCurveTo(cx - S * 0.26, cy + S * 0.46, cx - S * 0.34, cy + S * 0.22);                              // jaw
      ctx.closePath();
    }
    function body() {
      ctx.beginPath();
      ctx.moveTo(cx - S * 0.18, cy + S * 0.4); ctx.lineTo(cx - S * 0.2, cy + S * 0.72);                               // neck
      ctx.bezierCurveTo(cx - S * 0.5, cy + S * 0.8, cx - S * 0.95, cy + S * 0.86, cx - S * 1.1, cy + S * 1.4);        // trapezius → shoulder
      ctx.lineTo(cx - S * 1.15, cy + S * 3); ctx.lineTo(cx + S * 1.15, cy + S * 3); ctx.lineTo(cx + S * 1.1, cy + S * 1.4);
      ctx.bezierCurveTo(cx + S * 0.95, cy + S * 0.86, cx + S * 0.45, cy + S * 0.8, cx + S * 0.2, cy + S * 0.7);
      ctx.lineTo(cx + S * 0.18, cy + S * 0.36); ctx.closePath();
    }
    ctx.save();
    if (mode === 'fill') {
      let g = ctx.createLinearGradient(cx - S, 0, cx + S, 0); g.addColorStop(0, col[1]); g.addColorStop(0.55, col[0]); g.addColorStop(1, col[2]);
      ctx.fillStyle = g; body(); ctx.fill(); head(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - S * 0.3, cy + S * 0.02, S * 0.07, S * 0.12, 0.2, 0, Math.PI * 2); ctx.fill();   // ear
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = S * 0.02;
      ctx.beginPath(); ctx.moveTo(cx + S * 0.06, cy + S * 0.72); ctx.quadraticCurveTo(cx, cy + S * 1.0, cx + S * 0.02, cy + S * 1.4); ctx.stroke(); // collar line
      g = ctx.createRadialGradient(cx - S * 0.15, cy - S * 0.3, 2, cx - S * 0.15, cy - S * 0.3, S * 0.5); g.addColorStop(0, 'rgba(255,255,255,.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; head(); ctx.fill();
    } else {
      ctx.strokeStyle = col[0]; ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) { ctx.lineWidth = 1 + r() * 1.6; ctx.globalAlpha = 0.5 + r() * 0.4; ctx.save(); ctx.translate((r() - 0.5) * S * 0.02, (r() - 0.5) * S * 0.02); head(); ctx.stroke(); body(); ctx.stroke(); ctx.restore(); }
      ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx - S * 0.3, cy + S * 0.02, S * 0.06, S * 0.11, 0.2, 0, Math.PI * 2); ctx.stroke();                    // ear
      ctx.beginPath(); ctx.moveTo(cx - S * 0.08, cy - S * 0.1); ctx.quadraticCurveTo(cx + S * 0.02, cy - S * 0.16, cx + S * 0.1, cy - S * 0.1); ctx.stroke(); // brows
      ctx.beginPath(); ctx.moveTo(cx + S * 0.18, cy - S * 0.1); ctx.quadraticCurveTo(cx + S * 0.26, cy - S * 0.15, cx + S * 0.32, cy - S * 0.1); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + S * 0.01, cy - S * 0.03, S * 0.055, S * 0.022, 0, 0, Math.PI * 2); ctx.stroke();               // eyes
      ctx.beginPath(); ctx.ellipse(cx + S * 0.25, cy - S * 0.03, S * 0.045, S * 0.02, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + S * 0.15, cy - S * 0.04); ctx.lineTo(cx + S * 0.2, cy + S * 0.16); ctx.lineTo(cx + S * 0.12, cy + S * 0.19); ctx.stroke(); // nose
      ctx.beginPath(); ctx.moveTo(cx + S * 0.03, cy + S * 0.31); ctx.quadraticCurveTo(cx + S * 0.13, cy + S * 0.34, cx + S * 0.24, cy + S * 0.3); ctx.stroke(); // mouth
      ctx.globalAlpha = 0.5; ctx.lineWidth = 1.2;                                                                                       // hair hatching
      for (let i = 0; i < 26; i++) { const a = -2.6 + i * 0.085; ctx.beginPath(); ctx.moveTo(cx - S * 0.02 + Math.cos(a) * S * 0.38, cy - S * 0.18 + Math.sin(a) * S * 0.42); ctx.lineTo(cx - S * 0.02 + Math.cos(a) * S * 0.3, cy - S * 0.18 + Math.sin(a) * S * 0.32 + S * 0.06); ctx.stroke(); }
      for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.moveTo(cx + S * 0.3 - i * S * 0.02, cy + S * 0.05 + i * S * 0.03); ctx.lineTo(cx + S * 0.36 - i * S * 0.02, cy + S * 0.02 + i * S * 0.03); ctx.stroke(); } // cheek shadow
    }
    ctx.restore();
  }

  // Portrait: a chrome robot head and shoulders in three-quarter view (the classic paperback cover).
  function bust(ctx, r, w, h, p) {
    const cx = w * 0.53, cy = h * 0.43, R = w * 0.27, eye = p.eye || '#7ff6ff';
    const metal = ['#1b2430', '#eef4fa', '#7d8b99'];
    // shoulders + collar
    let g = ctx.createLinearGradient(0, h * 0.72, 0, h); g.addColorStop(0, '#8d9bab'); g.addColorStop(1, '#1b2430');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(w * 0.02, h); ctx.bezierCurveTo(w * 0.06, h * 0.8, w * 0.3, h * 0.76, cx, h * 0.75);
    ctx.bezierCurveTo(w * 0.76, h * 0.76, w * 0.96, h * 0.8, w * 1.0, h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(w * (0.1 + i * 0.03), h); ctx.quadraticCurveTo(w * (0.2 + i * 0.03), h * (0.84 - i * 0.01), cx - R * 0.2, h * (0.78 + i * 0.02)); ctx.stroke(); }
    // neck pistons and cables
    limb(ctx, cx - R * 0.22, cy + R * 0.9, cx - R * 0.26, h * 0.79, R * 0.2, R * 0.24, metal);
    limb(ctx, cx + R * 0.2, cy + R * 0.9, cx + R * 0.24, h * 0.79, R * 0.18, R * 0.22, ['#1b2430', '#9aa8b6', '#56636f']);
    ctx.strokeStyle = '#141a22'; ctx.lineWidth = R * 0.05;
    ctx.beginPath(); ctx.moveTo(cx - R * 0.05, cy + R * 0.85); ctx.bezierCurveTo(cx, h * 0.72, cx - R * 0.1, h * 0.75, cx + R * 0.02, h * 0.8); ctx.stroke();
    // cranium + jaw (head turned slightly to the viewer's left)
    g = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.55, R * 0.05, cx - R * 0.1, cy - R * 0.1, R * 1.25);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, '#e4ecf4'); g.addColorStop(0.55, '#7d8b99'); g.addColorStop(1, '#141a22');
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(cx - R * 0.92, cy - R * 0.05);
    ctx.bezierCurveTo(cx - R * 0.98, cy - R * 1.25, cx + R * 0.98, cy - R * 1.25, cx + R * 0.86, cy - R * 0.05);
    ctx.quadraticCurveTo(cx + R * 0.8, cy + R * 0.62, cx + R * 0.36, cy + R * 0.95);
    ctx.lineTo(cx - R * 0.42, cy + R * 0.95);
    ctx.quadraticCurveTo(cx - R * 0.86, cy + R * 0.62, cx - R * 0.92, cy - R * 0.05); ctx.closePath(); ctx.fill();
    // ear disc (near side)
    ctx.save(); ctx.translate(cx - R * 0.9, cy + R * 0.05);
    for (let i = 3; i >= 1; i--) { ctx.fillStyle = i % 2 ? '#2a3440' : '#a8b5c2'; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.08 * i, R * 0.14 * i, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // faceplate, set slightly toward the far side
    g = ctx.createLinearGradient(cx - R * 0.6, 0, cx + R * 0.7, 0); g.addColorStop(0, '#c9d4de'); g.addColorStop(0.5, '#8794a2'); g.addColorStop(1, '#2a3440');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - R * 0.62, cy - R * 0.38); ctx.quadraticCurveTo(cx + R * 0.05, cy - R * 0.52, cx + R * 0.7, cy - R * 0.36);
    ctx.quadraticCurveTo(cx + R * 0.66, cy + R * 0.55, cx + R * 0.3, cy + R * 0.86); ctx.lineTo(cx - R * 0.32, cy + R * 0.86);
    ctx.quadraticCurveTo(cx - R * 0.66, cy + R * 0.5, cx - R * 0.62, cy - R * 0.38); ctx.closePath(); ctx.fill();
    // brow + eye sockets + glowing eyes (far eye narrower: perspective)
    ctx.fillStyle = '#0b1016';
    ctx.beginPath(); ctx.ellipse(cx - R * 0.3, cy - R * 0.08, R * 0.22, R * 0.13, -0.06, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + R * 0.33, cy - R * 0.08, R * 0.18, R * 0.12, 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = eye; ctx.shadowBlur = R * 0.35; ctx.fillStyle = eye;
    ctx.beginPath(); ctx.ellipse(cx - R * 0.3, cy - R * 0.08, R * 0.13, R * 0.055, -0.06, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + R * 0.33, cy - R * 0.08, R * 0.1, R * 0.048, 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(cx - R * 0.3, cy - R * 0.08, R * 0.05, R * 0.02, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(10,14,20,.7)'; ctx.lineWidth = R * 0.03;
    ctx.beginPath(); ctx.moveTo(cx - R * 0.58, cy - R * 0.28); ctx.quadraticCurveTo(cx, cy - R * 0.4, cx + R * 0.62, cy - R * 0.27); ctx.stroke();
    // nose ridge + mouth grille
    ctx.beginPath(); ctx.moveTo(cx + R * 0.02, cy - R * 0.02); ctx.lineTo(cx - R * 0.04, cy + R * 0.32); ctx.stroke();
    ctx.fillStyle = '#0b1016'; ctx.beginPath(); ctx.roundRect(cx - R * 0.3, cy + R * 0.5, R * 0.56, R * 0.18, R * 0.06); ctx.fill();
    ctx.fillStyle = '#56636f'; for (let i = 0; i < 6; i++) ctx.fillRect(cx - R * 0.26 + i * R * 0.09, cy + R * 0.53, R * 0.035, R * 0.12);
    // panel seams, rivets
    ctx.strokeStyle = 'rgba(10,14,20,.45)'; ctx.lineWidth = R * 0.015;
    ctx.beginPath(); ctx.moveTo(cx - R * 0.05, cy - R * 0.98); ctx.quadraticCurveTo(cx - R * 0.02, cy - R * 0.7, cx - R * 0.02, cy - R * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - R * 0.05, cy - R * 0.2, R * 0.82, Math.PI * 1.08, Math.PI * 1.32); ctx.stroke();
    ctx.fillStyle = '#3a4550'; [[-0.7, -0.55], [0.62, -0.58], [-0.72, 0.4], [0.64, 0.38]].forEach(function (q) { ctx.beginPath(); ctx.arc(cx + q[0] * R, cy + q[1] * R, R * 0.025, 0, Math.PI * 2); ctx.fill(); });
    // specular glint on the dome, accent rim light on the far edge
    g = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.72, 1, cx - R * 0.45, cy - R * 0.72, R * 0.3); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx - R * 0.45, cy - R * 0.72, R * 0.3, R * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = p.accent || '#ff6a3a'; ctx.globalAlpha = 0.55; ctx.lineWidth = R * 0.035;
    ctx.beginPath(); ctx.moveTo(cx + R * 0.55, cy - R * 0.85); ctx.bezierCurveTo(cx + R * 0.9, cy - R * 0.5, cx + R * 0.9, cy + R * 0.3, cx + R * 0.38, cy + R * 0.93); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  // The fact: a GPU package on a circuit board, die glowing, traces running to the edges.
  function chip(ctx, r, w, h) {
    let g = ctx.createRadialGradient(w * 0.5, h * 0.48, w * 0.05, w * 0.5, h * 0.48, h * 0.75);
    g.addColorStop(0, '#16351a'); g.addColorStop(1, '#040a05'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.52, S = w * 0.56;
    // traces: orthogonal runs from the package edge outward, ending in pads
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const side = i % 4, k = r() - 0.5; let x = cx, y = cy, dx = 0, dy = 0;
      if (side === 0) { x = cx + k * S * 0.9; y = cy - S / 2; dy = -1; } else if (side === 1) { x = cx + S / 2; y = cy + k * S * 0.9; dx = 1; }
      else if (side === 2) { x = cx + k * S * 0.9; y = cy + S / 2; dy = 1; } else { x = cx - S / 2; y = cy + k * S * 0.9; dx = -1; }
      ctx.strokeStyle = r() > 0.7 ? 'rgba(232,190,90,.75)' : 'rgba(120,200,90,.35)'; ctx.lineWidth = 1 + r() * 1.6;
      ctx.beginPath(); ctx.moveTo(x, y); let len = w * (0.04 + r() * 0.12); x += dx * len; y += dy * len; ctx.lineTo(x, y);
      const turn = r() > 0.5 ? 1 : -1; len = w * (0.03 + r() * 0.1); x += (dy ? turn : 0) * len; y += (dx ? turn : 0) * len; ctx.lineTo(x, y);
      len = w * (0.05 + r() * 0.2); x += dx * len; y += dy * len; ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = 'rgba(232,190,90,.8)'; ctx.beginPath(); ctx.arc(x, y, 2 + r() * 2, 0, Math.PI * 2); ctx.fill();
    }
    // package substrate with gold contacts
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    g = ctx.createLinearGradient(cx - S / 2, cy - S / 2, cx + S / 2, cy + S / 2); g.addColorStop(0, '#2c3a2c'); g.addColorStop(1, '#0d150d');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(cx - S / 2, cy - S / 2, S, S, S * 0.04); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#d9a63a';
    for (let i = 0; i < 18; i++) { const o = -S * 0.43 + i * S * 0.05;
      ctx.fillRect(cx + o, cy - S / 2 + 3, S * 0.022, S * 0.04); ctx.fillRect(cx + o, cy + S / 2 - 3 - S * 0.04, S * 0.022, S * 0.04);
      ctx.fillRect(cx - S / 2 + 3, cy + o, S * 0.04, S * 0.022); ctx.fillRect(cx + S / 2 - 3 - S * 0.04, cy + o, S * 0.04, S * 0.022); }
    // memory stacks around the die
    ctx.fillStyle = '#1a1f1a'; [[-0.34, -0.24], [-0.34, 0.06], [0.2, -0.24], [0.2, 0.06]].forEach(function (q) { ctx.fillRect(cx + q[0] * S, cy + q[1] * S, S * 0.14, S * 0.18); ctx.strokeStyle = 'rgba(200,220,200,.25)'; ctx.strokeRect(cx + q[0] * S, cy + q[1] * S, S * 0.14, S * 0.18); });
    // the die: glossy, iridescent, a grid of cores lit green
    const D = S * 0.36, dx0 = cx - D / 2, dy0 = cy - D / 2;
    ctx.save(); ctx.shadowColor = '#7dff4a'; ctx.shadowBlur = 50;
    g = ctx.createLinearGradient(dx0, dy0, dx0 + D, dy0 + D); g.addColorStop(0, '#2b2340'); g.addColorStop(0.45, '#1c3a2a'); g.addColorStop(1, '#0d1a12');
    ctx.fillStyle = g; ctx.fillRect(dx0, dy0, D, D); ctx.restore();
    const n = 10, cs = D / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const on = r(); ctx.fillStyle = on > 0.55 ? 'rgba(140,255,90,' + (0.35 + on * 0.6) + ')' : 'rgba(80,140,70,.25)'; ctx.fillRect(dx0 + i * cs + cs * 0.15, dy0 + j * cs + cs * 0.15, cs * 0.7, cs * 0.7); }
    g = ctx.createLinearGradient(dx0, dy0, dx0 + D * 0.7, dy0 + D * 0.7); g.addColorStop(0, 'rgba(255,255,255,.3)'); g.addColorStop(0.4, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(dx0, dy0, D, D);
    ctx.strokeStyle = 'rgba(200,255,170,.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(dx0, dy0, D, D);
    // heat shimmer above the die
    g = ctx.createRadialGradient(cx, cy, D * 0.2, cx, cy, S * 0.9); g.addColorStop(0, 'rgba(125,255,74,.22)'); g.addColorStop(1, 'rgba(125,255,74,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }


  // greeble: machined detail inside a rect (panels, vents, conduits) for megastructure towers
  function greeble(ctx, r, x, y, w, h, base, light, dark) {
    ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, dark); g.addColorStop(0.35, light); g.addColorStop(0.6, base); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.globalAlpha = 0.7; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    for (let i = 0; i < Math.max(6, h / 7); i++) {
      const gy = y + r() * h, gw = w * (0.15 + r() * 0.6), gx = x + r() * (w - gw), gh = 1 + r() * Math.min(10, h * 0.04);
      ctx.fillStyle = r() > 0.5 ? dark : light; ctx.globalAlpha = 0.35 + r() * 0.4; ctx.fillRect(gx, gy, gw, gh);
    }
    ctx.globalAlpha = 0.5; ctx.fillStyle = dark;
    for (let yy = y; yy < y + h; yy += 12 + r() * 30) ctx.fillRect(x, yy, w, 1.5);
    ctx.globalAlpha = 1;
  }
  function spireTower(ctx, r, cx, top, base, w, cols, disc) {
    greeble(ctx, r, cx - w / 2, top, w, base - top, cols[0], cols[1], cols[2]);
    for (let k = 0; k < 3; k++) { const yy = top + (base - top) * (0.15 + k * 0.28); ctx.fillStyle = cols[2]; ctx.fillRect(cx - w * 0.62, yy, w * 1.24, w * 0.12); ctx.fillStyle = cols[1]; ctx.globalAlpha = 0.5; ctx.fillRect(cx - w * 0.62, yy, w * 1.24, w * 0.03); ctx.globalAlpha = 1; }
    if (disc) { ctx.fillStyle = cols[2]; ctx.beginPath(); ctx.ellipse(cx, top, w * 2.4, w * 0.42, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = cols[1]; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.ellipse(cx, top - w * 0.08, w * 2.3, w * 0.3, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  }
  function cloaked(ctx, x, base, h, col) {
    ctx.save(); ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x, base - h * 0.9, h * 0.07, h * 0.085, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - h * 0.11, base - h * 0.78); ctx.quadraticCurveTo(x, base - h * 0.84, x + h * 0.11, base - h * 0.78);
    ctx.lineTo(x + h * 0.2, base); ctx.lineTo(x - h * 0.24, base); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - h * 0.16, base - h * 0.2); ctx.quadraticCurveTo(x - h * 0.42, base - h * 0.1, x - h * 0.36, base); ctx.lineTo(x - h * 0.2, base); ctx.fill(); // cape in the wind
    ctx.restore();
  }
  function catSil(ctx, x, base, h, col) {
    ctx.save(); ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x, base - h * 0.35, h * 0.24, h * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, base - h * 0.8, h * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - h * 0.16, base - h * 0.88); ctx.lineTo(x - h * 0.12, base - h * 1.05); ctx.lineTo(x - h * 0.03, base - h * 0.94); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + h * 0.16, base - h * 0.88); ctx.lineTo(x + h * 0.12, base - h * 1.05); ctx.lineTo(x + h * 0.03, base - h * 0.94); ctx.fill();
    ctx.lineWidth = h * 0.08; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + h * 0.2, base - h * 0.08); ctx.quadraticCurveTo(x + h * 0.55, base - h * 0.1, x + h * 0.5, base - h * 0.45); ctx.stroke();
    ctx.restore();
  }
  function nebula(ctx, r, w, h, cols) { cols.forEach(function (c, i) { dabs(ctx, r, w * (0.2 + r() * 0.6), h * (0.15 + r() * 0.5), w * 1.1, h * 0.5, c, 160, w * 0.18); }); }

  const SCENES = {
    planet: function (c, r, w, h, p) {
      sky(c, w, h, p.sky); stars(c, r, w, h, 260, 0.7);
      dabs(c, r, w * 0.3, h * 0.35, w, h * 0.4, p.accent, 140, w * 0.12);
      planet(c, w * 0.66, h * 0.32, w * 0.24, p.accent, '#ffe7c2', '#f6d48a');
      planet(c, w * 0.18, h * 0.16, w * 0.05, '#7a6a8e', '#e8e0ff');
      ridge(c, r, w, h, h * 0.78, h * 0.08, '#24131c'); ridge(c, r, w, h, h * 0.88, h * 0.05, '#0e070b');
      figure(c, w * 0.3, h * 0.885, h * 0.07, '#0e070b');
    },
    robot: function (c, r, w, h, p) {
      sky(c, w, h, p.sky); dabs(c, r, w * 0.5, h * 0.45, w * 1.2, h * 0.8, '#000', 160, w * 0.18);
      c.save(); c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(w * 0.5, h * 1.02, w * 0.9, h * 0.2, 0, 0, Math.PI * 2); c.fill(); c.restore();
      robot(c, w * 0.5, h * 0.93, h * 0.8, ['#050404', '#3a2a2a', '#0b0808'], p.eye || '#fff4d6');
    },
    city: function (c, r, w, h, p) {
      sky(c, w, h, p.sky); planet(c, w * 0.5, h * 0.55, w * 0.22, '#ffcf5a', '#fff6c8');
      dabs(c, r, w * 0.5, h * 0.3, w, h * 0.3, '#ff6a2a', 120, w * 0.14);
      c.fillStyle = '#2a0d10';
      for (let i = 0; i < 9; i++) { const x = r() * w, ht = h * (0.15 + r() * 0.3);
        c.fillRect(x, h * 0.72 - ht, w * 0.012, ht); c.beginPath(); c.ellipse(x + w * 0.006, h * 0.72 - ht, w * (0.03 + r() * 0.03), h * 0.012, 0, 0, Math.PI * 2); c.fill(); }
      for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(w * (0.15 + i * 0.24), h * 0.74, w * (0.06 + r() * 0.05), Math.PI, 0); c.fillStyle = '#e8d6ff'; c.globalAlpha = 0.6; c.fill(); c.globalAlpha = 1; }
      ridge(c, r, w, h, h * 0.76, h * 0.03, '#4a2a12'); ridge(c, r, w, h, h * 0.86, h * 0.02, '#1c0b06');
      robot(c, w * 0.66, h * 0.95, h * 0.32, ['#8a5a10', '#ffd66a', '#7a4a0a'], '#fff');
      figure(c, w * 0.42, h * 0.95, h * 0.2, '#1c0b06');
    },
    nebula: function (c, r, w, h, p) {
      sky(c, w, h, p.sky); stars(c, r, w, h, 320, 1);
      ['#ff4fa0', '#5ad6ff', p.accent].forEach(function (col, i) { dabs(c, r, w * (0.3 + i * 0.2), h * (0.35 + i * 0.12), w * 0.8, h * 0.4, col, 220, w * 0.16); });
      c.save(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.shadowColor = '#fff'; c.shadowBlur = 12;
      c.beginPath(); c.moveTo(w * 0.15, h * 0.75); c.lineTo(w * 0.62, h * 0.4); c.stroke(); c.restore();
      c.save(); c.translate(w * 0.62, h * 0.4); c.rotate(-0.65); c.fillStyle = '#d9dde6';
      c.beginPath(); c.moveTo(w * 0.07, 0); c.lineTo(-w * 0.03, -w * 0.025); c.lineTo(-w * 0.03, w * 0.025); c.closePath(); c.fill(); c.restore();
      planet(c, w * 0.8, h * 0.82, w * 0.12, '#3b5bb5', '#bfe3ff', '#a9c4ff');
    },
    portal: function (c, r, w, h, p) {
      sky(c, w, h, p.sky);
      const cx = w * 0.5, cy = h * 0.45, R = w * 0.38;
      c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
      sky(c, w, h, ['#02040c', '#0b1b3a', '#030712']); stars(c, r, w, h, 220, 1);
      planet(c, cx + R * 0.35, cy - R * 0.3, R * 0.22, '#8fb4d8', '#f0f8ff'); c.restore();
      c.save(); c.lineWidth = w * 0.05; c.strokeStyle = '#2f4a5a'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      c.lineWidth = w * 0.012; c.strokeStyle = '#9fd6e6'; c.beginPath(); c.arc(cx, cy, R - w * 0.03, 0, Math.PI * 2); c.stroke(); c.restore();
      c.fillStyle = 'rgba(0,10,20,.55)'; c.fillRect(0, h * 0.84, w, h * 0.16);
      robot(c, w * 0.62, h * 0.97, h * 0.5, ['#4d5a66', '#dce6ee', '#3a4550'], '#7ff');
      figure(c, w * 0.36, h * 0.97, h * 0.42, '#e8e2d4');
    },
    sun: function (c, r, w, h, p) {
      sky(c, w, h, p.sky);
      c.save(); c.translate(w * 0.72, h * 0.26); c.strokeStyle = '#fff'; c.globalAlpha = 0.85;
      for (let i = 0; i < 16; i++) { c.rotate(Math.PI / 8); c.lineWidth = i % 2 ? 1 : 2.5; c.beginPath(); c.moveTo(0, w * 0.03); c.lineTo(0, w * (i % 2 ? 0.1 : 0.16)); c.stroke(); }
      c.restore();
      portrait(c, r, w * 0.38, h * 0.5, w * 0.36, 'fill', ['#5a4320', '#c9a24a', '#2a1d0c']);
      c.fillStyle = '#1a1206'; c.fillRect(w * 0.26, h * 0.74, w * 0.2, h * 0.1);
      c.strokeStyle = '#e9c45a'; c.lineWidth = 1.2; for (let i = 0; i < 5; i++) c.strokeRect(w * (0.27 + i * 0.036), h * 0.755, w * 0.025, h * 0.07);
      for (let i = 0; i < 3; i++) robot(c, w * (0.74 + i * 0.09), h * 0.78, h * 0.18, ['#2a2010', '#7a6a40', '#2a2010'], '#fff6c0');
    },
    sketch: function (c, r, w, h, p) {
      sky(c, w, h, p.sky);
      c.save(); c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineCap = 'round';
      for (let i = 0; i < 26; i++) { c.lineWidth = 0.6 + r() * 1.2; c.beginPath();
        const x = w * (0.35 + r() * 0.5), y = h * (0.15 + r() * 0.6); c.moveTo(x, y);
        c.bezierCurveTo(x + (r() - 0.5) * w * 0.3, y + (r() - 0.5) * h * 0.2, x + (r() - 0.5) * w * 0.3, y + (r() - 0.5) * h * 0.2, x + (r() - 0.5) * w * 0.4, y + (r() - 0.5) * h * 0.3); c.stroke(); }
      c.restore();
      c.save(); c.globalAlpha = 0.35; c.fillStyle = '#0e1c2e'; c.beginPath(); c.ellipse(w * 0.6, h * 0.5, w * 0.36, h * 0.3, 0, 0, Math.PI * 2); c.fill(); c.restore();
      portrait(c, r, w * 0.6, h * 0.42, w * 0.42, 'line', ['#f4f8ff']);
      dabs(c, r, w * 0.3, h * 0.88, w * 0.6, h * 0.05, '#d2232a', 90, w * 0.08);
      figure(c, w * 0.22, h * 0.87, h * 0.08, '#111');
    },
    bust: function (c, r, w, h, p) {
      sky(c, w, h, p.sky); stars(c, r, w, h, 180, 0.6);
      const gl = c.createRadialGradient(w * 0.62, h * 0.3, 10, w * 0.62, h * 0.3, w * 0.7); gl.addColorStop(0, (p.accent || '#ff5a2e') + '66'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gl; c.fillRect(0, 0, w, h);
      bust(c, r, w, h, p);
    },
    chip: function (c, r, w, h) { chip(c, r, w, h); },
    // backdrop only (for 3D scenes): sky, stars, a big soft planet glow
    sky: function (c, r, w, h, p) {
      sky(c, w, h, p.sky); stars(c, r, w, h, 220, 0.75);
      dabs(c, r, w * 0.5, h * 0.4, w, h * 0.6, '#000', 90, w * 0.2);
      planet(c, w * 0.78, h * 0.2, w * 0.17, p.accent, '#ffe7c2', '#f6d48a');
      const g = c.createRadialGradient(w * 0.45, h * 0.55, 10, w * 0.45, h * 0.55, w * 0.7); g.addColorStop(0, 'rgba(255,170,90,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    },

    // ── homage paintings for the "Painters of the future" shelf (our own work, in the spirit of the credited artists) ──
    trantor: function (c, r, w, h) {      // after Michael Whelan's Foundation: towers of Trantor at dusk
      sky(c, w, h, ['#e9c7d8', '#c9a3d6', '#9c86c9', '#7d6fb3']);
      for (let i = 0; i < 9; i++) { const x = r() * w, s = 0.4 + r() * 0.5; spireTower(c, r, x, h * (0.15 + r() * 0.25), h * 0.66, w * 0.035 * s, ['#8a7fae', '#b3a8d6', '#5e5487'], r() > 0.4); }
      spireTower(c, r, w * 0.62, h * 0.02, h * 0.72, w * 0.16, ['#6f6693', '#a69bc9', '#3e3760'], false);
      c.strokeStyle = '#4c4570'; c.lineWidth = w * 0.012; for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(w * 0.84, h * (0.12 + k * 0.035), w * 0.11, w * 0.025, 0, 0, Math.PI * 2); c.stroke(); }
      const g = c.createLinearGradient(0, h * 0.66, 0, h); g.addColorStop(0, '#8d84b4'); g.addColorStop(1, '#5b5384'); c.fillStyle = g; c.fillRect(0, h * 0.66, w, h * 0.34);
      c.strokeStyle = 'rgba(40,34,70,.55)'; c.lineWidth = 2; for (let k = 1; k < 6; k++) { c.beginPath(); c.ellipse(w * 0.3, h * 0.84, w * 0.08 * k, h * 0.018 * k, 0, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = '#7a3a2a'; c.fillRect(w * 0.36, h * 0.86, w * 0.28, h * 0.14);                                   // the carpet
      cloaked(c, w * 0.5, h * 0.93, h * 0.22, '#f1ead8'); catSil(c, w * 0.6, h * 0.94, h * 0.07, '#3a3346');
    },
    ruins: function (c, r, w, h) {        // after Whelan's Foundation and Empire: fallen towers in green haze
      sky(c, w, h, ['#e7ecc4', '#c9d3a0', '#9aa67c']);
      [[0.25, -0.35], [0.55, 0.42], [0.8, -0.2]].forEach(function (q) { c.save(); c.translate(w * q[0], h * 0.85); c.rotate(q[1]); greeble(c, r, -w * 0.08, -h * 0.95, w * 0.16, h * 0.95, '#8b8f7c', '#c5c9b0', '#55594a'); c.restore(); });
      c.fillStyle = '#5a5d4c'; c.beginPath(); c.moveTo(0, h); c.lineTo(0, h * 0.84); for (let x = 0; x <= w; x += w / 14) c.lineTo(x, h * (0.82 + r() * 0.06)); c.lineTo(w, h); c.fill();
      cloaked(c, w * 0.5, h * 0.86, h * 0.2, '#d9763a');
    },
    arch: function (c, r, w, h) {         // after Whelan's Second Foundation: alien spires under a clean sky
      sky(c, w, h, ['#2f7fd0', '#5aa2e0', '#a9d0f2']);
      for (let i = 0; i < 7; i++) dabs(c, r, w * r(), h * (0.08 + r() * 0.3), w * 0.35, h * 0.08, '#ffffff', 26, w * 0.08);
      c.fillStyle = '#5d86b8';
      c.beginPath(); c.moveTo(w * 0.18, h * 0.78); c.bezierCurveTo(w * 0.28, h * 0.4, w * 0.42, h * 0.2, w * 0.56, h * 0.08); c.lineTo(w * 0.5, h * 0.3); c.bezierCurveTo(w * 0.4, h * 0.45, w * 0.32, h * 0.6, w * 0.3, h * 0.78); c.fill();
      c.beginPath(); c.moveTo(w * 0.88, h * 0.78); c.bezierCurveTo(w * 0.8, h * 0.45, w * 0.66, h * 0.2, w * 0.52, h * 0.1); c.lineTo(w * 0.6, h * 0.32); c.bezierCurveTo(w * 0.7, h * 0.48, w * 0.76, h * 0.62, w * 0.76, h * 0.78); c.fill();
      c.fillStyle = '#3f7a3a'; c.fillRect(0, h * 0.78, w, h * 0.22); dabs(c, r, w * 0.5, h * 0.84, w, h * 0.1, '#6aa04a', 80, w * 0.06);
      c.fillStyle = '#9aa0a8'; c.fillRect(w * 0.35, h * 0.9, w * 0.4, h * 0.1);
      figure(c, w * 0.58, h * 0.97, h * 0.26, '#4a5a3a');
    },
    fleet: function (c, r, w, h) {        // in the spirit of the great paperback starship painters
      sky(c, w, h, ['#c9e86a', '#7fc64a', '#3c8a3a']); stars(c, r, w, h, 120, 1);
      planet(c, w * 0.75, h * 0.42, w * 0.2, '#9ed27a', '#eaffc8'); planet(c, w * 0.18, h * 0.86, w * 0.1, '#7fb85a', '#e0ffc0');
      c.save(); c.translate(w * 0.48, h * 0.42); c.rotate(-0.55);
      c.fillStyle = '#3f5c46'; c.beginPath(); c.moveTo(-w * 0.55, 0); c.lineTo(-w * 0.2, -h * 0.12); c.lineTo(w * 0.45, -h * 0.07); c.lineTo(w * 0.5, h * 0.05); c.lineTo(-w * 0.15, h * 0.13); c.closePath(); c.fill();
      for (let i = 0; i < 40; i++) { c.fillStyle = r() > 0.5 ? '#6e8f74' : '#28402e'; c.fillRect(-w * 0.45 + r() * w * 0.9, -h * 0.1 + r() * h * 0.2, w * (0.02 + r() * 0.08), h * (0.008 + r() * 0.02)); }
      for (let i = 0; i < 14; i++) { c.fillStyle = r() > 0.5 ? '#ffb347' : '#ffe08a'; c.fillRect(-w * 0.4 + r() * w * 0.8, -h * 0.05 + r() * h * 0.1, 4, 3); }
      c.fillStyle = '#ffcf4a'; c.fillRect(-w * 0.05, -h * 0.02, w * 0.12, h * 0.04);
      c.restore();
      c.fillStyle = '#c8d0c0'; c.beginPath(); c.ellipse(w * 0.22, h * 0.72, w * 0.08, h * 0.02, -0.2, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#ff7a3a'; c.lineWidth = 3; c.beginPath(); c.moveTo(w * 0.3, h * 0.7); c.lineTo(w * 0.42, h * 0.67); c.stroke();
    },
    rows: function (c, r, w, h) {         // after I, Robot (2004): rows of identical machines
      sky(c, w, h, ['#c7d2dc', '#8e9cab', '#3a4450']);
      for (let row = 0; row < 5; row++) { const s = 0.35 + row * 0.16, y = h * (0.52 + row * 0.12); for (let i = -2; i < 7; i++) robot(c, w * (0.08 + i * 0.2 * s + row * 0.05), y + h * 0.3 * s, h * 0.42 * s, ['#7f8b96', '#eef4fa', '#b9c5cf'], '#7fd6ff'); }
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(230,240,255,.55)'); g.addColorStop(0.4, 'rgba(230,240,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    },
    tower: function (c, r, w, h) {        // a megastructure under a ringed planet; the cloaked watcher and the cat
      sky(c, w, h, ['#2a5a8a', '#3f8fa8', '#c08ab8', '#6a4a7a']); nebula(c, r, w, h, ['#7ff0ff', '#ff8ac8', '#9a7aff']); stars(c, r, w, h, 260, 0.8);
      c.save(); c.strokeStyle = 'rgba(160,255,255,.8)'; c.lineWidth = 3; c.shadowColor = '#7ff'; c.shadowBlur = 14; c.beginPath(); c.arc(w * 0.62, h * 0.4, w * 0.42, -2.3, 1.0); c.stroke(); c.restore();
      greeble(c, r, w * 0.38, 0, w * 0.24, h * 0.7, '#22374a', '#4f7894', '#0e1a26');
      [[0.28, 0.28, 0.12], [0.62, 0.22, 0.12], [0.2, 0.55, 0.16], [0.66, 0.55, 0.16]].forEach(function (q) { greeble(c, r, w * q[0], h * q[1], w * q[2], h * 0.14, '#1e3242', '#4a7088', '#0b1520'); });
      c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createLinearGradient(w * 0.5, h * 0.3, w * 0.5, h * 0.75); g.addColorStop(0, 'rgba(120,255,255,0)'); g.addColorStop(1, 'rgba(120,255,255,.55)'); c.fillStyle = g; c.beginPath(); c.moveTo(w * 0.46, h * 0.3); c.lineTo(w * 0.56, h * 0.3); c.lineTo(w * 0.6, h * 0.75); c.lineTo(w * 0.42, h * 0.75); c.fill(); c.restore();
      c.fillStyle = '#0b1622'; c.fillRect(0, h * 0.74, w, h * 0.26); c.fillRect(w * 0.3, h * 0.7, w * 0.4, h * 0.06); c.fillRect(w * 0.43, h * 0.66, w * 0.14, h * 0.05);
      for (let i = 0; i < 60; i++) { c.fillStyle = r() > 0.6 ? '#ffb070' : '#7ff0ff'; c.globalAlpha = 0.6; c.fillRect(r() * w, h * (0.75 + r() * 0.08), 2, 2); } c.globalAlpha = 1;
      cloaked(c, w * 0.5, h * 0.665, h * 0.12, '#0a121a'); catSil(c, w * 0.555, h * 0.665, h * 0.035, '#0a121a');
    },
    split: function (c, r, w, h, p) {
      c.fillStyle = '#111'; c.fillRect(0, 0, w, h);
      c.save(); c.beginPath(); c.rect(w * 0.5, 0, w * 0.5, h); c.clip();
      c.fillStyle = '#f4efe6'; c.beginPath(); c.arc(w * 0.5, h * 0.2, w * 0.13, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(w * 0.5, h * 0.3); c.lineTo(w * 0.78, h * 0.36); c.lineTo(w * 0.86, h * 0.8); c.lineTo(w * 0.78, h * 0.8); c.lineTo(w * 0.72, h * 0.45); c.lineTo(w * 0.66, h); c.lineTo(w * 0.5, h); c.fill();
      c.strokeStyle = '#d4482a'; c.lineWidth = 1.4; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(w * 0.76, h * 0.42); c.quadraticCurveTo(w * (0.78 + r() * 0.05), h * 0.6, w * (0.79 + r() * 0.06), h * 0.78); c.stroke(); }
      c.restore();
      c.save(); c.beginPath(); c.rect(0, 0, w * 0.5, h); c.clip(); c.strokeStyle = '#eee'; c.fillStyle = '#eee'; c.lineWidth = 2;
      c.beginPath(); c.arc(w * 0.5, h * 0.2, w * 0.13, Math.PI * 0.5, Math.PI * 1.5); c.stroke();
      for (let i = 0; i < 9; i++) { const y = h * (0.32 + i * 0.07); c.strokeRect(w * (0.3 + r() * 0.1), y, w * (0.1 + r() * 0.1), h * 0.04); }
      c.beginPath(); c.arc(w * 0.22, h * 0.36, w * 0.05, 0, Math.PI * 2); c.fill();
      c.fillRect(w * 0.1, h * 0.4, w * 0.025, h * 0.4); c.restore();
    }
  };

  function paint(canvas) {
    if (canvas.dataset.locked) return;
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(160, Math.round(box.width)), h = Math.max(220, Math.round(box.height));
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!ctx.roundRect) ctx.roundRect = function (x, y, ww, hh) { this.rect(x, y, ww, hh); };
    const d = canvas.dataset;
    const p = { sky: (d.sky || '#1b1030,#6a2a4a,#f0a050').split(','), accent: d.accent || '#c8462e', eye: d.eye };
    (SCENES[d.scene] || SCENES.planet)(ctx, rng(+d.seed || 7), w, h, p);
  }

  // Paint straight onto an offscreen canvas at a fixed size (used for WebGL textures).
  function paintTo(canvas, opts, w, h) {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx.roundRect) ctx.roundRect = function (x, y, ww, hh) { this.rect(x, y, ww, hh); };
    const p = { sky: (opts.sky || '#1b1030,#6a2a4a,#f0a050').split(','), accent: opts.accent || '#c8462e', eye: opts.eye };
    (SCENES[opts.scene] || SCENES.planet)(ctx, rng(+opts.seed || 7), w, h, p);
    return ctx;
  }

  function paintAll(root) { (root || document).querySelectorAll('canvas[data-scene]').forEach(paint); }

  let t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(paintAll, 150); });
  window.CoverPaint = { paint: paint, paintAll: paintAll, paintTo: paintTo };
  if (document.readyState !== 'loading') paintAll(); else document.addEventListener('DOMContentLoaded', function () { paintAll(); });
})();
