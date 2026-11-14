/* samite-press.js — "the press": Samite's signature element.
 * Draws any white-on-black source (logo, wordmark, photo, light field) as a print screen of cream dots, squares or
 * ordered-dither pixels, and animates it with a deterministic "bloom" schedule (ink → bloom → dim → scatter → blob → ink),
 * the way a print breathes under light. Canvas 2D, no dependencies, a pure function of time (press.seek(t)).
 *
 *   const press = SamitePress(canvas, {
 *     source(ctx, w, h) { ... draw white shapes on black, in CSS px ... },
 *     cell: 9,                   // CSS px per screen cell
 *     shape: 'dot',              // 'dot' (halftone) | 'square' (Park) | 'bayer' (TRACE dither)
 *     schedule: 'cycle',         // 'cycle' (placeholder) | 'breathe' (hero) | 'still'
 *     period: 6.4,               // seconds per cycle
 *     bloom: 1,                  // scales the glow; < 1 keeps holes and edges readable
 *     overlay(ctx, t, api) {},   // draw reticles/labels on top, CSS px; api.sample(x, y) → 0..1 brightness
 *   });
 *   press.start(); press.stop(); press.seek(t); press.layout();
 */
(function (root) {
  'use strict';
  const INK = '#F2EFE8';
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

  // separable box blur, 3 passes ≈ gaussian; r in cells
  function blur(src, w, h, r) {
    if (r < 1) return src.slice();
    let a = src.slice(), b = new Float32Array(src.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {           // horizontal
        let acc = 0, o = y * w;
        for (let x = -r; x <= r; x++) acc += a[o + clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          b[o + x] = acc / (2 * r + 1);
          acc += a[o + clamp(x + r + 1, 0, w - 1)] - a[o + clamp(x - r, 0, w - 1)];
        }
      }
      for (let x = 0; x < w; x++) {           // vertical
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          a[y * w + x] = acc / (2 * r + 1);
          acc += b[clamp(y + r + 1, 0, h - 1) * w + x] - b[clamp(y - r, 0, h - 1) * w + x];
        }
      }
    }
    return a;
  }

  // keyframes of the 'cycle' schedule (phase 0..1): sharp, glow, wide weights, gain, threshold, scatter
  const CYCLE = [
    [0.00, { a: 1, b: .30, c: 0, gain: 1.7, th: .02, sc: 0 }],   // ink: crisp letters, a fringe of small dots
    [0.16, { a: 1, b: .30, c: 0, gain: 1.7, th: .02, sc: 0 }],
    [0.30, { a: .8, b: .9, c: .55, gain: 1.35, th: .04, sc: 0 }],  // bloom: glow spreads into big dots
    [0.40, { a: .8, b: .9, c: .55, gain: 1.2, th: .04, sc: 0 }],
    [0.50, { a: .6, b: .8, c: .5, gain: .5, th: 0, sc: 0 }],      // dim: dots shrink to a faint screen
    [0.58, { a: .8, b: .5, c: .2, gain: 1.1, th: .05, sc: .85 }], // scatter: dots fly off and drop out
    [0.66, { a: 1, b: .45, c: 0, gain: 2.4, th: .22, sc: 0 }],    // blob: chunky merged dots, an outline look
    [0.80, { a: 1, b: .45, c: 0, gain: 2.4, th: .22, sc: 0 }],
    [0.92, { a: 1, b: .30, c: 0, gain: 1.7, th: .02, sc: 0 }],
    [1.00, { a: 1, b: .30, c: 0, gain: 1.7, th: .02, sc: 0 }],
  ];
  function cycleAt(p) {
    for (let k = 1; k < CYCLE.length; k++) {
      const [p1, v1] = CYCLE[k], [p0, v0] = CYCLE[k - 1];
      if (p <= p1) {
        const u = smooth(p0, p1, p), o = {};
        for (const key in v0) o[key] = v0[key] + (v1[key] - v0[key]) * u;
        return o;
      }
    }
    return CYCLE[0][1];
  }
  function breatheAt(t, period) {
    const s = Math.sin((t / period) * Math.PI * 2), s2 = Math.sin((t / (period * 1.7)) * Math.PI * 2 + 1.3);
    return { a: 1, b: .55 + .25 * s, c: .35 + .2 * s2, gain: 1.25 + .12 * s, th: .03, sc: 0 };
  }

  function SamitePress(canvas, opts) {
    const o = Object.assign({ cell: 9, shape: 'dot', schedule: 'cycle', period: 6.4, ink: INK, gamma: .9, glow: 2, wide: 6,
      intro: 1.2, seed: 7, bloom: 1 }, opts);   // bloom scales the glow terms (b, c) of every schedule
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, cols = 0, rows = 0, S, G, Wd, raf = 0, t0 = 0, running = false, tNow = 0;
    const off = document.createElement('canvas'), octx = off.getContext('2d', { willReadFrequently: true });

    function layout() {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      cols = Math.ceil(W / o.cell); rows = Math.ceil(H / o.cell);
      // draw the source at full size, then average it down to one value per cell
      off.width = Math.round(W); off.height = Math.round(H);
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.fillStyle = '#000'; octx.fillRect(0, 0, off.width, off.height);
      octx.fillStyle = '#fff'; octx.strokeStyle = '#fff';
      o.source(octx, off.width, off.height);
      const small = document.createElement('canvas'); small.width = cols; small.height = rows;
      const sctx = small.getContext('2d', { willReadFrequently: true });
      sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(off, 0, 0, cols * o.cell, rows * o.cell, 0, 0, cols, rows);
      const px = sctx.getImageData(0, 0, cols, rows).data;
      S = new Float32Array(cols * rows);
      for (let i = 0; i < S.length; i++) S[i] = px[i * 4] / 255;
      G = blur(S, cols, rows, o.glow); Wd = blur(S, cols, rows, o.wide);
      draw(tNow);
    }

    function params(t) {
      if (o.schedule === 'still' || matchMedia('(prefers-reduced-motion: reduce)').matches) return { a: 1, b: .45, c: .25, gain: 1.4, th: .03, sc: 0 };
      if (o.schedule === 'breathe') return breatheAt(t, o.period);
      return cycleAt((t % o.period) / o.period);
    }

    function draw(t) {
      tNow = t;
      if (!S) return;
      const p = Object.assign({}, params(t)); p.b *= o.bloom; p.c *= o.bloom;
      const intro = o.intro > 0 && o.schedule !== 'still' ? smooth(0, o.intro, t) : 1;   // the print comes up from nothing on load
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = o.ink;
      ctx.beginPath();
      const c = o.cell, half = c / 2, seedT = Math.floor(t * 12);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          let L = (p.a * S[k] + p.b * G[k] + p.c * Wd[k]) * p.gain * intro - p.th;
          if (L <= 0.02) continue;
          L = Math.pow(Math.min(L, 1.35), o.gamma);
          let x = i * c + half, y = j * c + half;
          if (p.sc > 0.01) {
            const h1 = hash(i, j, o.seed), h2 = hash(i, j, o.seed + 1), h3 = hash(i, j, seedT);
            if (h3 < p.sc * .55) continue;                  // flicker out
            x += (h1 - .5) * p.sc * c * 5; y += (h2 - .5) * p.sc * c * 3 - p.sc * c * 1.5;
          }
          if (o.shape === 'dot') {
            const r = half * 1.12 * Math.sqrt(L);
            ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
          } else if (o.shape === 'square') {
            const s = c * .92 * Math.sqrt(Math.min(L, 1));
            ctx.rect(x - s / 2, y - s / 2, s, s);
          } else {                                          // bayer: on/off pixels, density = brightness
            if (L > BAYER[(j & 3) * 4 + (i & 3)]) { const s = c * .82; ctx.rect(x - s / 2, y - s / 2, s, s); }
          }
        }
      }
      ctx.fill();
      if (o.overlay) o.overlay(ctx, t, api);
    }

    const api = {
      get width() { return W; }, get height() { return H; }, get cell() { return o.cell; },
      sample(x, y) { if (!S) return 0; const i = clamp(Math.floor(x / o.cell), 0, cols - 1), j = clamp(Math.floor(y / o.cell), 0, rows - 1); return S[j * cols + i]; },
      params,
    };

    function frame(now) {
      if (!running) return;
      draw(Math.max(0, (now - t0) / 1000));
      raf = requestAnimationFrame(frame);
    }
    const press = {
      layout, draw, api,
      seek(t) { draw(t); },
      start() { if (o.schedule === 'still') { draw(tNow); return; } if (running) return; running = true; t0 = performance.now() - tNow * 1000; raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
    };
    // pause offscreen and in hidden tabs
    if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => (e.isIntersecting && !document.hidden ? press.start() : press.stop()))).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? press.stop() : press.start()));
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 120); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout); else layout();
    layout();
    return press;
  }
  SamitePress.INK = INK;
  root.SamitePress = SamitePress;
})(typeof window !== 'undefined' ? window : this);
