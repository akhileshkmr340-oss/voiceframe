// Original soundtrack + final mix, synthesised note by note with Web Audio.
// Nothing is sampled, so the score is unique to each film and royalty-free.
export const SR = 48000;
const LOOP_AFTER = 200; // seconds: longer films reuse one composed section

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const MOODS = {
  epic:       { root: 50, scale: 'minor', prog: [0, 5, 2, 6], bpm: 88,  pad: 'brass',   lead: 'ostinato', drums: 'taiko',     trans: 'flash' },
  adventure:  { root: 55, scale: 'major', prog: [0, 4, 5, 3], bpm: 108, pad: 'strings', lead: 'pluck',    drums: 'light',     trans: 'flash' },
  emotional:  { root: 48, scale: 'major', prog: [5, 3, 0, 4], bpm: 68,  pad: 'strings', lead: 'piano',    drums: null,        trans: 'dissolve' },
  mysterious: { root: 45, scale: 'minor', prog: [0, 5, 3, 4], bpm: 60,  pad: 'dark',    lead: 'bells',    drums: null,        trans: 'dip' },
  dark:       { root: 49, scale: 'minor', prog: [0, 0, 5, 4], bpm: 56,  pad: 'dark',    lead: 'bells',    drums: 'heartbeat', trans: 'dip' },
  romantic:   { root: 53, scale: 'major', prog: [0, 5, 3, 4], bpm: 72,  pad: 'strings', lead: 'piano',    drums: null,        trans: 'dissolve' },
  joyful:     { root: 48, scale: 'major', prog: [0, 4, 5, 3], bpm: 116, pad: 'warm',    lead: 'pluck',    drums: 'light',     trans: 'flash' },
  scifi:      { root: 52, scale: 'minor', prog: [0, 5, 2, 6], bpm: 96,  pad: 'synth',   lead: 'synth',    drums: 'pulse',     trans: 'dissolve' }
};
export const transitionFor = mood => (MOODS[mood] || MOODS.epic).trans;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

