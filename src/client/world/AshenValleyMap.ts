import { getTerrainHeight } from '../../shared/terrain';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP_SIZE, POI_LOCATIONS } from '../../shared/constants';
import { FOG_COLOR, GLSL_NOISE, SKY_HORIZON, SKY_TOP, SUN_DIRECTION, WATER_LEVEL, glslColor, worldTime } from './Environment';
export { WATER_LEVEL };

const FOLIAGE_TILE = 500;
interface FoliageTile { mesh: THREE.InstancedMesh; kind: 'tree' | 'rock'; center: THREE.Vector3; }

/** Deterministic 0..1 hash of a vertex position, so shared corners move together. */
function positionHash(x: number, y: number, z: number, seed: number): number {
  const v = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719 + seed) * 43758.5453;
  return v - Math.floor(v);
}

/** Seeded random so the valley looks identical on every client. */
function seeded(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }

export class AshenValleyMap {
  public scene: THREE.Scene;
  public terrainMesh!: THREE.Mesh;
  public collisionObjects: THREE.Object3D[] = [];
  public terrainData: Float32Array<ArrayBuffer>;
  /** Terrain heights as a float texture (for the grass shader). */
  public heightTexture!: THREE.DataTexture;
  /** Road centre-line segments [x1, z1, x2, z2, halfWidth] used to keep grass off roads. */
  public roadSegments: number[][] = [];
  public readonly segs = 512; // ~9.8 m terrain spacing across the 5 km world
  private skyMaterial?: THREE.ShaderMaterial;
  private sky?: THREE.Mesh;
  private foliage = new THREE.Group();
  private foliageTiles: FoliageTile[] = [];

  /** The sky dome follows the camera so it is never clipped by the far plane. */
  public update(time: number, camera?: THREE.Vector3): void {
    worldTime.value = time;
    if (this.skyMaterial) this.skyMaterial.uniforms.time.value = time;
    if (camera && this.sky) this.sky.position.copy(camera);
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.terrainData = new Float32Array((this.segs + 1) * (this.segs + 1));
    this.createSky();
    this.createTerrain();
    this.createWater();
    this.createRoads();
    this.createFoliageAndRocks();
  }

