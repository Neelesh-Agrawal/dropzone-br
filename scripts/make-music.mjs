// Original, intense hybrid-trailer score for the Dropzone trailer: distorted
// 16th-note bass ostinato, staccato string stabs, taiko/war drums, metal hits,
// brass braams and risers, timed to the trailer cuts. Pure synthesis, so it is
// free to publish.   node scripts/make-music.mjs [out.wav]
import fs from 'node:fs';

const SR = 44100;
const DURATION = 55.5;
const N = Math.ceil(SR * DURATION);
const L = new Float32Array(N), R = new Float32Array(N), SEND = new Float32Array(N);
const BEAT = .5, SIX = BEAT / 4;

// Trailer cuts (seconds).
const CUT = { plane: 3.5, freefall: 8, parachute: 12, landing: 16.5, loot: 21, fps: 25.5, tps: 30.5, sniper: 35.5, sniperShot: 37.6, drive: 39.5, zone: 44.5, outro: 49, count: [49, 49.9, 50.8], logo: 51.7 };

let seed = 777;
const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const at = t => Math.floor(t * SR);
const put = (i, l, r = l, s = 0) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; SEND[i] += s; } };
const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

// ---------------------------------------------------------------- drums

function kick(t, g = 1) {
  let ph = 0;
  for (let k = 0; k < SR * .45; k++) {
    const s = k / SR; ph += 2 * Math.PI * (45 + 140 * Math.exp(-s * 32)) / SR;
    const v = (Math.tanh(Math.sin(ph) * 2.2) * Math.exp(-s * 7) + (k < 90 ? noise() * .4 * (1 - k / 90) : 0)) * g;
    put(at(t) + k, v, v, v * .03);
  }
}

function snare(t, g = 1) {
  let lp = 0;
  for (let k = 0; k < SR * .4; k++) {
    const s = k / SR, n = noise(); lp += (n - lp) * .3;
    const crack = (n - lp) * Math.exp(-s * 13), body = Math.sin(2 * Math.PI * 200 * s) * Math.exp(-s * 28);
    const clap = (s < .03 ? (Math.floor(s * 400) % 3 === 0 ? 1 : .3) : 1) * crack;
    const v = (clap * .85 + body * .5) * g;
    put(at(t) + k, v * .95, v, v * .5);
  }
}

function hat(t, g = .14, pan = .3, len = .05) {
  let lp = 0;
  for (let k = 0; k < SR * len; k++) {
    const n = noise(); lp += (n - lp) * .55;
    const v = (n - lp) * Math.exp(-(k / SR) * (2.6 / len)) * g;
    put(at(t) + k, v * (1 - pan), v * (1 + pan), v * .08);
  }
}

/** Taiko / war drum: deep pitched body with a skin slap. */
function taiko(t, g = 1, f = 58, pan = 0) {
  let ph = 0, lp = 0;
  for (let k = 0; k < SR * 1.1; k++) {
    const s = k / SR; ph += 2 * Math.PI * f * (1 + .5 * Math.exp(-s * 20)) / SR;
    const n = noise(); lp += (n - lp) * .12;
    const v = (Math.sin(ph) * Math.exp(-s * 3.6) * 1.1 + lp * Math.exp(-s * 25) * 1.4) * g;
    put(at(t) + k, v * (1 - pan * .6), v * (1 + pan * .6), v * .45);
  }
}

/** Metallic anvil-like hit: inharmonic partials with a long ring. */
function metal(t, g = .35) {
  const partials = [523, 811, 1247, 1733, 2391], decays = [3, 4, 5.5, 7, 9];
  for (let k = 0; k < SR * 1.4; k++) {
    const s = k / SR; let v = 0;
    partials.forEach((f, i) => { v += Math.sin(2 * Math.PI * f * s) * Math.exp(-s * decays[i]) / (i + 1); });
    v = (v + (k < 200 ? noise() * .5 : 0)) * g;
    put(at(t) + k, v * .8, v, v * .7);
  }
}

// ---------------------------------------------------------------- tonal

