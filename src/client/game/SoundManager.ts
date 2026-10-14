import * as THREE from 'three';

type Category = 'ar' | 'smg' | 'dmr' | 'shotgun' | 'sniper' | string;

interface GunVoice {
  crack: number;      // transient high band level
  crackFreq: number;
  body: number;       // mid noise level
  bodyFreq: number;
  bodyDecay: number;  // seconds
  thump: number;      // low sine level
  thumpFreq: number;
  tail: number;       // reverb send
}

const VOICES: Record<string, GunVoice> = {
  ar:      { crack: .55, crackFreq: 3800, body: .9,  bodyFreq: 1500, bodyDecay: .16, thump: .7,  thumpFreq: 110, tail: .55 },
  smg:     { crack: .45, crackFreq: 4400, body: .7,  bodyFreq: 1900, bodyDecay: .11, thump: .45, thumpFreq: 140, tail: .4 },
  dmr:     { crack: .7,  crackFreq: 3200, body: 1.0, bodyFreq: 1200, bodyDecay: .24, thump: .9,  thumpFreq: 90,  tail: .8 },
  shotgun: { crack: .5,  crackFreq: 2600, body: 1.15,bodyFreq: 900,  bodyDecay: .28, thump: 1.1, thumpFreq: 70,  tail: .85 },
  sniper:  { crack: .85, crackFreq: 3000, body: 1.1, bodyFreq: 1000, bodyDecay: .34, thump: 1.0, thumpFreq: 75,  tail: 1.0 }
};