class Score {
  constructor(ctx, mood, seed) {
    this.ctx = ctx;
    this.m = MOODS[mood] || MOODS.epic;
    this.rand = rng(seed || 7);
    const sc = SCALES[this.m.scale];
    this.note = (deg, oct = 0) => this.m.root + 12 * (Math.floor(deg / 7) + oct) + sc[((deg % 7) + 7) % 7];
    this.noise = ctx.createBuffer(1, SR * 3, SR);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.4);
    this.out = ctx.createGain();
    this.wet = ctx.createGain(); this.wet.gain.value = 0.42;
    this.wet.connect(this.reverb); this.reverb.connect(this.out);
  }
  impulse(sec) {
    const len = Math.floor(SR * sec), b = this.ctx.createBuffer(2, len, SR);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }
  send(node, dry = 1, wet = 1) {
    const g = this.ctx.createGain(); g.gain.value = dry; node.connect(g); g.connect(this.out);
    if (wet) { const w = this.ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(this.wet); }
  }
  env(g, t, a, peak, hold, r) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.linearRampToValueAtTime(0, t + a + hold + r);
  }
  osc(type, f, t, end, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    o.start(t); o.stop(end); return o;
  }

  pad(midi, t, dur, vel) {
    const kind = this.m.pad, c = this.ctx;
    const types = { brass: ['sawtooth', 'sawtooth'], strings: ['sawtooth', 'triangle'], dark: ['triangle', 'sawtooth'], warm: ['triangle', 'sine'], synth: ['sawtooth', 'square'] }[kind];
    const cutoff = { brass: 1600, strings: 1300, dark: 520, warm: 1500, synth: 2100 }[kind];
    const attack = kind === 'strings' ? 1.6 : kind === 'brass' ? 0.6 : 1.1;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(cutoff * 0.5, t);
    f.frequency.linearRampToValueAtTime(cutoff * (0.8 + vel * 0.6), t + attack + dur * 0.4);
    const g = c.createGain(); this.env(g, t, attack, 0.05 * vel, Math.max(0.1, dur - attack), 1.6);
    [-9, 9].forEach((det, k) => {
      const p = c.createStereoPanner(); p.pan.value = k ? 0.35 : -0.35;
      this.osc(types[k], hz(midi), t, t + dur + 1.8, det).connect(p); p.connect(f);
    });
    f.connect(g); this.send(g, 0.85, 0.6);
  }
  bass(midi, t, dur, vel) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 220;
    this.env(g, t, 0.25, 0.16 * vel, Math.max(0.1, dur - 0.25), 0.8);
    this.osc('sine', hz(midi), t, t + dur + 1).connect(g);
    this.osc('triangle', hz(midi), t, t + dur + 1).connect(f); f.connect(g);
    this.send(g, 1, 0);
  }
  piano(midi, t, vel) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2800;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 2.6);
    [[1, 'sine', 1], [2, 'triangle', 0.25], [3, 'sine', 0.08]].forEach(([mul, type, amp]) => {
      const a = c.createGain(); a.gain.value = amp; this.osc(type, hz(midi) * mul, t, t + 2.7).connect(a); a.connect(f);
    });
    f.connect(g); const p = c.createStereoPanner(); p.pan.value = (midi - 64) / 40; g.connect(p); this.send(p, 0.8, 0.7);
  }
  pluck(midi, t, vel, type = 'triangle') {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(380, t + 0.35);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.7);
    this.osc(type, hz(midi), t, t + 0.75).connect(f); f.connect(g);
    const p = c.createStereoPanner(); p.pan.value = this.rand() * 0.8 - 0.4; g.connect(p); this.send(p, 0.8, 0.5);
  }
  bell(midi, t, vel) {
    const c = this.ctx, g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * vel, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0006, t + 3.5);
    this.osc('sine', hz(midi), t, t + 3.6).connect(g);
    const h = c.createGain(); h.gain.value = 0.35; this.osc('sine', hz(midi) * 2.76, t, t + 3.6).connect(h); h.connect(g);
    this.send(g, 0.5, 1);
  }
  boom(t, vel, from = 140, to = 42) {
    const c = this.ctx, g = c.createGain(), o = this.osc('sine', from, t, t + 1.2);
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + 0.35);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55 * vel, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(g); this.send(g, 1, 0.25);
    this.noiseHit(t, 0.12 * vel, 'lowpass', 500, 0.18);
  }
  noiseHit(t, amp, type, freq, dec) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
    s.connect(f); f.connect(g); this.send(g, 1, 0.1);
    s.start(t, this.rand() * 2); s.stop(t + dec + 0.05);
  }
  whoosh(tEnd, dur, amp) {
    const c = this.ctx, t = Math.max(0, tEnd - dur), s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(5000, tEnd);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, tEnd - 0.05); g.gain.linearRampToValueAtTime(0, tEnd + 0.25);
    s.connect(f); f.connect(g); this.send(g, 1, 0.5); s.start(t); s.stop(tEnd + 0.3);
  }

  // Lay out the whole score. `marks` = scene start times; intensity follows the story arc.
  compose(total, marks, { ending = true } = {}) {
    const m = this.m, beat = 60 / m.bpm, chordLen = beat * 8;
    const intensity = t => {
      const x = t / total;
      if (x < 0.08) return 0.45;
      if (x > 0.93) return 0.5;
      return 0.5 + 0.5 * Math.sin(Math.min(1, (x - 0.08) / 0.7) * Math.PI / 2) * (x > 0.85 ? 0.7 : 1);
    };
    let ci = 0;
    for (let t = 0; t < total - 1; t += chordLen, ci++) {
      const deg = m.prog[ci % m.prog.length];
      const len = Math.min(chordLen, total - t);
      const v = intensity(t);
      [0, 2, 4].forEach(k => this.pad(this.note(deg + k), t, len, 0.7 + v * 0.3));
      if (v > 0.6) this.pad(this.note(deg, 1), t, len, 0.5 * v);
      this.bass(this.note(deg, -1), t, len, v);
      const steps = Math.floor(len / (beat / 2));
      for (let s = 0; s < steps; s++) {
        const tt = t + s * beat / 2, vv = intensity(tt);
        const tone = [0, 2, 4, 7, 4, 2][s % 6];
        if (m.lead === 'ostinato' && vv > 0.55) this.pluck(this.note(deg + (s % 2 ? 4 : 0)), tt, 0.6 + vv * 0.4, 'sawtooth');
        if (m.lead === 'pluck' && vv > 0.5 && s % 2 === 0) this.pluck(this.note(deg + tone, 1), tt, vv);
        if (m.lead === 'synth' && vv > 0.5) this.pluck(this.note(deg + tone, 1), tt, 0.5 * vv, 'square');
        if (m.lead === 'piano' && s % 2 === 0) this.piano(this.note(deg + tone, s % 4 ? 1 : 0), tt + this.rand() * 0.02, 0.5 + vv * 0.4);
        if (m.lead === 'bells' && s % 6 === 0 && this.rand() < 0.6) this.bell(this.note(deg + [4, 7, 9][s % 3], 1), tt, 0.7);
        if (s % 2) continue;
        const b = s / 2;
        if (m.drums === 'taiko' && vv > 0.6 && (b % 4 === 0 || (vv > 0.85 && b % 4 === 3))) this.boom(tt, vv);
        if (m.drums === 'light' && vv > 0.55) {
          if (b % 2 === 0) this.boom(tt, 0.35 * vv, 120, 50);
          this.noiseHit(tt + beat / 2, 0.03 * vv, 'highpass', 6500, 0.06);
        }
        if (m.drums === 'pulse' && vv > 0.55) this.boom(tt, 0.3 * vv, 100, 45);
        if (m.drums === 'heartbeat' && b % 4 === 0) { this.boom(tt, 0.35, 70, 38); this.boom(tt + 0.28, 0.25, 65, 38); }
      }
    }
    // hits and swells around cuts
    marks.forEach((t, i) => {
      if (i === 0) return;
      this.whoosh(t, 1.3, 0.05);
      if (m.drums === 'taiko' || m.drums === 'heartbeat') this.boom(t, 0.5);
    });
    // final sustained chord
    if (!ending) return;
    const last = Math.max(0, total - 5.5);
    [0, 2, 4, 7].forEach(k => this.pad(this.note(m.prog[0] + k), last, 4.2, 0.8));
  }
}