/** Brass braam: detuned saw stack through drive, low-pass opening then closing, with a sub drop. */
function braam(t, g = 1, length = 2.8, notes = [26, 33, 38, 41]) {
  const freqs = notes.map(hz), ph = freqs.map(() => [Math.random(), Math.random(), Math.random()]);
  let lp1 = 0, lp2 = 0, sub = 0, nlp = 0;
  for (let k = 0; k < SR * length; k++) {
    const s = k / SR, env = Math.min(1, s / .02) * Math.exp(-s * (1.6 / length * 2.4));
    let saw = 0;
    freqs.forEach((f, i) => [-.15, 0, .14].forEach((d, j) => { ph[i][j] = (ph[i][j] + f * (1 + d / 100) / SR) % 1; saw += (ph[i][j] * 2 - 1) / (i + 1); }));
    const cut = 140 + 1600 * Math.exp(-s * 2.2) * Math.min(1, s / .1);
    const c = 1 - Math.exp(-2 * Math.PI * cut / SR);
    lp1 += (saw - lp1) * c; lp2 += (lp1 - lp2) * c;
    sub += 2 * Math.PI * (24 + 45 * Math.exp(-s * 4)) / SR;
    const n = noise(); nlp += (n - nlp) * .06;
    const v = (Math.tanh(lp2 * 2.4) * .6 + Math.sin(sub) * Math.exp(-s * 1.4) * .95 + nlp * Math.exp(-s * 8) * 2.2) * env * g;
    put(at(t) + k, v, v, Math.tanh(lp2 * 2.4) * env * g * .5);
  }
}

/** Driving distorted bass ostinato in 16ths (D phrygian colour), plucked filter per note. */
const OSTINATO = [38, 38, 38, 38, 38, 38, 41, 38, 38, 38, 38, 38, 39, 38, 36, 38];
function ostinato(t0, t1, g = .5, bright = 1) {
  const phA = [0, 0, 0]; let lp = 0, sub = 0;
  for (let t = t0; t < t1 - 1e-6; t += SIX) {
    const step = Math.round((t - t0) / SIX), note = OSTINATO[step % 16] - (Math.floor(step / 64) % 2 ? 2 : 0);
    const f = hz(note), accent = step % 4 === 0 ? 1.25 : 1;
    for (let k = 0; k < SR * SIX; k++) {
      const s = k / SR, env = Math.min(1, s / .003) * Math.exp(-s * 9);
      let saw = 0;
      [-.2, 0, .2].forEach((d, j) => { phA[j] = (phA[j] + f * (1 + d / 100) / SR) % 1; saw += phA[j] * 2 - 1; });
      sub += 2 * Math.PI * (f / 2) / SR;
      const cut = (150 + 1800 * bright * Math.exp(-s * 30)) * accent;
      lp += (saw - lp) * (1 - Math.exp(-2 * Math.PI * cut / SR));
      const v = (Math.tanh(lp * 3) * .5 + Math.sin(sub) * .45) * env * g * accent;
      put(at(t) + k, v, v, 0);
    }
  }
}

/** Staccato string stabs (Dm / Bb / C colours) in an 8th-note pattern. */
const STAB_CHORDS = [[62, 65, 69], [58, 62, 65], [60, 64, 67], [62, 65, 69]];
const STAB_RHYTHM = [1, 0, 1, 1, 0, 1, 1, 0];
function strings(t0, t1, g = .14) {
  for (let t = t0; t < t1 - 1e-6; t += BEAT / 2) {
    const step = Math.round((t - t0) / (BEAT / 2));
    if (!STAB_RHYTHM[step % 8]) continue;
    const chord = STAB_CHORDS[Math.floor(step / 16) % 4].map(hz);
    const ph = chord.map(() => [0, 0]); let lp = 0;
    for (let k = 0; k < SR * .22; k++) {
      const s = k / SR, env = Math.min(1, s / .008) * Math.exp(-s * 16);
      let v = 0;
      chord.forEach((f, i) => [-.25, .25].forEach((d, j) => { ph[i][j] = (ph[i][j] + f * (1 + d / 100) / SR) % 1; v += ph[i][j] * 2 - 1; }));
      lp += (v - lp) * .18;
      const out = lp * env * g * (step % 4 === 0 ? 1.2 : 1);
      put(at(t) + k, out * 1.1, out * .9, out * .7);
    }
  }
}

