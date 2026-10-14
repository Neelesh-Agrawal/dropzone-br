import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { POI_LOCATIONS } from '../../shared/constants';
import { AshenValleyMap } from './AshenValleyMap';
import { Surface, SURFACE_SCALE, boxProjectUVs, surfaceTextures } from './Textures';

type Mat = THREE.MeshStandardMaterial;

/**
 * Procedural towns and landmarks. Every piece is authored as simple meshes,
 * then merged per area and surface into a few batches with world-space
 * texturing. Collision meshes are listed in `buildings` and kept (invisible)
 * for player collision, bullet raycasts and bot line-of-sight.
 */
export class BuildingGenerator {
  private scene: THREE.Scene;
  private map: AshenValleyMap;
  public buildings: THREE.Object3D[] = [];
  /** Ground footprints of everything built (houses, roads, yards), used to keep grass out. */
  public footprints: THREE.Box3[] = [];
  private materials = new Map<string, Mat>();
  private rnd: () => number;

  /** isuals is false on the server, which only needs collision geometry. */
  constructor(scene: THREE.Scene, map: AshenValleyMap, visuals = typeof document !== 'undefined') {
    this.scene = scene;
    this.map = map;
    let seed = 7331;
    this.rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const before = new Set(scene.children);
    this.generateAllPOIs();
    if (visuals) this.batchStatic(scene.children.filter(o => !before.has(o)));
  }

  // ---------------------------------------------------------------- helpers