// ---------------- ambience ----------------
function ambience(ctx, dest, noise, kind, t0, t1, rand) {
  if (!kind || kind === 'none' || t1 - t0 < 1) return;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.8);
  g.gain.setValueAtTime(1, t1 - 0.8); g.gain.linearRampToValueAtTime(0, t1);
  g.connect(dest);
  const bed = (type, freq, amp, q = 0.7) => {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const a = ctx.createGain(); a.gain.value = amp;
    s.connect(f); f.connect(a); a.connect(g); s.start(t0, rand() * 2); s.stop(t1);
    return { f, a };
  };
  const swell = (param, base, depth, period) => {
    for (let t = t0; t < t1; t += period / 2) param.linearRampToValueAtTime(base + depth * (rand() * 2 - 1), Math.min(t1, t + period / 2));
  };
  const blip = (t, f1, f2, dur, amp, type = 'sine') => {
    const o = ctx.createOscillator(), a = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(amp, t + 0.01); a.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(a); a.connect(g); o.start(t); o.stop(t + dur + 0.02);
  };
  switch (kind) {
    case 'rain': bed('highpass', 900, 0.07); bed('lowpass', 500, 0.05); break;
    case 'wind': { const w = bed('bandpass', 500, 0.12, 1.4); swell(w.f.frequency, 550, 300, 3); swell(w.a.gain, 0.1, 0.06, 4); break; }
    case 'ocean': { const o = bed('lowpass', 700, 0.08); for (let t = t0; t < t1; t += 6) { o.a.gain.linearRampToValueAtTime(0.14, Math.min(t1, t + 3)); o.a.gain.linearRampToValueAtTime(0.02, Math.min(t1, t + 6)); } break; }
    case 'fire': bed('lowpass', 900, 0.04); for (let t = t0; t < t1; t += 0.05 + rand() * 0.25) blip(t, 2500 + rand() * 2000, 800, 0.02, 0.05 * rand(), 'square'); break;
    case 'forest': bed('bandpass', 600, 0.03); for (let t = t0 + rand(); t < t1; t += 1.2 + rand() * 2.5) { const f = 2600 + rand() * 1800; blip(t, f, f * 1.4, 0.09, 0.03); blip(t + 0.13, f * 1.1, f * 1.5, 0.08, 0.025); } break;
    case 'city': bed('lowpass', 350, 0.09); bed('bandpass', 1100, 0.015); break;
    case 'night': bed('lowpass', 400, 0.02); for (let t = t0; t < t1; t += 0.9 + rand() * 0.6) for (let k = 0; k < 3; k++) blip(t + k * 0.06, 4400, 4300, 0.04, 0.012); break;
    case 'cave': bed('lowpass', 250, 0.05); for (let t = t0 + rand() * 2; t < t1; t += 1.5 + rand() * 3) blip(t, 1400, 700, 0.12, 0.03); break;
  }
}

