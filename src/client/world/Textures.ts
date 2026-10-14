import * as THREE from 'three';

export type Surface = 'plaster' | 'brick' | 'roof' | 'metal' | 'wood' | 'concrete' | 'asphalt' | 'trim' | 'glass' | 'plain';

/** World-space tile size (metres per texture repeat) for each surface. */
export const SURFACE_SCALE: Record<Surface, number> = {
  plaster: 3, brick: 1.6, roof: 2.4, metal: 2, wood: 2.4, concrete: 4, asphalt: 6, trim: 2, glass: 2, plain: 4
};

const SIZE = 256;

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }

/**
 * Draw an albedo canvas and a height field together, then derive a tangent-space
 * normal map from the height field so the surface catches light.
 */
function make(draw: (ctx: CanvasRenderingContext2D, height: Float32Array, rnd: () => number) => void, seed: number, bumpStrength: number): { map: THREE.CanvasTexture; normal: THREE.DataTexture } {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const height = new Float32Array(SIZE * SIZE);
  draw(ctx, height, rng(seed));
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const at = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * bumpStrength, dy = (at(x, y + 1) - at(x, y - 1)) * bumpStrength;
    const len = Math.hypot(dx, dy, 1), i = (y * SIZE + x) * 4;
    data[i] = (-dx / len * .5 + .5) * 255; data[i + 1] = (dy / len * .5 + .5) * 255; data[i + 2] = (1 / len * .5 + .5) * 255; data[i + 3] = 255;
  }
  const normal = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.generateMipmaps = true; normal.minFilter = THREE.LinearMipmapLinearFilter; normal.magFilter = THREE.LinearFilter;
  normal.needsUpdate = true;
  return { map, normal };
}

/** Fill pixels from a per-pixel function returning [grey, height]. */
function pixels(ctx: CanvasRenderingContext2D, height: Float32Array, fn: (x: number, y: number) => [number, number, number?, number?]) {
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const [g, h, gG, gB] = fn(x, y), i = (y * SIZE + x) * 4;
    img.data[i] = g; img.data[i + 1] = gG ?? g; img.data[i + 2] = gB ?? g; img.data[i + 3] = 255;
    height[y * SIZE + x] = h;
  }
  ctx.putImageData(img, 0, 0);
}

