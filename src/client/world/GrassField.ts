import * as THREE from 'three';
import { MAP_SIZE } from '../../shared/constants';
import { GLSL_NOISE, SUN_DIRECTION, WATER_LEVEL, glslColor, worldTime } from './Environment';

const RADIUS = 42;
const GRID_SPACING = 2 * RADIUS;
const MASK_SIZE = 2048;

/**
 * Wind-blown grass around the camera in a single draw call. Each instance has
 * a permanent world grid anchor (no modulo remainder jumping on `uCamera.xz`),
 * so grass blades never blink, snap, or pop while the player runs.
 */
export class GrassField {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, heightTexture: THREE.DataTexture, segs: number, blocked: THREE.Box3[], roads: number[][], count = 16000) {
    // One clump: three tapered blades rotated 60° apart.
    const blade: number[] = [];
    const uv: number[] = [];
    for (let b = 0; b < 3; b++) {
      const a = b * Math.PI / 3 + .3, ca = Math.cos(a), sa = Math.sin(a), off = (b - 1) * .07;
      const w = .038;
      const pts = [[-w, 0], [w, 0], [-w * .6, .5], [w * .6, .5], [0, 1]];
      const tri = [[0, 1, 2], [1, 3, 2], [2, 3, 4]];
      for (const t of tri) for (const k of t) {
        const [x, y] = pts[k];
        blade.push(x * ca + off, y, x * sa + off * .5);
        uv.push(b, y);
      }
    }
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(blade, 3));
    base.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = null;
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    const offsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      offsets[i * 3] = (Math.random() * 2 - 1) * RADIUS;
      offsets[i * 3 + 1] = (Math.random() * 2 - 1) * RADIUS;
      offsets[i * 3 + 2] = Math.random();
    }
    geometry.setAttribute('offsetRand', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.instanceCount = count;

    this.material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uHeight: { value: heightTexture }, uMask: { value: this.buildMask(blocked, roads) },
        uCamera: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() },
        uSun: { value: SUN_DIRECTION.clone() }, uTime: { value: 0 }, uFade: { value: 1 }
      }]),
      vertexShader: /* glsl */ `
        attribute vec3 offsetRand;
        uniform sampler2D uHeight; uniform sampler2D uMask;
        uniform vec3 uCamera; uniform vec3 uPlayer; uniform float uTime; uniform float uFade;
        varying float vTip; varying vec3 vColor; varying float vShade;
        #include <fog_pars_vertex>
        ${GLSL_NOISE}
        float heightAt(vec2 p) {
          vec2 g = clamp((p + ${(MAP_SIZE / 2).toFixed(1)}) / ${MAP_SIZE.toFixed(1)} * ${segs.toFixed(1)}, vec2(0.), vec2(${(segs - 1).toFixed(1)}));
          ivec2 i = ivec2(floor(g)); vec2 f = fract(g);
          float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
          float c = texelFetch(uHeight, i + ivec2(0, 1), 0).r, d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        void main() {
          float R = ${RADIUS.toFixed(1)};
          float G = ${GRID_SPACING.toFixed(1)};
          // Stable world-space lattice: world position only shifts by whole multiples of G
          // at the far edge where fade == 0, so blades never blink or jitter while running.
          vec2 cell = floor((uCamera.xz - offsetRand.xy + R) / G);
          vec2 world = offsetRand.xy + cell * G;
          vec2 local = world - uCamera.xz;
          float dist = length(local);
          float fade = (1.0 - smoothstep(R * .62, R * .96, dist)) * uFade;
          if (fade <= 0.001) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          float h = heightAt(world);
          float slope = abs(heightAt(world + vec2(2., 0.)) - h) + abs(heightAt(world + vec2(0., 2.)) - h);
          float mask = texture2D(uMask, (world + ${(MAP_SIZE / 2).toFixed(1)}) / ${MAP_SIZE.toFixed(1)}).r;
          float macro = dzFbm(world * .0035);
          float patches = dzFbm(world * .03 + 11.0);
          float ok = fade * (1.0 - mask) * step(${(WATER_LEVEL + .3).toFixed(2)}, h)
            * (1.0 - smoothstep(.9, 1.6, slope)) * (1.0 - smoothstep(24.0, 30.0, h))
            * (1.0 - smoothstep(.6, .76, patches));
          float r = offsetRand.z;
          float height = (.22 + r * .40) * (.6 + macro * .68) * ok;
          float yaw = r * 6.2831;
          vec3 p = position;
          p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
          p.y *= height;
          float tip = uv.y;
          float gust = sin(uTime * 1.4 + world.x * .11 + world.y * .08) * .45 + sin(uTime * 2.8 + world.x * .38 + r * 6.0) * .15;
          p.x += gust * tip * tip * .28 * height;
          p.z += gust * tip * tip * .12 * height;
          // Smooth parting around player feet without sharp step jump
          vec2 away = world - uPlayer.xz;
          float d = length(away);
          float part = smoothstep(1.1, 0.1, d);
          if (d > .001) p.xz += (away / d) * part * tip * .38;
          vec4 worldPos = vec4(world.x + p.x, h + p.y - .02, world.y + p.z, 1.0);
          vec4 mvPosition = viewMatrix * worldPos;
          gl_Position = projectionMatrix * mvPosition;
          vTip = tip;
          vec3 lush = ${glslColor('#26733b')}, meadow = ${glslColor('#44984a')}, dry = ${glslColor('#7ea848')};
          vColor = mix(lush, meadow, smoothstep(.32, .62, macro));
          vColor = mix(vColor, dry, smoothstep(.58, .82, macro) * .72) * (.78 + r * .34);
          vColor = mix(vColor, ${glslColor('#1a582d')}, smoothstep(.55, .75, dzFbm(world * .012 + 5.0)) * .48);
          vShade = .5 + .5 * sin(world.x * .7 + world.y * .4 + r * 3.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        varying float vTip; varying vec3 vColor; varying float vShade;
        #include <fog_pars_fragment>
        void main() {
          vec3 c = vColor * mix(.34, 1.04, vTip);
          c += vec3(.11, .09, .02) * pow(vTip, 3.0) * max(uSun.y, 0.0) * (.6 + vShade * .4);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    this.material.uniforms.uTime = worldTime;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'GrassField';
    scene.add(this.mesh);
  }

  /** Rasterise building footprints and roads into a coverage mask (1 = no grass). */
  private buildMask(blocked: THREE.Box3[], roads: number[][]): THREE.DataTexture {
    const data = new Uint8Array(MASK_SIZE * MASK_SIZE);
    const scale = MASK_SIZE / MAP_SIZE, half = MAP_SIZE / 2;
    const fill = (x0: number, z0: number, x1: number, z1: number) => {
      const ax = Math.max(0, Math.round((x0 + half) * scale)), bx = Math.min(MASK_SIZE - 1, Math.round((x1 + half) * scale));
      const az = Math.max(0, Math.round((z0 + half) * scale)), bz = Math.min(MASK_SIZE - 1, Math.round((z1 + half) * scale));
      for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) data[z * MASK_SIZE + x] = 255;
    };
    for (const box of blocked) if ((box.max.x - box.min.x) * (box.max.z - box.min.z) < 20000) fill(box.min.x - 1, box.min.z - 1, box.max.x + 1, box.max.z + 1);
    for (const [x1, z1, x2, z2, w] of roads) {
      const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 3);
      for (let i = 0; i <= steps; i++) { const t = i / steps, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t; fill(x - w, z - w, x + w, z + w); }
    }
    const texture = new THREE.DataTexture(data, MASK_SIZE, MASK_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  public update(camera: THREE.Vector3, player: THREE.Vector3, groundHeight: number): void {
    this.material.uniforms.uCamera.value.copy(camera);
    this.material.uniforms.uPlayer.value.copy(player);
    const altitude = camera.y - groundHeight;
    this.material.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(altitude, 25, 60);
    this.mesh.visible = altitude < 60;
  }

  public setDensity(count: number): void { (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = count; }
}
