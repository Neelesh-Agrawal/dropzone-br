import * as THREE from 'three';
import { VehicleState, VehicleType } from '../../shared/types';
import { VEHICLE_SPAWNS, VEHICLE_SPECS, VehicleSpec } from '../../shared/vehicles';
import { AshenValleyMap, WATER_LEVEL } from './AshenValleyMap';

interface VehicleRig {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  steerPivots: THREE.Object3D[];
  lights: THREE.MeshStandardMaterial[];
  propellers?: THREE.Object3D[];
  lastPos: THREE.Vector3;
  type: VehicleType;
}

export class VehicleManager {
  private scene: THREE.Scene;
  private map: AshenValleyMap;
  public vehicles: Map<string, THREE.Group> = new Map();
  private rigs: Map<string, VehicleRig> = new Map();
  private wheelMat: THREE.MeshStandardMaterial;
  private rimMat: THREE.MeshStandardMaterial;
  private frameMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, map: AshenValleyMap) {
    this.scene = scene;
    this.map = map;
    this.wheelMat = new THREE.MeshStandardMaterial({ color: 0x16191d, roughness: 0.82, metalness: 0.12 });
    this.rimMat = new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.32, metalness: 0.82 });
    this.frameMat = new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.42, metalness: 0.72 });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x7ad7f0,
      roughness: 0.12,
      metalness: 0.35,
      transparent: true,
      opacity: 0.48
    });
  }

  public spawnOfflineVehicles(): void {
    this.removeAll();
    const states: VehicleState[] = VEHICLE_SPAWNS.map(({ id, type, x, z, yaw }) => ({
      id,
      type,
      position: { x, y: Math.max(this.map.getTerrainHeight(x, z), type === 'patrol_boat' ? WATER_LEVEL - 0.12 : -99), z },
      rotation: { yaw: yaw ?? 0, pitch: 0, roll: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      driverId: null,
      health: VEHICLE_SPECS[type].maxHealth
    }));
    this.updateVehicles(states);
  }

  /**
   * Guarantees a driveable vehicle near the player's landing zone in solo mode
   * so the player can immediately test or rotate with a vehicle wherever they drop.
   */
  public ensureLandingVehicle(x: number, z: number): void {
    for (const group of this.vehicles.values()) {
      if (Math.hypot(group.position.x - x, group.position.z - z) < 75) return;
    }
    const angle = 0.65;
    const vx = x + Math.cos(angle) * 26;
    const vz = z + Math.sin(angle) * 26;
    const terrainY = this.map.getTerrainHeight(vx, vz);
    const vType: VehicleType = terrainY < WATER_LEVEL - 0.2 ? 'patrol_boat' : 'strike_bike';
    const id = 'veh_drop_recon';
    const rig = this.createVehicleMesh(id, vType);
    const y = vType === 'patrol_boat' ? Math.max(terrainY, WATER_LEVEL - 0.12) : terrainY;
    rig.root.position.set(vx, y, vz);
    rig.root.rotation.set(0, -angle, 0, 'YXZ');
    rig.lastPos.set(vx, y, vz);
    this.scene.add(rig.root);
    this.vehicles.set(id, rig.root);
    this.rigs.set(id, rig);
  }

  public updateVehicles(states: VehicleState[], delta = 1 / 60): void {
    const activeIds = new Set<string>();

    for (const vState of states) {
      activeIds.add(vState.id);
      const vType: VehicleType = vState.type || 'scout_runner';
      let rig = this.rigs.get(vState.id);
      if (!rig || rig.type !== vType) {
        if (rig) this.scene.remove(rig.root);
        rig = this.createVehicleMesh(vState.id, vType);
        rig.lastPos.set(vState.position.x, vState.position.y, vState.position.z);
        this.scene.add(rig.root);
        this.vehicles.set(vState.id, rig.root);
        this.rigs.set(vState.id, rig);
      }

      this.poseVehicle(rig, vState.position.x, vState.position.z, vState.rotation.yaw, 0, !!vState.driverId, delta);
    }

    for (const [id, rig] of this.rigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(rig.root);
        this.rigs.delete(id);
        this.vehicles.delete(id);
      }
    }
  }

  public updateLocalVehicle(id: string, playerPosition: THREE.Vector3, yaw: number, steer = 0): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    this.poseVehicle(rig, playerPosition.x, playerPosition.z, yaw, steer, true, 1 / 60);
  }

  private poseVehicle(rig: VehicleRig, x: number, z: number, yaw: number, steer: number, occupied: boolean, delta: number): void {
    const spec = VEHICLE_SPECS[rig.type] || VEHICLE_SPECS.scout_runner;
    const terrainH = this.map.getTerrainHeight(x, z);
    const h = spec.amphibious ? Math.max(terrainH, WATER_LEVEL - 0.12) : Math.max(terrainH, WATER_LEVEL - 0.65);
    const hx = this.map.getTerrainHeight(x + 1.4, z) - this.map.getTerrainHeight(x - 1.4, z);
    const hz = this.map.getTerrainHeight(x, z + 1.4) - this.map.getTerrainHeight(x, z - 1.4);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);

    const inWater = spec.amphibious && terrainH < WATER_LEVEL - 0.1;
    const slopePitch = inWater
      ? Math.sin(performance.now() * 0.003 + x * 0.1) * 0.035
      : Math.atan2(hx * sy + hz * cy, 2.8) * 0.65;
    const slopeRoll = inWater
      ? Math.cos(performance.now() * 0.0025 + z * 0.1) * 0.04
      : Math.atan2(hx * cy - hz * sy, 2.8) * 0.65;

    const dx = x - rig.lastPos.x;
    const dz = z - rig.lastPos.z;
    const signedSpeed = -(dx * sy + dz * cy) / Math.max(0.001, delta);
    const spin = signedSpeed * delta / 0.44;
    for (const w of rig.wheels) w.rotation.x -= spin;
    for (const p of rig.steerPivots) p.rotation.y = steer * 0.42;
    if (rig.propellers) {
      for (const p of rig.propellers) p.rotation.z += signedSpeed * delta * 2.5;
    }

    for (const m of rig.lights) m.emissiveIntensity = occupied ? 1.8 : 0.55;
    rig.body.position.y = occupied
      ? Math.sin(performance.now() * (inWater ? 0.006 : 0.025)) * (inWater ? 0.045 : 0.018)
      : (inWater ? Math.sin(performance.now() * 0.003) * 0.035 : 0);

    rig.root.position.set(x, h, z);
    rig.root.rotation.order = 'YXZ';
    rig.root.rotation.set(slopePitch, yaw, slopeRoll);
    rig.lastPos.set(x, h, z);
  }

  public cull(position: THREE.Vector3): void {
    for (const group of this.vehicles.values()) {
      group.visible = Math.hypot(group.position.x - position.x, group.position.z - position.z) < 750;
    }
  }

  public getNearestVehicle(pos: THREE.Vector3, maxDistance = 5.5): { id: string; position: THREE.Vector3; yaw: number; type: VehicleType; spec: VehicleSpec } | null {
    let closest: { id: string; distance: number; position: THREE.Vector3; yaw: number; type: VehicleType; spec: VehicleSpec } | null = null;
    for (const [id, rig] of this.rigs.entries()) {
      const dist = Math.hypot(rig.root.position.x - pos.x, rig.root.position.z - pos.z);
      if (dist < maxDistance && (!closest || dist < closest.distance)) {
        const spec = VEHICLE_SPECS[rig.type] || VEHICLE_SPECS.scout_runner;
        closest = {
          id,
          distance: dist,
          position: rig.root.position,
          yaw: rig.root.rotation.y,
          type: rig.type,
          spec
        };
      }
    }
    return closest;
  }

  private createWheel(radius = 0.44, width = 0.30): THREE.Group {
    const group = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), this.wheelMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, width + 0.02, 12), this.rimMat);
    rim.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, width + 0.04, 8), this.frameMat);
    hub.rotation.z = Math.PI / 2;
    group.add(tire, rim, hub);
    return group;
  }

  private createVehicleMesh(id: string, type: VehicleType): VehicleRig {
    let rig: VehicleRig;
    switch (type) {
      case 'armored_truck':
        rig = this.createArmoredTruckMesh(id);
        break;
      case 'strike_bike':
        rig = this.createStrikeBikeMesh(id);
        break;
      case 'patrol_boat':
        rig = this.createPatrolBoatMesh(id);
        break;
      case 'scout_runner':
      default:
        rig = this.createScoutRunnerMesh(id);
        break;
    }
    rig.root.userData.type = type;
    return rig;
  }

  private createScoutRunnerMesh(id: string): VehicleRig {
    const root = new THREE.Group();
    root.name = `vehicle_${id}`;
    const body = new THREE.Group();
    root.add(body);

    const paintHex = id.charCodeAt(id.length - 1) % 2 === 0 ? 0x1d70b8 : 0xe06d1b;
    const paint = new THREE.MeshStandardMaterial({ color: paintHex, roughness: 0.34, metalness: 0.45 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xf7b731, roughness: 0.32, metalness: 0.55 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.78 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff6ff, emissiveIntensity: 0.65, roughness: 0.15 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2a1a, emissiveIntensity: 0.65, roughness: 0.25 });

    const pan = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.26, 3.85), this.frameMat);
    pan.position.y = 0.52;
    pan.castShadow = true; pan.receiveShadow = true;
    body.add(pan);

    const sides = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.52, 2.7), paint);
    sides.position.set(0, 0.86, -0.05);
    sides.castShadow = true; sides.receiveShadow = true;
    body.add(sides);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.11, 0.10, 2.55), trim);
    stripe.position.set(0, 0.92, -0.05);
    body.add(stripe);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.36, 1.25), paint);
    hood.position.set(0, 0.96, 1.32);
    hood.rotation.x = 0.14;
    hood.castShadow = true;
    body.add(hood);

    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.46, 1.05), paint);
    bed.position.set(0, 0.96, -1.42);
    bed.castShadow = true;
    body.add(bed);

    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.24, 0.24), this.frameMat);
    bumper.position.set(0, 0.56, 2.02);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 8, 14, Math.PI), this.frameMat);
    guard.position.set(0, 0.72, 2.06);
    body.add(bumper, guard);

    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.02, 8);
    for (const [x, z, tilt] of [[-0.84, 0.65, -0.25], [0.84, 0.65, -0.25], [-0.84, -0.75, 0.12], [0.84, -0.75, 0.12]] as const) {
      const post = new THREE.Mesh(postGeo, this.frameMat);
      post.position.set(x, 1.5, z);
      post.rotation.x = tilt;
      post.castShadow = true;
      body.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.07, 1.55), this.frameMat);
    roof.position.set(0, 1.98, -0.08);
    roof.castShadow = true;
    body.add(roof);

    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.09, 0.12), headMat);
    ledBar.position.set(0, 2.05, 0.64);
    body.add(ledBar);

    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.78), this.glassMat);
    windshield.position.set(0, 1.48, 0.72);
    windshield.rotation.x = -0.35;
    body.add(windshield);

    for (const sx of [-0.46, 0.46]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.55), seatMat);
      base.position.set(sx, 0.85, -0.05);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.14), seatMat);
      back.position.set(sx, 1.22, -0.3);
      back.rotation.x = -0.12;
      body.add(base, back);
    }

    const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 16), this.frameMat);
    wheelRing.position.set(-0.46, 1.24, 0.42);
    wheelRing.rotation.x = -0.5;
    body.add(wheelRing);

    for (const lx of [-0.62, 0.62]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), headMat);
      h.rotation.x = Math.PI / 2;
      h.position.set(lx, 0.88, 1.95);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.06), tailMat);
      t.position.set(lx, 0.96, -1.96);
      body.add(h, t);
    }

    const spare = this.createWheel(0.42, 0.28);
    spare.rotation.z = Math.PI / 2;
    spare.rotation.y = Math.PI / 2;
    spare.position.set(0, 1.15, -2.02);
    body.add(spare);

    const wheels: THREE.Object3D[] = [];
    const steerPivots: THREE.Object3D[] = [];
    for (const [wx, wz, front] of [[-1.08, 1.28, true], [1.08, 1.28, true], [-1.08, -1.28, false], [1.08, -1.28, false]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.44, wz);
      const w = this.createWheel(0.44, 0.30);
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
      if (front) steerPivots.push(pivot);
    }

    return { root, body, wheels, steerPivots, lights: [headMat, tailMat], lastPos: new THREE.Vector3(), type: 'scout_runner' };
  }

  private createArmoredTruckMesh(id: string): VehicleRig {
    const root = new THREE.Group();
    root.name = `vehicle_${id}`;
    const body = new THREE.Group();
    root.add(body);

    const armorMat = new THREE.MeshStandardMaterial({ color: 0x3b4d3f, roughness: 0.46, metalness: 0.45 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x26312a, roughness: 0.52, metalness: 0.62 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xf7b731, roughness: 0.32, metalness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd8f3ff, emissiveIntensity: 0.7, roughness: 0.15 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2211, emissiveIntensity: 0.65, roughness: 0.25 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.42, 4.85), this.frameMat);
    chassis.position.y = 0.62;
    chassis.castShadow = true; chassis.receiveShadow = true;
    body.add(chassis);

    const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.78, 4.55), armorMat);
    lowerHull.position.set(0, 1.18, -0.05);
    lowerHull.castShadow = true; lowerHull.receiveShadow = true;
    body.add(lowerHull);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.86, 2.85), armorMat);
    cabin.position.set(0, 1.92, -0.25);
    cabin.castShadow = true; cabin.receiveShadow = true;
    body.add(cabin);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.55, 1.45), plateMat);
    hood.position.set(0, 1.52, 1.62);
    hood.rotation.x = 0.08;
    hood.castShadow = true;
    body.add(hood);

    const hazardStripe = new THREE.Mesh(new THREE.BoxGeometry(2.50, 0.12, 3.8), accentMat);
    hazardStripe.position.set(0, 1.24, -0.15);
    body.add(hazardStripe);

    for (const sx of [-0.54, 0.54]) {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.52, 0.06), this.glassMat);
      glass.position.set(sx, 1.95, 1.16);
      glass.rotation.x = -0.22;
      body.add(glass);
    }

    const bullbar = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.58, 0.28), this.frameMat);
    bullbar.position.set(0, 0.78, 2.48);
    bullbar.castShadow = true;
    body.add(bullbar);

    const turretRing = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.64, 0.22, 16), plateMat);
    turretRing.position.set(0, 2.45, -0.15);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.42, 0.08), plateMat);
    shield.position.set(0, 2.68, 0.32);
    shield.rotation.x = -0.18;
    const hmgReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.65), this.frameMat);
    hmgReceiver.position.set(0, 2.66, 0.15);
    const hmgBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 10), this.frameMat);
    hmgBarrel.rotation.x = Math.PI / 2;
    hmgBarrel.position.set(0, 2.66, 0.85);
    body.add(turretRing, shield, hmgReceiver, hmgBarrel);

    for (const lx of [-0.82, 0.82]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.08), headMat);
      h.position.set(lx, 1.18, 2.26);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.08), tailMat);
      t.position.set(lx, 1.18, -2.35);
      body.add(h, t);
    }

    const wheels: THREE.Object3D[] = [];
    const steerPivots: THREE.Object3D[] = [];
    for (const [wx, wz, front] of [[-1.24, 1.52, true], [1.24, 1.52, true], [-1.24, -1.48, false], [1.24, -1.48, false]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.56, wz);
      const w = this.createWheel(0.56, 0.38);
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
      if (front) steerPivots.push(pivot);
    }

    return { root, body, wheels, steerPivots, lights: [headMat, tailMat], lastPos: new THREE.Vector3(), type: 'armored_truck' };
  }

  private createStrikeBikeMesh(id: string): VehicleRig {
    const root = new THREE.Group();
    root.name = `vehicle_${id}`;
    const body = new THREE.Group();
    root.add(body);

    const fairingMat = new THREE.MeshStandardMaterial({ color: 0xe62e3d, roughness: 0.26, metalness: 0.48 });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.42, metalness: 0.65 });
    const springMat = new THREE.MeshStandardMaterial({ color: 0xf7b731, roughness: 0.25, metalness: 0.8 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcff4ff, emissiveIntensity: 0.8, roughness: 0.12 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2211, emissiveIntensity: 0.7, roughness: 0.2 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.24, 2.25), this.frameMat);
    chassis.position.y = 0.45;
    chassis.castShadow = true;
    body.add(chassis);

    const frontCowling = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.32, 0.92), fairingMat);
    frontCowling.position.set(0, 0.82, 0.68);
    frontCowling.rotation.x = 0.16;
    frontCowling.castShadow = true;
    body.add(frontCowling);

    const rearCowling = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.28, 0.95), fairingMat);
    rearCowling.position.set(0, 0.82, -0.68);
    rearCowling.castShadow = true;
    body.add(rearCowling);

    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 1.05), carbonMat);
    saddle.position.set(0, 0.92, -0.12);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 0.56), fairingMat);
    tank.position.set(0, 1.02, 0.35);
    body.add(saddle, tank);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.46, 8), this.frameMat);
    stem.position.set(0, 1.18, 0.58);
    stem.rotation.x = -0.24;
    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.92, 8), this.frameMat);
    handlebar.rotation.z = Math.PI / 2;
    handlebar.position.set(0, 1.38, 0.52);
    body.add(stem, handlebar);

    for (const [sx, sz] of [[-0.45, 0.72], [0.45, 0.72], [-0.45, -0.72], [0.45, -0.72]] as const) {
      const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.38, 8), springMat);
      shock.position.set(sx, 0.62, sz);
      shock.rotation.z = sx > 0 ? 0.22 : -0.22;
      body.add(shock);
    }

    for (const lx of [-0.36, 0.36]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.10, 0.08), headMat);
      h.position.set(lx, 0.84, 1.16);
      body.add(h);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.10, 0.08), tailMat);
    tail.position.set(0, 0.86, -1.18);
    body.add(tail);

    const wheels: THREE.Object3D[] = [];
    const steerPivots: THREE.Object3D[] = [];
    for (const [wx, wz, front] of [[-0.68, 0.78, true], [0.68, 0.78, true], [-0.68, -0.78, false], [0.68, -0.78, false]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.36, wz);
      const w = this.createWheel(0.36, 0.26);
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
      if (front) steerPivots.push(pivot);
    }

    return { root, body, wheels, steerPivots, lights: [headMat, tailMat], lastPos: new THREE.Vector3(), type: 'strike_bike' };
  }

  private createPatrolBoatMesh(id: string): VehicleRig {
    const root = new THREE.Group();
    root.name = `vehicle_${id}`;
    const body = new THREE.Group();
    root.add(body);

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1a2634, roughness: 0.32, metalness: 0.55 });
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xf26419, roughness: 0.42, metalness: 0.18 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2f3b47, roughness: 0.68, metalness: 0.25 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff8ff, emissiveIntensity: 0.75, roughness: 0.12 });
    const navMat = new THREE.MeshStandardMaterial({ color: 0x00f5d4, emissive: 0x00f5d4, emissiveIntensity: 0.85, roughness: 0.2 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.48, 4.65), hullMat);
    hull.position.set(0, 0.32, 0);
    hull.castShadow = true; hull.receiveShadow = true;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.12, 4.15), deckMat);
    deck.position.set(0, 0.58, -0.1);
    body.add(hull, deck);

    const tubeGeo = new THREE.CylinderGeometry(0.28, 0.28, 4.1, 14);
    tubeGeo.rotateX(Math.PI / 2);
    for (const sx of [-1.05, 1.05]) {
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.position.set(sx, 0.58, -0.12);
      tube.castShadow = true;
      body.add(tube);
    }
    const bowTube = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.27, 12, 20, Math.PI), tubeMat);
    bowTube.rotation.x = Math.PI / 2;
    bowTube.position.set(0, 0.58, 1.92);
    bowTube.castShadow = true;
    body.add(bowTube);

    const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.82), hullMat);
    consoleBox.position.set(0, 1.02, 0.25);
    consoleBox.castShadow = true;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.48, 0.06), this.glassMat);
    screen.position.set(0, 1.56, 0.58);
    screen.rotation.x = -0.32;
    body.add(consoleBox, screen);

    const archLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 8), this.frameMat);
    archLeft.position.set(-0.88, 1.25, -1.25);
    const archRight = archLeft.clone();
    archRight.position.x = 0.88;
    const archTop = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.08, 0.35), this.frameMat);
    archTop.position.set(0, 1.92, -1.25);
    const radarBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.16, 12), navMat);
    radarBeacon.position.set(0, 2.04, -1.25);
    const bowSearchlight = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.24, 12), headMat);
    bowSearchlight.rotation.x = Math.PI / 2;
    bowSearchlight.position.set(0, 0.92, 2.15);
    body.add(archLeft, archRight, archTop, radarBeacon, bowSearchlight);

    const propellers: THREE.Object3D[] = [];
    for (const mx of [-0.46, 0.46]) {
      const motor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.72, 0.44), this.frameMat);
      motor.position.set(mx, 0.62, -2.38);
      const prop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.06), this.rimMat);
      prop.position.set(mx, 0.22, -2.62);
      propellers.push(prop);
      body.add(motor, prop);
    }

    return {
      root,
      body,
      wheels: [],
      steerPivots: [],
      propellers,
      lights: [headMat, navMat],
      lastPos: new THREE.Vector3(),
      type: 'patrol_boat'
    };
  }

  public removeAll(): void {
    for (const rig of this.rigs.values()) {
      this.scene.remove(rig.root);
    }
    this.rigs.clear();
    this.vehicles.clear();
  }
}