// ---------------- full mix ----------------
// timeline: { total, scenes:[{start,end,ambience}], segments:[{start,buffer}] }
export async function mixFilm(timeline, { mood, seed, musicVol = 0.55, sfx = true, withVoice = true }) {
  const total = timeline.total;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.25;
  comp.connect(ctx.destination);

  // music bus with ducking under speech
  const music = ctx.createGain();
  music.connect(comp);
  const base = 0.9 * musicVol, duck = base * 0.32;
  music.gain.setValueAtTime(0, 0);
  music.gain.linearRampToValueAtTime(base, 1.5);
  const spans = [];
  if (withVoice) for (const s of timeline.segments) {
    const a = s.start - 0.25, b = s.start + s.buffer.duration + 0.3;
    if (spans.length && a - spans[spans.length - 1][1] < 0.9) spans[spans.length - 1][1] = b; else spans.push([a, b]);
  }
  for (const [a, b] of spans) {
    music.gain.setValueAtTime(base, Math.max(1.6, a - 0.35));
    music.gain.linearRampToValueAtTime(duck, Math.max(1.7, a));
    music.gain.setValueAtTime(duck, b);
    music.gain.linearRampToValueAtTime(base, b + 0.6);
  }
  music.gain.setValueAtTime(base, Math.max(0, total - 3));
  music.gain.linearRampToValueAtTime(0, total);

  let noise;
  if (total <= LOOP_AFTER) {
    const score = new Score(ctx, mood, seed);
    score.out.connect(music);
    score.compose(total, timeline.scenes.map(s => s.start));
    noise = score.noise;
  } else {
    // Long films: compose ~2 minutes of whole chord cycles once (with its own reverb),
    // then lay copies end to end. Each copy's ringing tail flows into the next copy,
    // so the joins are seamless and mixing time stays flat for any film length.
    const m = MOODS[mood] || MOODS.epic, cycle = 60 / m.bpm * 8 * m.prog.length;
    const L = cycle * Math.max(1, Math.round(110 / cycle));
    const sub = new OfflineAudioContext(2, Math.ceil((L + 4) * SR), SR);
    const score = new Score(sub, mood, seed);
    score.out.connect(sub.destination);
    score.compose(L, [0], { ending: false });
    const loop = await sub.startRendering();
    for (let t = 0; t < total; t += L) {
      const s = ctx.createBufferSource(); s.buffer = loop; s.connect(music); s.start(t);
    }
    noise = ctx.createBuffer(1, SR * 3, SR);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // dry whooshes into each cut (no reverb: a full-length convolver is the slow part)
    timeline.scenes.forEach((s, i) => {
      if (!i) return;
      const t1 = s.start, t0 = Math.max(0, t1 - 1.3), src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, t0); f.frequency.exponentialRampToValueAtTime(5000, t1);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05, t1 - 0.05); g.gain.linearRampToValueAtTime(0, t1 + 0.25);
      src.connect(f); f.connect(g); g.connect(music); src.start(t0); src.stop(t1 + 0.3);
    });
  }

  if (sfx) {
    const fx = ctx.createGain(); fx.gain.value = 0.9; fx.connect(comp);
    const r = rng((seed || 1) * 31);
    timeline.scenes.forEach(s => ambience(ctx, fx, noise, s.ambience, s.start, s.end, r));
  }
  if (withVoice) {
    const voice = ctx.createGain(); voice.gain.value = 1.15;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    voice.connect(hp); hp.connect(comp);
    for (const s of timeline.segments) {
      const src = ctx.createBufferSource(); src.buffer = s.buffer; src.connect(voice); src.start(s.start);
    }
  }
  const out = await ctx.startRendering();
  normalise(out, 0.94);
  return out;
}

export async function previewScore(mood, seconds = 15, seed = 3) {
  const marks = [0, seconds / 2];
  return mixFilm({ total: seconds, scenes: marks.map((s, i) => ({ start: s, end: marks[i + 1] || seconds, ambience: 'none' })), segments: [] },
    { mood, seed, musicVol: 0.8, sfx: false, withVoice: false });
}

function normalise(buf, peak) {
  let max = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 2) { const v = Math.abs(d[i]); if (v > max) max = v; }
  }
  if (max < 1e-4) return;
  const k = peak / max;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}
