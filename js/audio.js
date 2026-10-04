/* Overgrowth — audio: procedural horror sound design + adaptive score.
   Every sound is synthesised at load (no files needed). Real recordings dropped into
   assets/audio and listed in assets/manifest.json override the synthetic versions by name. */
(function () {
  'use strict';
  const OG = window.OG;
  const A = (OG.audio = { ready: false, buffers: {} });
  let ctx = null, SR = 44100;
  let master, comp, bus = {}, rvOut, rvIn, rvIndoor, rvOutdoor, rvMixIn, rvMixOut, ambFilter, ambGain;
  const buffers = A.buffers;
  const R = Math.random;

  // ---------------- DSP helpers ----------------
  const arr = (dur) => new Float32Array(Math.max(1, Math.round(dur * SR)));
  function coef(type, f, Q, gainDb) {
    f = Math.max(20, Math.min(SR * 0.45, f));
    const w = (2 * Math.PI * f) / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    const Ag = Math.pow(10, (gainDb || 0) / 40);
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = 1 + al * Ag; b1 = -2 * cs; b2 = 1 - al * Ag; a0 = 1 + al / Ag; a1 = -2 * cs; a2 = 1 - al / Ag; }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  function filt(x, type, f, Q = 0.707, g) {
    const c = coef(type, f, Q, g);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i], y0 = c[0] * x0 + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      x[i] = y0;
    }
    return x;
  }
  function filtV(x, type, fFn, Q = 0.707) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c;
    for (let i = 0; i < x.length; i++) {
      if ((i & 31) === 0) c = coef(type, fFn(i / SR), Q);
      const x0 = x[i], y0 = c[0] * x0 + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      x[i] = y0;
    }
    return x;
  }
  const white = (x, amp = 1) => { for (let i = 0; i < x.length; i++) x[i] += (R() * 2 - 1) * amp; return x; };
  function pink(x, amp = 1) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < x.length; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      x[i] += (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * amp;
      b6 = w * 0.115926;
    }
    return x;
  }
  function brown(x, amp = 1) {
    let l = 0;
    for (let i = 0; i < x.length; i++) { l = (l + 0.02 * (R() * 2 - 1)) / 1.02; x[i] += l * 3.5 * amp; }
    return x;
  }
  function envExp(x, attack, tau, start = 0) {
    const a = attack * SR, s = start * SR;
    for (let i = 0; i < x.length; i++) {
      const t = i - s;
      if (t < 0) { x[i] = 0; continue; }
      x[i] *= (t < a ? t / a : 1) * Math.exp(-(t - Math.min(t, a)) / (tau * SR));
    }
    return x;
  }
  function envAD(x, a, d) {
    const n = x.length;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      x[i] *= t < a ? t / a : Math.max(0, 1 - (t - a) / d);
    }
    return x;
  }
  function fadeEdges(x, fi = 0.004, fo = 0.02) {
    const a = fi * SR, b = fo * SR, n = x.length;
    for (let i = 0; i < n; i++) {
      if (i < a) x[i] *= i / a;
      if (n - i < b) x[i] *= (n - i) / b;
    }
    return x;
  }
  function norm(x, peak = 0.9) {
    let m = 1e-6;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    const k = peak / m;
    for (let i = 0; i < x.length; i++) x[i] *= k;
    return x;
  }
  const shape = (x, k) => { const d = Math.tanh(k); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) / d; return x; };
  function mix(dst, src, gain = 1, at = 0) {
    const o = Math.round(at * SR);
    for (let i = 0; i < src.length && i + o < dst.length; i++) if (i + o >= 0) dst[i + o] += src[i] * gain;
    return dst;
  }
  function sine(x, fFn, amp = 1, phase0 = 0) {
    let ph = phase0;
    for (let i = 0; i < x.length; i++) { ph += (2 * Math.PI * fFn(i / SR)) / SR; x[i] += Math.sin(ph) * amp; }
    return x;
  }
  function saw(x, fFn, amp = 1, jitter = 0) {
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      ph += (fFn(i / SR) * (1 + (R() - 0.5) * jitter)) / SR;
      if (ph >= 1) ph -= 1;
      x[i] += (2 * ph - 1) * amp;
    }
    return x;
  }
  function formants(src, fs) {
    const out = new Float32Array(src.length);
    fs.forEach(([f, Q, g]) => {
      const b = filt(Float32Array.from(src), 'bp', f, Q);
      for (let i = 0; i < out.length; i++) out[i] += b[i] * g;
    });
    return out;
  }
  function pluck(freq, dur, damp = 0.996) {
    const n = Math.round(dur * SR), out = new Float32Array(n), N = Math.max(2, Math.round(SR / freq));
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = R() * 2 - 1;
    filt(line, 'lp', 3000, 0.7);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const cur = line[idx], nxt = line[(idx + 1) % N];
      line[idx] = (cur + nxt) * 0.5 * damp;
      out[i] = cur;
      idx = (idx + 1) % N;
    }
    filt(out, 'pk', 220, 1.2, 5);
    filt(out, 'pk', 480, 1.5, 3);
    filt(out, 'lp', 5200, 0.7);
    return fadeEdges(out, 0.002, 0.3);
  }
  function add(name, chans) {
    if (!Array.isArray(chans)) chans = [chans];
    const b = ctx.createBuffer(chans.length, chans[0].length, SR);
    chans.forEach((c, i) => b.copyToChannel(c, i));
    (buffers[name] = buffers[name] || []).push(b);
  }
  // seamless loop: crossfade tail into head
  function loopify(x, xf = 0.5) {
    const n = Math.round(xf * SR), L = x.length - n, out = new Float32Array(L);
    for (let i = 0; i < L; i++) out[i] = x[i];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      out[i] = x[i] * Math.sqrt(t) + x[L + i] * Math.sqrt(1 - t);
    }
    return out;
  }

  // ---------------- sound designs ----------------
  const D = {};
  D.step = (surf, v) => {
    const x = arr(0.26);
    if (surf === 'grass') {
      white(x, 0.8); filt(x, 'hp', 1800, 0.7); filt(x, 'lp', 7000);
      envAD(x, 0.03, 0.18);
      for (let i = 0; i < x.length; i++) x[i] *= 0.6 + 0.4 * Math.sin(i / SR * 90 + v);
    } else if (surf === 'water') {
      white(x, 1); filtV(x, 'lp', (t) => 3500 - t * 9000, 1.4); envExp(x, 0.005, 0.07);
      for (let k = 0; k < 3; k++) { const b = arr(0.05); sine(b, (t) => 700 + k * 300 + t * 6000, 0.3); envExp(b, 0.002, 0.012); mix(x, b, 1, 0.03 + k * 0.03 + R() * 0.02); }
    } else if (surf === 'glass') {
      for (let k = 0; k < 16; k++) { const c = arr(0.012); white(c, 1); filt(c, 'bp', 3500 + R() * 4000, 6); envExp(c, 0.0005, 0.003); mix(x, c, 0.5 + R(), R() * 0.14); }
      const t = arr(0.06); white(t, 0.5); filt(t, 'lp', 400); envExp(t, 0.002, 0.02); mix(x, t);
    } else if (surf === 'metal') {
      sine(x, () => 430 + v * 20, 0.3); sine(x, () => 1130 + v * 40, 0.2); sine(x, () => 2380, 0.1);
      envExp(x, 0.001, 0.06);
      const c = arr(0.02); white(c, 1); filt(c, 'bp', 2500, 2); envExp(c, 0.0005, 0.005); mix(x, c);
    } else {
      const thump = arr(0.08); sine(thump, (t) => 95 - t * 300, 0.9); envExp(thump, 0.002, 0.018); mix(x, thump);
      const n = arr(0.12); white(n, 1);
      const f = surf === 'tile' ? 2600 : surf === 'wood' ? 700 : surf === 'carpet' ? 400 : surf === 'dirt' ? 500 : 1100;
      filt(n, surf === 'carpet' ? 'lp' : 'bp', f, surf === 'tile' ? 3 : 0.9);
      envExp(n, 0.001, surf === 'tile' ? 0.012 : 0.022);
      mix(x, n, surf === 'carpet' ? 0.5 : 0.9);
      if (surf === 'asphalt' || surf === 'concrete' || surf === 'dirt') for (let k = 0; k < 6; k++) { const c = arr(0.006); white(c, 1); filt(c, 'bp', 2500 + R() * 3000, 3); envExp(c, 0.0005, 0.002); mix(x, c, 0.35, 0.01 + R() * 0.07); }
      if (surf === 'wood' && R() < 0.4) { const cr = arr(0.2); for (let k = 0; k < 12; k++) { const c = arr(0.004); white(c, 1); mix(cr, c, 0.5, k * 0.012 + R() * 0.005); } filt(cr, 'bp', 900, 8); mix(x, cr, 0.6, 0.02); }
    }
    return norm(fadeEdges(x), 0.8);
  };

  D.clicker = () => {
    const dur = 0.5 + R() * 0.9, x = arr(dur + 0.1), exc = arr(dur + 0.1);
    let t = 0.01, gap = 0.028 + R() * 0.03;
    while (t < dur) {
      const k = Math.round(t * SR), len = Math.round((0.002 + R() * 0.004) * SR), a = 0.5 + R() * 0.5;
      for (let i = 0; i < len && k + i < exc.length; i++) exc[k + i] += (R() * 2 - 1) * a * (1 - i / len);
      t += gap * (0.7 + R() * 0.7);
      gap = OG.clamp(gap + (R() - 0.52) * 0.012, 0.018, 0.075);
    }
    const f1 = 1100 + R() * 400, f2 = 2300 + R() * 500, f3 = 3500 + R() * 600;
    const out = formants(exc, [[f1, 9, 1.4], [f2, 11, 1], [f3, 13, 0.7], [600, 3, 0.4]]);
    mix(x, out);
    // wet glottal croak underneath
    const g = arr(dur);
    saw(g, (tt) => 38 + 12 * Math.sin(tt * 9), 0.5, 0.4);
    white(g, 0.25);
    const gf = formants(g, [[420, 4, 1], [900, 5, 0.6]]);
    for (let i = 0; i < gf.length; i++) gf[i] *= 0.5 + 0.5 * Math.sin((i / SR) * 2 * Math.PI * (22 + R() * 0.1));
    envAD(gf, 0.1, dur);
    mix(x, gf, 0.35);
    return norm(fadeEdges(shape(x, 1.6)), 0.85);
  };
  D.clickerScream = () => {
    const d = 1.3, x = arr(d);
    saw(x, (t) => 300 + 240 * Math.sin(Math.min(t, 0.6) / 0.6 * Math.PI) + (R() - 0.5) * 60, 1, 0.25);
    white(x, 0.6);
    let y = formants(x, [[850, 5, 1], [1350, 6, 0.8], [2700, 8, 0.6], [3900, 8, 0.4]]);
    // rattling click AM
    for (let i = 0; i < y.length; i++) y[i] *= 0.55 + 0.45 * Math.sign(Math.sin((i / SR) * 2 * Math.PI * 34));
    envAD(y, 0.04, d - 0.04);
    return norm(fadeEdges(shape(y, 3)), 0.9);
  };
  D.runnerMoan = () => {
    const d = 1.2 + R() * 1.4, x = arr(d), f0 = 110 + R() * 90, vib = 3 + R() * 4;
    saw(x, (t) => f0 * (1 + 0.25 * Math.sin(t * vib) - 0.3 * (t / d)), 0.8, 0.12);
    white(x, 0.35);
    const vowels = [[[650, 5, 1], [1080, 6, 0.6], [2650, 8, 0.25]], [[450, 5, 1], [800, 6, 0.6], [2600, 8, 0.2]], [[380, 5, 1], [950, 6, 0.4], [2400, 8, 0.2]]];
    let y = formants(x, OG.pick(vowels));
    const sob = 4 + R() * 5;
    for (let i = 0; i < y.length; i++) y[i] *= 0.45 + 0.55 * Math.abs(Math.sin((i / SR) * sob));
    envAD(y, 0.15, d - 0.15);
    return norm(fadeEdges(shape(y, 1.8)), 0.8);
  };
  D.runnerScream = () => {
    const d = 1.1 + R() * 0.5, x = arr(d);
    saw(x, (t) => 420 + 520 * Math.exp(-Math.pow((t - 0.25) / 0.3, 2)) + 90 * Math.sin(t * 40), 1, 0.2);
    white(x, 0.8);
    const y = formants(x, [[900, 4, 1], [1500, 5, 0.9], [2900, 6, 0.6], [4200, 8, 0.35]]);
    envAD(y, 0.03, d - 0.03);
    return norm(fadeEdges(shape(y, 4)), 0.92);
  };
  D.growl = (f0, d) => {
    const x = arr(d);
    saw(x, (t) => f0 * (1 + 0.15 * Math.sin(t * 7)), 1, 0.35);
    saw(x, (t) => f0 * 0.5, 0.5, 0.4);
    white(x, 0.5);
    const y = formants(x, [[380, 3, 1], [760, 4, 0.7], [1700, 6, 0.25]]);
    envAD(y, 0.08, d - 0.08);
    return norm(fadeEdges(shape(y, 2.5)), 0.9);
  };
  D.breath = (inhale, d = 0.6, f = 1400) => {
    const x = arr(d);
    white(x, 1); filt(x, 'bp', f, 0.8); filt(x, 'lp', 4200);
    for (let i = 0; i < x.length; i++) { const t = i / x.length; x[i] *= inhale ? Math.sin(t * Math.PI) * (0.6 + 0.4 * t) : Math.sin(t * Math.PI) * (1 - 0.5 * t); }
    return norm(x, 0.6);
  };
  D.grunt = (f0, d) => {
    const x = arr(d);
    saw(x, (t) => f0 * (1 - t * 0.6), 1, 0.08);
    white(x, 0.2);
    const y = formants(x, [[500, 5, 1], [1000, 6, 0.5], [2400, 8, 0.2]]);
    envAD(y, 0.02, d - 0.02);
    return norm(fadeEdges(shape(y, 2)), 0.8);
  };
  D.gunshot = (big) => {
    const d = big ? 1.6 : 1.2, x = arr(d);
    const crack = arr(0.03); white(crack, 1); filt(crack, 'hp', 1500); envExp(crack, 0.0003, 0.004); mix(x, crack, 1.2);
    const body = arr(0.4); white(body, 1); filtV(body, 'lp', (t) => 6000 * Math.exp(-t * 18) + 300, 0.8); envExp(body, 0.0008, big ? 0.07 : 0.045); mix(x, body, 1.3);
    const boom = arr(0.6); sine(boom, (t) => (big ? 55 : 70) * Math.exp(-t * 3) + 30, 1); envExp(boom, 0.001, big ? 0.16 : 0.1); mix(x, boom, 1.1);
    const tail = arr(d); brown(tail, 1); filt(tail, 'lp', 700); envExp(tail, 0.01, big ? 0.5 : 0.35); mix(x, tail, 0.5);
    return norm(shape(x, 2.2), 0.98);
  };
  D.click = (f = 2400, d = 0.05) => { const x = arr(d); white(x, 1); filt(x, 'bp', f, 5); envExp(x, 0.0005, 0.006); sine(x, () => f * 0.6, 0.15); envExp(x, 0.0005, 0.012); return norm(x, 0.7); };
  D.twang = () => { const x = pluck(98, 0.8, 0.985); const w = arr(0.25); white(w, 1); filtV(w, 'bp', (t) => 2500 - t * 7000, 1.5); envExp(w, 0.002, 0.06); mix(x, w, 0.5); return norm(x, 0.85); };
  D.creak = (d = 1.2, fBase = 700, rough = 1) => {
    const x = arr(d), exc = arr(d);
    let t = 0;
    while (t < d) { const k = Math.round(t * SR); if (k < exc.length) exc[k] = (R() * 2 - 1) * (0.5 + R() * 0.5); t += 0.004 + R() * 0.018 * rough; }
    const y = arr(d);
    mix(y, filtV(Float32Array.from(exc), 'bp', (tt) => fBase + 400 * Math.sin(tt * 2.2), 14), 1);
    mix(y, filtV(Float32Array.from(exc), 'bp', (tt) => fBase * 2.3 + 500 * Math.sin(tt * 1.7), 18), 0.6);
    envAD(y, 0.1, d - 0.1);
    mix(x, y);
    return norm(fadeEdges(x), 0.8);
  };
  D.thud = (f = 80, d = 0.35) => { const x = arr(d); sine(x, (t) => f * Math.exp(-t * 4) + 30, 1); envExp(x, 0.002, d * 0.25); const n = arr(0.08); white(n, 1); filt(n, 'lp', 900); envExp(n, 0.001, 0.02); mix(x, n, 0.7); return norm(x, 0.9); };
  D.shatter = () => {
    const x = arr(1.1);
    const hit = arr(0.05); white(hit, 1); filt(hit, 'hp', 2000); envExp(hit, 0.0005, 0.01); mix(x, hit, 1.2);
    for (let k = 0; k < 60; k++) {
      const s = arr(0.25); sine(s, () => 2500 + R() * 6000, 1); sine(s, () => 1800 + R() * 5000, 0.5); envExp(s, 0.0005, 0.02 + R() * 0.05);
      mix(x, s, 0.15 + R() * 0.3, R() * 0.3 + (k > 40 ? R() * 0.5 : 0));
    }
    return norm(x, 0.85);
  };
  D.rustle = (d = 0.7, hp = 2200) => {
    const x = arr(d);
    const dens = 60 + R() * 120;
    for (let k = 0; k < dens * d; k++) { const gr = arr(0.004 + R() * 0.01); white(gr, 1); envAD(gr, 0.001, 0.008); mix(x, gr, R() * R(), R() * d); }
    filt(x, 'hp', hp, 0.7); filt(x, 'lp', 9000);
    for (let i = 0; i < x.length; i++) { const t = i / x.length; x[i] *= Math.sin(t * Math.PI); }
    return norm(x, 0.7);
  };
  D.drip = () => { const x = arr(0.3); sine(x, (t) => 1300 + R() * 500 - t * 5000, 1); envExp(x, 0.0005, 0.03); filt(x, 'pk', 1500, 4, 6); return norm(x, 0.6); };
  D.groan = (d = 3) => {
    const x = arr(d); brown(x, 1); white(x, 0.05);
    const y = filtV(x, 'bp', (t) => 120 + 80 * Math.sin(t * 1.3) + 40 * Math.sin(t * 3.1), 25);
    const z = filtV(Float32Array.from(x), 'bp', (t) => 310 + 120 * Math.sin(t * 0.9), 30);
    for (let i = 0; i < y.length; i++) y[i] += z[i] * 0.6;
    envAD(y, 0.8, d - 0.8);
    return norm(fadeEdges(y, 0.1, 0.4), 0.7);
  };
  D.thunder = () => {
    const d = 5 + R() * 2, x = arr(d); brown(x, 1); white(x, 0.08);
    filtV(x, 'lp', (t) => 900 * Math.exp(-t * 0.6) + 120, 0.7);
    const n = x.length;
    let e = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; e = Math.max(e * 0.99995, t < 0.05 ? 1 : 0); const rumble = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.3 + Math.sin(t * 0.7) * 3)); x[i] *= Math.exp(-t * 0.55) * rumble * (t < 0.03 ? t / 0.03 : 1); }
    return norm(x, 0.95);
  };
  D.crow = () => {
    const d = 1.6, x = arr(d);
    for (let k = 0; k < 2 + ((R() * 2) | 0); k++) {
      const c = arr(0.28); saw(c, (t) => 520 + 180 * Math.sin(t * 30) - t * 400, 1, 0.3); white(c, 0.6);
      const y = formants(c, [[900, 5, 1], [1500, 6, 0.8], [2500, 7, 0.5]]); envAD(y, 0.02, 0.26);
      mix(x, shape(y, 3), 1, k * 0.42);
    }
    return norm(x, 0.7);
  };
  D.phoneRing = () => {
    const x = arr(2.1);
    for (let t = 0; t < 2; t += 1 / 22) {
      const s = arr(0.09); sine(s, () => 980, 1); sine(s, () => 1570, 0.6); sine(s, () => 2390, 0.35); envExp(s, 0.0005, 0.03);
      mix(x, s, 0.7, t);
    }
    return norm(fadeEdges(x), 0.8);
  };
  D.static = (d = 3, voice) => {
    const x = arr(d); white(x, 1); filt(x, 'bp', 2200, 0.6);
    for (let i = 0; i < x.length; i++) if (R() < 0.0015) x[i] += (R() * 2 - 1) * 4;
    if (voice) {
      const v = arr(d); saw(v, (t) => 130 + 30 * Math.sin(t * 5) + 20 * Math.sin(t * 11), 1, 0.05);
      let y = formants(v, [[600, 4, 1], [1200, 5, 0.7], [2400, 6, 0.4]]);
      for (let i = 0; i < y.length; i++) { const t = i / SR; y[i] *= Math.max(0, Math.sin(t * 2 * Math.PI * 3.5 + Math.sin(t * 7) * 2)) * (Math.sin(t * 0.9) > -0.6 ? 1 : 0); }
      filt(y, 'bp', 1500, 0.7);
      mix(x, y, 2.5);
    }
    return norm(fadeEdges(x, 0.05, 0.1), 0.6);
  };
  D.heart = () => {
    const x = arr(0.9);
    const beat = (at, a) => { const b = arr(0.18); sine(b, (t) => 58 - t * 90, 1); envExp(b, 0.004, 0.045); mix(x, b, a, at); };
    beat(0, 1); beat(0.23, 0.7);
    filt(x, 'lp', 160);
    return norm(x, 0.95);
  };
  D.whoosh = (d = 0.35, f0 = 600, f1 = 2500) => { const x = arr(d); white(x, 1); filtV(x, 'bp', (t) => f0 + (f1 - f0) * (t / d), 1.2); envAD(x, d * 0.4, d * 0.6); return norm(x, 0.7); };
  D.fire = () => {
    const d = 4, x = arr(d); brown(x, 1); filt(x, 'lp', 500);
    for (let i = 0; i < x.length; i++) if (R() < 0.004) { const len = 40 + ((R() * 200) | 0), a = R() * 1.5; for (let k = 0; k < len && i + k < x.length; k++) x[i + k] += (R() * 2 - 1) * a * (1 - k / len); }
    return norm(loopify(x, 0.4), 0.7);
  };
  D.engine = () => {
    const d = 3, x = arr(d); saw(x, () => 29, 0.8, 0.02); saw(x, () => 58.3, 0.4, 0.02);
    for (let i = 0; i < x.length; i++) x[i] *= 0.7 + 0.3 * Math.sin((i / SR) * 2 * Math.PI * 14.5);
    filt(x, 'lp', 380, 1); white(x, 0.03);
    return norm(loopify(x, 0.3), 0.7);
  };
  D.pad = (freqs, d = 5) => {
    const x = arr(d);
    freqs.forEach((f, i) => { saw(x, (t) => f * (1 + 0.002 * Math.sin(t * (0.7 + i))), 0.35, 0.002); saw(x, () => f * 1.004, 0.25, 0.002); });
    filtV(x, 'lp', (t) => 400 + 1400 * Math.sin((t / d) * Math.PI), 0.8);
    for (let i = 0; i < x.length; i++) { const t = i / x.length; x[i] *= Math.sin(t * Math.PI); }
    return norm(x, 0.7);
  };
  D.stingerSpotted = () => {
    const d = 2.4, x = arr(d);
    [146.8, 155.6, 207.7, 220, 311.1].forEach((f) => saw(x, (t) => f * (1 + t * 0.03), 0.3, 0.01));
    filtV(x, 'lp', (t) => 300 + 4000 * Math.min(1, t / 0.45), 0.9);
    for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] *= t < 0.45 ? Math.pow(t / 0.45, 2) : Math.exp(-(t - 0.45) * 3); }
    const hit = arr(1.2); sine(hit, (t) => 50 * Math.exp(-t * 2) + 28, 1); envExp(hit, 0.002, 0.3); mix(x, hit, 1.2, 0.44);
    const scrape = arr(1.4); white(scrape, 1); filtV(scrape, 'bp', (t) => 1800 + 900 * Math.sin(t * 9), 18); envAD(scrape, 0.3, 1.1); mix(x, scrape, 0.8, 0.1);
    return norm(shape(x, 1.5), 0.9);
  };
  D.stingerDeath = () => {
    const d = 4, x = arr(d);
    const rev = arr(1.4); white(rev, 1); filt(rev, 'lp', 5000); for (let i = 0; i < rev.length; i++) rev[i] *= Math.pow(i / rev.length, 3);
    mix(x, rev, 0.6);
    const boom = arr(3); sine(boom, (t) => 42 * Math.exp(-t * 0.8) + 22, 1); envExp(boom, 0.002, 1.1); mix(x, boom, 1.2, 1.35);
    [73.4, 77.8, 110].forEach((f) => { const p = arr(2.6); saw(p, () => f, 0.3, 0.002); filt(p, 'lp', 300); envAD(p, 0.05, 2.5); mix(x, p, 0.6, 1.35); });
    return norm(x, 0.95);
  };
  D.metalHit = () => { const x = arr(1.2); [310, 845, 1623, 2410].forEach((f, i) => sine(x, () => f, 0.4 / (i + 1))); envExp(x, 0.001, 0.3); const n = arr(0.02); white(n, 1); envExp(n, 0.0005, 0.004); mix(x, n); return norm(x, 0.75); };
  D.zip = () => { const x = arr(0.45); for (let k = 0; k < 40; k++) { const c = arr(0.004); white(c, 1); mix(x, c, 0.6, k * 0.009 + R() * 0.002); } filt(x, 'bp', 3000, 1.2); return norm(x, 0.6); };
  D.tape = () => { const x = arr(0.5); white(x, 1); filtV(x, 'bp', (t) => 1500 + t * 5000, 2); for (let i = 0; i < x.length; i++) x[i] *= 0.5 + 0.5 * Math.sign(Math.sin((i / SR) * 2 * Math.PI * 60)); envAD(x, 0.02, 0.45); return norm(x, 0.6); };
  D.spray = () => { const x = arr(0.7); white(x, 1); filt(x, 'hp', 3500); envAD(x, 0.05, 0.6); return norm(x, 0.5); };
  D.rattle = () => { const x = arr(0.4); for (let k = 0; k < 18; k++) { const c = arr(0.02); sine(c, () => 2500 + R() * 2500, 1); envExp(c, 0.0005, 0.006); mix(x, c, 0.5 + R() * 0.5, R() * 0.33); } return norm(x, 0.6); };

  // ---------------- synthesis job list ----------------
  async function synthesizeAll(progress) {
    const surfaces = ['asphalt', 'concrete', 'grass', 'tile', 'wood', 'water', 'glass', 'carpet', 'dirt', 'metal'];
    const jobs = [];
    surfaces.forEach((s) => jobs.push(() => { for (let v = 0; v < 4; v++) add('step_' + s, D.step(s, v)); }));
    jobs.push(() => { for (let v = 0; v < 8; v++) add('clicker', D.clicker()); });
    jobs.push(() => { add('clicker_scream', D.clickerScream()); add('clicker_scream', D.clickerScream()); });
    jobs.push(() => { for (let v = 0; v < 6; v++) add('runner_moan', D.runnerMoan()); });
    jobs.push(() => { for (let v = 0; v < 3; v++) add('runner_scream', D.runnerScream()); });
    jobs.push(() => { add('runner_attack', D.growl(170, 0.6)); add('runner_attack', D.growl(150, 0.5)); });
    jobs.push(() => { add('stalker', D.growl(95, 1.4)); add('stalker', D.breath(true, 1, 900)); });
    jobs.push(() => { add('bloater', D.growl(62, 2.2)); add('bloater', D.growl(55, 1.8)); add('bloater_roar', D.growl(70, 2.6)); });
    jobs.push(() => { add('breath_in', D.breath(true)); add('breath_out', D.breath(false)); add('mask_in', D.breath(true, 0.8, 600)); add('mask_out', D.breath(false, 0.9, 500)); });
    jobs.push(() => { add('hurt', D.grunt(125, 0.28)); add('hurt', D.grunt(140, 0.22)); add('hurt', D.grunt(115, 0.3)); add('ellie_hurt', D.grunt(260, 0.25)); add('strain', D.grunt(105, 0.9)); });
    jobs.push(() => { add('revolver', D.gunshot(false)); add('shotgun', D.gunshot(true)); });
    jobs.push(() => { add('dryfire', D.click(3000, 0.05)); add('reload_open', D.click(1500, 0.08)); add('reload_insert', D.click(2800, 0.04)); add('reload_insert', D.click(3100, 0.04)); add('reload_close', D.metalHit()); });
    jobs.push(() => { add('bow_draw', D.creak(0.7, 380, 0.5)); add('bow_release', D.twang()); add('arrow_hit', D.thud(140, 0.2)); add('arrow_wall', D.thud(220, 0.25)); });
    jobs.push(() => { add('swing', D.whoosh(0.3, 500, 2600)); add('hit', D.thud(90, 0.3)); add('hit', D.thud(110, 0.25)); add('stab', D.thud(70, 0.4)); add('snap', D.click(900, 0.1)); });
    jobs.push(() => { add('brick', D.thud(130, 0.4)); add('shatter', D.shatter()); add('shatter', D.shatter()); add('ignite', D.whoosh(0.8, 200, 1200)); add('fire', D.fire()); });
    jobs.push(() => { add('body_fall', D.thud(60, 0.5)); add('metal_hit', D.metalHit()); });
    jobs.push(() => {
      const L = arr(7), Rr = arr(7);
      pink(L, 1); pink(Rr, 1);
      [L, Rr].forEach((c) => { filt(c, 'hp', 350); filt(c, 'lp', 7500); for (let i = 0; i < c.length; i++) if (R() < 0.01) c[i] += (R() * 2 - 1) * 0.8; });
      add('rain', [norm(loopify(L, 0.8), 0.6), norm(loopify(Rr, 0.8), 0.6)]);
      const r2 = arr(6); brown(r2, 1); pink(r2, 0.4); filt(r2, 'lp', 900);
      for (let i = 0; i < r2.length; i++) if (R() < 0.0012) r2[i] += (R() * 2 - 1) * 2;
      add('rain_roof', norm(loopify(r2, 0.6), 0.6));
    });
    jobs.push(() => {
      const L = arr(9), Rr = arr(9);
      brown(L, 1); brown(Rr, 1);
      [L, Rr].forEach((c, k) => { filtV(c, 'bp', (t) => 380 + 220 * Math.sin(t * 0.6 + k), 0.7); for (let i = 0; i < c.length; i++) c[i] *= 0.4 + 0.6 * Math.pow(Math.sin((i / SR) * 0.35 + k) * 0.5 + 0.5, 2); });
      add('wind', [norm(loopify(L, 1), 0.6), norm(loopify(Rr, 1), 0.6)]);
    });
    jobs.push(() => { for (let v = 0; v < 5; v++) add('rustle', D.rustle(0.4 + R() * 0.8)); add('swish', D.rustle(0.35, 3000)); add('swish', D.rustle(0.3, 3500)); });
    jobs.push(() => { for (let v = 0; v < 5; v++) add('drip', D.drip()); });
    jobs.push(() => { for (let v = 0; v < 3; v++) add('groan', D.groan(2.5 + R() * 2)); });
    jobs.push(() => { for (let v = 0; v < 3; v++) add('thunder', D.thunder()); });
    jobs.push(() => { add('crow', D.crow()); add('crow', D.crow()); });
    jobs.push(() => { add('door_open', D.creak(1.2, 650)); add('door_open', D.creak(0.9, 820)); add('door_close', D.thud(95, 0.45)); add('drawer', D.whoosh(0.35, 1400, 2200)); add('locker', D.creak(0.5, 1300, 0.3)); add('search', D.rustle(0.9, 1200)); });
    jobs.push(() => { add('phone', D.phoneRing()); add('static', D.static(3, false)); add('radio_voice', D.static(6, true)); });
    jobs.push(() => { add('generator', D.engine()); add('heart', D.heart()); add('zip', D.zip()); add('tape', D.tape()); add('spray', D.spray()); add('pills', D.rattle()); });
    jobs.push(() => { add('pick', D.rustle(0.25, 1500)); add('pick_metal', D.click(3400, 0.12)); add('ui', D.click(1800, 0.04)); add('paper', D.rustle(0.5, 2500)); });
    jobs.push(() => { add('stinger_spotted', D.stingerSpotted()); add('stinger_death', D.stingerDeath()); add('stinger_part', D.pad([146.8, 220, 293.7, 329.6], 5)); add('stinger_tense', D.pad([587.3, 622.3, 932.3], 3.5)); });
    jobs.push(() => {
      const notes = { D3: 146.83, F3: 174.61, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33 };
      A.guitarNotes = Object.keys(notes);
      Object.keys(notes).forEach((k) => add('gtr_' + k, pluck(notes[k], 3.2, 0.9975)));
    });
    for (let i = 0; i < jobs.length; i++) {
      jobs[i]();
      progress && progress((i + 1) / jobs.length);
      if (i % 3 === 2) await OG.frame();
    }
  }

  function impulse(dur, decay, bright) {
    const L = arr(dur), Rr = arr(dur);
    white(L); white(Rr);
    [L, Rr].forEach((c) => {
      filtV(c, 'lp', (t) => bright * Math.exp(-t * 2.2) + 300, 0.5);
      for (let i = 0; i < c.length; i++) c[i] *= Math.exp(-(i / SR) / decay) * (i < 0.004 * SR ? i / (0.004 * SR) : 1);
    });
    const b = ctx.createBuffer(2, L.length, SR);
    b.copyToChannel(norm(L, 0.5), 0);
    b.copyToChannel(norm(Rr, 0.5), 1);
    return b;
  }

  // ---------------- graph ----------------
  A.init = async function (progress) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = A.ctx = new AC({ latencyHint: 'interactive' });
    SR = ctx.sampleRate;
    master = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(ctx.destination);
    ['sfx', 'music', 'amb', 'ui', 'voice'].forEach((k) => { bus[k] = ctx.createGain(); bus[k].connect(master); });
    // ambience goes through a filter that closes when you are indoors
    ambFilter = ctx.createBiquadFilter(); ambFilter.type = 'lowpass'; ambFilter.frequency.value = 18000;
    ambGain = ctx.createGain();
    ambFilter.connect(ambGain); ambGain.connect(bus.amb);
    // reverb: outdoor and indoor, crossfaded
    rvIn = ctx.createGain();
    rvOutdoor = ctx.createConvolver(); rvIndoor = ctx.createConvolver();
    rvOutdoor.buffer = impulse(3.2, 1.1, 5000);
    rvIndoor.buffer = impulse(1.6, 0.45, 8000);
    rvMixOut = ctx.createGain(); rvMixIn = ctx.createGain(); rvMixIn.gain.value = 0;
    rvIn.connect(rvOutdoor); rvIn.connect(rvIndoor);
    rvOutdoor.connect(rvMixOut); rvIndoor.connect(rvMixIn);
    rvOut = ctx.createGain(); rvOut.gain.value = 0.9;
    rvMixOut.connect(rvOut); rvMixIn.connect(rvOut); rvOut.connect(master);
    A.setVolumes();
    await synthesizeAll(progress);
    await loadOverrides();
    A.ready = true;
  };
  A.setVolumes = function () {
    if (!ctx) return;
    const s = OG.settings;
    master.gain.value = s.master;
    bus.sfx.gain.value = s.sfx;
    bus.voice.gain.value = s.sfx;
    bus.amb.gain.value = s.sfx * 0.9;
    bus.ui.gain.value = 0.6;
    bus.music.gain.value = s.music * 0.8;
  };
  A.resume = function () { if (ctx && ctx.state !== 'running') ctx.resume(); };
  A.suspend = function () { if (ctx && ctx.state === 'running') ctx.suspend(); };

  async function loadOverrides() {
    // assets/manifest.json -> { "audio": { "clicker": ["clicker_01.mp3", ...], "music_explore": "..." } }
    try {
      const res = await fetch('assets/manifest.json', { cache: 'no-store' });
      if (!res.ok) return;
      const man = await res.json();
      const audio = man.audio || {};
      for (const name of Object.keys(audio)) {
        const files = [].concat(audio[name]);
        const loaded = [];
        for (const f of files) {
          try {
            const r = await fetch('assets/audio/' + f);
            if (!r.ok) continue;
            loaded.push(await ctx.decodeAudioData(await r.arrayBuffer()));
          } catch (_) {}
        }
        if (loaded.length) buffers[name] = loaded;
      }
    } catch (_) {}
  }

  const pickBuf = (name) => { const b = buffers[name]; return b && b.length ? b[(R() * b.length) | 0] : null; };
  A.has = (name) => !!(buffers[name] && buffers[name].length);

  function setPannerPos(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
  }
  function makePanner(o) {
    const p = ctx.createPanner();
    p.panningModel = o.hrtf === false ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref || 2;
    p.maxDistance = 200;
    p.rolloffFactor = o.roll || 1.2;
    return p;
  }
  let listenerPos = { x: 0, y: 1.6, z: 0 };
  function occlusion(x, z) {
    const w = OG.phys ? OG.phys.wallsBetween(listenerPos.x, listenerPos.z, x, z) : 0;
    return w;
  }

  // one-shot sound; returns {src, gain}
  A.play = function (name, o = {}) {
    if (!ctx || !A.ready) return null;
    const b = pickBuf(name);
    if (!b) return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = (o.rate || 1) * (1 + (R() - 0.5) * (o.rateVar === undefined ? 0.08 : o.rateVar));
    const g = ctx.createGain();
    g.gain.value = o.vol === undefined ? 1 : o.vol;
    let head = src;
    if (o.pos) {
      const walls = o.occlude === false ? 0 : occlusion(o.pos.x, o.pos.z);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = walls ? Math.max(350, 1400 / walls) : 20000;
      g.gain.value *= Math.pow(0.55, walls);
      const p = makePanner(o);
      setPannerPos(p, o.pos.x, o.pos.y === undefined ? 1.2 : o.pos.y, o.pos.z);
      src.connect(f); f.connect(g); g.connect(p); p.connect(bus[o.bus || 'sfx']);
      head = p;
    } else {
      src.connect(g); g.connect(bus[o.bus || 'sfx']);
    }
    const send = o.reverb === undefined ? 0.25 : o.reverb;
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(rvIn); }
    const when = ctx.currentTime + (o.delay || 0);
    src.start(when, o.offset || 0);
    return { src, gain: g };
  };

  // persistent looping source; handle can be moved / faded
  A.loop = function (name, o = {}) {
    if (!ctx || !A.ready) return null;
    const b = pickBuf(name);
    if (!b) return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const g = ctx.createGain();
    g.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 20000;
    src.connect(f); f.connect(g);
    let p = null;
    if (o.pos) {
      p = makePanner(o);
      setPannerPos(p, o.pos.x, o.pos.y || 1, o.pos.z);
      g.connect(p); p.connect(o.amb ? ambFilter : bus[o.bus || 'sfx']);
    } else g.connect(o.amb ? ambFilter : bus[o.bus || 'sfx']);
    if (o.reverb) { const s = ctx.createGain(); s.gain.value = o.reverb; g.connect(s); s.connect(rvIn); }
    src.start(0, R() * b.duration);
    const target = o.vol === undefined ? 1 : o.vol;
    g.gain.setTargetAtTime(target, ctx.currentTime, o.fade || 0.3);
    const h = {
      src, gain: g, filter: f, panner: p, pos: o.pos,
      setVol(v, tc = 0.3) { g.gain.setTargetAtTime(v, ctx.currentTime, tc); },
      setPos(x, y, z) { if (p) { setPannerPos(p, x, y, z); h.pos = { x, y, z }; } },
      setRate(r) { src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.1); },
      stop(tc = 0.3) { g.gain.setTargetAtTime(0, ctx.currentTime, tc); setTimeout(() => { try { src.stop(); } catch (_) {} }, tc * 6000); },
      occlude() { if (!p || !h.pos) return; const w = occlusion(h.pos.x, h.pos.z); f.frequency.setTargetAtTime(w ? Math.max(350, 1400 / w) : 20000, ctx.currentTime, 0.2); },
    };
    return h;
  };

  A.setListener = function (pos, fwd) {
    if (!ctx) return;
    listenerPos = pos;
    const L = ctx.listener;
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  };

  // ---------------- ambience + adaptive score ----------------
  const M = (A.music = { tension: 0, combat: 0, calm: 1, dark: 0, t: 0 });
  let loops = {}, musicNodes = null, nextHit = 0, nextGuitar = 20, beat = 0, nextAmb = 5, nextRustle = 8, nextDrip = 3, nextCreak = 12;
  function osc(type, f, detune = 0) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.start(); return o; }
  function buildMusic() {
    const n = {};
    // drone: low saws through a slowly breathing low-pass
    n.drone = ctx.createGain(); n.drone.gain.value = 0;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 260; dl.Q.value = 2.5;
    [[36.71, 0], [55, 4], [73.42, -5], [77.78, 3]].forEach(([f, dt], i) => { const o = osc('sawtooth', f, dt); const g = ctx.createGain(); g.gain.value = i === 3 ? 0.05 : 0.12; o.connect(g); g.connect(dl); });
    const lfo = osc('sine', 0.035), lg = ctx.createGain(); lg.gain.value = 150; lfo.connect(lg); lg.connect(dl.frequency);
    dl.connect(n.drone); n.drone.connect(bus.music);
    // tension: high string-harmonic cluster with vibrato + tremolo
    n.tension = ctx.createGain(); n.tension.gain.value = 0;
    [587.33, 622.25, 880, 932.33].forEach((f, i) => {
      const o = osc(i % 2 ? 'triangle' : 'sine', f);
      const v = osc('sine', 4.5 + i * 0.7), vg = ctx.createGain(); vg.gain.value = f * 0.004; v.connect(vg); vg.connect(o.frequency);
      const g = ctx.createGain(); g.gain.value = 0.05;
      const tr = osc('sine', 0.13 + i * 0.07), tg = ctx.createGain(); tg.gain.value = 0.04; tr.connect(tg); tg.connect(g.gain);
      o.connect(g); g.connect(n.tension);
    });
    const ts = ctx.createGain(); ts.gain.value = 0.35; n.tension.connect(ts); ts.connect(rvIn);
    n.tension.connect(bus.music);
    // bowed-metal resonance: noise through very narrow band-passes
    n.metal = ctx.createGain(); n.metal.gain.value = 0;
    const nb = ctx.createBuffer(1, SR * 4, SR), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = R() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.start();
    [523, 1328, 2745].forEach((f) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 70; const g = ctx.createGain(); g.gain.value = 1.4; ns.connect(bp); bp.connect(g); g.connect(n.metal); });
    const ms = ctx.createGain(); ms.gain.value = 0.6; n.metal.connect(ms); ms.connect(rvIn); n.metal.connect(bus.music);
    // combat rumble
    n.rumble = ctx.createGain(); n.rumble.gain.value = 0;
    const rb = ctx.createBuffer(1, SR * 3, SR), rd = rb.getChannelData(0);
    let l = 0;
    for (let i = 0; i < rd.length; i++) { l = (l + 0.02 * (R() * 2 - 1)) / 1.02; rd[i] = l * 3; }
    const rs = ctx.createBufferSource(); rs.buffer = rb; rs.loop = true; rs.start();
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 120;
    rs.connect(rl); rl.connect(n.rumble); n.rumble.connect(bus.music);
    return n;
  }
  function hit(time, f, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, time);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, time + dur);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g); g.connect(bus.music);
    o.start(time); o.stop(time + dur + 0.05);
  }
  function stab(time, vol) {
    [146.83, 155.56, 207.65].forEach((f) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f * (R() < 0.5 ? 1 : 2);
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, time); lp.frequency.exponentialRampToValueAtTime(300, time + 0.35);
      g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
      o.connect(lp); lp.connect(g); g.connect(bus.music);
      const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s); s.connect(rvIn);
      o.start(time); o.stop(time + 0.55);
    });
  }
  function guitarPhrase() {
    const scale = ['D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'A3', 'C4'];
    let t = ctx.currentTime + 0.1, idx = (R() * 4) | 0;
    const len = 4 + ((R() * 4) | 0);
    for (let k = 0; k < len; k++) {
      idx = OG.clamp(idx + ((R() * 3) | 0) - 1, 0, scale.length - 1);
      const name = k === len - 1 ? OG.pick(['D4', 'A3', 'D3']) : scale[idx];
      const b = pickBuf('gtr_' + name);
      if (b) {
        const s = ctx.createBufferSource(); s.buffer = b;
        s.playbackRate.value = 1 + (R() < 0.2 ? 0.003 : 0);
        const g = ctx.createGain(); g.gain.value = 0.26;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        s.connect(g);
        if (pan) { pan.pan.value = (R() - 0.5) * 0.6; g.connect(pan); pan.connect(bus.music); } else g.connect(bus.music);
        const snd = ctx.createGain(); snd.gain.value = 0.7; g.connect(snd); snd.connect(rvIn);
        s.start(t);
      }
      t += OG.pick([0.42, 0.42, 0.63, 0.84, 1.05]);
    }
  }

  A.startWorld = function () {
    if (!ctx || !A.ready || musicNodes) return;
    musicNodes = buildMusic();
    loops.rain = A.loop('rain', { amb: true, vol: 0, fade: 1 });
    loops.roof = A.loop('rain_roof', { vol: 0, fade: 1, bus: 'amb' });
    loops.wind = A.loop('wind', { amb: true, vol: 0.3, fade: 2 });
    nextGuitar = ctx.currentTime + 25;
  };

  // env: { interior, rain(0..1), tension(0..1), combat(0..1), dark(0..1), hp(0..1), near:{trees,grass}, pos }
  A.update = function (dt, env) {
    if (!ctx || !A.ready || !musicNodes) return;
    const now = ctx.currentTime, tc = 0.8;
    M.tension = OG.damp(M.tension, env.tension, 1.5, dt);
    M.combat = OG.damp(M.combat, env.combat, env.combat > M.combat ? 4 : 0.6, dt);
    M.dark = OG.damp(M.dark, env.dark, 1, dt);
    const interior = env.interior ? 1 : 0;
    // ambience
    loops.rain && loops.rain.setVol(env.rain * (interior ? 0.05 : 0.75), 1);
    loops.roof && loops.roof.setVol(env.rain * interior * 0.55, 1);
    loops.wind && loops.wind.setVol((interior ? 0.06 : 0.28) + env.rain * 0.12, 1.5);
    ambFilter.frequency.setTargetAtTime(interior ? 650 : 16000, now, 0.4);
    rvMixIn.gain.setTargetAtTime(interior ? 1 : 0, now, 0.5);
    rvMixOut.gain.setTargetAtTime(interior ? 0.15 : 1, now, 0.5);
    // score layers
    musicNodes.drone.gain.setTargetAtTime(0.18 + M.dark * 0.12 + M.tension * 0.15, now, tc);
    musicNodes.tension.gain.setTargetAtTime(M.tension * 0.55 * (1 - M.combat * 0.5), now, tc);
    musicNodes.metal.gain.setTargetAtTime((M.tension * 0.35 + M.dark * 0.08) * (0.6 + 0.4 * Math.sin(now * 0.21)), now, tc);
    musicNodes.rumble.gain.setTargetAtTime(M.combat * 0.8, now, 0.3);
    // combat percussion scheduler
    if (M.combat > 0.12) {
      const bpm = 84 + M.combat * 44, step = 60 / bpm / 2;
      if (nextHit < now) nextHit = now + 0.05;
      while (nextHit < now + 0.15) {
        const pat = [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0];
        if (pat[beat % 16]) hit(nextHit, beat % 8 === 0 ? 62 : 78, 0.24, 0.55 * M.combat);
        if (beat % 32 === 28 && M.combat > 0.5) stab(nextHit, 0.12 * M.combat);
        nextHit += step;
        beat++;
      }
    }
    // heartbeat when hurt or hunted
    if ((env.hp < 0.35 || M.combat > 0.6) && (!A._heartT || now > A._heartT)) {
      A.play('heart', { vol: 0.35 + (1 - env.hp) * 0.4, bus: 'music', reverb: 0 });
      A._heartT = now + (env.hp < 0.2 ? 0.75 : 1.05);
    }
    // sparse guitar when things are quiet
    if (now > nextGuitar) {
      if (M.tension < 0.1 && M.combat < 0.05) guitarPhrase();
      nextGuitar = now + 45 + R() * 50;
    }
    // positional ambience one-shots around the listener
    const p = env.pos;
    const around = (dmin, dmax) => { const a = R() * Math.PI * 2, d = dmin + R() * (dmax - dmin); return { x: p.x + Math.cos(a) * d, y: 1 + R() * 6, z: p.z + Math.sin(a) * d }; };
    if (now > nextAmb) {
      nextAmb = now + 14 + R() * 26;
      const r = R();
      if (interior) A.play('groan', { pos: around(6, 14), vol: 0.35, occlude: false, reverb: 0.6 });
      else if (r < 0.35) A.play('groan', { pos: around(25, 60), vol: 0.5, occlude: false, reverb: 0.7, hrtf: false });
      else if (r < 0.6 && env.rain < 0.6) A.play('crow', { pos: around(20, 45), vol: 0.45, occlude: false, hrtf: false, reverb: 0.5 });
      else if (r < 0.8) A.play('runner_scream', { pos: around(60, 110), vol: 0.35, occlude: false, rate: 0.9, reverb: 1, hrtf: false });
      else A.play('clicker', { pos: around(35, 70), vol: 0.3, occlude: false, reverb: 0.8, hrtf: false });
    }
    if (!interior && env.near && env.near.trees && now > nextRustle) {
      nextRustle = now + 5 + R() * 10;
      A.play('rustle', { pos: around(4, 12), vol: 0.35 + R() * 0.3, occlude: false, reverb: 0.2 });
    }
    if (interior && now > nextDrip) {
      nextDrip = now + 1.5 + R() * 4;
      A.play('drip', { pos: around(2, 8), vol: 0.35, occlude: false, reverb: 0.8, rate: 0.8 + R() * 0.5 });
    }
    if (interior && now > nextCreak) {
      nextCreak = now + 9 + R() * 16;
      A.play('door_open', { pos: around(5, 12), vol: 0.18, occlude: false, reverb: 0.7, rate: 0.6 + R() * 0.3 });
    }
  };
  A.stinger = function (name, vol = 0.8) { return A.play(name, { bus: 'music', vol, reverb: 0.5, rateVar: 0 }); };
  A.thunder = function (delay, vol) { A.play('thunder', { vol, delay, bus: 'amb', reverb: 0.4, rateVar: 0.2 }); };
  A.stopWorld = function () {
    if (!musicNodes) return;
    const t = ctx.currentTime;
    ['drone', 'tension', 'metal', 'rumble'].forEach((k) => musicNodes[k].gain.setTargetAtTime(0, t, 0.4));
    Object.values(loops).forEach((l) => l && l.setVol(0, 0.5));
  };
  A.now = () => (ctx ? ctx.currentTime : 0);
})();
