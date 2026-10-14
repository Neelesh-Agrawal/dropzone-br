/**
 * Development-only trailer director. Each shot sets up the world once, then
 * drives the player, bots and (optionally) a cinematic camera every frame.
 * The recorder (scripts/record.mjs) steps the game at a fixed rate and
 * captures each frame, so timing is exact regardless of machine speed.
 */
import * as THREE from 'three';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const g = (): Any => (window as Any).__dropzone;
const pc = (): Any => g().playerController;
const OLD_TOWN = { x: -1650, z: -1250 };
const ease = (t: number) => t * t * (3 - 2 * t);

const cinematic = () => (window as Any).__cinematic !== false;

function setCamera(fn: ((camera: THREE.PerspectiveCamera) => void) | null): void {
  (window as Any).__cameraHook = cinematic() ? fn : null;
}

function hud(visible: boolean): void { if (visible || !cinematic()) g().gameHUD.show(); else g().gameHUD.hide(); }

function key(code: string, down: boolean): void { (window as Any).__harness.key(code, down); }

function releaseKeys(): void { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) key(k, false); }

/** Point the first-person view at a world position. */
function aimFirstPerson(target: THREE.Vector3, smoothing = 1): void {
  const p = pc(), eye = p.position;
  const dx = target.x - eye.x, dz = target.z - eye.z, dy = target.y - eye.y;
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const dyaw = THREE.MathUtils.euclideanModulo(yaw - p.yaw + Math.PI, Math.PI * 2) - Math.PI;
  p.yaw += dyaw * smoothing; p.pitch += (pitch - p.pitch) * smoothing;
}

/** Third person: solve yaw/pitch so the shoulder camera's crosshair lands on target. */
function aimThirdPerson(target: THREE.Vector3): void {
  const p = pc();
  aimFirstPerson(target);
  for (let i = 0; i < 4; i++) {
    p.update(1e-6);
    const cam: THREE.PerspectiveCamera = g().camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = target.clone().sub(cam.position).normalize();
    const yawErr = Math.atan2(-to.x, -to.z) - Math.atan2(-dir.x, -dir.z);
    p.yaw += THREE.MathUtils.euclideanModulo(yawErr + Math.PI, Math.PI * 2) - Math.PI;
    p.pitch += Math.asin(THREE.MathUtils.clamp(to.y, -1, 1)) - Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }
}

/** Gameplay shots are self-contained: HUD on, player standing on the ground. */
function grounded(): void {
  const p = pc();
  if (p.dropStage !== 'none') { p.dropStage = 'none'; p.isGrounded = true; p.velocity.set(0, 0, 0); }
  hud(true);
}

function trigger(down: boolean): void {
  const cs = g().combatSystem;
  if (down && !cs.triggerHeld) cs.triggerConsumed = false;
  cs.triggerHeld = down;
}

/** Take a bot out of the AI loop and stand it at a position facing the player. */
function stageBot(index: number, x: number, z: number): Any {
  const bot = g().offlineBots[index];
  // Staged duels last a couple of seconds so the fight reads on camera.
  bot.isEliminated = false; bot.health = 170; bot.armor = 50;
  bot.position.x = x; bot.position.z = z; bot.position.y = g().map.getTerrainHeight(x, z);
  bot.velocity = { x: 0, y: 0, z: 0 };
  return bot;
}

function botTarget(bot: Any, chest = 1.25): THREE.Vector3 { return new THREE.Vector3(bot.position.x, bot.position.y + chest, bot.position.z); }

/** Bot fires a near miss at the player: muzzle flash, tracer, sound-free. */
function botReturnFire(bot: Any): void {
  const model = g().remotePlayers.get(bot.id);
  if (!model) return;
  model.fire();
  const from = model.getMuzzle()?.position ?? botTarget(bot, 1.45);
  const to = pc().position.clone().add(new THREE.Vector3((Math.random() - .5) * 3, .5 + Math.random(), (Math.random() - .5) * 3));
  g().particleSystem.spawnTracer(from, to);
  g().particleSystem.spawnMuzzleFlash(from, to.clone().sub(from).normalize(), .8);
  g().soundManager.playSpatialGunshot(from.clone(), pc().position.clone(), WEAPON_CATEGORY[bot.equippedWeapon] ?? 'ar');
  if (Math.random() < .35) g().soundManager.playBulletWhizBy();
}

