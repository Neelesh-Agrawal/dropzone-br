import * as THREE from 'three';

type SpriteKind = 'smoke' | 'spark' | 'dust' | 'blood' | 'flash';

interface SpriteParticle {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startSize: number;
  endSize: number;
  startOpacity: number;
  gravity: number;
  drag: number;
  active: boolean;
}

interface Tracer { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; length: number; travelled: number; speed: number; active: boolean; }
interface Shell { mesh: THREE.Mesh; velocity: THREE.Vector3; spin: THREE.Vector3; life: number; active: boolean; }

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const radial = (stops: [number, string][]) => (ctx: CanvasRenderingContext2D, s: number) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
};

/** Shared, lazily-built textures for every combat effect. */
export const FxTextures = {
  _cache: {} as Record<string, THREE.Texture>,
  get(kind: SpriteKind | 'decal' | 'muzzle'): THREE.Texture {
    if (this._cache[kind]) return this._cache[kind];
    let tex: THREE.Texture;
    if (kind === 'smoke') tex = canvasTexture(64, (ctx, s) => {
      for (let i = 0; i < 7; i++) {
        const x = s / 2 + (Math.random() - .5) * s * .3, y = s / 2 + (Math.random() - .5) * s * .3, r = s * (.22 + Math.random() * .16);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      }
    });
    else if (kind === 'spark') tex = canvasTexture(32, radial([[0, 'rgba(255,255,240,1)'], [.25, 'rgba(255,210,120,.9)'], [1, 'rgba(255,140,40,0)']]));
    else if (kind === 'dust') tex = canvasTexture(64, radial([[0, 'rgba(205,190,160,.75)'], [.6, 'rgba(160,145,120,.35)'], [1, 'rgba(140,130,110,0)']]));
    else if (kind === 'blood') tex = canvasTexture(64, (ctx, s) => {
      for (let i = 0; i < 9; i++) {
        const x = s / 2 + (Math.random() - .5) * s * .45, y = s / 2 + (Math.random() - .5) * s * .45, r = s * (.08 + Math.random() * .16);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(150,10,12,.95)'); g.addColorStop(1, 'rgba(90,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      }
    });
    else if (kind === 'flash' || kind === 'muzzle') tex = canvasTexture(128, (ctx, s) => {
      radial([[0, 'rgba(255,255,230,1)'], [.12, 'rgba(255,230,150,.95)'], [.35, 'rgba(255,150,50,.45)'], [1, 'rgba(255,90,10,0)']])(ctx, s);
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(s / 2, s / 2);
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3 + (Math.random() - .5) * .3);
        const len = s * (.32 + Math.random() * .16);
        const g = ctx.createLinearGradient(0, 0, len, 0); g.addColorStop(0, 'rgba(255,240,190,.9)'); g.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -s * .035); ctx.lineTo(len, 0); ctx.lineTo(0, s * .035); ctx.fill();
      }
    });
    else tex = canvasTexture(64, (ctx, s) => {
      radial([[0, 'rgba(10,8,6,1)'], [.18, 'rgba(25,22,18,.95)'], [.34, 'rgba(60,55,48,.55)'], [.6, 'rgba(70,65,55,.18)'], [1, 'rgba(0,0,0,0)']])(ctx, s);
      ctx.strokeStyle = 'rgba(20,18,15,.6)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(a) * s * .3, s / 2 + Math.sin(a) * s * .3); ctx.stroke(); }
    });
    this._cache[kind] = tex;
    return tex;
  }
};

/**
 * Pooled combat effects. Nothing is allocated per shot after warm-up, so
 * sustained automatic fire does not churn geometry, materials or the GC.
 */
