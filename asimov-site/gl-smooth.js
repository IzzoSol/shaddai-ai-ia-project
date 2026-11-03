/* gl-smooth.js: stops shader compilation from freezing the page.
   Browsers can compile WebGL programs in the background, but only if nothing asks about them too early.
   Each renderer now starts compiling a material the first time it is seen and skips drawing until the
   programs are ready, so a slow GPU delays a picture instead of locking the whole tab. */
(function () {
  'use strict';
  var T = window.THREE; if (!T || !T.WebGLRenderer) return;
  var sync = 0;
  ['fromScene', 'fromEquirectangular', 'fromCubemap'].forEach(function (name) { // environment maps must draw at once
    var fn = T.PMREMGenerator && T.PMREMGenerator.prototype[name]; if (!fn) return;
    T.PMREMGenerator.prototype[name] = function () { sync++; try { return fn.apply(this, arguments); } finally { sync--; } };
  });
  var Base = T.WebGLRenderer;
  T.WebGLRenderer = function (params) {
    var r = new Base(params), gl = r.getContext(), ext = gl.getExtension('KHR_parallel_shader_compile');
    if (!ext) { r.isGLPending = function () { return false; }; return r; }
    r.debug.checkShaderErrors = false;
    var render = r.render.bind(r), compile = r.compile.bind(r), seen = new WeakSet(), done = new WeakSet();
    function pending() {
      var list = r.info.programs || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i].program;
        if (!p || done.has(p)) continue;
        if (!gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR)) return true;
        done.add(p);
      }
      return false;
    }
    r.isGLPending = pending;
    r.render = function (scene, camera) {
      if (sync) return render(scene, camera);
      var fresh = false;
      scene.traverse(function (o) {
        var m = o.material; if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach(function (x) { if (!seen.has(x)) { seen.add(x); fresh = true; } });
      });
      if (fresh) { try { compile(scene, camera); } catch (e) { console.warn(e); } }
      if (pending()) return;
      render(scene, camera);
    };
    return r;
  };
  Object.keys(Base).forEach(function (k) { T.WebGLRenderer[k] = Base[k]; });
})();