const WEAPON_CATEGORY: Record<string, string> = { viper_ar: 'ar', rook_smg: 'smg', sentinel_dmr: 'dmr', hammer_shotgun: 'shotgun', longbow: 'sniper' };

function faceBot(bot: Any): void {
  const p = pc().position;
  bot.rotation.yaw = Math.atan2(-(p.x - bot.position.x), -(p.z - bot.position.z));
  bot.rotation.pitch = 0;
}

function title(html: string | null, opacity = 1): void {
  let el = document.getElementById('trailer-title');
  if (!el) {
    el = document.createElement('div'); el.id = 'trailer-title';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;display:grid;place-items:center;pointer-events:none;text-align:center;color:#f2ecdc;text-shadow:0 4px 24px #000a';
    document.body.appendChild(el);
  }
  el.innerHTML = cinematic() ? html ?? '' : '';
  el.style.opacity = String(opacity);
}

const TITLE = (sub: string) => `<div><div style="font:700 15px Inter,sans-serif;letter-spacing:.5em;color:#edc27c;margin-bottom:6px">ASHEN VALLEY</div><div style="font:600 170px/0.85 Teko,sans-serif;letter-spacing:.06em">DROPZONE</div><div style="font:500 22px Inter,sans-serif;letter-spacing:.18em;margin-top:14px;color:#e6e0cf">${sub}</div></div>`;

export interface Shot { duration: number; setup(): void; frame(t: number, dt: number): void; teardown?(): void; }

let lastFire = 0;