export class ParticleSystem {
  private scene: THREE.Scene;
  private sprites: SpriteParticle[] = [];
  private tracers: Tracer[] = [];
  private shells: Shell[] = [];
  private decals: THREE.Mesh[] = [];
  private decalIndex = 0;
  private tmp = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    for (let i = 0; i < 360; i++) {
      const material = new THREE.SpriteMaterial({ map: FxTextures.get('smoke'), transparent: true, depthWrite: false, fog: true });
      const sprite = new THREE.Sprite(material); sprite.visible = false; sprite.frustumCulled = false; scene.add(sprite);
      this.sprites.push({ sprite, material, velocity: new THREE.Vector3(), life: 0, maxLife: 1, startSize: 1, endSize: 1, startOpacity: 1, gravity: 0, drag: 0, active: false });
    }
    const tracerGeometry = new THREE.CylinderGeometry(.018, .018, 1, 5, 1, true);
    tracerGeometry.rotateX(Math.PI / 2); tracerGeometry.translate(0, 0, .5);
    const tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 80; i++) {
      const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial); mesh.visible = false; mesh.frustumCulled = false; scene.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, travelled: 0, speed: 0, active: false });
    }
    const shellGeometry = new THREE.CylinderGeometry(.006, .006, .045, 6); shellGeometry.rotateZ(Math.PI / 2);
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0xc8963a, metalness: .9, roughness: .3 });
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(shellGeometry, shellMaterial); mesh.visible = false; scene.add(mesh);
      this.shells.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, active: false });
    }
    const decalGeometry = new THREE.PlaneGeometry(.16, .16);
    const decalMaterial = new THREE.MeshBasicMaterial({ map: FxTextures.get('decal'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    for (let i = 0; i < 90; i++) {
      const mesh = new THREE.Mesh(decalGeometry, decalMaterial); mesh.visible = false; scene.add(mesh); this.decals.push(mesh);
    }
  }

  private emit(kind: SpriteKind, position: THREE.Vector3, velocity: THREE.Vector3, life: number, startSize: number, endSize: number, opacity: number, gravity = 0, drag = 0, additive = false): void {
    let p = this.sprites.find(s => !s.active);
    if (!p) p = this.sprites.reduce((a, b) => (a.life / a.maxLife > b.life / b.maxLife ? a : b));
    p.active = true; p.life = 0; p.maxLife = life; p.startSize = startSize; p.endSize = endSize; p.startOpacity = opacity; p.gravity = gravity; p.drag = drag;
    p.velocity.copy(velocity);
    p.sprite.position.copy(position); p.sprite.scale.setScalar(startSize); p.sprite.visible = true;
    p.material.map = FxTextures.get(kind);
    p.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.material.rotation = Math.random() * Math.PI * 2;
    p.material.opacity = opacity;
    p.material.color.set(kind === 'smoke' ? 0xcfcac0 : 0xffffff);
  }

  // Dynamic lights cost shading time on every pixel of the world, so the flash is sprite-only.
  public spawnMuzzleLight(_position: THREE.Vector3): void { /* intentionally no light */ }

  /** World-space muzzle flash for third-person and other operators. */
  public spawnMuzzleFlash(position: THREE.Vector3, direction: THREE.Vector3, size = 1, suppressed = false): void {
    if (!suppressed) {
      this.emit('flash', position, this.tmp.copy(direction).multiplyScalar(2), .05, .55 * size, .8 * size, 1, 0, 0, true);
      this.emit('flash', this.tmp.copy(position).addScaledVector(direction, .25 * size), direction.clone().multiplyScalar(3), .04, .35 * size, .5 * size, .8, 0, 0, true);
    }
    this.spawnMuzzleSmoke(position, direction);
  }

  // 1. Eject brass casing
  public ejectShell(origin: THREE.Vector3, rightDir: THREE.Vector3): void {
    const shell = this.shells.find(s => !s.active) || this.shells.reduce((a, b) => (a.life > b.life ? a : b));
    shell.active = true; shell.life = 0; shell.mesh.visible = true; shell.mesh.position.copy(origin);
    shell.velocity.copy(rightDir).multiplyScalar(2.2 + Math.random()).add(this.tmp.set((Math.random() - .5) * .6, 1.6 + Math.random(), (Math.random() - .5) * .6));
    shell.spin.set(Math.random() * 25, Math.random() * 25, Math.random() * 25);
  }

  // 2. Bullet tracer that actually travels from the muzzle to the impact point.
  public spawnTracer(start: THREE.Vector3, end: THREE.Vector3, speed = 650): void {
    const distance = start.distanceTo(end);
    if (distance < 1.5) return;
    const t = this.tracers.find(x => !x.active) || this.tracers[0];
    t.active = true; t.from.copy(start); t.dir.copy(end).sub(start).normalize(); t.length = distance; t.travelled = 0; t.speed = speed;
    t.mesh.visible = true; t.mesh.position.copy(start); t.mesh.lookAt(end);
    t.mesh.scale.set(1, 1, Math.min(7, distance));
  }

  // 3. Muzzle smoke wisps
  public spawnMuzzleSmoke(origin: THREE.Vector3, forwardDir: THREE.Vector3): void {
    for (let i = 0; i < 2; i++) {
      const vel = this.tmp.copy(forwardDir).multiplyScalar(.8 + Math.random() * .8).add(new THREE.Vector3((Math.random() - .5) * .3, .35 + Math.random() * .3, (Math.random() - .5) * .3));
      this.emit('smoke', origin, vel, .5 + Math.random() * .3, .06, .38, .1, -.4, 1.6);
    }
  }

  // 4. Surface impact: sparks + dust puff + bullet hole decal.
  public spawnImpactSparks(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, surface: 'hard' | 'soft' = 'hard'): void {
    const n = hitNormal.lengthSq() > 0 ? hitNormal.clone().normalize() : this.up.clone();
    if (surface === 'hard') for (let i = 0; i < 6; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3((Math.random() - .5) * 4, Math.random() * 3, (Math.random() - .5) * 4));
      this.emit('spark', hitPos, v, .18 + Math.random() * .15, .07, .02, 1, 9.8, 1, true);
    }
    for (let i = 0; i < (surface === 'soft' ? 4 : 2); i++) {
      const v = n.clone().multiplyScalar(.8 + Math.random() * 1.2).add(new THREE.Vector3((Math.random() - .5) * .7, .3 + Math.random() * .6, (Math.random() - .5) * .7));
      this.emit('dust', this.tmp.copy(hitPos).addScaledVector(n, .05), v, .7 + Math.random() * .5, .18, surface === 'soft' ? 1.3 : .8, .7, 1.2, 2.2);
    }
    this.spawnDecal(hitPos, n);
  }

  private spawnDecal(position: THREE.Vector3, normal: THREE.Vector3): void {
    const decal = this.decals[this.decalIndex++ % this.decals.length];
    decal.visible = true;
    decal.position.copy(position).addScaledVector(normal, .015);
    decal.lookAt(this.tmp.copy(decal.position).add(normal));
    decal.rotateZ(Math.random() * Math.PI * 2);
    decal.scale.setScalar(.7 + Math.random() * .6);
  }

  /** Blood puff for confirmed hits on operators. */
  public spawnBloodHit(position: THREE.Vector3, direction: THREE.Vector3, headshot = false): void {
    for (let i = 0; i < (headshot ? 7 : 4); i++) {
      const v = direction.clone().multiplyScalar(1.2 + Math.random() * 2).add(new THREE.Vector3((Math.random() - .5) * 1.4, Math.random() * 1.4, (Math.random() - .5) * 1.4));
      this.emit('blood', position, v, .35 + Math.random() * .25, .12, headshot ? .7 : .45, .95, 5, 1.5);
    }
  }

  /** Large dust cloud used for landings and vehicle effects. */
  public spawnDustBurst(position: THREE.Vector3, amount = 8, size = 1.6): void {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (1.5 + Math.random() * 2), .3 + Math.random() * .8, Math.sin(a) * (1.5 + Math.random() * 2));
      this.emit('dust', position, v, 1 + Math.random() * .6, .4, size, .6, .5, 1.8);
    }
  }

  public update(delta: number): void {
    for (const p of this.sprites) {
      if (!p.active) continue;
      p.life += delta;
      if (p.life >= p.maxLife) { p.active = false; p.sprite.visible = false; continue; }
      const k = p.life / p.maxLife;
      p.velocity.y -= p.gravity * delta;
      if (p.drag) p.velocity.multiplyScalar(Math.max(0, 1 - p.drag * delta));
      p.sprite.position.addScaledVector(p.velocity, delta);
      p.sprite.scale.setScalar(THREE.MathUtils.lerp(p.startSize, p.endSize, 1 - (1 - k) * (1 - k)));
      p.material.opacity = p.startOpacity * (1 - k) * (k < .1 ? k * 10 : 1);
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.travelled += t.speed * delta;
      if (t.travelled >= t.length) { t.active = false; t.mesh.visible = false; continue; }
      const segment = Math.min(7, t.length - t.travelled, Math.max(1.5, t.travelled));
      t.mesh.position.copy(t.from).addScaledVector(t.dir, t.travelled);
      t.mesh.scale.z = segment;
    }
    for (const s of this.shells) {
      if (!s.active) continue;
      s.life += delta;
      if (s.life > 1.6) { s.active = false; s.mesh.visible = false; continue; }
      s.velocity.y -= 9.8 * delta;
      s.mesh.position.addScaledVector(s.velocity, delta);
      s.mesh.rotation.x += s.spin.x * delta; s.mesh.rotation.y += s.spin.y * delta; s.mesh.rotation.z += s.spin.z * delta;
    }
  }
}