  private createSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(5300, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          time: { value: 0 },
          topColor: { value: SKY_TOP.clone() },
          horizonColor: { value: SKY_HORIZON.clone() },
          sunDir: { value: SUN_DIRECTION.clone() },
          fogColor: { value: FOG_COLOR.clone() }
        },
        vertexShader: 'varying vec3 vPosition; void main() { vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDir; uniform vec3 fogColor; uniform float time; varying vec3 vPosition;
          ${GLSL_NOISE}
          void main(){
            vec3 d = normalize(vPosition);
            float sunAmount = max(dot(d, sunDir), 0.0);
            // Gradient with a warm glow on the sun side of the horizon.
            float t = smoothstep(-.05, .65, d.y);
            vec3 horizon = mix(horizonColor, vec3(1.0, .78, .52), pow(sunAmount, 4.0) * .55);
            vec3 sky = mix(horizon, topColor, t);
            // Below and at the horizon the sky matches the fog, so distant terrain melts into it.
            sky = mix(fogColor, sky, smoothstep(-.02, .12, d.y));
            // Two drifting cloud layers, lit from the sun side.
            vec2 uv = d.xz / max(.12, d.y) * 1.3;
            float n = dzFbm(uv + vec2(time * .004, time * .001));
            float n2 = dzFbm(uv * 2.3 + vec2(-time * .006, 4.0));
            float cloud = smoothstep(.46, .76, n * .7 + n2 * .35) * smoothstep(.0, .22, d.y);
            vec3 cloudLit = mix(${glslColor('#8fb6d4')}, ${glslColor('#ffffff')}, clamp(n2 * 1.35 + sunAmount * .55, 0., 1.));
            sky = mix(sky, cloudLit, cloud * .92);
            // Sun disc and bloom halo.
            sky += vec3(1.0, .92, .72) * (pow(sunAmount, 900.0) * 20.0 + pow(sunAmount, 22.0) * .52);
            gl_FragColor = vec4(sky, 1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      })
    );
    sky.name = 'AtmosphericSky';
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.sky = sky;
    this.skyMaterial = sky.material;
    this.scene.add(sky);
  }

  public getTerrainHeight(x: number, z: number): number { return getTerrainHeight(x, z); }

  /**
   * Procedural ground: two grass tones, dry patches, dirt, shoreline sand, mud,
   * and rock on slopes and ridges, with a fine bump so it catches the light.
   */
  private createTerrain(): void {
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, this.segs, this.segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const h = this.getTerrainHeight(pos.getX(i), pos.getZ(i));
      pos.setY(i, h);
      this.terrainData[i] = h;
    }
    geo.computeVertexNormals();

    this.heightTexture = new THREE.DataTexture(this.terrainData as Float32Array<ArrayBuffer>, this.segs + 1, this.segs + 1, THREE.RedFormat, THREE.FloatType);
    this.heightTexture.magFilter = this.heightTexture.minFilter = THREE.NearestFilter;
    this.heightTexture.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
    mat.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vTerrainPos; varying vec3 vTerrainNormal;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = `varying vec3 vTerrainPos; varying vec3 vTerrainNormal;\n${GLSL_NOISE}\n` + shader.fragmentShader
        .replace('#include <map_fragment>', `
          vec2 wp = vTerrainPos.xz;
          float h = vTerrainPos.y;
          float slope = 1.0 - clamp(vTerrainNormal.y, 0.0, 1.0);
          float macro = dzFbm(wp * .0035);
          float patches = dzFbm(wp * .03 + 11.0);
          float detail = dzNoise(wp * .9);
          vec3 lush = ${glslColor('#216e39')}, meadow = ${glslColor('#3c9146')}, dry = ${glslColor('#78a646')};
          vec3 dirt = ${glslColor('#8f6e49')}, rock = ${glslColor('#6c7682')}, sand = ${glslColor('#e5cf9e')}, mud = ${glslColor('#2b6d72')};
          vec3 c = mix(lush, meadow, smoothstep(.32, .62, macro));
          c = mix(c, dry, smoothstep(.58, .82, macro) * .72);
          c = mix(c, ${glslColor('#18542c')}, smoothstep(.55, .75, dzFbm(wp * .012 + 5.0)) * .55);
          c = mix(c, dirt, smoothstep(.64, .82, patches) * .55);
          c = mix(c, sand, 1.0 - smoothstep(${(WATER_LEVEL + .15).toFixed(2)}, ${(WATER_LEVEL + 1.25).toFixed(2)}, h));
          c = mix(c, mud, 1.0 - smoothstep(${(WATER_LEVEL - .55).toFixed(2)}, ${(WATER_LEVEL + .15).toFixed(2)}, h));
          float rocky = smoothstep(.24, .44, slope + (detail - .5) * .12) + smoothstep(62.0, 80.0, h + macro * 10.0);
          c = mix(c, rock * (.88 + macro * .32), clamp(rocky, 0.0, 1.0));
          c *= .88 + detail * .24 + dzNoise(wp * 4.5) * .12;
          diffuseColor.rgb = c;`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          {
            vec2 bp = vTerrainPos.xz * .45; float e = .05;
            float b0 = dzNoise(bp), bx = dzNoise(bp + vec2(e, 0.)), bz = dzNoise(bp + vec2(0., e));
            vec3 worldN = normalize(vTerrainNormal + vec3(-(bx - b0) / e, 0.0, -(bz - b0) / e) * .18);
            normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
          }`);
    };
    mat.customProgramCacheKey = () => 'dz-terrain-v2';

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'Terrain';
    this.scene.add(this.terrainMesh);
    this.collisionObjects.push(this.terrainMesh);
  }

  /** Shallow lakes and marshes: animated waves, depth absorption, shoreline foam, fresnel sky reflection and sun glint. */
  private createWater(): void {
    const waterGeo = new THREE.PlaneGeometry(MAP_SIZE * 1.5, MAP_SIZE * 1.5, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          time: worldTime,
          sunDir: { value: SUN_DIRECTION.clone() },
          uHeight: { value: this.heightTexture }
        }
      ]),
      vertexShader: `
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main(){
          vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float time; uniform vec3 sunDir; uniform sampler2D uHeight; varying vec3 vWorld;
        #include <fog_pars_fragment>
        ${GLSL_NOISE}
        void main(){
          vec2 p = vWorld.xz;
          float camDist = length(cameraPosition - vWorld);
          float detailFade = 1.0 / (1.0 + camDist * 0.014);
          vec2 hUv = clamp(p / ${MAP_SIZE.toFixed(1)} + 0.5, 0.002, 0.998);
          float terrainH = texture2D(uHeight, hUv).r;
          float depth = max(0.0, ${WATER_LEVEL.toFixed(1)} - terrainH);

          // Multi-scale wave normal with distance attenuation so high-altitude views stay silky smooth.
          float e = 0.55;
          float swell = dzNoise(p * 0.035 + time * 0.14);
          float ripple0 = dzNoise(p * 0.16 + time * 0.24) + dzNoise(p * 0.52 - time * 0.36) * 0.38 * detailFade;
          float h0 = swell * 0.65 + ripple0 * (0.35 + 0.65 * detailFade);
          float hx = dzNoise((p + vec2(e, 0.0)) * 0.035 + time * 0.14) * 0.65
                   + (dzNoise((p + vec2(e, 0.0)) * 0.16 + time * 0.24) + dzNoise((p + vec2(e, 0.0)) * 0.52 - time * 0.36) * 0.38 * detailFade) * (0.35 + 0.65 * detailFade);
          float hz = dzNoise((p + vec2(0.0, e)) * 0.035 + time * 0.14) * 0.65
                   + (dzNoise((p + vec2(0.0, e)) * 0.16 + time * 0.24) + dzNoise((p + vec2(0.0, e)) * 0.52 - time * 0.36) * 0.38 * detailFade) * (0.35 + 0.65 * detailFade);
          float normalStrength = mix(0.18, 0.58, detailFade);
          vec3 n = normalize(vec3(-(hx - h0) / e * normalStrength, 1.0, -(hz - h0) / e * normalStrength));

          vec3 v = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.2);
          vec3 deep = ${glslColor('#073256')};
          vec3 midWater = ${glslColor('#0d769b')};
          vec3 shallow = ${glslColor('#20d8c8')};
          vec3 skyRef = ${glslColor('#b8e6fa')};

          float depthFactor = clamp(depth / 4.5, 0.0, 1.0);
          vec3 waterBody = mix(shallow, mix(midWater, deep, smoothstep(0.25, 1.0, depthFactor)), smoothstep(0.0, 0.65, depthFactor));
          float caustic = smoothstep(0.45, 0.85, dzNoise(p * 0.42 + time * 0.35) * 0.6 + dzNoise(p * 0.85 - time * 0.28) * 0.4);
          waterBody += vec3(0.06, 0.22, 0.24) * caustic * (1.0 - depthFactor * 0.7) * detailFade;
          waterBody *= 0.94 + 0.14 * swell;
          vec3 c = mix(waterBody, skyRef, fresnel * 0.76);

          // Shoreline surf foam where water meets beach sand
          float shoreBand = smoothstep(1.35, 0.02, depth);
          float surfWave = 0.5 + 0.5 * sin(depth * 11.0 - time * 2.6 + swell * 4.5);
          float foam = shoreBand * smoothstep(0.30, 0.82, surfWave * shoreBand + shoreBand * 0.45);
          c = mix(c, ${glslColor('#f2fbff')}, clamp(foam * 0.86, 0.0, 0.92));

          float spec = pow(max(dot(reflect(-sunDir, n), v), 0.0), mix(70.0, 175.0, detailFade));
          c += vec3(1.0, 0.95, 0.82) * spec * (1.4 + detailFade * 1.2);
          float alpha = clamp(smoothstep(0.0, 0.28, depth) * (0.84 + fresnel * 0.14) + foam * 0.35, 0.0, 0.96);
          gl_FragColor = vec4(c, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    material.uniforms.time = worldTime;
    material.uniforms.uHeight.value = this.heightTexture;
    const water = new THREE.Mesh(waterGeo, material);
    water.position.y = WATER_LEVEL;
    water.name = 'Water';
    this.scene.add(water);
  }

  private makeRoadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(128, 512);
    const rnd = seeded(91);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = 38 + rnd() * 18;
      img.data[i] = g; img.data[i + 1] = g + 1; img.data[i + 2] = g + 4; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Tyre-worn lanes, crisp edge lines and a highway-amber dashed centre line.
    ctx.fillStyle = 'rgba(18,20,24,.32)'; ctx.fillRect(22, 0, 20, 512); ctx.fillRect(86, 0, 20, 512);
    ctx.fillStyle = 'rgba(240,244,248,.88)'; ctx.fillRect(6, 0, 4, 512); ctx.fillRect(118, 0, 4, 512);
    ctx.fillStyle = 'rgba(255,196,46,.92)'; for (let y = 0; y < 512; y += 128) ctx.fillRect(61, y, 6, 70);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(20,20,18,${.1 + rnd() * .2})`; ctx.beginPath(); ctx.ellipse(rnd() * 128, rnd() * 512, 4 + rnd() * 14, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2); ctx.fill(); }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  private createRoads(): void {
    const points = [
      new THREE.Vector3(-1650, 0, -1250), new THREE.Vector3(100, 0, -1900), new THREE.Vector3(1800, 0, 100),
      new THREE.Vector3(1650, 0, -1250), new THREE.Vector3(1650, 0, 1550), new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-1600, 0, 1550), new THREE.Vector3(-1850, 0, 50), new THREE.Vector3(100, 0, 1850),
      new THREE.Vector3(-1650, 0, -1250)
    ];
    // Ground-following ribbon with UVs along its length so markings tile correctly.
    const curve = new THREE.CatmullRomCurve3(points, true);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const samples = 1400;
    let travelled = 0;
    let previous = curve.getPoint(0);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const center = curve.getPoint(t);
      travelled += center.distanceTo(previous);
      const tangent = curve.getTangent(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      for (const side of [-1, 1]) {
        const x = center.x + normal.x * side * 5, z = center.z + normal.z * side * 5;
        positions.push(x, Math.max(this.getTerrainHeight(x, z), this.getTerrainHeight(center.x, center.z)) + 0.12, z);
        uvs.push(side < 0 ? 0 : 1, travelled / 20);
      }
      if (i < samples) { const j = i * 2; indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3); }
      if (i % 4 === 0 && i > 0) this.roadSegments.push([previous.x, previous.z, center.x, center.z, 6]);
      previous = center;
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();
    const roadMat = new THREE.MeshStandardMaterial({ map: this.makeRoadTexture(), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    roadMesh.name = 'Road';
    this.scene.add(roadMesh);
  }

  /** Low-poly conifer: trunk plus four jittered cone tiers, darker toward the core. */
  private conifer(rnd: () => number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const paint = (g: THREE.BufferGeometry, base: THREE.Color, dark: THREE.Color, y0: number, y1: number) => {
      const p = g.attributes.position, colors = new Float32Array(p.count * 3), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const k = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
        c.copy(dark).lerp(base, k * .8 + rnd() * .2);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    };
    parts.push(paint(new THREE.CylinderGeometry(.16, .3, 3, 6).translate(0, 1.5, 0).toNonIndexed(), new THREE.Color('#6b4c35'), new THREE.Color('#38271b'), 0, 3));
    const green = new THREE.Color('#28723e'), dark = new THREE.Color('#133a20');
    for (let tier = 0; tier < 4; tier++) {
      const r = 2.5 - tier * .5 + rnd() * .2, hgt = 3.2 - tier * .35, y = 2.2 + tier * 1.55;
      const cone = new THREE.ConeGeometry(r, hgt, 9, 1).toNonIndexed();
      cone.rotateY(rnd() * Math.PI);
      cone.translate((rnd() - .5) * .25, y + hgt / 2, (rnd() - .5) * .25);
      parts.push(paint(cone, green, dark, y, y + hgt));
    }
    const merged = mergeGeometries(parts)!;
    merged.computeVertexNormals();
    return merged;
  }

  /** Broadleaf tree: trunk with a clustered, lumpy canopy. */
  private broadleaf(rnd: () => number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const color = (g: THREE.BufferGeometry, a: string, b: string) => {
      const p = g.attributes.position, colors = new Float32Array(p.count * 3), ca = new THREE.Color(a), cb = new THREE.Color(b), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) { c.copy(ca).lerp(cb, rnd()); colors.set([c.r, c.g, c.b], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    };
    parts.push(color(new THREE.CylinderGeometry(.18, .32, 3.4, 6).translate(0, 1.7, 0).toNonIndexed(), '#5b4636', '#3a2c21'));
    for (let i = 0; i < 5; i++) {
      const blob = new THREE.IcosahedronGeometry(1.3 + rnd() * .7, 1);
      const p = blob.attributes.position, seed = rnd() * 10;
      for (let v = 0; v < p.count; v++) { const x = p.getX(v), y = p.getY(v), z = p.getZ(v), k = .88 + positionHash(x, y, z, seed) * .24; p.setXYZ(v, x * k, y * k * .9, z * k); }
      const a = i / 5 * Math.PI * 2;
      blob.translate(i === 0 ? 0 : Math.cos(a) * 1.3, 4.2 + (i === 0 ? 1.1 : rnd() * .8), i === 0 ? 0 : Math.sin(a) * 1.3);
      parts.push(color(blob.toNonIndexed(), '#3f9142', '#21592a'));
    }
    const merged = mergeGeometries(parts)!;
    merged.computeVertexNormals();
    return merged;
  }

  private rockGeometry(rnd: () => number): THREE.BufferGeometry {
    // Polyhedron geometry is non-indexed; displacement keyed on position keeps shared corners welded.
    const g = new THREE.IcosahedronGeometry(1.4, 1);
    const seed = rnd() * 10;
    const p = g.attributes.position, colors = new Float32Array(p.count * 3);
    const stone = new THREE.Color('#78828c'), moss = new THREE.Color('#3b8542'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = .78 + positionHash(x, y, z, seed) * .3;
      p.setXYZ(i, x * k * 1.2, y * k * .75, z * k);
      c.copy(stone).multiplyScalar(.8 + positionHash(z, x, y, seed) * .3).lerp(moss, y > .5 ? .55 : 0);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Wind sway for instanced foliage, stronger toward the treetop. */
  private windMaterial(params: THREE.MeshStandardMaterialParameters, strength: number): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial(params);
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = worldTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float bend = pow(max(transformed.y, 0.0) / 8.0, 2.0) * ${strength.toFixed(2)};
          float gust = sin(uTime * 1.1 + ip.x * .05 + ip.z * .04) * .7 + sin(uTime * 2.3 + ip.x * .21) * .3;
          transformed.x += gust * bend;
          transformed.z += gust * bend * .5;
        #endif`);
    };
    mat.customProgramCacheKey = () => `dz-wind-${strength}`;
    return mat;
  }

  private createFoliageAndRocks(): void {
    const rnd = seeded(20240611);
    const conifers = [this.conifer(rnd), this.conifer(rnd)];
    const broadleaves = [this.broadleaf(rnd), this.broadleaf(rnd)];
    const rocks = [this.rockGeometry(rnd), this.rockGeometry(rnd)];
    const treeMat = this.windMaterial({ vertexColors: true, roughness: 0.9 }, .45);
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });

    const tileCount = Math.ceil(MAP_SIZE / FOLIAGE_TILE);
    type Bucket = Record<string, THREE.Matrix4[]>;
    const buckets = new Map<number, Bucket>();
    const bucket = (x: number, z: number) => {
      const tx = THREE.MathUtils.clamp(Math.floor((x + MAP_SIZE / 2) / FOLIAGE_TILE), 0, tileCount - 1);
      const tz = THREE.MathUtils.clamp(Math.floor((z + MAP_SIZE / 2) / FOLIAGE_TILE), 0, tileCount - 1);
      const key = tz * tileCount + tx;
      if (!buckets.has(key)) buckets.set(key, {});
      return buckets.get(key)!;
    };
    const push = (b: Bucket, kind: string, m: THREE.Matrix4) => { (b[kind] ??= []).push(m); };
    const dummy = new THREE.Object3D();
    const matrix = () => { dummy.updateMatrix(); return dummy.matrix.clone(); };
    const clearOfTown = (x: number, z: number) => !POI_LOCATIONS.some(poi => poi.name !== 'Radio Ridge' && poi.name !== 'Quarry' && Math.hypot(x - poi.x, z - poi.z) < poi.radius * (poi.name === 'Central Depot' || poi.name === 'Old Town' || poi.name === 'Harbor' ? .8 : .45));

    // Trees grow in clustered forests rather than a uniform sprinkle.
    const groves: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < 70; i++) groves.push({ x: (rnd() - .5) * (MAP_SIZE - 400), z: (rnd() - .5) * (MAP_SIZE - 400), r: 80 + rnd() * 220 });
    for (let i = 0; i < 7800; i++) {
      let rx: number, rz: number;
      if (i % 4 !== 0) { const g = groves[Math.floor(rnd() * groves.length)], a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * g.r; rx = g.x + Math.cos(a) * d; rz = g.z + Math.sin(a) * d; }
      else { rx = (rnd() - 0.5) * (MAP_SIZE - 300); rz = (rnd() - 0.5) * (MAP_SIZE - 300); }
      if (!clearOfTown(rx, rz)) continue;
      const ry = this.getTerrainHeight(rx, rz);
      if (ry < WATER_LEVEL + .4 || Math.abs(rx) > MAP_SIZE / 2 - 120 || Math.abs(rz) > MAP_SIZE / 2 - 120) continue;
      const scale = 0.75 + rnd() * 0.65;
      dummy.position.set(rx, ry - .1, rz); dummy.rotation.set(0, rnd() * Math.PI * 2, 0); dummy.scale.set(scale, scale * (.9 + rnd() * .25), scale);
      const kind = ry > 12 || rnd() < .62 ? 'conifer' : 'broadleaf';
      push(bucket(rx, rz), kind, matrix());
    }
    // Forested foothills on the boundary ridges, thinning out toward rocky peaks.
    for (let i = 0; i < 3400; i++) {
      const side = Math.floor(rnd() * 4), along = (rnd() - .5) * (MAP_SIZE - 80), depth = MAP_SIZE / 2 - 30 - rnd() * 260;
      const rx = side < 2 ? along : side === 2 ? depth : -depth, rz = side < 2 ? (side === 0 ? depth : -depth) : along;
      const ry = this.getTerrainHeight(rx, rz);
      if (ry > 85 || ry < WATER_LEVEL + .4) continue;
      const scale = .8 + rnd() * .7;
      dummy.position.set(rx, ry - .1, rz); dummy.rotation.set(0, rnd() * Math.PI * 2, 0); dummy.scale.setScalar(scale);
      push(bucket(rx, rz), 'conifer', matrix());
    }
    for (let i = 0; i < 900; i++) {
      const rx = (rnd() - 0.5) * (MAP_SIZE - 200), rz = (rnd() - 0.5) * (MAP_SIZE - 200);
      if (!clearOfTown(rx, rz)) continue;
      const scale = 0.5 + rnd() * 1.8;
      dummy.position.set(rx, this.getTerrainHeight(rx, rz) + scale * 0.15, rz);
      dummy.rotation.set(rnd() * .4, rnd() * Math.PI * 2, rnd() * .4);
      dummy.scale.set(scale, scale * (0.7 + rnd() * 0.5), scale);
      push(bucket(rx, rz), 'rock', matrix());
    }

    // One instanced mesh per kind per tile; neighbouring tiles alternate geometry variants.
    const geometryFor = (kind: string, variant: number): [THREE.BufferGeometry, THREE.Material, FoliageTile['kind']] =>
      kind === 'conifer' ? [conifers[variant], treeMat, 'tree'] : kind === 'broadleaf' ? [broadleaves[variant], treeMat, 'tree'] : [rocks[variant], rockMat, 'rock'];
    for (const [key, b] of buckets) {
      const center = new THREE.Vector3((key % tileCount + .5) * FOLIAGE_TILE - MAP_SIZE / 2, 0, (Math.floor(key / tileCount) + .5) * FOLIAGE_TILE - MAP_SIZE / 2);
      for (const [kind, matrices] of Object.entries(b)) {
        const [geometry, material, tileKind] = geometryFor(kind, (key + Math.floor(key / tileCount)) % 2);
        const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.computeBoundingSphere();
        mesh.receiveShadow = true;
        this.foliage.add(mesh);
        this.foliageTiles.push({ mesh, kind: tileKind, center });
      }
    }
    this.scene.add(this.foliage);
  }

  /**
   * Distance culling for foliage tiles. Only trees and rocks near the player
   * render into the shadow map.
   */
  public updateLod(position: THREE.Vector3, shadows: boolean): void {
    const half = FOLIAGE_TILE * .71;
    const airborne = position.y - this.getTerrainHeight(position.x, position.z) > 150;
    for (const tile of this.foliageTiles) {
      const d = Math.max(0, Math.hypot(tile.center.x - position.x, tile.center.z - position.z) - half);
      tile.mesh.visible = d < (tile.kind === 'rock' ? 800 : 1800);
      tile.mesh.castShadow = shadows && d < 60 && !airborne;
    }
  }
}