/** Tense high string tremolo (sniper hush, zone build). */
function tremolo(t0, t1, g = .07, rise = false) {
  const notes = [74, 77, 81].map(hz), ph = notes.map(() => 0);
  let lp = 0;
  for (let i = at(t0); i < Math.min(N, at(t1)); i++) {
    const s = i / SR - t0, p = s / (t1 - t0), trem = .55 + .45 * Math.sin(2 * Math.PI * 13 * s);
    let v = 0; notes.forEach((f, j) => { ph[j] = (ph[j] + f * (rise ? 1 + p * .06 : 1) / SR) % 1; v += ph[j] * 2 - 1; });
    lp += (v - lp) * .12;
    const env = Math.min(1, s / .5) * (rise ? .4 + p : 1) * Math.min(1, (t1 - t0 - s) / .05);
    put(i, lp * trem * env * g, lp * trem * env * g * .9, lp * env * g * .6);
  }
}

/** Dark drone: low D and A fifths, always underneath. */
function drone(level) {
  const f = [hz(26), hz(33), hz(38)], ph = [0, 0, 0]; let lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, g = level(t); if (g <= 0) continue;
    let v = 0; f.forEach((fr, j) => { ph[j] = (ph[j] + fr * (1 + .002 * Math.sin(t * (j + 1))) / SR) % 1; v += ph[j] * 2 - 1; });
    lp += (v - lp) * .01;
    put(i, lp * g * .25, lp * g * .25, lp * g * .1);
  }
}

function riser(t0, t1, g = .5) {
  let low = 0, band = 0, ph = 0;
  const len = (t1 - t0) * SR;
  for (let k = 0; k < len; k++) {
    const p = k / len, cutoff = 250 + 6000 * p * p, f = 2 * Math.sin(Math.PI * cutoff / SR), n = noise();
    low += f * band; const high = n - low - .35 * band; band += f * high;
    ph += 2 * Math.PI * (120 + 1100 * p * p * p) / SR;
    const v = (band * .55 + Math.sin(ph) * .18) * p * p * g;
    put(at(t0) + k, v, v, v * .4);
  }
}

function heartbeat(t, g = .8) { taiko(t, g, 46); taiko(t + .2, g * .65, 42); }

// ---------------------------------------------------------------- arrangement

drone(t => t < 2 ? t / 2 * .9 : t > CUT.logo ? Math.max(0, .9 * (1 - (t - CUT.logo) / 3.8)) : .9);

// Cold open: metal hit, sub and a slow clock.
braam(.2, .5, 3.2, [26, 33, 38]); metal(.2, .3);
for (let t = 1; t < CUT.plane; t += BEAT) hat(t, .08, .5, .03);
// Plane: filtered pulse building, toms gathering.
ostinato(CUT.plane, CUT.freefall, .32, .35);
for (let t = CUT.plane; t < CUT.freefall; t += BEAT) hat(t + BEAT / 2, .1);
for (let t = 6; t < CUT.freefall; t += BEAT) taiko(t, .55 + (t - 6) * .15, 62);
for (let k = 0; k < 8; k++) snare(CUT.freefall - .5 + k * SIX / 2, .25 + k * .07);
riser(5.6, CUT.freefall, .6);

// Drop: braam, then the engine of the track starts.
braam(CUT.freefall, 1.1); metal(CUT.freefall, .45);
ostinato(CUT.freefall, CUT.parachute, .5, 1);
strings(CUT.freefall, CUT.parachute, .12);
for (let t = CUT.freefall; t < CUT.parachute; t += BEAT) {
  const b = Math.round((t - CUT.freefall) / BEAT);
  if (b % 2 === 0) kick(t, .95);
  if (b % 4 === 2) { snare(t, .9); taiko(t, .7, 70, .3); }
  hat(t + BEAT / 2, .14);
}
// Parachute: pull back to war drums and a filtered pulse.
ostinato(CUT.parachute, CUT.landing, .38, .45);
for (let t = CUT.parachute; t < CUT.landing; t += BEAT) {
  const b = Math.round((t - CUT.parachute) / BEAT);
  if (b % 4 === 0) taiko(t, 1, 52); if (b % 4 === 3) taiko(t + BEAT / 2, .6, 64, -.4);
}
tremolo(CUT.parachute, CUT.landing, .045);
riser(15, CUT.landing, .6);
for (let k = 0; k < 12; k++) taiko(CUT.landing - .75 + k * SIX / 2, .4 + k * .05, 60 + k * 2, k % 2 ? .5 : -.5);