function valueNoise(rnd: () => number, cells: number) {
  const grid = Array.from({ length: cells * cells }, rnd);
  return (x: number, y: number) => {
    const gx = x / SIZE * cells, gy = y / SIZE * cells, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const g = (a: number, b: number) => grid[((b % cells + cells) % cells) * cells + ((a % cells + cells) % cells)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
  };
}

const cache = new Map<Surface, { map: THREE.Texture; normal: THREE.Texture } | null>();

export function surfaceTextures(surface: Surface): { map: THREE.Texture; normal: THREE.Texture } | null {
  if (cache.has(surface)) return cache.get(surface)!;
  let result: { map: THREE.CanvasTexture; normal: THREE.DataTexture } | null = null;
  if (surface === 'plaster') result = make((ctx, h, rnd) => {
    const n1 = valueNoise(rnd, 8), n2 = valueNoise(rnd, 32), n3 = valueNoise(rnd, 96);
    pixels(ctx, h, (x, y) => { const v = n1(x, y) * .45 + n2(x, y) * .35 + n3(x, y) * .2; return [205 + v * 45 - (n1(y, x) > .7 ? 18 : 0), n3(x, y) * .6 + n2(x, y) * .4]; });
  }, 11, 2.2);
  else if (surface === 'brick') result = make((ctx, h, rnd) => {
    const n = valueNoise(rnd, 48), rows = 8, bw = SIZE / 4, bh = SIZE / rows;
    const tint = Array.from({ length: 64 }, () => .8 + rnd() * .35);
    pixels(ctx, h, (x, y) => {
      const row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0, col = Math.floor((x + off) / bw);
      const mortar = (y % bh) < 3 || ((x + off) % bw) < 3;
      const t = tint[(row * 5 + col) % 64] * (.85 + n(x, y) * .3);
      return mortar ? [175, 0, 170, 160] : [150 * t, .6 + n(x, y) * .3, 82 * t, 64 * t];
    });
  }, 21, 4);
  else if (surface === 'roof') result = make((ctx, h, rnd) => {
    const n = valueNoise(rnd, 40), rows = 10, tw = SIZE / 8, th = SIZE / rows;
    const tint = Array.from({ length: 80 }, () => .8 + rnd() * .3);
    pixels(ctx, h, (x, y) => {
      const row = Math.floor(y / th), off = row % 2 ? tw / 2 : 0, col = Math.floor((x + off) / tw);
      const fy = (y % th) / th, fx = ((x + off) % tw) / tw;
      const curve = Math.sin(fx * Math.PI), shade = .55 + fy * .45;
      const t = tint[(row * 7 + col) % 80] * shade * (.9 + n(x, y) * .2);
      return [200 * t, curve * .5 + fy * .5, 196 * t, 188 * t];
    });
  }, 31, 3);
  else if (surface === 'metal') result = make((ctx, h, rnd) => {
    const rust = valueNoise(rnd, 12), streak = valueNoise(rnd, 64), fine = valueNoise(rnd, 128);
    pixels(ctx, h, (x, y) => {
      const ridge = Math.sin(x / SIZE * Math.PI * 2 * 12) * .5 + .5;
      const r = Math.max(0, rust(x, y * .25) - .55) * 2.2 * (streak(x * 3, y * .2));
      const g = 205 + ridge * 30 + fine(x, y) * 15;
      return [g * (1 - r * .25) + r * 40, ridge, g * (1 - r * .45), g * (1 - r * .6)];
    });
  }, 41, 5);
  else if (surface === 'wood') result = make((ctx, h, rnd) => {
    const grain = valueNoise(rnd, 24), plankH = SIZE / 8;
    const tint = Array.from({ length: 8 }, () => .8 + rnd() * .3);
    pixels(ctx, h, (x, y) => {
      const plank = Math.floor(y / plankH), seam = (y % plankH) < 2;
      const g = grain(x * .15 + plank * 20, y * 3) * .5 + Math.sin(x * .08 + grain(x, y) * 6) * .25 + .5;
      const t = tint[plank] * (.75 + g * .35);
      return seam ? [70, 0, 55, 45] : [205 * t, .7 + g * .3, 170 * t, 135 * t];
    });
  }, 51, 3);
  else if (surface === 'concrete') result = make((ctx, h, rnd) => {
    const n1 = valueNoise(rnd, 6), n2 = valueNoise(rnd, 40), n3 = valueNoise(rnd, 120);
    pixels(ctx, h, (x, y) => {
      const seam = x % (SIZE / 2) < 2 || y % (SIZE / 2) < 2;
      const v = n1(x, y) * .4 + n2(x, y) * .35 + n3(x, y) * .25;
      return seam ? [150, 0] : [190 + v * 40, n3(x, y) * .4 + n2(x, y) * .3 + .3];
    });
  }, 61, 1.6);
  else if (surface === 'asphalt') result = make((ctx, h, rnd) => {
    const n1 = valueNoise(rnd, 10), n2 = valueNoise(rnd, 128);
    pixels(ctx, h, (x, y) => { const v = n1(x, y) * .5 + n2(x, y) * .5; return [150 + v * 50, n2(x, y)]; });
  }, 71, 1.2);
  else if (surface === 'trim') result = make((ctx, h, rnd) => {
    const n = valueNoise(rnd, 48);
    pixels(ctx, h, (x, y) => [225 + n(x, y) * 25, n(x, y) * .3]);
  }, 81, 1);
  cache.set(surface, result);
  return result;
}

/**
 * Replace a geometry's UVs with a world-space box projection so textures tile at
 * a constant real-world scale regardless of how big each box is.
 */
export function boxProjectUVs(geometry: THREE.BufferGeometry, scale: number): void {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u: number, v: number;
      if (ay >= ax && ay >= az) { u = p.x; v = p.z; }
      else if (ax >= az) { u = p.z; v = p.y; }
      else { u = p.x; v = p.y; }
      uv[(i + k) * 2] = u / scale; uv[(i + k) * 2 + 1] = v / scale;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function getConcreteTexture(): THREE.Texture {
  return surfaceTextures('concrete')!.map;
}

export function getCarbonTexture(): THREE.Texture {
  return surfaceTextures('metal')!.map;
}

export function getNoiseTexture(): THREE.Texture {
  return surfaceTextures('asphalt')!.map;
}