export const SHOTS: Record<string, Shot> = {
  lobby: {
    duration: 3.5,
    setup() { title(null); },
    frame(t) { title(TITLE('BATTLE ROYALE · RIGHT IN YOUR BROWSER'), t < .4 ? t / .4 : t > 3 ? (3.5 - t) / .5 : 1); }
  },

  plane: {
    duration: 4.5,
    setup() {
      title(null);
      g().lobbyUI.onStartMatchCallback();
      (window as Any).__harness.step(.2);
      const plane = g().dropPlane;
      // Fly toward Old Town at golden hour.
      plane.start.set(-2600, 520, -900); plane.end.set(1500, 520, -1600);
      plane.length = plane.start.distanceTo(plane.end); plane.progress = .34;
      plane.group.position.lerpVectors(plane.start, plane.end, plane.progress);
      plane.group.lookAt(plane.end); plane.group.rotateY(Math.PI);
      g().offlineCombatAt = Infinity;
      g().updateOfflineBots = () => { /* bots are staged per shot */ };
      hud(false);
    },
    frame(t) {
      const plane = g().dropPlane.group.position as THREE.Vector3;
      // Three-quarter front orbit, slightly above, so both wings and the props read.
      const heading = Math.atan2(g().dropPlane.end.x - g().dropPlane.start.x, g().dropPlane.end.z - g().dropPlane.start.z);
      const a = heading + .9 - t * .2;
      setCamera(cam => {
        cam.position.set(plane.x + Math.sin(a) * 48, plane.y + 9 - t * 1.2, plane.z + Math.cos(a) * 48);
        cam.lookAt(plane.x, plane.y + 1, plane.z);
        cam.fov = 50; cam.updateProjectionMatrix();
      });
      title(t < 2.6 ? `<div style="font:600 64px Teko,sans-serif;letter-spacing:.08em">DROP IN</div>` : null, t < .4 ? t / .4 : t < 2.2 ? 1 : Math.max(0, (2.6 - t) / .4));
    },
    teardown() { setCamera(null); title(null); }
  },

  freefall: {
    duration: 4,
    setup() {
      const p = pc();
      p.jumpFromPlane();
      p.position.set(OLD_TOWN.x - 120, g().map.getTerrainHeight(OLD_TOWN.x, OLD_TOWN.z) + 380, OLD_TOWN.z + 160);
      p.velocity.set(0, -50, 0);
      p.yaw = Math.atan2(-(OLD_TOWN.x - p.position.x), -(OLD_TOWN.z - p.position.z));
      p.dropHeading = p.yaw;
      p.pitch = -.75;
      key('KeyW', true);
      hud(true);
    },
    frame() { pc().pitch = -.75; }
  },

  parachute: {
    duration: 4.5,
    setup() {
      const p = pc();
      if (p.dropStage !== 'freefall') {
        if (p.dropStage === 'plane') p.jumpFromPlane();
        p.dropStage = 'freefall';
        p.position.set(OLD_TOWN.x - 60, g().map.getTerrainHeight(OLD_TOWN.x, OLD_TOWN.z) + 170, OLD_TOWN.z + 120);
        p.velocity.set(0, -30, 0); p.yaw = 0.3; p.dropHeading = 0.3;
      }
      p.parachuteRequested = true;
      p.pitch = -.15;
      hud(true);
    },
    frame(t) {
      const p = pc();
      // Low, front three-quarter angle looking up at the canopy against the sky.
      const h = p.dropHeading ?? p.yaw;
      setCamera(cam => {
        const fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
        const orbit = .4 + t * .12;
        cam.position.set(p.position.x + fx * 8 + rx * 6 * orbit * 2, p.position.y - 2.5, p.position.z + fz * 8 + rz * 6 * orbit * 2);
        cam.lookAt(p.position.x, p.position.y + 3.2, p.position.z);
        cam.fov = 62; cam.updateProjectionMatrix();
      });
    },
    teardown() { setCamera(null); }
  },

  landing: {
    duration: 4.5,
    setup() {
      const p = pc();
      const x = OLD_TOWN.x + 23 - 4, z = OLD_TOWN.z + 105;
      p.dropStage = 'parachute'; p.chuteOpenTime = 3;
      p.position.set(x, g().map.getTerrainHeight(x, z) + 9, z);
      p.velocity.set(0, -6, -6);
      p.yaw = 0; p.dropHeading = 0; p.pitch = -.05;
      key('KeyW', true);
    },
    frame(t) { if (t > 1.4) key('ShiftLeft', true); pc().pitch = -.04; }
  },

  loot: {
    duration: 4.5,
    setup() {
      releaseKeys();
      grounded();
      const p = pc();
      const x = p.position.x, z = p.position.z - 4;
      const mk = g().makeLoot.bind(g());
      const scope = mk('attachment', x - .6, z, { attachmentType: 'grip_vertical', rarity: 'uncommon' });
      const smg = mk('weapon', x + .7, z - .4, { weaponId: 'sentinel_dmr', rarity: 'rare' });
      g().offlineLoot.push(scope, smg);
      g().inventorySystem.updateWorldLoot(g().offlineLoot);
      (window as Any).__lootIds = [smg.id, scope.id];
      p.pitch = -.35;
    },
    frame(t) {
      const ids = (window as Any).__lootIds;
      if (t < 1) key('KeyW', true); else key('KeyW', false);
      if (t > 1.2 && ids[0]) { g().soundManager.playLootPickup('weapon'); g().pickupOfflineLoot(ids[0]); ids[0] = null; }
      if (t > 1.9 && ids[1]) { g().soundManager.playLootPickup('attachment'); g().pickupOfflineLoot(ids[1]); ids[1] = null; }
      if (t > 2.6 && !g().inventoryUI.isOpen && t < 4.2) g().inventoryUI.toggle(true);
      if (t > 4.2 && g().inventoryUI.isOpen) g().inventoryUI.toggle(false);
    },
    teardown() { if (g().inventoryUI.isOpen) g().inventoryUI.toggle(false); releaseKeys(); }
  },

  fpsFight: {
    duration: 5,
    setup() {
      grounded();
      const p = pc(), inv = g().inventorySystem;
      g().updateOfflineBots = () => { /* scripted */ };
      inv.selectSlot(1);
      g().combatSystem.fireMode = 'auto';
      const x = OLD_TOWN.x + 23, z = OLD_TOWN.z + 70;
      p.position.set(x, g().map.getTerrainHeight(x, z) + 1.7, z);
      p.cameraMode = 'FPS'; p.yaw = 0; p.pitch = 0;
      // Two enemies down the street: drop the first, swing onto the second.
      const first = stageBot(3, x + 2, z - 24), second = stageBot(4, x - 5, z - 32);
      faceBot(first); faceBot(second);
      (window as Any).__bots = [first, second];
      lastFire = 0;
    },
    frame(t, dt) {
      const p = pc(), [first, second] = (window as Any).__bots;
      for (const [i, bot] of [first, second].entries()) if (!bot.isEliminated) {
        bot.position.x += Math.sin(t * 2.2 + i) * dt * 2.5;
        bot.velocity = { x: Math.cos(t * 2.2 + i) * 2.5, y: 0, z: 0 };
        faceBot(bot);
      }
      const target = !first.isEliminated ? first : second;
      p.isScoped = t > .5 && t < 4.6;
      aimFirstPerson(botTarget(target, target.isEliminated ? .5 : 1.3), first.isEliminated && t < 4 ? .22 : .35);
      trigger(t > .9 && !target.isEliminated && Math.floor(t * 2.6) % 4 !== 3);
      if (t - lastFire > .24 && t > .3) { lastFire = t; for (const bot of [first, second]) if (!bot.isEliminated && Math.random() < .7) botReturnFire(bot); }
      if (target.isEliminated) trigger(false);
    },
    teardown() { trigger(false); pc().isScoped = false; }
  },

  tpsFight: {
    duration: 5,
    setup() {
      grounded();
      const p = pc();
      const x = OLD_TOWN.x - 23 - 4, z = OLD_TOWN.z + 30;
      p.position.set(x, g().map.getTerrainHeight(x, z) + 1.7, z);
      p.cameraMode = 'TPS'; p.isCrouching = false;
      const bot = stageBot(5, x + 26, z - 20);
      const bot2 = stageBot(6, x + 34, z - 14);
      (window as Any).__bots = [bot, bot2];
      g().inventorySystem.selectSlot(1);
      lastFire = 0;
    },
    frame(t, dt) {
      const p = pc(), [a, b] = (window as Any).__bots;
      const target = !a.isEliminated ? a : b;
      for (const bot of [a, b]) if (!bot.isEliminated) { bot.position.z += Math.cos(t * 1.8 + (bot === b ? 1 : 0)) * dt * 2; faceBot(bot); bot.velocity = { x: 0, y: 0, z: 2 }; }
      // Strafe while engaging.
      key('KeyA', t > .2 && t < 1.6); key('KeyD', t > 2.6 && t < 3.6);
      p.isScoped = t > .6;
      if (!target.isEliminated) aimThirdPerson(botTarget(target, 1.3));
      trigger(t > .9 && !target.isEliminated && Math.floor(t * 3) % 4 !== 3);
      if (t - lastFire > .35) { lastFire = t; for (const bot of [a, b]) if (!bot.isEliminated && Math.random() < .6) botReturnFire(bot); }
    },
    teardown() { trigger(false); releaseKeys(); pc().isScoped = false; }
  },

  sniper: {
    duration: 4,
    setup() {
      grounded();
      const p = pc(), inv = g().inventorySystem;
      inv.secondaryWeapon = 'longbow'; inv.magAmmo.secondary = 5; inv.ammo['Sniper Ammo'] = 20;
      inv.attachments.secondary = { optic: 'optic_4x', muzzle: null, grip: null, mag: null };
      inv.selectSlot(2);
      const x = OLD_TOWN.x + 23, z = OLD_TOWN.z + 110;
      p.position.set(x, g().map.getTerrainHeight(x, z) + 1.7, z);
      p.cameraMode = 'TPS'; p.yaw = 0; p.pitch = 0;
      const bot = stageBot(8, x + 6, z - 125);
      bot.health = 60; bot.armor = 0;
      (window as Any).__bot = bot;
      (window as Any).__shot = false;
    },
    frame(t) {
      const p = pc(), bot = (window as Any).__bot;
      if (!bot.isEliminated) { faceBot(bot); bot.rotation.yaw += 1.2; }
      p.isScoped = t > .8 && t < 3.3;
      aimFirstPerson(botTarget(bot, 1.72), t < 1.6 ? .12 : .5);
      if (t > 2.1 && !(window as Any).__shot) { (window as Any).__shot = true; g().combatSystem.lastFireTime = 0; g().combatSystem.attemptFire(); }
    },
    teardown() { pc().isScoped = false; g().inventorySystem.selectSlot(1); }
  },

  drive: {
    duration: 5,
    setup() {
      const p = pc(), vm = g().vehicleManager;
      grounded();
      const [id, mesh] = [...vm.vehicles.entries()][0];
      // Pick a dry stretch of the main road well away from towns.
      const segs: number[][] = g().map.roadSegments, map = g().map;
      let pick = segs[0];
      for (let i = 0; i < segs.length - 14; i++) {
        const run = segs.slice(i, i + 14);
        if (run.every(s => map.getTerrainHeight(s[0], s[1]) > .8) && Math.hypot(segs[i][0] + 1650, segs[i][1] + 1250) > 450 && Math.hypot(segs[i][0], segs[i][1]) > 500) { pick = segs[i]; break; }
      }
      const sx = pick[0], sz = pick[1];
      mesh.position.set(sx, map.getTerrainHeight(sx, sz), sz);
      const yaw = Math.atan2(-(pick[2] - pick[0]), -(pick[3] - pick[1]));
      p.enterVehicle(id, new THREE.Vector3(sx, mesh.position.y + 1.05, sz), yaw);
      p.drivingSpeed = 14;
      key('KeyW', true);
    },
    frame(t) {
      key('KeyA', t > 2 && t < 2.25); key('KeyD', t > 3.2 && t < 3.45);
      const p = pc();
      setCamera(cam => {
        // Low tracking shot alongside the buggy.
        const h = p.yaw, fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
        const side = 7 - t * .6;
        cam.position.set(p.position.x + rx * side + fx * (4 - t), p.position.y + 1.2, p.position.z + rz * side + fz * (4 - t));
        cam.lookAt(p.position.x + fx * 2, p.position.y + .3, p.position.z + fz * 2);
        cam.fov = 58; cam.updateProjectionMatrix();
      });
    },
    teardown() { releaseKeys(); setCamera(null); const p = pc(); if (p.isDriving) p.exitVehicle(); }
  },

  zone: {
    duration: 4.5,
    setup() {
      hud(false);
      const game = g();
      game.offlineStartTime = game.gameNow() - (300 + 270 + 240 + 60) * 1000;
      const p = pc(); p.position.set(0, game.map.getTerrainHeight(0, 0) + 1.7, 120);
    },
    frame(t) {
      const k = ease(t / 4.5);
      setCamera(cam => {
        cam.position.set(-140 + k * 90, 60 - k * 18, 260 + k * 160);
        cam.lookAt(120, 55, 980);
        cam.fov = 55; cam.updateProjectionMatrix();
      });
      title(t > 1.4 ? `<div style="font:600 64px Teko,sans-serif;letter-spacing:.08em">THE ZONE CLOSES IN</div>` : null, t > 1.4 ? Math.min(1, (t - 1.4) / .4) * (t > 4 ? (4.5 - t) / .5 : 1) : 0);
    },
    teardown() { setCamera(null); title(null); }
  },

  /** 3-2-1 countdown over the zone shot, dimming to black, then the logo card. */
  outro: {
    duration: 6.5,
    setup() { hud(false); },
    frame(t) {
      // Keep drifting toward the zone wall from where the zone shot ended.
      setCamera(cam => {
        cam.position.set(-50 + t * 7, 42 - t * 1.5, 420 + t * 18);
        cam.lookAt(120 + t * 4, 55, 980);
        cam.fov = 55 - t * .8; cam.updateProjectionMatrix();
      });
      const el = document.getElementById('trailer-title') ?? (title(null), document.getElementById('trailer-title')!);
      const COUNT_END = 2.7;
      if (t < COUNT_END) {
        const index = Math.min(2, Math.floor(t / .9)), p = (t - index * .9) / .9;
        const dim = Math.min(.9, (t / COUNT_END) * .9);
        title(`<div style="font:600 260px/1 Teko,sans-serif;color:#f2ecdc;transform:scale(${(1.35 - .35 * Math.min(1, p * 2.5)).toFixed(3)});opacity:${(p < .75 ? 1 : 1 - (p - .75) / .25).toFixed(3)}">${3 - index}</div>`, 1);
        el.style.background = `rgba(4,7,6,${dim.toFixed(3)})`;
      } else {
        const k = Math.min(1, (t - COUNT_END) / .6);
        title(TITLE('PLAY FREE WITH FRIENDS'), k);
        el.style.opacity = '1';
        const inner = el.firstElementChild as HTMLElement | null;
        if (inner) { inner.style.opacity = String(k); inner.style.transform = `scale(${(1.08 - .08 * k).toFixed(3)})`; }
        el.style.background = 'radial-gradient(ellipse at center, #0b1210 0%, #040706 80%)';
      }
    },
    teardown() { setCamera(null); }
  },

  victory: {
    duration: 4,
    setup() {
      const game = g();
      for (const bot of game.offlineBots) bot.isEliminated = true;
      game.offlineKillFeed.push({ id: 'trailer', killerName: game.currentProfile.name, victimName: '[BOT] Apex_04', weaponName: 'Viper AR', isHeadshot: true, timestamp: Date.now() });
      game.finishOfflineMatch(true);
    },
    frame(t) {
      title(t > 2 ? TITLE('PLAY FREE WITH FRIENDS') : null, t > 2 ? Math.min(1, (t - 2) / .5) : 0);
      const results = document.getElementById('results-root');
      if (results) results.style.opacity = String(t > 1.8 ? Math.max(0, 1 - (t - 1.8) / .4) : 1);
      const el = document.getElementById('trailer-title');
      if (el) el.style.background = t > 2 ? 'radial-gradient(ellipse at center, #0b1210ee 0%, #050807 80%)' : 'none';
    }
  }
};

