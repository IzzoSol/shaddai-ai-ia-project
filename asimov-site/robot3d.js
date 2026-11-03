/* robot3d.js — R-7, the procedural 3D robot (three.js r128 UMD global THREE).
   Pearl ceramic shell (panel lines, clearcoat) over graphite hinges and chrome, a smoked-glass face shield
   with the eyes glowing through it, ring-lit ear pods and a chest core.
   finish: 'r7' (default) = R-7 after the upgrade: metallic green, glowing circuit traces, a lit visor band, neck gimbal rings,
   lit joint rings, three fingers and a thumb. 'silver' = the ordinary robots. 'gold' = R-7 before the upgrade.
   Fully jointed so the site and the film can pose it:
     const bot = AsimovRobot.create({ eye: 0x7ff6ff });  scene.add(bot.root);
     bot.pose({ headYaw: .3, armR: { shoulder: [-.4, 0, .2], elbow: -.6 } });  bot.setEye(0xffc04a, 1);
   AsimovRobot.studio(renderer) returns a PMREM environment map for chrome reflections. */
(function () {
  'use strict';
  var T = window.THREE; if (!T) return;

  // Panel lines and a few fasteners, as a bump map (lathe/sphere UVs: u around, v along)
  var panelTex = null;
  function panels() {
    if (panelTex) return panelTex;
    var cv = document.createElement('canvas'); cv.width = cv.height = 512; var x = cv.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, 512, 512); x.strokeStyle = '#2a2a2a'; x.lineWidth = 3;
    [0.12, 0.37, 0.63, 0.88].forEach(function (u) { x.beginPath(); x.moveTo(u * 512, 0); x.lineTo(u * 512, 512); x.stroke(); });
    [0.18, 0.72].forEach(function (v) { x.beginPath(); x.moveTo(0, v * 512); x.lineTo(512, v * 512); x.stroke(); });
    x.fillStyle = '#5a5a5a'; for (var i = 0; i < 4; i++) for (var j = 0; j < 2; j++) { x.beginPath(); x.arc((0.12 + i * 0.25) * 512 + 14, (0.18 + j * 0.54) * 512 + 14, 4, 0, 7); x.fill(); }
    panelTex = new T.CanvasTexture(cv); panelTex.wrapS = panelTex.wrapT = T.RepeatWrapping; return panelTex;
  }

  // Circuit traces: thin right-angled lines that run along each plate, used as an emissive map (green R-7)
  var traceTex = null;
  function traces() {
    if (traceTex) return traceTex;
    var cv = document.createElement('canvas'); cv.width = cv.height = 512; var x = cv.getContext('2d'), s = 7;
    function r() { s = (s * 16807) % 2147483647; return s / 2147483647; }            // seeded: same traces every render
    x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); x.strokeStyle = '#fff'; x.lineWidth = 2.2; x.lineCap = 'square';
    [0.12, 0.37, 0.63, 0.88].forEach(function (u) { x.beginPath(); x.moveTo(u * 512 - 7, 0); x.lineTo(u * 512 - 7, 512); x.stroke(); }); // seam glow beside the panel lines
    for (var i = 0; i < 14; i++) { // traces: run, jog 45 degrees, run, end in a node
      var px = r() * 512, py = r() * 512, len = 40 + r() * 140, dir = r() < 0.5 ? 1 : -1;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px, py + len * 0.5); x.lineTo(px + dir * 18, py + len * 0.5 + 18); x.lineTo(px + dir * 18, py + len); x.stroke();
      x.beginPath(); x.arc(px + dir * 18, py + len, 3.5, 0, 7); x.fillStyle = '#fff'; x.fill();
    }
    traceTex = new T.CanvasTexture(cv); traceTex.wrapS = traceTex.wrapT = T.RepeatWrapping; return traceTex;
  }

  // finish: 'r7' (metallic green, made different: default) · 'silver' (the ordinary robots; 'ceramic' is an alias) · 'gold' (R-7 before the upgrade)
  var GREEN = 0x76ff1a; // NVIDIA-style green light (colour only: no marks)
  function mats(eyeColor, finish) {
    finish = finish || 'r7';
    var gold = finish === 'gold', green = finish === 'r7';
    if (green) return {
      ceramic: new T.MeshPhysicalMaterial({ color: 0x0f4a05, metalness: 0.65, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.75, // glossy deep green, clear-coated
        bumpMap: panels(), bumpScale: 0.004, emissive: GREEN, emissiveMap: traces(), emissiveIntensity: 0.9 }),
      ceramicDark: new T.MeshPhysicalMaterial({ color: 0x15181b, metalness: 0.45, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.7 }),
      chrome: new T.MeshStandardMaterial({ color: 0x2a2f33, metalness: 1, roughness: 0.28, envMapIntensity: 0.9 }),
      gunmetal: new T.MeshStandardMaterial({ color: 0x1d2125, metalness: 0.85, roughness: 0.35 }),
      rubber: new T.MeshStandardMaterial({ color: 0x0d0f12, metalness: 0.2, roughness: 0.7 }),
      visor: new T.MeshBasicMaterial({ color: eyeColor, toneMapped: false }),          // the visor band IS the light
      eye: new T.MeshBasicMaterial({ color: eyeColor, toneMapped: false }),
      eyeCore: new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      core: new T.MeshBasicMaterial({ color: eyeColor, toneMapped: false }),
      seam: new T.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.6 }),
      green: true
    };
    return {
      ceramic: gold ? new T.MeshStandardMaterial({ color: 0xcf9a3a, metalness: 1, roughness: 0.3, envMapIntensity: 0.85 })
                    : new T.MeshPhysicalMaterial({ color: 0xeeebe4, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.09, envMapIntensity: 0.7, bumpMap: panels(), bumpScale: 0.0035 }),
      ceramicDark: gold ? new T.MeshStandardMaterial({ color: 0x8c6a32, metalness: 1, roughness: 0.34, envMapIntensity: 0.9 })
                        : new T.MeshPhysicalMaterial({ color: 0x1c1f24, metalness: 0.25, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.6 }),
      chrome: new T.MeshStandardMaterial({ color: 0xc4cbd3, metalness: 1, roughness: 0.16, envMapIntensity: 1.0 }),
      gunmetal: new T.MeshStandardMaterial({ color: 0x23272d, metalness: 0.85, roughness: 0.35 }),
      rubber: new T.MeshStandardMaterial({ color: 0x0d0f12, metalness: 0.2, roughness: 0.7 }),
      visor: new T.MeshPhysicalMaterial({ color: 0x05080c, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4, transparent: true, opacity: 0.86, depthWrite: false }),
      eye: new T.MeshBasicMaterial({ color: eyeColor, toneMapped: false }),
      eyeCore: new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      core: new T.MeshBasicMaterial({ color: eyeColor, toneMapped: false }),
      seam: new T.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6 })
    };
  }

  // Smooth tapered limb shell from a lathe profile (radius r0 at top → r1 at bottom, length L, along -Y).
  function limbShell(r0, r1, L, bulge) {
    var pts = [], n = 14;
    for (var i = 0; i <= n; i++) {
      var k = i / n, r = r0 + (r1 - r0) * k + Math.sin(k * Math.PI) * (bulge || 0);
      pts.push(new T.Vector2(Math.max(0.001, r * (i === 0 || i === n ? 0.82 : 1)), -k * L));
    }
    return new T.LatheGeometry(pts.reverse(), 40);
  }
  // LatheGeometry wants its profile bottom-to-top; ours are written top-to-bottom, which turned every shell inside out
  // (you saw the inner walls through the front). Reverse descending profiles so faces point outward.
  // R-7 (green) limbs: a dark mechanical core with 3 armour plates over it, separated by glowing grooves.
  // Breaks the highlight at every plate edge (the Blender lookdev lesson); other finishes keep one smooth shell.
  function plated(parent, M, r0, r1, L, y0, bulge) {
    if (!M.green) { parent.add(mesh(limbShell(r0, r1, L, bulge), M.ceramic, 0, y0, 0)); return; }
    var core = mesh(new T.CylinderGeometry(r1 * 0.78, r0 * 0.78, L * 0.98, 20), M.ceramicDark, 0, y0 - L / 2, 0); parent.add(core);
    var cuts = [0, 0.36, 0.7, 1], gap = 0.014;
    for (var i = 0; i < 3; i++) {
      var a = cuts[i] * L + (i ? gap / 2 : 0), b = cuts[i + 1] * L - (i < 2 ? gap / 2 : 0);
      var ra = r0 + (r1 - r0) * (a / L), rb = r0 + (r1 - r0) * (b / L);
      parent.add(mesh(limbShell(ra * 1.02, rb * 1.02, b - a, bulge * 0.4 * (b - a) / L), M.ceramic, 0, y0 - a, 0));
      if (i < 2) { var g = mesh(new T.TorusGeometry(rb * 0.97, 0.004, 6, 40), M.eye, 0, y0 - b - gap / 2, 0); g.rotation.x = Math.PI / 2; parent.add(g); }
    }
  }
  function lathe(profile, seg) {
    var pts = profile.map(function (p) { return new T.Vector2(p[0], p[1]); });
    if (pts[0].y > pts[pts.length - 1].y) pts.reverse();
    return new T.LatheGeometry(pts, seg || 56);
  }
  function mesh(g, m, x, y, z) { var o = new T.Mesh(g, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = o.receiveShadow = true; return o; }
  function pivot(parent, x, y, z) { var g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; }

  function create(opts) {
    opts = opts || {};
    var finish = opts.finish === 'ceramic' ? 'silver' : (opts.finish || 'r7'), eyeDefault = finish === 'r7' ? GREEN : 0x7ff6ff;
    var M = mats(opts.eye != null ? opts.eye : eyeDefault, finish), J = {};
    if (opts.envMap) Object.keys(M).forEach(function (k) { if (M[k].isMeshStandardMaterial) { M[k].envMap = opts.envMap; M[k].needsUpdate = true; } });
    var root = new T.Group(); root.name = 'R-7'; var bot0 = null;

    /* pelvis + spine */
    J.pelvis = pivot(root, 0, 1.77, 0); // soles rest on y = 0 (was 1.62: feet sank ~5 cm into every floor)
    var pelvis = mesh(lathe([[0.001, 0.12], [0.24, 0.1], [0.3, 0.0], [0.27, -0.12], [0.16, -0.2], [0.001, -0.22]]), M.ceramic);
    pelvis.scale.set(1.25, 1, 0.82); J.pelvis.add(pelvis);
    var belt = mesh(new T.TorusGeometry(0.29, 0.022, 10, 56), M.ceramicDark, 0, 0.06, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1.25, 0.82, 1); J.pelvis.add(belt);
    J.spine = pivot(J.pelvis, 0, 0.12, 0);
    J.spine.add(mesh(new T.CylinderGeometry(0.09, 0.11, 0.36, 24), M.chrome, 0, 0.16, -0.02));
    for (var i = 0; i < 5; i++) { // exposed vertebrae: thin graphite discs
      var dr = 0.15 - Math.abs(i - 2) * 0.008, disc = mesh(new T.CylinderGeometry(dr, dr, 0.032, 32), M.ceramicDark, 0, 0.03 + i * 0.065, -0.01);
      disc.scale.set(1.2, 1, 0.82); J.spine.add(disc);
    }
    [-1, 1].forEach(function (s) { // side pistons, pelvis to ribcage
      J.spine.add(mesh(new T.CylinderGeometry(0.026, 0.026, 0.2, 14), M.ceramicDark, s * 0.2, 0.08, 0.02));
      J.spine.add(mesh(new T.CylinderGeometry(0.014, 0.014, 0.22, 10), M.chrome, s * 0.2, 0.24, 0.02));
    });

    /* chest */
    J.chest = pivot(J.spine, 0, 0.34, 0);
    var chest = mesh(lathe([[0.001, 0.8], [0.22, 0.79], [0.41, 0.73], [0.5, 0.6], [0.48, 0.42], [0.4, 0.22], [0.3, 0.06], [0.24, 0.0], [0.001, -0.01]]), M.ceramic);
    chest.scale.set(1.08, 1, 0.62); J.chest.add(chest);
    // pectoral seam + sternum channel
    var seam = mesh(new T.TorusGeometry(0.36, 0.006, 6, 64, Math.PI), M.seam, 0, 0.5, 0.0); seam.scale.set(1.18, 0.55, 0.66); seam.rotation.x = 0.1; seam.position.z = 0.04; J.chest.add(seam);
    var stern = mesh(new T.BoxGeometry(0.012, 0.42, 0.02), M.seam, 0, 0.36, 0.335); J.chest.add(stern);
    // chest core: chrome bezel + glow
    var bezel = mesh(new T.TorusGeometry(0.075, 0.022, 16, 48), M.chrome, 0, 0.42, 0.318); J.chest.add(bezel);
    J.core = mesh(new T.CircleGeometry(0.06, 40), M.core, 0, 0.42, 0.322); J.chest.add(J.core);
    // collar and trapezius plates
    var collar = mesh(new T.TorusGeometry(0.165, 0.022, 14, 48), M.ceramicDark, 0, 0.78, 0); collar.rotation.x = Math.PI / 2; J.chest.add(collar);
    // lower ribcage: a graphite band where the shell tucks in above the spine
    var band = mesh(new T.TorusGeometry(0.3, 0.02, 10, 56), M.ceramicDark, 0, 0.1, 0); band.rotation.x = Math.PI / 2; band.scale.set(1.08, 0.64, 1); J.chest.add(band);
    [-1, 1].forEach(function (s) {
      var trap = mesh(new T.SphereGeometry(0.17, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.ceramicDark, s * 0.26, 0.7, -0.02);
      trap.scale.set(1.3, 0.45, 0.9); trap.rotation.z = -s * 0.35; J.chest.add(trap);
    });

    /* neck: chrome segments + cables */
    J.neck = pivot(J.chest, 0, 0.8, 0);
    J.neck.add(mesh(new T.CylinderGeometry(0.075, 0.09, 0.2, 24), M.chrome, 0, 0.08, 0));
    for (var n = 0; n < 3; n++) { // gimbal discs, each with a status light ring
      var nr = mesh(new T.TorusGeometry(0.085, 0.016, 10, 32), M.gunmetal, 0, 0.02 + n * 0.06, 0); nr.rotation.x = Math.PI / 2; J.neck.add(nr);
      var lr = mesh(new T.TorusGeometry(0.104, 0.005, 6, 40), M.eye, 0, 0.02 + n * 0.06, 0); lr.rotation.x = Math.PI / 2; J.neck.add(lr); (J.neckRings = J.neckRings || []).push(lr);
    }
    [-1, 1].forEach(function (s) {
      var curve = new T.CatmullRomCurve3([new T.Vector3(s * 0.12, -0.08, -0.02), new T.Vector3(s * 0.11, 0.08, 0.02), new T.Vector3(s * 0.08, 0.22, 0.0)]);
      J.neck.add(mesh(new T.TubeGeometry(curve, 16, 0.018, 8, false), M.rubber));
    });

    /* head */
    J.head = pivot(J.neck, 0, 0.18, 0); J.head.scale.setScalar(0.86);
    // cranium (set back) + a protruding face mask whose rim reads as a panel line
    var skull = mesh(new T.SphereGeometry(0.285, 64, 48), M.green ? M.ceramic : M.ceramicDark, 0, 0.29, -0.02); // green R-7: the whole helmet is green skull.scale.set(0.9, 1.05, 1.0); J.head.add(skull);
    if (!skull.parent) J.head.add(skull);
    skull.scale.set(0.92, 1.06, 1.0); // one smooth dome
    var cap = mesh(new T.SphereGeometry(0.292, 64, 32, 0, Math.PI * 2, 0, 1.15), M.ceramic, 0, 0.29, -0.02); cap.scale.set(0.9, 1.05, 1.0); J.head.add(cap); cap.visible = false; // its rim stood proud of the helmet and read as a jagged brim
    var mask = mesh(new T.SphereGeometry(0.29, 64, 48, Math.PI / 2 - 1.05, 2.1, 0.95, 1.55), M.ceramic, 0, 0.27, 0.0); mask.scale.set(0.82, 1.03, 0.98); J.head.add(mask);
    var jaw = mesh(lathe([[0.001, 0.0], [0.13, 0.015], [0.19, 0.08], [0.215, 0.17], [0.001, 0.2]], 48), M.ceramic, 0, 0.03, 0.035); jaw.scale.set(0.95, 1, 0.95); J.head.add(jaw);
    // brow ridge, nose ridge, cheekbones
    var brow = mesh(new T.TorusGeometry(0.235, 0.014, 10, 48, 1.5), M.ceramic, 0, 0.2, 0.0); brow.rotation.set(0, 0, Math.PI / 2 - 0.75); brow.position.set(0, 0.06, 0.07); brow.scale.set(1, 1, 1);
    var browWrap = pivot(J.head, 0, 0.27, 0.035); browWrap.rotation.x = -1.32; browWrap.add(brow); brow.position.set(0, 0, 0); brow.visible = false; // its arc poked through the helmet as a jagged notch
    // sagittal seam over the cranium
    var sag = mesh(new T.TorusGeometry(0.296, 0.0035, 6, 80, Math.PI * 0.9), M.seam, 0, 0.29, -0.02); sag.rotation.set(0, Math.PI / 2, Math.PI * 0.55); sag.scale.set(1.05, 0.9, 1); J.head.add(sag);
    // visor: a wraparound shield of smoked glass from brow to cheekbone; the eyes glow through it
    var visor = M.green ? mesh(new T.SphereGeometry(0.293, 64, 8, Math.PI / 2 - 0.95, 1.9, 1.43, 0.13), M.visor, 0, 0.27, 0.03)
                        : mesh(new T.SphereGeometry(0.291, 64, 16, Math.PI / 2 - 0.9, 1.8, 1.28, 0.42), M.visor, 0, 0.27, 0.03);
    visor.scale.set(0.86, 1.08, 1.05); visor.renderOrder = 2; J.head.add(visor); J.visor = visor;
    if (M.green) { // helmet seam split down the middle, and a dark recess the band sits in
      var crest = mesh(new T.TorusGeometry(0.297, 0.006, 6, 80, Math.PI * 0.95), M.seam, 0, 0.29, -0.02); crest.rotation.set(0, Math.PI / 2, Math.PI * 0.52); crest.scale.set(1.05, 0.9, 1); J.head.add(crest);
      var recess = mesh(new T.SphereGeometry(0.289, 64, 8, Math.PI / 2 - 1.0, 2.0, 1.39, 0.21), M.ceramicDark, 0, 0.27, 0.03); recess.scale.set(0.86, 1.08, 1.05); J.head.add(recess);
    }
    [-1, 1].forEach(function (s) { var fs = mesh(new T.BoxGeometry(0.004, 0.11, 0.01), M.seam, s * 0.135, 0.16, 0.225); fs.rotation.set(-0.35, s * 0.55, s * 0.12); J.head.add(fs); });
    var voc = mesh(new T.BoxGeometry(0.075, 0.012, 0.03), M.ceramicDark, 0, 0.115, 0.255); voc.rotation.x = -0.4; J.head.add(voc);
    var jawSeam = mesh(new T.TorusGeometry(0.205, 0.0035, 6, 48, 2.2), M.seam, 0, 0.13, 0.04); jawSeam.rotation.set(Math.PI / 2, 0, -Math.PI / 2 - 1.1); J.head.add(jawSeam);
    // eyes: elongated glows with hot cores
    J.eyes = [];
    [-1, 1].forEach(function (s) {
      var e = mesh(new T.SphereGeometry(1, 24, 12), M.eye, s * 0.085, 0.292, 0.318); e.scale.set(0.048, 0.012, 0.008); e.rotation.y = s * 0.28; e.rotation.z = s * -0.06; J.head.add(e); J.eyes.push(e);
      var c = mesh(new T.SphereGeometry(1, 16, 8), M.eyeCore, s * 0.085, 0.292, 0.325); c.scale.set(0.018, 0.0045, 0.004); c.rotation.y = s * 0.28; J.head.add(c);
    });
    // ear pods: graphite drums with a thin light ring that follows the eye colour
    [-1, 1].forEach(function (s) {
      var ear = mesh(new T.CylinderGeometry(0.07, 0.078, 0.05, 40), M.ceramicDark, s * 0.255, 0.25, -0.01); ear.rotation.z = Math.PI / 2; J.head.add(ear);
      var er = mesh(new T.TorusGeometry(0.052, 0.005, 8, 40), M.eye, s * 0.282, 0.25, -0.01); er.rotation.y = Math.PI / 2; J.head.add(er);
      var cap = mesh(new T.CircleGeometry(0.04, 32), M.chrome, s * 0.281, 0.25, -0.01); cap.rotation.y = s * Math.PI / 2; J.head.add(cap);
    });
    // serial on the chest plate (film 1's script calls for it)
    var sc = document.createElement('canvas'); sc.width = 128; sc.height = 64; var sx = sc.getContext('2d');
    sx.fillStyle = '#3a3e45'; sx.font = 'bold 44px Oswald, Impact, sans-serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillText('R-7', 64, 34);
    var stex = new T.CanvasTexture(sc); stex.encoding = T.sRGBEncoding;
    var serial = mesh(new T.PlaneGeometry(0.11, 0.055), new T.MeshStandardMaterial({ map: stex, transparent: true, roughness: 0.5 }), 0.2, 0.6, 0.292); serial.rotation.y = 0.32; J.chest.add(serial);

    /* arms */
    function arm(side) {
      var s = side === 'L' ? -1 : 1, A = {};
      A.shoulder = pivot(J.chest, s * 0.56, 0.64, -0.02);
      A.shoulder.add(mesh(new T.SphereGeometry(0.115, 32, 24), M.ceramicDark));
      var sr = mesh(new T.TorusGeometry(0.1, 0.004, 6, 40), M.eye, s * 0.075, 0, 0); sr.rotation.y = Math.PI / 2; A.shoulder.add(sr);
      var paul = mesh(new T.SphereGeometry(0.135, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), M.ceramic, s * 0.03, 0.03, 0); paul.scale.set(1.05, 0.9, 1.0); paul.rotation.z = -s * 0.5; A.shoulder.add(paul);
      plated(A.shoulder, M, 0.1, 0.085, 0.56, -0.08, 0.012);
      A.elbow = pivot(A.shoulder, 0, -0.66, 0);
      var eh = mesh(new T.CylinderGeometry(0.068, 0.068, 0.15, 24), M.ceramicDark); eh.rotation.z = Math.PI / 2; A.elbow.add(eh); // hinge
      [-1, 1].forEach(function (k) { var c = mesh(new T.CylinderGeometry(0.045, 0.045, 0.012, 24), M.chrome, k * 0.08, 0, 0); c.rotation.z = Math.PI / 2; A.elbow.add(c);
        var gl = mesh(new T.TorusGeometry(0.046, 0.0035, 6, 32), M.eye, k * 0.087, 0, 0); gl.rotation.y = Math.PI / 2; A.elbow.add(gl); });
      plated(A.elbow, M, 0.082, 0.062, 0.5, -0.06, 0.01);
      A.wrist = pivot(A.elbow, 0, -0.6, 0);
      A.wrist.add(mesh(new T.SphereGeometry(0.046, 16, 12), M.chrome));
      var wr = mesh(new T.TorusGeometry(0.047, 0.003, 6, 32), M.eye, 0, 0.0, 0); wr.rotation.x = Math.PI / 2; A.wrist.add(wr);
      var palm = mesh(new T.SphereGeometry(0.07, 24, 16), M.ceramicDark, 0, -0.075, 0); palm.scale.set(0.82, 0.95, 0.42); A.wrist.add(palm);
      for (var f = 0; f < 3; f++) { // three two-segment fingers with knuckles (and a thumb below); grip curls both segments
        var fg = pivot(A.wrist, -0.03 + f * 0.03, -0.13, 0);
        fg.add(mesh(new T.SphereGeometry(0.012, 10, 8), M.chrome));
        fg.add(mesh(new T.CylinderGeometry(0.0125, 0.011, 0.045, 8), M.ceramicDark, 0, -0.025, 0));
        var tip = pivot(fg, 0, -0.05, 0); tip.add(mesh(new T.CylinderGeometry(0.011, 0.008, 0.04, 8), M.ceramicDark, 0, -0.02, 0));
        fg.rotation.x = 0.25; fg.userData.tip = tip; A['f' + f] = fg;
      }
      var th = pivot(A.wrist, s * -0.052, -0.06, 0.02); th.rotation.z = s * 0.6; th.add(mesh(new T.CylinderGeometry(0.011, 0.009, 0.06, 8), M.ceramicDark, 0, -0.03, 0));
      return A;
    }
    J.armL = arm('L'); J.armR = arm('R');

    /* legs */
    function leg(side) {
      var s = side === 'L' ? -1 : 1, L = {};
      L.hip = pivot(J.pelvis, s * 0.17, -0.12, 0);
      L.hip.add(mesh(new T.SphereGeometry(0.06, 24, 16), M.ceramicDark));
      plated(L.hip, M, 0.135, 0.1, 0.72, -0.06, 0.02);
      L.knee = pivot(L.hip, 0, -0.8, 0);
      var kh = mesh(new T.CylinderGeometry(0.074, 0.074, 0.17, 24), M.ceramicDark); kh.rotation.z = Math.PI / 2; L.knee.add(kh); // hinge
      [-1, 1].forEach(function (k) { var c = mesh(new T.CylinderGeometry(0.05, 0.05, 0.012, 24), M.chrome, k * 0.09, 0, 0); c.rotation.z = Math.PI / 2; L.knee.add(c);
        var gl = mesh(new T.TorusGeometry(0.051, 0.0035, 6, 32), M.eye, k * 0.097, 0, 0); gl.rotation.y = Math.PI / 2; L.knee.add(gl); });
      var cap = mesh(new T.SphereGeometry(0.075, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.ceramic, 0, 0.0, 0.05); cap.rotation.x = Math.PI / 2; J.knee = cap; L.knee.add(cap);
      plated(L.knee, M, 0.1, 0.065, 0.66, -0.06, 0.015);
      L.ankle = pivot(L.knee, 0, -0.74, 0);
      L.ankle.add(mesh(new T.SphereGeometry(0.05, 16, 12), M.chrome));
      var ar = mesh(new T.TorusGeometry(0.052, 0.003, 6, 32), M.eye, 0, 0.0, 0); ar.rotation.x = Math.PI / 2; L.ankle.add(ar);
      if (M.green) {
        var shoe = mesh(new T.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.ceramic, 0, -0.1, 0.07); shoe.scale.set(0.078, 0.078, 0.2); L.ankle.add(shoe);
        L.ankle.add(mesh(new T.BoxGeometry(0.14, 0.022, 0.34), M.rubber, 0, -0.108, 0.07));
        var sg = mesh(new T.BoxGeometry(0.142, 0.004, 0.3), M.eye, 0, -0.095, 0.07); L.ankle.add(sg);
        [-1, 1].forEach(function (k) { var d = mesh(new T.CylinderGeometry(0.036, 0.036, 0.014, 24), M.ceramicDark, k * 0.058, 0, 0); d.rotation.z = Math.PI / 2; L.ankle.add(d);
          var dg = mesh(new T.TorusGeometry(0.024, 0.003, 6, 24), M.eye, k * 0.066, 0, 0); dg.rotation.y = Math.PI / 2; L.ankle.add(dg); });
      } else {
        var foot = mesh(new T.BoxGeometry(0.13, 0.07, 0.3), M.ceramic, 0, -0.07, 0.07); L.ankle.add(foot);
        L.ankle.add(mesh(new T.BoxGeometry(0.135, 0.02, 0.31), M.rubber, 0, -0.105, 0.07));
      }
      return L;
    }
    J.legL = leg('L'); J.legR = leg('R');
    if (M.green) { // R-7 proportions: athletic humanoid (narrower V-chest, shorter waist, arms close to the body, bigger feet)
      J.chest.children.forEach(function (c) { if (c.isMesh) { c.position.x *= 0.8; c.position.z *= 0.8; c.scale.x *= 0.8; c.scale.z *= 0.82; } });
      J.chest.position.y = 0.24;                                   // shorter exposed waist
      J.neck.position.y = 0.75; J.head.scale.setScalar(0.94);
      [J.armL, J.armR].forEach(function (A) { A.shoulder.position.x *= 0.8; A.shoulder.position.y = 0.6; });
      J.pelvis.children.forEach(function (c) { if (c.isMesh) { c.scale.x *= 0.88; c.scale.y *= 1.25; } });
      [J.legL, J.legR].forEach(function (L) { L.hip.position.x *= 0.92; });
      bot0 = { chestY: J.chest.position.y };
    }

    var bot = {
      root: root, joints: J, materials: M,
      setEye: function (hex, intensity) {
        M.eye.color.setHex(hex); M.core.color.setHex(hex);
        if (M.green) { M.visor.color.setHex(hex); M.ceramic.emissive.setHex(hex); M.ceramic.emissiveIntensity = 0.9 * (intensity == null ? 1 : intensity); }
        var k = intensity == null ? 1 : intensity; M.eye.color.multiplyScalar(1.15 * k); M.core.color.multiplyScalar(1.1 * k);
        M.eyeCore.color.setScalar(Math.min(1, 0.4 + k * 0.6));
      },
      // Angles in radians. arm: { shoulder:[x,y,z], elbow, wrist:[x,y,z], grip }  leg: { hip:[x,y,z], knee, ankle }
      pose: function (p) {
        p = p || {};
        J.head.rotation.set(p.headPitch || 0, p.headYaw || 0, p.headRoll || 0);
        J.neck.rotation.set((p.headPitch || 0) * 0.3, (p.headYaw || 0) * 0.25, 0);
        J.chest.rotation.set(p.chestPitch || 0, p.chestYaw || 0, p.chestRoll || 0);
        J.spine.rotation.set(p.spinePitch || 0, 0, 0);
        J.pelvis.rotation.set(0, p.hipYaw || 0, 0);
        J.pelvis.position.y = 1.77 + (p.lift || 0);
        ['L', 'R'].forEach(function (s) {
          var a = p['arm' + s] || {}, A = J['arm' + s], sg = s === 'L' ? -1 : 1, sh = a.shoulder || [0, 0, 0.12 * sg];
          A.shoulder.rotation.set(sh[0], sh[1], sh[2]);
          A.elbow.rotation.set(a.elbow || -0.15, 0, 0);
          var w = a.wrist || [0, 0, 0]; A.wrist.rotation.set(w[0], w[1], w[2]);
          var gr = a.grip == null ? 0.25 : a.grip; for (var f = 0; A['f' + f]; f++) { A['f' + f].rotation.x = gr; A['f' + f].userData.tip.rotation.x = gr * 1.2; }
          var l = p['leg' + s] || {}, L = J['leg' + s], hp = l.hip || [0, 0, 0.03 * sg];
          L.hip.rotation.set(hp[0], hp[1], hp[2]); L.knee.rotation.set(l.knee || 0, 0, 0); L.ankle.rotation.set(l.ankle || 0, 0, 0);
        });
      },
      // "Alive but still": call after pose()/walk() each frame. Deterministic in t.
      // o: { visor: 0..1 base brightness, pulse: Hz of the chest core (0.8 idle, 2.5 alarm), jitter: 0..1 servo micro-motion }
      idle: function (t, o) {
        o = o || {}; var base = o.visor == null ? 1 : o.visor, hz = o.pulse == null ? 0.8 : o.pulse, jit = o.jitter == null ? 1 : o.jitter;
        var beat = Math.pow(Math.max(0, Math.sin(t * hz * Math.PI * 2)), 6);                       // heartbeat-shaped thump
        if (J.visor && M.green) J.visor.material.color.copy(M.eye.color).multiplyScalar(base * (0.88 + 0.12 * Math.sin(t * 1.3)));
        J.core.scale.setScalar(1 + beat * 0.12);
        (J.neckRings || []).forEach(function (r, i) { r.rotation.z = t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1); });
        ['L', 'R'].forEach(function (sd, i) { J['arm' + sd].elbow.rotation.x += jit * 0.004 * Math.sin(t * 23 + i * 1.7) * Math.sin(t * 0.7 + i); });
      },
      // A procedural walk: phase in radians.
      walk: function (phase, stride, extra) {
        var s = stride == null ? 0.45 : stride, sin = Math.sin(phase), cos = Math.cos(phase);
        var p = Object.assign({
          lift: Math.abs(cos) * 0.025 - 0.02, hipYaw: sin * 0.06, chestYaw: -sin * 0.08,
          armL: { shoulder: [sin * s * 0.8, 0, -0.1], elbow: -0.25 - Math.max(0, sin) * 0.35 },
          armR: { shoulder: [-sin * s * 0.8, 0, 0.1], elbow: -0.25 - Math.max(0, -sin) * 0.35 },
          legL: { hip: [-sin * s, 0, -0.03], knee: Math.max(0, cos) * s * 1.4, ankle: sin * 0.15 },
          legR: { hip: [sin * s, 0, 0.03], knee: Math.max(0, -cos) * s * 1.4, ankle: -sin * 0.15 }
        }, extra || {});
        bot.pose(p);
      }
    };
    bot.setEye(opts.eye != null ? opts.eye : eyeDefault, 1);
    bot.pose({});
    return bot;
  }

  // Studio lighting environment for reflections (no network: generated in-scene).
  function studio(renderer) {
    if (!T.RoomEnvironment) return null;
    var pm = new T.PMREMGenerator(renderer);
    var env = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    pm.dispose(); return env;
  }

  window.AsimovRobot = { create: create, studio: studio };
})();
