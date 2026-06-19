// audio.js — procedural Web Audio SFX for Monster Bash. No assets.
//
// One AudioContext + master bus (with a gentle compressor so stacked pops don't
// clip). Every sound is synthesised on demand. Browser policy needs a user
// gesture first, so prime() is called from the first pointerdown/keydown.
//
// Sounds:
//   pop()        pop-bumper boing — bright resonant blip + pitch jump
//   sling()      slingshot snap — short hipassed noise whip
//   flip()       flipper clack — tight mechanical tick
//   monster()    monster-bumper splat — squelchy low growl + thock
//   launch()     plunger whoosh — rising filtered noise
//   drain()      ball lost — descending forlorn tone + soft thud
//   over()       game over — low minor two-note knell
//   hum(on)      faint cabinet ambience loop
//
// All methods are no-ops until primed / when muted; callers don't guard.

export function createAudio() {
  let ctx = null, master = null, humNodes = null, muted = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try {
      ctx = new C();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 6;
      comp.attack.value = 0.003; comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(comp).connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function prime() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  function noiseBuf(dur = 0.3) {
    const c = ensureCtx(); if (!c) return null;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function tone(type, f0, f1, t0, dur, peak, dest) {
    const c = ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(dest || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return o;
  }

  // pop bumper — the signature "boing": a square blip that jumps UP in pitch
  function pop() {
    const c = ensureCtx(); if (!c || muted) return;
    const t = c.currentTime;
    const base = 320 + Math.random() * 120;
    tone('square', base, base * 2.4, t, 0.16, 0.16);
    tone('sine', base * 2, base * 4, t, 0.12, 0.10);
  }
  // slingshot — snappy noise whip
  function sling() {
    const c = ensureCtx(); if (!c || muted) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = noiseBuf(0.12);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    s.connect(hp).connect(g).connect(master);
    s.start(t); s.stop(t + 0.13);
    tone('triangle', 900, 1500, t, 0.07, 0.06);
  }
  // flipper clack — tight tick
  function flip() {
    const c = ensureCtx(); if (!c || muted) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = noiseBuf(0.05);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(bp).connect(g).connect(master);
    s.start(t); s.stop(t + 0.06);
    tone('sine', 180, 90, t, 0.06, 0.10);
  }
  // monster bumper — squelchy growl + thock (the juicy big hit)
  function monster() {
    const c = ensureCtx(); if (!c || muted) return;
    const t = c.currentTime;
    tone('sawtooth', 150, 60, t, 0.26, 0.22);                 // growl down
    const s = c.createBufferSource(); s.buffer = noiseBuf(0.2);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    s.connect(lp).connect(g).connect(master);
    s.start(t); s.stop(t + 0.22);
    tone('square', 420, 200, t + 0.01, 0.1, 0.08);
  }
  // plunger whoosh — rising filtered noise
  function launch() {
    const c = ensureCtx(); if (!c || muted) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = noiseBuf(0.4);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.32);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    s.connect(bp).connect(g).connect(master);
    s.start(t); s.stop(t + 0.4);
  }
  // ball lost — descending forlorn tone + soft thud
  function drain() {
    const c = ensureCtx(); if (!c || muted) return;
    const t = c.currentTime;
    tone('sine', 520, 130, t, 0.5, 0.18);
    tone('sine', 90, 60, t + 0.04, 0.3, 0.14);
  }
  // game over — low minor two-note knell
  function over() {
    const c = ensureCtx(); if (!c || muted) return;
    const t = c.currentTime;
    tone('triangle', 220, 200, t, 0.6, 0.2);
    tone('triangle', 165, 150, t + 0.18, 0.8, 0.2);
    tone('sine', 80, 55, t, 0.9, 0.14);
  }
  // faint cabinet hum loop
  function hum(on) {
    const c = ensureCtx(); if (!c) return;
    if (on && !humNodes) {
      const s = c.createBufferSource(); s.buffer = noiseBuf(3); s.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(lp).connect(g).connect(master); s.start();
      g.gain.linearRampToValueAtTime(0.05, c.currentTime + 1.2);
      humNodes = { s, g };
    } else if (!on && humNodes) {
      const h = humNodes; humNodes = null;
      h.g.gain.cancelScheduledValues(c.currentTime);
      h.g.gain.setValueAtTime(h.g.gain.value, c.currentTime);
      h.g.gain.linearRampToValueAtTime(0, c.currentTime + 0.5);
      setTimeout(() => { try { h.s.stop(); } catch (e) {} }, 700);
    }
  }
  function setMute(m) { muted = !!m; if (muted) hum(false); }

  return { prime, pop, sling, flip, monster, launch, drain, over, hum, setMute };
}