// ---------------------------------------------------------------- audio capture
// Every SoundManager call during a recording is logged with its video time,
// then replayed through the same SoundManager on an OfflineAudioContext so the
// soundtrack is sample-accurate to the captured frames.

type AudioEvent = { t: number; m: string; a: unknown[] };
const AUDIO_METHODS = ['playGunshot', 'playSpatialGunshot', 'playBulletWhizBy', 'playHitMarker', 'playDamageTaken', 'playReload', 'playDryFire', 'playEquip', 'playFireModeSwitch', 'playImpact', 'playLootPickup', 'playHealStart', 'playHealComplete', 'playFootstep', 'playLanding', 'playParachuteOpen', 'setWind', 'setEngine', 'setVehicleEngine', 'playVehicleStart', 'playVehicleHit', 'updateListener'];
let audioLog: AudioEvent[] = [];
const pack = (v: unknown): unknown => v instanceof THREE.Vector3 ? { __v3: [v.x, v.y, v.z] } : v;
const unpack = (v: unknown): unknown => (v && typeof v === 'object' && '__v3' in (v as Any)) ? new THREE.Vector3(...(v as Any).__v3) : v;

function startAudioLog(): void {
  audioLog = [];
  const sm = g().soundManager;
  for (const m of AUDIO_METHODS) {
    const original = sm[m].bind(sm);
    sm[m] = (...args: unknown[]) => { audioLog.push({ t: (window as Any).__videoTime ?? 0, m, a: args.map(pack) }); return original(...args); };
  }
}

async function renderAudio(duration: number): Promise<string> {
  const sampleRate = 44100;
  const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  let now = 0;
  const ctx = new Proxy(offline, {
    get(target, prop) {
      if (prop === 'currentTime') return now;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const sm = new (g().soundManager.constructor)();
  sm.ctx = ctx; sm.initCtx = () => { /* offline context is driven explicitly */ };
  sm.buildGraph();
  for (const e of audioLog) { now = Math.max(0, Math.min(duration - .01, e.t)); sm[e.m](...e.a.map(unpack)); }
  const buffer = await offline.startRendering();
  const l = buffer.getChannelData(0), r = buffer.getChannelData(1);
  const pcm = new Int16Array(l.length * 2);
  for (let i = 0; i < l.length; i++) { pcm[i * 2] = Math.max(-1, Math.min(1, l[i])) * 32767; pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767; }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

(window as Any).__director = { SHOTS, setCamera, title, hud, startAudioLog, renderAudio, audioLog: () => audioLog };