/**
 * Procedural combat audio. Everything is synthesized at runtime so the game
 * ships no audio files: layered gunshots (transient crack, noise body, low
 * thump, outdoor reverb tail), staged reload foley, impacts and UI cues.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverbSend!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private distortion!: WaveShaperNode;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  private engineGain?: GainNode;
  private engineOsc?: OscillatorNode;
  public muted = false;

  public initCtx(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private buildGraph(): void {
    const ctx = this.ctx!;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14; compressor.knee.value = 8; compressor.ratio.value = 6;
    compressor.attack.value = .002; compressor.release.value = .18;
    this.master = ctx.createGain(); this.master.gain.value = .8;
    this.master.connect(compressor); compressor.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);

    // Outdoor reverb: a decaying noise impulse with early slap reflections.
    const length = Math.floor(ctx.sampleRate * 1.8);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate;
        const slap = (Math.abs(t - .09 - c * .013) < .004 ? 2.2 : 0) + (Math.abs(t - .21 - c * .021) < .006 ? 1.2 : 0);
        data[i] = (Math.random() * 2 - 1) * (Math.pow(1 - i / length, 3.2) * .55 + slap * Math.exp(-t * 4));
      }
    }
    const convolver = ctx.createConvolver(); convolver.buffer = impulse;
    const reverbFilter = ctx.createBiquadFilter(); reverbFilter.type = 'lowpass'; reverbFilter.frequency.value = 2600;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = .32;
    this.reverbSend.connect(convolver); convolver.connect(reverbFilter); reverbFilter.connect(this.master);

    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;

    this.distortion = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
    this.distortion.curve = curve;
    this.distortion.connect(this.sfx);
  }

  private noise(start: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.start(start, Math.random() * 1.5, duration + .05);
    return src;
  }

  private env(gain: GainNode, start: number, peak: number, attack: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), start + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, start + attack + decay);
  }

  /** Short filtered noise burst. Used for clicks, clacks, cloth and dirt. */
  private burst(at: number, freq: number, q: number, peak: number, decay: number, type: BiquadFilterType = 'bandpass', out: AudioNode = this.sfx): void {
    const ctx = this.ctx!;
    const src = this.noise(at, decay + .02);
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = ctx.createGain(); this.env(gain, at, peak, .002, decay);
    src.connect(filter); filter.connect(gain); gain.connect(out);
  }

  private tone(at: number, type: OscillatorType, from: number, to: number, peak: number, decay: number, out: AudioNode = this.sfx): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + decay);
    const gain = ctx.createGain(); this.env(gain, at, peak, .003, decay);
    osc.connect(gain); gain.connect(out); osc.start(at); osc.stop(at + decay + .05);
  }

  private shot(category: Category, suppressed: boolean, volume: number, at: number, out: AudioNode, distanceMuffle = 0): void {
    const ctx = this.ctx!;
    const v = VOICES[category] || VOICES.ar;
    const pitch = .94 + Math.random() * .12;
    const s = suppressed ? .35 : 1;
    // Transient crack — the supersonic snap that defines a rifle report.
    if (!suppressed) {
      const src = this.noise(at, .03);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v.crackFreq * pitch * (1 - distanceMuffle * .7);
      const g = ctx.createGain(); this.env(g, at, v.crack * volume * (1 - distanceMuffle), .001, .025);
      src.connect(hp); hp.connect(g); g.connect(out);
    }
    // Noise body through soft clipping for a punchy, saturated blast.
    const body = this.noise(at, v.bodyDecay + .1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    const bodyFreq = (suppressed ? 700 : v.bodyFreq) * pitch * (1 - distanceMuffle * .75);
    lp.frequency.setValueAtTime(bodyFreq * 2.2, at); lp.frequency.exponentialRampToValueAtTime(Math.max(120, bodyFreq * .35), at + v.bodyDecay);
    const bg = ctx.createGain(); this.env(bg, at, v.body * volume * s, .002, v.bodyDecay * (suppressed ? .7 : 1));
    body.connect(lp); lp.connect(bg); bg.connect(out === this.sfx ? this.distortion : out);
    // Sub thump felt more than heard.
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(v.thumpFreq * 1.8 * pitch, at); osc.frequency.exponentialRampToValueAtTime(v.thumpFreq * .45, at + .14);
    const og = ctx.createGain(); this.env(og, at, v.thump * volume * s * (1 - distanceMuffle * .4), .003, .16);
    osc.connect(og); og.connect(out); osc.start(at); osc.stop(at + .25);
    // Reverb tail sells the open valley.
    const tail = ctx.createGain(); tail.gain.value = v.tail * volume * (suppressed ? .25 : 1) * (1 + distanceMuffle);
    bg.connect(tail); tail.connect(this.reverbSend);
  }

  // 1. Local player gunshot, including mechanical action noise.
  public playGunshot(weaponCategory: string, suppressed = false): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.shot(weaponCategory, suppressed, 1, now, this.sfx);
    // Low boom felt in the chest, longer for heavy calibres.
    const heavy = weaponCategory === 'sniper' || weaponCategory === 'dmr' || weaponCategory === 'shotgun';
    if (!suppressed) this.tone(now, 'sine', heavy ? 95 : 120, heavy ? 32 : 42, heavy ? .55 : .3, heavy ? .45 : .22);
    // Outdoor echo rolling back off the valley for big rifles.
    if (heavy && !suppressed) {
      const echo = this.ctx.createBiquadFilter(); echo.type = 'lowpass'; echo.frequency.value = 900;
      echo.connect(this.sfx);
      this.shot(weaponCategory, false, .32, now + .24, echo, .55);
      this.shot(weaponCategory, false, .16, now + .58, echo, .75);
    }
    // Bolt carrier cycling right after the shot.
    this.burst(now + .035, 2400 + Math.random() * 600, 6, .08, .03);
    if (weaponCategory === 'shotgun') { this.burst(now + .32, 1300, 4, .22, .05); this.burst(now + .45, 1700, 5, .25, .04); }
    if (weaponCategory === 'sniper') { this.burst(now + .55, 1500, 5, .2, .05); this.burst(now + .72, 2100, 6, .22, .04); }
  }

  /** Point the Web Audio listener along the camera so spatial shots pan correctly. */
  public updateListener(position: THREE.Vector3, yaw: number): void {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.setValueAtTime(position.x, t); l.positionY.setValueAtTime(position.y, t); l.positionZ.setValueAtTime(position.z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  // 2. 3D spatial audio for other operators' gunshots, delayed by the speed of sound.
  public playSpatialGunshot(pos: THREE.Vector3, listenerPos: THREE.Vector3, weaponCategory: string): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const dist = pos.distanceTo(listenerPos);
    if (dist > 900) return;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
    panner.refDistance = 12; panner.maxDistance = 900; panner.rolloffFactor = .9;
    const t = this.ctx.currentTime + Math.min(1.5, dist / 343);
    panner.positionX.setValueAtTime(pos.x, t); panner.positionY.setValueAtTime(pos.y, t); panner.positionZ.setValueAtTime(pos.z, t);
    panner.connect(this.sfx);
    this.shot(weaponCategory, false, .9, t, panner, Math.min(.85, dist / 600));
  }

  // 3. Supersonic crack of a round passing close to the player.
  public playBulletWhizBy(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.burst(now, 5200, 2, .35, .03, 'highpass');
    const src = this.noise(now, .18);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8;
    bp.frequency.setValueAtTime(3600, now); bp.frequency.exponentialRampToValueAtTime(900, now + .16);
    const pan = this.ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - .8;
    const g = this.ctx.createGain(); this.env(g, now, .3, .01, .15);
    src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.sfx);
  }

  // 4. Hit confirmation: body tick, headshot ring, elimination chime.
  public playHitMarker(headshot = false, kill = false): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.burst(now, 2600, 3, .28, .035);
    this.tone(now, 'triangle', 1700, 1100, .16, .05);
    if (headshot) { this.tone(now + .01, 'sine', 2900, 2700, .2, .32); this.tone(now + .01, 'sine', 4350, 4200, .08, .25); }
    if (kill) { this.tone(now + .06, 'triangle', 660, 640, .22, .14); this.tone(now + .16, 'triangle', 990, 980, .22, .22); this.burst(now + .05, 180, 1, .4, .12, 'lowpass'); }
  }

  /** The player is hit: a meaty thud plus a short tinnitus ring for heavy hits. */
  public playDamageTaken(heavy = false): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.tone(now, 'sine', 160, 50, .5, .18);
    this.burst(now, 500, 1, .35, .09, 'lowpass');
    if (heavy) this.tone(now + .02, 'sine', 3800, 3700, .035, 1.2);
  }

  // 5. Staged reload foley that tracks the reload animation.
  public playReload(reloadTime = 2.2, empty = true): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    // Magazine release + drop
    this.burst(now + reloadTime * .14, 2100, 5, .32, .04);
    this.burst(now + reloadTime * .17, 900, 3, .18, .06);
    // Cloth/pouch rustle
    this.burst(now + reloadTime * .3, 3000, .7, .06, .22);
    // New magazine seated: two sharp clacks
    this.burst(now + reloadTime * .58, 1600, 6, .42, .035);
    this.burst(now + reloadTime * .61, 2600, 7, .36, .03);
    this.tone(now + reloadTime * .58, 'square', 420, 300, .05, .03);
    if (empty) {
      // Charging handle back and forward
      const pull = this.noise(now + reloadTime * .76, .12);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(1200, now + reloadTime * .76); bp.frequency.linearRampToValueAtTime(3200, now + reloadTime * .76 + .1);
      const g = this.ctx.createGain(); this.env(g, now + reloadTime * .76, .22, .01, .1);
      pull.connect(bp); bp.connect(g); g.connect(this.sfx);
      this.burst(now + reloadTime * .84, 2200, 8, .45, .04);
    }
  }

  public playDryFire(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    this.burst(this.ctx.currentTime, 3200, 9, .3, .025);
  }

  public playEquip(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.burst(now, 2500, .6, .08, .14);
    this.burst(now + .18, 1900, 6, .25, .035);
  }

  public playFireModeSwitch(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    this.burst(this.ctx.currentTime, 3500, 10, .25, .02);
  }

  /** Bullet striking a surface near the shooter. */
  public playImpact(kind: 'hard' | 'soft' | 'flesh', distance = 10): void {
    this.initCtx(); if (!this.ctx || this.muted || distance > 120) return;
    const now = this.ctx.currentTime, v = Math.max(.04, .3 - distance / 400);
    if (kind === 'flesh') { this.burst(now, 300, 1, v * 1.6, .07, 'lowpass'); return; }
    if (kind === 'hard') { this.burst(now, 3800, 4, v, .05); this.tone(now, 'triangle', 2600 + Math.random() * 900, 1800, v * .3, .08); }
    else this.burst(now, 700, 1, v * 1.2, .09, 'lowpass');
  }

  // 6. Loot pickup — gear rustle with a type-specific accent.
  public playLootPickup(kind: string = 'item'): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.burst(now, 2200, .7, .14, .12);
    if (kind === 'weapon') { this.burst(now + .08, 1500, 5, .32, .05); this.burst(now + .2, 2300, 7, .3, .03); }
    else if (kind === 'ammo') { for (let i = 0; i < 3; i++) this.burst(now + .04 + i * .05, 4200 + i * 300, 9, .15, .03); }
    else if (kind === 'armor') this.burst(now + .05, 600, 2, .3, .1);
    else this.tone(now + .04, 'sine', 880, 1320, .07, .1);
  }

  public playHealStart(kind: 'medkit' | 'bandage'): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < (kind === 'medkit' ? 4 : 3); i++) this.burst(now + i * .35, 3300, .6, .08, .25);
  }

  public playHealComplete(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.tone(now, 'sine', 660, 660, .12, .12); this.tone(now + .1, 'sine', 990, 990, .12, .2);
  }

  // 7. Victory fanfare
  public playVictoryFanfare(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, i) => this.tone(now + i * .14, 'triangle', freq, freq, .3, .5));
  }

  public playDefeat(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    [392, 349.23, 293.66].forEach((freq, i) => this.tone(now + i * .22, 'triangle', freq, freq * .98, .22, .6));
  }

  /**
   * Pre-rendered boot steps: a soft heel strike followed by a granular
   * gravel/dirt crunch as the sole rolls. Several variants avoid repetition.
   */
  private stepBuffers: AudioBuffer[] = [];
  private stepFoot = 1;
  private buildSteps(): void {
    const ctx = this.ctx!, rate = ctx.sampleRate;
    for (let v = 0; v < 6; v++) {
      const length = Math.floor(rate * .2), buffer = ctx.createBuffer(1, length, rate), data = buffer.getChannelData(0);
      // Heel: short damped low thump.
      const heelFreq = 70 + Math.random() * 25;
      for (let i = 0; i < length; i++) { const t = i / rate; data[i] += Math.sin(2 * Math.PI * heelFreq * t) * Math.exp(-t * 55) * .9; }
      // Sole roll: dozens of tiny grit impulses spread over ~90 ms.
      const grains = 38 + Math.floor(Math.random() * 20);
      for (let g = 0; g < grains; g++) {
        const start = Math.floor(rate * (.008 + Math.pow(Math.random(), 1.6) * .09)), amp = (.25 + Math.random() * .55) * (1 - start / (rate * .12));
        const decay = 900 + Math.random() * 2200, len = Math.floor(rate * .004);
        for (let i = 0; i < len && start + i < length; i++) data[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-(i / rate) * decay);
      }
      // Gentle one-pole low-pass so the grit sounds like dirt, not static.
      let prev = 0; for (let i = 0; i < length; i++) { prev += (data[i] - prev) * .38; data[i] = prev; }
      this.stepBuffers.push(buffer);
    }
  }

  // 8. Footsteps — heavier while sprinting, soft while crouched, alternating feet.
  public playFootstep(sprinting = false, crouching = false): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    if (!this.stepBuffers.length) this.buildSteps();
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.stepBuffers[Math.floor(Math.random() * this.stepBuffers.length)];
    src.playbackRate.value = (sprinting ? 1.08 : crouching ? .9 : 1) * (.94 + Math.random() * .12);
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = crouching ? 1400 : sprinting ? 3600 : 2600;
    const gain = ctx.createGain(); gain.gain.value = (crouching ? .18 : sprinting ? .55 : .36) * (.85 + Math.random() * .3);
    const pan = ctx.createStereoPanner(); this.stepFoot *= -1; pan.pan.value = this.stepFoot * .12;
    src.connect(tone); tone.connect(gain); gain.connect(pan); pan.connect(this.sfx);
    src.start(now);
    // Gear rattle on sprint steps.
    if (sprinting && Math.random() < .6) this.burst(now + .03, 3800 + Math.random() * 1200, 3, .04, .05);
  }

  private vehicle?: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode; road: GainNode; roadFilter: BiquadFilterNode };
  /** Engine note follows speed with simulated gear changes; 0 = engine off. */
  public setVehicleEngine(speed: number, active: boolean): void {
    if (!active && !this.vehicle) return;
    this.initCtx(); if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.vehicle) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const sub = ctx.createOscillator(); sub.type = 'square';
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 3;
      const gain = ctx.createGain(); gain.gain.value = 0;
      osc.connect(filter); sub.connect(filter); filter.connect(gain); gain.connect(this.sfx);
      const road = ctx.createGain(); road.gain.value = 0;
      const roadSrc = ctx.createBufferSource(); roadSrc.buffer = this.noiseBuffer; roadSrc.loop = true;
      const roadFilter = ctx.createBiquadFilter(); roadFilter.type = 'bandpass'; roadFilter.Q.value = .7;
      roadSrc.connect(roadFilter); roadFilter.connect(road); road.connect(this.sfx);
      osc.start(); sub.start(); roadSrc.start();
      this.vehicle = { osc, sub, gain, filter, road, roadFilter };
    }
    const v = this.vehicle, t = ctx.currentTime, s = Math.abs(speed);
    // Four "gears": rpm climbs within each band then drops on the shift.
    const gearTop = [7, 13, 19, 30], gear = gearTop.findIndex(top => s < top), g = gear < 0 ? 3 : gear;
    const low = g === 0 ? 0 : gearTop[g - 1], rpm = .25 + .75 * Math.min(1, (s - low) / (gearTop[g] - low));
    const freq = 38 + rpm * 70 + g * 6;
    v.osc.frequency.setTargetAtTime(freq, t, .06); v.sub.frequency.setTargetAtTime(freq / 2, t, .06);
    v.filter.frequency.setTargetAtTime(300 + rpm * 900, t, .08);
    v.gain.gain.setTargetAtTime(active && !this.muted ? .07 + rpm * .06 : 0, t, .12);
    v.road.gain.setTargetAtTime(active && !this.muted ? Math.min(.12, s / 200) : 0, t, .15);
    v.roadFilter.frequency.setTargetAtTime(200 + s * 25, t, .2);
  }

  /** Vehicle striking an operator. */
  public playVehicleHit(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.tone(now, 'sine', 120, 40, .7, .25);
    this.burst(now, 400, 1, .6, .15, 'lowpass');
    this.burst(now + .02, 1800, 2, .25, .08);
  }

  public playLanding(hard = false): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.burst(now, 260, 1, hard ? .7 : .35, .16, 'lowpass');
    this.tone(now, 'sine', 120, 45, hard ? .5 : .25, .18);
  }

  public playParachuteOpen(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.noise(now, .6);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = .8;
    bp.frequency.setValueAtTime(400, now); bp.frequency.exponentialRampToValueAtTime(1400, now + .25);
    const g = this.ctx.createGain(); this.env(g, now, .55, .05, .5);
    src.connect(bp); bp.connect(g); g.connect(this.sfx);
  }

  /** Continuous wind while skydiving; intensity 0 silences it. */
  public setWind(intensity: number): void {
    if (!this.ctx) { if (intensity <= 0) return; this.initCtx(); }
    const ctx = this.ctx!;
    if (!this.windGain) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.loop = true;
      this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.Q.value = .6;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      src.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.sfx); src.start();
    }
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : intensity * .22, ctx.currentTime, .15);
    this.windFilter!.frequency.setTargetAtTime(500 + intensity * 900, ctx.currentTime, .2);
  }

  /** Transport aircraft drone, 0 to stop. */
  public setEngine(intensity: number): void {
    if (!this.ctx) { if (intensity <= 0) return; this.initCtx(); }
    const ctx = this.ctx!;
    if (!this.engineGain) {
      this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 58;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lfoGain = ctx.createGain(); lfoGain.gain.value = 4;
      lfo.connect(lfoGain); lfoGain.connect(this.engineOsc.frequency); lfo.start();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
      this.engineOsc.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(this.sfx); this.engineOsc.start();
    }
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : intensity * .18, ctx.currentTime, .3);
  }

  public playVehicleStart(): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    // Starter motor whirr, then the engine catches.
    for (let i = 0; i < 4; i++) this.tone(now + i * .07, 'square', 160, 120, .05, .06);
    this.tone(now + .3, 'sawtooth', 35, 70, .18, .5);
    this.burst(now + .3, 300, 1, .25, .3, 'lowpass');
  }

  /** Water stroke / splash foley when swimming or wading in lakes & coastal channels. */
  public playSwimStroke(fast = false): void {
    this.initCtx(); if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    // Low water surge + aerated splash band
    this.burst(now, fast ? 620 : 480, 1.1, fast ? .28 : .18, .22, 'bandpass');
    this.burst(now + .05, fast ? 1450 : 1100, 1.6, fast ? .16 : .10, .18, 'bandpass');
    this.tone(now, 'sine', 95, 48, fast ? .14 : .08, .18);
  }
}
