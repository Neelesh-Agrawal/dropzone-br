import * as THREE from 'three';

/**
 * Shared look-development constants so the sky, sun light, terrain, grass and
 * water all agree. Late-afternoon sun (~33° elevation) gives long, readable shadows.
 */
export const SUN_DIRECTION = new THREE.Vector3(0.58, 0.56, 0.42).normalize();
export const SUN_COLOR = new THREE.Color('#fff5dc');
export const SKY_TOP = new THREE.Color('#0f58a8');
export const SKY_HORIZON = new THREE.Color('#82d1f0');
export const FOG_COLOR = new THREE.Color('#9cd6ee');
export const WATER_LEVEL = -1.2;

/** Value noise + fbm used by several world shaders. */
export const GLSL_NOISE = /* glsl */ `
  float dzHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float dzNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(dzHash(i), dzHash(i + vec2(1.0, 0.0)), f.x), mix(dzHash(i + vec2(0.0, 1.0)), dzHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float dzFbm(vec2 p) { return dzNoise(p) * .5 + dzNoise(p * 2.07 + 13.1) * .27 + dzNoise(p * 4.13 + 7.7) * .15 + dzNoise(p * 8.3 + 3.3) * .08; }
`;

/** Shared clock for wind and water animation. */
export const worldTime = { value: 0 };

/** Convert an sRGB-authored hex colour into a linear GLSL vec3 literal. */
export function glslColor(hex: string): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}