  private mat(surface: Surface, color: number | string, roughness = .9, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): Mat {
    const key = `${surface}|${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
    let m = this.materials.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }); m.userData.surface = surface; this.materials.set(key, m); }
    return m;
  }

  private box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: Mat, collide = false, rotY = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    if (collide) this.buildings.push(mesh);
    return mesh;
  }

  private cylinder(parent: THREE.Object3D, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, material: Mat, segments = 14, collide = false): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    if (collide) this.buildings.push(mesh);
    return mesh;
  }

  /** Gable roof: two sloped planes along X plus the triangular gable ends. */
  private gableRoof(parent: THREE.Object3D, width: number, depth: number, rise: number, y: number, roofMat: Mat, gableMat: Mat, overhang = .6): void {
    const w = width / 2 + overhang, d = depth / 2 + overhang, t = .18;
    const slope: number[] = [];
    // Each slope as a thin slab (top + bottom + edges) so it reads solid from below.
    for (const s of [-1, 1]) {
      const z0 = s * d, x0 = -w, x1 = w;
      const top = [[x0, y + rise + t, 0], [x1, y + rise + t, 0], [x1, y + t, z0], [x0, y + t, z0]];
      const bot = [[x0, y + rise, 0], [x1, y + rise, 0], [x1, y, z0], [x0, y, z0]];
      const quad = (a: number[], b: number[], c: number[], e: number[], flip: boolean) => {
        const tri = flip ? [a, c, b, a, e, c] : [a, b, c, a, c, e];
        for (const p of tri) slope.push(...p);
      };
      quad(top[0], top[1], top[2], top[3], s > 0);
      quad(bot[0], bot[1], bot[2], bot[3], s < 0);
      quad(top[3], top[2], bot[2], bot[3], s > 0);
      quad(top[0], top[3], bot[3], bot[0], s > 0);
      quad(top[1], bot[1], bot[2], top[2], s > 0);
    }
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(slope, 3));
    roofGeo.computeVertexNormals();
    const roof = new THREE.Mesh(roofGeo, roofMat); roof.castShadow = roof.receiveShadow = true; parent.add(roof);
    // Gable ends fill the triangle above the wall line.
    const gw = width / 2, gd = depth / 2;
    const ends: number[] = [];
    for (const side of [-1, 1]) {
      const x = side * gw;
      const tri = [[x, y, -gd], [x, y, gd], [x, y + rise * (gd / d), 0]];
      const ordered = side > 0 ? tri : [tri[0], tri[2], tri[1]];
      for (const p of ordered) ends.push(...p);
    }
    const endGeo = new THREE.BufferGeometry();
    endGeo.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3));
    endGeo.computeVertexNormals();
    const gable = new THREE.Mesh(endGeo, gableMat); gable.castShadow = gable.receiveShadow = true; parent.add(gable);
    // Ridge cap
    this.box(parent, width + overhang * 2 + .1, .16, .32, 0, y + rise + .2, 0, this.mat('metal', 0x3a3a36, .6, .4));
  }

  // ------------------------------------------------------------ batching

  /**
   * Merge all generated meshes per 300 m cell and per material, with
   * world-space UVs so textures tile at real-world scale. Originals stay
   * (hidden) for raycasts.
   */
  private batchStatic(roots: THREE.Object3D[]): void {
    this.scene.updateMatrixWorld(true);
    // Per-mesh footprints: a whole road network as one box would be too coarse.
    this.footprints = [];
    for (const root of roots) root.traverse(o => { if (o instanceof THREE.Mesh) this.footprints.push(new THREE.Box3().setFromObject(o)); });
    const CELL = 300;
    const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; cast: boolean }>();
    for (const root of roots) {
      root.traverse(o => {
        if (!(o instanceof THREE.Mesh) || Array.isArray(o.material) || !o.visible) return;
        const geometry = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
        for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal'].includes(name)) geometry.deleteAttribute(name);
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        const surface = (o.material.userData.surface || 'plain') as Surface;
        boxProjectUVs(geometry, SURFACE_SCALE[surface]);
        // Bake the material colour into vertex colours so every tint of a
        // surface shares one material (and one draw call per area).
        const m = o.material as Mat;
        const tint = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < tint.length; i += 3) { tint[i] = m.color.r; tint[i + 1] = m.color.g; tint[i + 2] = m.color.b; }
        geometry.setAttribute('color', new THREE.BufferAttribute(tint, 3));
        const center = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const look = [surface, m.roughness, m.metalness, m.side, m.flatShading].join('|');
        const key = `${Math.floor(center.x / CELL)},${Math.floor(center.z / CELL)}|${look}`;
        if (!groups.has(key)) groups.set(key, { material: o.material, geometries: [], cast: false });
        const group = groups.get(key)!;
        group.geometries.push(geometry);
        group.cast ||= o.castShadow;
        o.visible = false;
      });
    }
    // One textured, vertex-tinted material per surface look.
    const textured = new Map<string, THREE.Material>();
    const texturedFor = (m: THREE.Material) => {
      const s = m as Mat;
      const surface = (m.userData.surface || 'plain') as Surface;
      const look = [surface, s.roughness, s.metalness, s.side, s.flatShading].join('|');
      if (!textured.has(look)) {
        const copy = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: s.roughness, metalness: s.metalness, side: s.side, flatShading: s.flatShading });
        const tex = surfaceTextures(surface);
        if (tex) {
          copy.map = tex.map; copy.normalMap = tex.normal;
          const k = surface === 'metal' ? 1.2 : surface === 'roof' ? 1 : .6;
          copy.normalScale.set(k, k);
        }
        textured.set(look, copy);
      }
      return textured.get(look)!;
    };
    const batches = new THREE.Group();
    batches.name = 'StaticBatches';
    for (const { material, geometries, cast } of groups.values()) {
      const merged = mergeGeometries(geometries);
      geometries.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, texturedFor(material));
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      batches.add(mesh);
    }
    this.scene.add(batches);
  }

  // ------------------------------------------------------------ POIs

  private generateAllPOIs(): void {
    for (const poi of POI_LOCATIONS) {
      if (poi.name === 'Central Depot') this.createCentralDepot(poi.x, poi.z);
      else if (poi.name === 'Old Town') this.createOldTown(poi.x, poi.z);
      else if (poi.name === 'Radio Ridge') this.createRadioRidge(poi.x, poi.z);
      else if (poi.name === 'Quarry') this.createQuarry(poi.x, poi.z);
      else if (poi.name === 'Farmstead') this.createFarmstead(poi.x, poi.z);
      else if (poi.name === 'Harbor') this.createHarbor(poi.x, poi.z);
      else if (poi.name === 'East Airfield') this.createAirfield(poi.x, poi.z);
      else this.createSettlement(poi.x, poi.z, poi.name);
      this.createTacticalCoverCluster(poi.x, poi.z, poi.radius * 0.55);
    }
    this.createRoadsideHomesteads();
  }

  /**
   * Builds tactical cover elements (concrete Jersey barriers, sandbag walls,
   * supply crates, and fuel barrels) around POIs so players have realistic cover in firefights.
   */
  private createTacticalCoverCluster(cx: number, cz: number, spread: number): void {
    const group = new THREE.Group();
    const concrete = this.mat('concrete', 0x928f86, .92);
    const sandbag = this.mat('plaster', 0xb8a47e, .95);
    for (let i = 0; i < 8; i++) {
      const angle = i * (Math.PI / 4) + 0.35;
      const dist = 22 + (i % 3) * (spread * 0.32);
      const bx = cx + Math.cos(angle) * dist;
      const bz = cz + Math.sin(angle) * dist;
      const by = this.map.getTerrainHeight(bx, bz);
      if (by < -0.8) continue;
      // L-shaped sandbag/concrete cover wall + supply crate
      this.box(group, 3.6, 1.25, 0.55, bx, by + 0.62, bz, i % 2 === 0 ? concrete : sandbag, true, angle);
      this.box(group, 0.55, 1.25, 2.4, bx + Math.cos(angle + 1.57) * 1.5, by + 0.62, bz + Math.sin(angle + 1.57) * 1.5, sandbag, true, angle);
      this.crate(group, bx - Math.cos(angle) * 1.4, bz - Math.sin(angle) * 1.4, 1.15, angle * 0.5);
      if (i % 2 === 1) {
        this.barrel(group, bx + Math.sin(angle) * 1.8, bz - Math.cos(angle) * 1.8, 0x2f5d7a);
      }
    }
    this.scene.add(group);
  }

  /**
   * Adds 14 roadside residential compounds, watchtowers, and tactical cover
   * across the valley so the map feels lived-in with plenty of homes to enter, hide, and loot.
   */
  public readonly homesteadSpots: { x: number; z: number }[] = [
    { x: -640, z: -480 }, { x: 420, z: -560 }, { x: -340, z: 320 }, { x: 520, z: 360 },
    { x: -980, z: -180 }, { x: 860, z: -120 }, { x: -220, z: -860 }, { x: 260, z: 880 },
    { x: -1120, z: 420 }, { x: 1080, z: 460 }, { x: -480, z: 980 }, { x: 640, z: -980 },
    { x: -180, z: -320 }, { x: 290, z: -190 }
  ];

  private createRoadsideHomesteads(): void {
    const palettes = [0xf2ece1, 0xe8d7be, 0xd8e4dc, 0xf0dfc4, 0xe4ebe6];
    const roofs = [0xb3422c, 0x3d4b59, 0x9c3828, 0x2f3b47];
    const wallMat = this.mat('concrete', 0x8d8a80, .92);

    this.homesteadSpots.forEach((spot, idx) => {
      const gy = this.map.getTerrainHeight(spot.x, spot.z);
      if (gy < -0.5) return;

      // Main two-story house
      const h1 = new THREE.Group();
      h1.position.set(spot.x, gy, spot.z);
      this.addHouse(h1, 14, 13, 7.6, palettes[idx % palettes.length], roofs[idx % roofs.length], idx);
      this.scene.add(h1);

      // Neighboring cottage / garage 24m away
      const nx = spot.x + 24, nz = spot.z + (idx % 2 === 0 ? 12 : -12);
      const ngy = this.map.getTerrainHeight(nx, nz);
      if (ngy >= -0.5) {
        const h2 = new THREE.Group();
        h2.position.set(nx, ngy, nz);
        this.addHouse(h2, 12, 11, 6.4, palettes[(idx + 2) % palettes.length], roofs[(idx + 1) % roofs.length], idx + 3);
        this.scene.add(h2);
      }

      // Compound courtyard walls, crates, and barrels for tactical cover
      const yard = new THREE.Group();
      this.box(yard, 10, 1.35, 0.45, spot.x + 12, this.map.getTerrainHeight(spot.x + 12, spot.z - 9) + 0.68, spot.z - 9, wallMat, true);
      this.box(yard, 0.45, 1.35, 9, spot.x - 10, this.map.getTerrainHeight(spot.x - 10, spot.z + 2) + 0.68, spot.z + 2, wallMat, true);
      this.crate(yard, spot.x + 9, spot.z + 4, 1.25, idx * 0.7);
      this.crate(yard, spot.x + 10.4, spot.z + 4.3, 1.0, idx * 1.1);
      this.barrel(yard, spot.x - 8.5, spot.z - 6, idx % 2 ? 0xc93b2b : 0x2f5d7a);
      this.scene.add(yard);
    });
  }

  /** Corrugated-metal warehouse with a low gable roof, roll-up doors and clerestory windows. */
  private createWarehouse(x: number, z: number, width: number, depth: number, height: number, color: number, rotY = 0): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, this.map.getTerrainHeight(x, z), z);
    group.rotation.y = rotY;
    const wall = this.mat('metal', color, .75, .35);
    this.box(group, width, height, depth, 0, height / 2, 0, wall, true);
    this.box(group, width + .5, .7, depth + .5, 0, .35, 0, this.mat('concrete', 0x9a978d, .95));
    this.gableRoof(group, width, depth, Math.min(4, depth * .12), height, this.mat('metal', 0x50534f, .55, .5), wall, .9);
    const door = this.mat('metal', 0x3d423e, .6, .5);
    const trim = this.mat('metal', 0x2b2e2b, .6, .5);
    for (const side of [-1, 1]) {
      // Roll-up door with frame and a small personnel door beside it.
      this.box(group, Math.min(8, width * .35), Math.min(6, height * .55), .25, 0, Math.min(6, height * .55) / 2, side * (depth / 2 + .1), door);
      this.box(group, Math.min(8, width * .35) + .6, .4, .4, 0, Math.min(6, height * .55) + .2, side * (depth / 2 + .15), trim);
      this.box(group, 1.1, 2.3, .2, width * .3, 1.15, side * (depth / 2 + .1), this.mat('metal', 0x6f5a3c, .7, .3));
      // Clerestory window band
      this.box(group, width * .8, 1, .12, 0, height - 1.4, side * (depth / 2 + .08), this.mat('glass', 0x2a3c40, .15, .8));
      // Downpipes
      for (const px of [-1, 1]) this.cylinder(group, .09, .09, height, px * (width / 2 - .3), height / 2, side * (depth / 2 + .2), trim, 6);
    }
    // Structural columns down the long walls.
    for (const side of [-1, 1]) for (let i = 0; i <= 4; i++) this.box(group, .3, height, .3, side * (width / 2 + .1), height / 2, -depth / 2 + i * depth / 4, trim);
    for (let i = -1; i <= 1; i++) this.box(group, 1.2, .6, 1.2, i * width * .28, height + Math.min(4, depth * .12) + .35, 0, trim);
    this.scene.add(group);
    return group;
  }

  private createShippingContainer(x: number, y: number, z: number, rotY: number, colorHex: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z); group.rotation.y = rotY;
    const body = this.mat('metal', colorHex, .65, .35);
    this.box(group, 2.5, 2.6, 6.1, 0, 1.3, 0, body, true);
    const frame = this.mat('metal', 0x2d2f2c, .6, .5);
    // Corner posts and door-end locking bars.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(group, .16, 2.62, .16, sx * 1.2, 1.3, sz * 3, frame);
    for (const bx of [-.75, -.35, .35, .75]) this.box(group, .05, 2.3, .05, bx, 1.3, 3.08, frame);
    this.box(group, .02, 2.4, .02, 0, 1.3, 3.07, frame);
    this.scene.add(group);
  }

  private crate(parent: THREE.Object3D, x: number, z: number, size = 1.2, rot = 0): void {
    const y = this.map.getTerrainHeight(x, z);
    this.box(parent, size, size, size, x, y + size / 2, z, this.mat('wood', 0x8a6e48, .9), true, rot);
  }

  private barrel(parent: THREE.Object3D, x: number, z: number, color: number): void {
    const y = this.map.getTerrainHeight(x, z);
    this.cylinder(parent, .42, .42, 1.25, x, y + .62, z, this.mat('metal', color, .55, .4), 12, true);
    for (const h of [.25, 1]) this.cylinder(parent, .44, .44, .06, x, y + h, z, this.mat('metal', 0x2b2c2a, .5, .5), 12);
  }

  private createCentralDepot(cx: number, cz: number): void {
    this.createWarehouse(cx - 35, cz - 30, 25, 45, 12, 0x4b6578);
    this.createWarehouse(cx + 35, cz - 30, 25, 45, 12, 0x3b586c);
    this.createWarehouse(cx, cz + 40, 45, 30, 14, 0x5c6670);
    const colors = [0xc93b2b, 0x1e69a8, 0x287d4e, 0xe09624, 0x3a4b5c];
    const groundY = this.map.getTerrainHeight(cx, cz);
    for (let i = 0; i < 16; i++) {
      const offsetX = (i % 4) * 5 - 7.5, offsetZ = Math.floor(i / 4) * 9 - 15;
      const stack = (i % 3 === 0) ? 2 : 1;
      for (let s = 0; s < stack; s++) this.createShippingContainer(cx + offsetX, groundY + s * 2.62, cz + offsetZ, (i % 2 === 0) ? 0 : Math.PI / 2, colors[(i + s) % colors.length]);
    }
    // Concrete yard, cover crates and fuel drums between the sheds.
    const yard = new THREE.Group();
    this.box(yard, 120, .12, 130, cx, groundY + .06, cz + 2, this.mat('concrete', 0x8e8b82, .95));
    for (let i = 0; i < 14; i++) this.crate(yard, cx - 20 + (i * 37 % 40), cz + 12 + (i * 13 % 14), 1 + (i % 3) * .25, i);
    for (let i = 0; i < 10; i++) this.barrel(yard, cx + 15 + (i % 4) * 1.1, cz + 10 + Math.floor(i / 4) * 1.1, i % 2 ? 0x2f5d7a : 0x7a2f2a);
    // Perimeter fence posts with rails.
    const fence = this.mat('metal', 0x5a5d58, .6, .6);
    for (let i = 0; i <= 24; i++) for (const side of [-1, 1]) {
      const fx = cx - 60 + i * 5, fz = cz + side * 65;
      this.cylinder(yard, .06, .06, 2.2, fx, this.map.getTerrainHeight(fx, fz) + 1.1, fz, fence, 6);
    }
    for (const side of [-1, 1]) for (const h of [.9, 2]) this.box(yard, 120, .05, .05, cx, groundY + h, cz + side * 65, fence);
    this.scene.add(yard);
  }

  /** Two-storey plaster house with gable roof, chimney, framed windows and open doorways. */
  private addHouse(group: THREE.Group, width: number, depth: number, height: number, wallColor: number, roofColor: number, variant: number): void {
    const wallMat = this.mat(variant % 4 === 0 ? 'brick' : 'plaster', variant % 4 === 0 ? 0xc29a86 : wallColor, .92);
    const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => this.box(group, w, h, d, x, y, z, wallMat, true);
    const thickness = .34, doorway = Math.min(1.8, width * .17), panel = (width - doorway) / 2;
    for (const zSide of [-1, 1]) {
      for (const side of [-1, 1]) wall(panel, height, thickness, side * (doorway / 2 + panel / 2), height / 2, zSide * (depth / 2));
      wall(doorway, Math.max(0, height - 2.8), thickness, 0, 2.8 + Math.max(0, height - 2.8) / 2, zSide * (depth / 2));
      for (const side of [-1, 1]) this.box(group, .14, 2.8, .44, side * doorway / 2, 1.4, zSide * (depth / 2), this.mat('wood', 0x5b4634, .85));
      this.box(group, doorway + .3, .14, .44, 0, 2.86, zSide * (depth / 2), this.mat('wood', 0x5b4634, .85));
      // Doorstep
      this.box(group, doorway + .8, .2, .9, 0, .1, zSide * (depth / 2 + .55), this.mat('concrete', 0x8f8c84, .95));
    }
    wall(thickness, height, depth, -width / 2, height / 2, 0);
    wall(thickness, height, depth, width / 2, height / 2, 0);
    this.box(group, width - .1, .22, depth - .1, 0, .11, 0, this.mat('wood', 0x7d6448, .85));
    // Upper floor slab (interior ceiling) and stone plinth around the base.
    this.box(group, width - .2, .2, depth - .2, 0, height * .5, 0, this.mat('wood', 0x6d5640, .85));
    this.box(group, width + .12, .7, depth + .12, 0, .35, 0, this.mat('concrete', 0x77736a, .95));
    const frame = this.mat('trim', 0xe8e1cf, .85);
    const glass = this.mat('glass', 0x2b3d42, .12, .85);
    const shutter = this.mat('wood', [0x3f5a4c, 0x6b3b2f, 0x3d4d63, 0x5e5a3c][variant % 4], .8);
    for (const side of [-1, 1]) {
      const z = side * (depth / 2 + .2);
      for (const x of [-width * .3, width * .3]) for (const y of [height * .25, height * .72]) {
        this.box(group, 1.5, 1.9, .14, x, y, z, frame);
        this.box(group, 1.26, 1.66, .16, x, y, z + side * .03, glass);
        this.box(group, .06, 1.66, .18, x, y, z + side * .07, frame);
        this.box(group, 1.26, .06, .18, x, y + .2, z + side * .07, frame);
        this.box(group, 1.9, .14, .4, x, y - 1.02, z + side * .08, frame);
        for (const dx of [-1.02, 1.02]) this.box(group, .52, 1.9, .08, x + dx, y, z + side * .02, shutter);
      }
      // Window on the gable walls too
      this.box(group, .14, 1.5, 1.2, side * (width / 2 + .18), height * .72, 0, frame);
      this.box(group, .16, 1.3, 1.0, side * (width / 2 + .2), height * .72, 0, glass);
      this.box(group, width + .2, .2, .2, 0, height * .5, side * (depth / 2 + .18), frame);
    }
    const rise = Math.min(4.2, depth * .32);
    this.gableRoof(group, width, depth, rise, height, this.mat('roof', roofColor, .85), wallMat, .7);
    // Chimney
    this.box(group, .9, rise + 2, .9, width * .28, height + rise * .55 + .5, depth * .18, this.mat('brick', 0xa9806c, .9));
    this.box(group, 1.1, .2, 1.1, width * .28, height + rise * .55 + 1.55, depth * .18, this.mat('concrete', 0x77736a, .95));
  }

  private createOldTown(cx: number, cz: number): void {
    const town = new THREE.Group();
    const asphalt = this.mat('asphalt', 0x4c4d49, .95);
    const curb = this.mat('concrete', 0xa29f95, .95);
    const walk = this.mat('concrete', 0x8b887f, .95);
    for (let i = -2; i <= 2; i++) for (const vertical of [false, true]) {
      const x = cx + (vertical ? i * 46 + 23 : 0), z = cz + (vertical ? 0 : i * 46 + 23);
      const y = this.map.getTerrainHeight(x, z);
      this.box(town, vertical ? 9 : 260, .13, vertical ? 260 : 9, x, y + .1, z, asphalt);
      for (const side of [-1, 1]) {
        const offset = side * 5.6;
        this.box(town, vertical ? .3 : 260, .25, vertical ? 260 : .3, x + (vertical ? offset : 0), y + .13, z + (vertical ? 0 : offset), curb);
        this.box(town, vertical ? 2.2 : 260, .2, vertical ? 260 : 2.2, x + (vertical ? side * 6.85 : 0), y + .12, z + (vertical ? 0 : side * 6.85), walk);
      }
    }
    // Street lamps along the main avenue
    const pole = this.mat('metal', 0x2e302d, .5, .6);
    for (let i = -5; i <= 5; i++) {
      const x = cx + i * 23, z = cz + 23 + 7.4;
      const y = this.map.getTerrainHeight(x, z);
      this.cylinder(town, .08, .1, 5, x, y + 2.5, z, pole, 6);
      this.box(town, .9, .1, .2, x, y + 5, z - .4, pole);
    }
    this.scene.add(town);
    const houseColors = [0xf2ece1, 0xe8d7be, 0xd8e4dc, 0xf0dfc4, 0xe2c7aa, 0xf5f0e6];
    const roofColors = [0xb3422c, 0x3d4b59, 0x9c3828, 0x2f3b47];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if ((r === 2 && c === 2) || (r === 2 && c === 1)) continue;
      const hx = cx + (c - 2) * 46, hz = cz + (r - 2) * 46;
      const group = new THREE.Group();
      group.position.set(hx, this.map.getTerrainHeight(hx, hz), hz);
      const width = 14 + ((r * 7 + c * 3) % 5), depth = 14 + ((r * 3 + c * 7) % 5), height = 8 + ((r * 5 + c * 2) % 5);
      const variant = r * 5 + c;
      this.addHouse(group, width, depth, height, houseColors[variant % houseColors.length], roofColors[variant % roofColors.length], variant);
      this.scene.add(group);
    }
    // Town square: fountain and benches in the open lot.
    const square = new THREE.Group();
    const sx = cx, sz = cz, sy = this.map.getTerrainHeight(sx, sz);
    this.box(square, 36, .15, 36, sx, sy + .08, sz, this.mat('concrete', 0xa5a092, .95));
    this.cylinder(square, 3.2, 3.4, .8, sx, sy + .45, sz, this.mat('concrete', 0x8f8b80, .9), 20, true);
    this.cylinder(square, .4, .5, 2.4, sx, sy + 1.4, sz, this.mat('concrete', 0x8f8b80, .9), 10);
    this.cylinder(square, 1.1, .6, .4, sx, sy + 2.6, sz, this.mat('concrete', 0x8f8b80, .9), 14);
    this.scene.add(square);
  }

  private createSettlement(cx: number, cz: number, name: string): void {
    const palettes = [0xf0e8d8, 0xdbe5de, 0xebd3b0, 0xe4ebe6];
    const roofs = [0xad422d, 0x3b4854, 0x8f3929];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      const x = cx + (col - 1.5) * 28, z = cz + (row - 1) * 30;
      const width = 12 + ((row + col) % 3) * 2, depth = 12 + ((row * 2 + col) % 3) * 2, height = 6.5 + ((row + col) % 2) * 1.5;
      const group = new THREE.Group();
      group.name = `${name}_House_${row}_${col}`;
      group.position.set(x, this.map.getTerrainHeight(x, z), z);
      this.addHouse(group, width, depth, height, palettes[(row + col) % palettes.length], roofs[(row * 2 + col) % roofs.length], row * 4 + col + 2);
      this.scene.add(group);
    }
    const road = new THREE.Group();
    const gy = this.map.getTerrainHeight(cx, cz);
    this.box(road, 150, .14, 6, cx, gy + .1, cz + 58, this.mat('asphalt', 0x4c4d49, .95));
    this.scene.add(road);
  }

  private createAirfield(cx: number, cz: number): void {
    const field = new THREE.Group();
    const y = this.map.getTerrainHeight(cx, cz) + .08;
    this.box(field, 330, .18, 30, cx, y, cz, this.mat('asphalt', 0x55564f, .95));
    const paint = this.mat('trim', 0xe6e2d2, .8);
    for (let i = -7; i <= 7; i++) this.box(field, 12, .02, .6, cx + i * 20, y + .1, cz, paint);
    for (const end of [-1, 1]) for (let k = -4; k <= 4; k++) this.box(field, 10, .02, 1.2, cx + end * 150, y + .1, cz + k * 3, paint);
    this.scene.add(field);
    this.createHangar(cx - 65, cz - 58, 48, 58, 0x7b8278);
    this.createHangar(cx + 65, cz - 58, 48, 58, 0x868579);
    this.createWarehouse(cx, cz + 75, 34, 46, 10, 0x6f7c74);
    // Control tower
    const tower = new THREE.Group();
    const tx = cx + 120, tz = cz + 40, ty = this.map.getTerrainHeight(tx, tz);
    this.box(tower, 6, 16, 6, tx, ty + 8, tz, this.mat('concrete', 0xa29e93, .9), true);
    this.box(tower, 9, 3.6, 9, tx, ty + 17.8, tz, this.mat('glass', 0x33494f, .1, .9));
    this.box(tower, 9.6, .5, 9.6, tx, ty + 19.8, tz, this.mat('metal', 0x3a3d3a, .6, .4));
    this.box(tower, 9.6, .4, 9.6, tx, ty + 15.9, tz, this.mat('concrete', 0x8c887d, .9));
    this.cylinder(tower, .06, .06, 5, tx + 3, ty + 22.5, tz + 3, this.mat('metal', 0xb03a2e, .5, .4), 6);
    this.scene.add(tower);
  }

  /** Arched (Quonset) hangar. */
  private createHangar(x: number, z: number, width: number, depth: number, color: number): void {
    const group = new THREE.Group();
    group.position.set(x, this.map.getTerrainHeight(x, z), z);
    const metal = this.mat('metal', color, .65, .45);
    const r = width / 2;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, 28, 1, true, -Math.PI / 2, Math.PI), metal);
    // Half-cylinder arch: axis along Z after rotation, squashed to a low profile.
    shell.rotation.set(-Math.PI / 2, 0, 0);
    shell.scale.set(1, 1, .55);
    shell.castShadow = shell.receiveShadow = true;
    group.add(shell);
    // Collision volume roughly matching the arch.
    this.box(group, width, r * .55, depth, 0, r * .55 / 2, 0, this.mat('plain', 0x000000), true).visible = false;
    for (const side of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CircleGeometry(r, 28, 0, Math.PI), this.mat('metal', 0x5c605a, .6, .4));
      end.scale.set(1, .55, 1); end.position.set(0, 0, side * depth / 2); if (side < 0) end.rotation.y = Math.PI;
      end.castShadow = true; group.add(end);
      this.box(group, width * .5, r * .42, .3, 0, r * .21, side * (depth / 2 + .1), this.mat('metal', 0x3b403c, .55, .5));
    }
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(r + .05, .12, 4, 28, Math.PI), this.mat('metal', 0x3a3d3a, .6, .5));
      rib.scale.set(1, .55, 1); rib.position.z = i * depth / 5; group.add(rib);
    }
    this.scene.add(group);
  }

  private createRadioRidge(cx: number, cz: number): void {
    const gy = this.map.getTerrainHeight(cx, cz);
    const group = new THREE.Group();
    group.position.set(cx, gy, cz);
    // Tapered lattice mast in red/white bands.
    const red = this.mat('metal', 0xb3382c, .55, .5), white = this.mat('metal', 0xe6e1d6, .55, .5);
    const levels = 10, baseW = 5, topW = 1.2, height = 52;
    for (let i = 0; i < levels; i++) {
      const y0 = i * height / levels, y1 = (i + 1) * height / levels;
      const w0 = baseW + (topW - baseW) * (i / levels), w1 = baseW + (topW - baseW) * ((i + 1) / levels);
      const m = i % 2 ? white : red;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = this.cylinder(group, .12, .12, y1 - y0 + .05, sx * (w0 + w1) / 4, (y0 + y1) / 2, sz * (w0 + w1) / 4, m, 5);
        leg.rotation.z = sx * Math.atan((w0 - w1) / 2 / (y1 - y0)); leg.rotation.x = -sz * Math.atan((w0 - w1) / 2 / (y1 - y0));
      }
      for (const s of [-1, 1]) {
        this.box(group, w1, .08, .08, 0, y1, s * w1 / 2, m);
        this.box(group, .08, .08, w1, s * w1 / 2, y1, 0, m);
        const diag = this.box(group, Math.hypot(w0, y1 - y0), .06, .06, 0, (y0 + y1) / 2, s * (w0 + w1) / 4, m);
        diag.rotation.z = Math.atan2(y1 - y0, w0) * (i % 2 ? 1 : -1);
      }
    }
    this.cylinder(group, .08, .08, 8, 0, height + 4, 0, white, 6);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3), this.mat('metal', 0xd8d6d0, .3, .7, { side: THREE.DoubleSide }));
    dish.rotation.x = Math.PI / 2.4; dish.position.set(0, height - 6, 2.2); group.add(dish);
    // Bunker with blast doors.
    const concrete = this.mat('concrete', 0x8f8c82, .95);
    this.box(group, 16, 5, 20, 12, 2.5, 0, concrete, true);
    this.box(group, 17, .6, 21, 12, 5.3, 0, this.mat('concrete', 0x7b786f, .95));
    this.box(group, 3, 3, .3, 12, 1.5, 10.1, this.mat('metal', 0x4c524a, .6, .5));
    for (let i = 0; i < 3; i++) this.box(group, 1.6, .9, .6, 6 + i * 4, 6.05, -4, this.mat('metal', 0x5d625b, .6, .4));
    this.scene.add(group);
  }

  private createQuarry(cx: number, cz: number): void {
    const gy = this.map.getTerrainHeight(cx, cz);
    const group = new THREE.Group();
    group.position.set(cx, gy, cz);
    const yellow = this.mat('metal', 0xd09a2a, .5, .4), dark = this.mat('metal', 0x2d2f2c, .7, .4);
    // Tracked excavator body
    for (const s of [-1, 1]) this.box(group, 1.4, 1.4, 7, s * 2.4, .7, 0, dark, true);
    this.box(group, 5.6, 2.4, 6, 0, 2.6, 0, yellow, true);
    this.box(group, 2.4, 2.2, 2.4, 1.3, 4.9, 1.4, yellow);
    this.box(group, 2.2, 1.6, .1, 1.3, 5.1, 2.62, this.mat('glass', 0x2a3c40, .1, .8));
    const boom = this.box(group, 1, 1, 13, 0, 7, -6, yellow); boom.rotation.x = .55;
    const arm = this.box(group, .8, .8, 8, 0, 6.5, -13.5, yellow); arm.rotation.x = -.9;
    this.box(group, 2.2, 1.6, 1.6, 0, 3.2, -16.5, dark);
    // Rock spoil heaps
    const stone = this.mat('concrete', 0x8a8478, .95, 0, { flatShading: true });
    for (let i = 0; i < 6; i++) {
      const heap = new THREE.Mesh(new THREE.ConeGeometry(5 + (i % 3) * 2, 4 + (i % 2) * 2, 7), stone);
      heap.position.set(Math.cos(i) * 25, 2, Math.sin(i * 1.7) * 25); heap.rotation.y = i; heap.castShadow = heap.receiveShadow = true; group.add(heap);
      this.buildings.push(heap);
    }
    this.scene.add(group);
  }

  private createFarmstead(cx: number, cz: number): void {
    const gy = this.map.getTerrainHeight(cx, cz);
    const barn = new THREE.Group();
    barn.position.set(cx - 15, gy, cz);
    const red = this.mat('wood', 0x9a3b2c, .85);
    this.box(barn, 18, 9, 25, 0, 4.5, 0, red, true);
    this.gableRoof(barn, 25, 18, 6, 9, this.mat('metal', 0x5f625d, .55, .5), red, .8);
    barn.children.slice(-3).forEach(o => { o.rotation.y = Math.PI / 2; });
    const trimW = this.mat('trim', 0xeee8da, .85);
    for (const side of [-1, 1]) {
      this.box(barn, 6, 6, .2, 0, 3, side * 12.6, this.mat('wood', 0x7c2f24, .85));
      this.box(barn, 6.4, .3, .3, 0, 6.1, side * 12.65, trimW);
      for (const k of [-1, 1]) { const x = this.box(barn, 8.4, .25, .25, 0, 3, side * 12.7, trimW); x.rotation.z = k * Math.atan(6 / 6); }
    }
    this.scene.add(barn);
    const silo = new THREE.Group();
    silo.position.set(cx + 15, gy, cz);
    this.cylinder(silo, 3.5, 3.5, 18, 0, 9, 0, this.mat('metal', 0xb9bdb8, .45, .6), 20, true);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.6, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat('metal', 0x8c908a, .4, .6));
    dome.position.y = 18; dome.castShadow = true; silo.add(dome);
    for (let i = 1; i < 6; i++) this.cylinder(silo, 3.56, 3.56, .15, 0, i * 3, 0, this.mat('metal', 0x7d817b, .5, .6), 20);
    this.scene.add(silo);
    // Paddock fence and hay bales.
    const fence = new THREE.Group();
    const wood = this.mat('wood', 0x6e5843, .9);
    for (let i = 0; i <= 20; i++) for (const side of [-1, 1]) {
      const fx = cx - 50 + i * 5, fz = cz + side * 40;
      this.box(fence, .2, 1.4, .2, fx, this.map.getTerrainHeight(fx, fz) + .7, fz, wood);
    }
    for (const side of [-1, 1]) for (const h of [.6, 1.15]) this.box(fence, 100, .12, .08, cx, gy + h, cz + side * 40, wood);
    const hay = this.mat('wood', 0xc8a656, .95);
    for (let i = 0; i < 8; i++) {
      const hx = cx + 10 + (i % 4) * 2.6, hz = cz + 20 + Math.floor(i / 4) * 2.4;
      const bale = this.cylinder(fence, .8, .8, 1.4, hx, this.map.getTerrainHeight(hx, hz) + .8, hz, hay, 12, true);
      bale.rotation.z = Math.PI / 2;
    }
    this.scene.add(fence);
  }

  private createHarbor(cx: number, cz: number): void {
    const gy = this.map.getTerrainHeight(cx, cz);
    const dock = new THREE.Group();
    this.box(dock, 20, 1.2, 80, cx, gy + .5, cz + 30, this.mat('wood', 0x6d5a45, .9), true);
    for (let i = 0; i < 8; i++) for (const side of [-1, 1]) this.cylinder(dock, .35, .35, 4, cx + side * 9.6, gy - 1, cz - 5 + i * 10, this.mat('wood', 0x4a3b2d, .9), 8);
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) this.cylinder(dock, .28, .34, .6, cx + side * 9, gy + 1.4, cz + i * 15, this.mat('metal', 0x2e302d, .5, .6), 10);
    this.scene.add(dock);
    this.createWarehouse(cx, cz - 25, 35, 45, 11, 0x285f82);
    const colors = [0xc93b2b, 0x1e69a8, 0x287d4e, 0xe09624];
    for (let i = 0; i < 8; i++) this.createShippingContainer(cx + 26 + (i % 2) * 3, gy + Math.floor(i / 4) * 2.62, cz - 10 + (i % 4) * 7, 0, colors[i % colors.length]);
    // Gantry crane
    const crane = new THREE.Group();
    const yellow = this.mat('metal', 0xd4a12c, .5, .5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(crane, .8, 18, .8, cx - 14 + sx * 5, gy + 9, cz + 10 + sz * 6, yellow, true);
    for (const sz of [-1, 1]) this.box(crane, 12, 1.2, 1, cx - 14, gy + 18, cz + 10 + sz * 6, yellow);
    this.box(crane, 1.2, 1.2, 30, cx - 14, gy + 19.2, cz + 18, yellow);
    this.box(crane, 3, 2.2, 3, cx - 14, gy + 17.5, cz + 14, this.mat('metal', 0x3e423e, .6, .5));
    this.scene.add(crane);
  }
}