/** Full action groove: four-on-the-floor kick, backbeat, 16th hats, war-drum fills, ostinato and stabs. */
function action(t0, t1, intensity = 1, withStrings = true) {
  braam(t0, .9 * intensity, 2.2); metal(t0, .4);
  ostinato(t0, t1, .5 * intensity, 1);
  if (withStrings) strings(t0, t1, .13 * intensity);
  for (let t = t0; t < t1 - 1e-6; t += SIX) {
    const step = Math.round((t - t0) / SIX), barStep = step % 16;
    if (barStep % 4 === 0) kick(t, .95 * intensity);
    if (barStep === 4 || barStep === 12) snare(t, .95 * intensity);
    hat(t, barStep % 2 ? .07 : .13, barStep % 4 === 2 ? -.4 : .4);
    if (barStep === 0 && step % 32 === 0) metal(t, .22);
    // War-drum fill at the end of every second bar.
    if (step % 32 >= 26 && step % 2 === 0) taiko(t, .55 * intensity, 64 + (step % 32) * 1.5, (step % 4 ? .5 : -.5));
  }
}
action(CUT.landing, CUT.loot, 1);
action(CUT.loot, CUT.fps, .95, false);
action(CUT.fps, CUT.sniper - .5, 1.15);
for (let k = 0; k < 8; k++) snare(CUT.sniper - .5 + k * SIX / 2, .3 + k * .08);

// Sniper: the floor drops out. Heartbeat and high tension until the shot, then a massive hit.
tremolo(CUT.sniper, CUT.sniperShot, .06, true);
heartbeat(CUT.sniper + .15); heartbeat(CUT.sniper + 1.0, .9); heartbeat(CUT.sniper + 1.7, 1);
braam(CUT.sniperShot, 1.3, 2.4); metal(CUT.sniperShot, .5); taiko(CUT.sniperShot, 1.2, 48);
riser(38.2, CUT.drive, .55);
action(CUT.drive, CUT.zone, 1.2);

// Zone: drums out, a ticking clock and rising tension into the countdown.
for (let t = CUT.zone; t < CUT.outro; t += SIX) hat(t, .05 + (t - CUT.zone) / 4.5 * .08, (Math.round(t / SIX) % 2) ? .5 : -.5, .03);
for (let t = CUT.zone; t < CUT.outro; t += BEAT) taiko(t, .45 + (t - CUT.zone) / 4.5 * .45, 50);
tremolo(CUT.zone, CUT.outro, .07, true);
ostinato(CUT.zone + 2, CUT.outro, .3, .4);
riser(46.3, CUT.outro, .7);

// Countdown: three hammer blows, each bigger; a breath; then the logo slam.
CUT.count.forEach((t, i) => { braam(t, .8 + i * .2, .9); taiko(t, 1.1, 50 - i * 3); metal(t, .35 + i * .08); snare(t, .9); });
riser(51.05, CUT.logo - .06, .5);
braam(CUT.logo, 1.5, 3.8, [26, 33, 38, 41, 45]); taiko(CUT.logo, 1.3, 44); metal(CUT.logo, .55); kick(CUT.logo, 1.2);

// ---------------------------------------------------------------- reverb + master

function reverb() {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map(d => ({ buf: new Float32Array(d), i: 0, lp: 0 }));
  const allpass = [556, 441, 341].map(d => ({ buf: new Float32Array(d), i: 0 }));
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const x = SEND[n] * .18; let y = 0;
    for (const c of combs) { const o = c.buf[c.i]; c.lp = o * .65 + c.lp * .35; c.buf[c.i] = x + c.lp * .87; c.i = (c.i + 1) % c.buf.length; y += o; }
    for (const a of allpass) { const o = a.buf[a.i]; const v = -y + o; a.buf[a.i] = y + o * .5; a.i = (a.i + 1) % a.buf.length; y = v; }
    out[n] = y;
  }
  return out;
}
const wet = reverb(), spread = Math.floor(SR * .015);
let peak = 0;
for (let n = 0; n < N; n++) {
  L[n] = Math.tanh((L[n] + wet[n] * .85) * .85);
  R[n] = Math.tanh((R[n] + (n >= spread ? wet[n - spread] : 0) * .85) * .85);
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}
const gain = .89 / peak, fadeOut = SR * 1.8;
const pcm = Buffer.alloc(N * 4);
for (let n = 0; n < N; n++) {
  const f = Math.min(1, n / (SR * .03)) * Math.min(1, (N - n) / fadeOut);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * gain * f)) * 32767), n * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * gain * f)) * 32767), n * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
const out = process.argv[2] || 'recordings/dropzone-score.wav';
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`Wrote ${out} (${DURATION}s)`);
