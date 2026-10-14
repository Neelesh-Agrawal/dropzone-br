import * as THREE from 'three';
import { getConcreteTexture, getNoiseTexture } from './Textures';

interface ReactiveTarget {
  pivot: THREE.Group;
  hitUntil: number;
  baseX: number;
  moveAmplitude: number;
  moveSpeed: number;
  movePhase: number;
}

export class TrainingGroundMap {
  private scene: THREE.Scene;
  public root = new THREE.Group();
  public terrainMesh!: THREE.Mesh;
  public targetMeshes: THREE.Mesh[] = [];
  public collisionBoxes: THREE.Box3[] = [];
  private reactiveTargets: ReactiveTarget[] = [];
  private built = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.name = 'TrainingGroundRoot';
    this.root.visible = false;
    this.scene.add(this.root);
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  public buildTrainingGround(): void {
    this.root.visible = true;
    if (this.built) {
      for (const rt of this.reactiveTargets) {
        rt.hitUntil = 0;
        rt.pivot.rotation.x = 0;
      }
      return;
    }
    this.built = true;

    const concreteTex = getConcreteTexture().clone();
    concreteTex.wrapS = concreteTex.wrapT = THREE.RepeatWrapping;
    concreteTex.repeat.set(36, 36);
    concreteTex.needsUpdate = true;

    const noiseTex = getNoiseTexture();

    // Main Range Compound Apron (500m x 500m)
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3b413c,
      map: concreteTex,
      bumpMap: noiseTex,
      bumpScale: 0.02,
      roughness: 0.86,
      metalness: 0.06
    });
    this.terrainMesh = new THREE.Mesh(groundGeo, groundMat);
    this.terrainMesh.receiveShadow = true;
    this.root.add(this.terrainMesh);

    const concreteWallMat = new THREE.MeshStandardMaterial({
      color: 0x4b5149,
      map: getConcreteTexture(),
      roughness: 0.84,
      metalness: 0.08
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1e2422,
      roughness: 0.46,
      metalness: 0.72
    });
    const sandbagMat = new THREE.MeshStandardMaterial({
      color: 0x7b6f54,
      bumpMap: noiseTex,
      bumpScale: 0.02,
      roughness: 0.92,
      metalness: 0.02
    });
    const brassStripeMat = new THREE.MeshBasicMaterial({ color: 0xc8a365 });
    const armorPlateMat = new THREE.MeshStandardMaterial({
      color: 0x262d2b,
      roughness: 0.42,
      metalness: 0.65
    });
    const chestZoneMat = new THREE.MeshStandardMaterial({
      color: 0xc95238,
      roughness: 0.48,
      metalness: 0.25
    });
    const headZoneMat = new THREE.MeshStandardMaterial({
      color: 0xe0a63a,
      roughness: 0.38,
      metalness: 0.35
    });

    const addObstacleBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, collide = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      if (collide) {
        this.collisionBoxes.push(new THREE.Box3(
          new THREE.Vector3(x - w * 0.5, y - h * 0.5, z - d * 0.5),
          new THREE.Vector3(x + w * 0.5, y + h * 0.5, z + d * 0.5)
        ));
      }
      return m;
    };

    // Overhead Firing Line Canopy & Booth Dividers
    addObstacleBox(34, 0.28, 7.5, 0, 3.85, 2.0, darkSteelMat, false);
    addObstacleBox(34.4, 0.10, 7.8, 0, 4.02, 2.0, concreteWallMat, false);
    for (const bx of [-16, -8, 0, 8, 16]) {
      addObstacleBox(0.24, 3.8, 0.24, bx, 1.9, -1.2, darkSteelMat, true);
      addObstacleBox(0.24, 3.8, 0.24, bx, 1.9, 5.2, darkSteelMat, true);
    }

    // Firing Line Hazard Stripe & Low Sandbag Firing Parapets (with central walkthrough gaps)
    addObstacleBox(32, 0.015, 0.18, 0, 0.01, -2.2, brassStripeMat, false);
    for (const sx of [-11.5, -4.2, 4.2, 11.5]) {
      addObstacleBox(4.2, 0.92, 0.85, sx, 0.46, -2.6, sandbagMat, true);
      addObstacleBox(4.4, 0.08, 0.92, sx, 0.94, -2.6, concreteWallMat, false);
    }

    // Quartermaster Weapon & Attachment Workbenches behind the firing line (z = 4.2 and z = 7.8)
    for (const tx of [-9.5, 0, 9.5]) {
      addObstacleBox(6.8, 0.82, 1.35, tx, 0.41, 4.2, darkSteelMat, false);
      addObstacleBox(7.0, 0.07, 1.48, tx, 0.84, 4.2, concreteWallMat, false);
    }
    for (const tx of [-6.5, 6.5]) {
      addObstacleBox(8.2, 0.82, 1.35, tx, 0.41, 7.8, darkSteelMat, false);
      addObstacleBox(8.4, 0.07, 1.48, tx, 0.84, 7.8, concreteWallMat, false);
    }

    // Perimeter Blast Walls & Downrange Earthen Berms
    addObstacleBox(90, 5.5, 2.4, 0, 2.75, -175, concreteWallMat, true);
    addObstacleBox(2.4, 4.5, 195, -44, 2.25, -82, concreteWallMat, true);
    addObstacleBox(2.4, 4.5, 195, 44, 2.25, -82, concreteWallMat, true);

    // Distance Lane Lines & Painted Range Markers (25m, 50m, 75m, 100m, 150m)
    const distances = [25, 50, 75, 100, 150];
    for (const d of distances) {
      addObstacleBox(64, 0.014, 0.14, 0, 0.01, -d, brassStripeMat, false);
      const signTex = this.makeDistanceSignTexture(`${d}M`);
      const signMat = new THREE.MeshBasicMaterial({ map: signTex });
      for (const side of [-34, 34]) {
        addObstacleBox(0.14, 1.4, 0.14, side, 0.7, -d, darkSteelMat, false);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), signMat);
        board.position.set(side, 1.65, -d + 0.09);
        this.root.add(board);
      }
    }

    // Reactive Armored Silhouette Targets & Moving Lateral Rail Targets
    const targetSpecs: { x: number; z: number; moveAmp: number; moveSpeed: number }[] = [
      // 25m Close-Quarters Reflex Row
      { x: -14, z: -25, moveAmp: 0, moveSpeed: 0 },
      { x: -5, z: -25, moveAmp: 0, moveSpeed: 0 },
      { x: 5, z: -25, moveAmp: 0, moveSpeed: 0 },
      { x: 14, z: -25, moveAmp: 0, moveSpeed: 0 },
      // 50m Mid-Range Combat Row (with 2 lateral movers)
      { x: -20, z: -50, moveAmp: 0, moveSpeed: 0 },
      { x: -8, z: -50, moveAmp: 4.5, moveSpeed: 1.55 },
      { x: 8, z: -50, moveAmp: 4.5, moveSpeed: -1.35 },
      { x: 20, z: -50, moveAmp: 0, moveSpeed: 0 },
      // 75m Marksman Row
      { x: -16, z: -75, moveAmp: 0, moveSpeed: 0 },
      { x: 0, z: -75, moveAmp: 6.5, moveSpeed: 1.85 },
      { x: 16, z: -75, moveAmp: 0, moveSpeed: 0 },
      // 100m Long-Range Precision Row
      { x: -22, z: -100, moveAmp: 0, moveSpeed: 0 },
      { x: -7, z: -100, moveAmp: 0, moveSpeed: 0 },
      { x: 7, z: -100, moveAmp: 7.5, moveSpeed: 1.6 },
      { x: 22, z: -100, moveAmp: 0, moveSpeed: 0 },
      // 150m Sniper Qualification Row
      { x: -18, z: -150, moveAmp: 0, moveSpeed: 0 },
      { x: 0, z: -150, moveAmp: 9.0, moveSpeed: 1.4 },
      { x: 18, z: -150, moveAmp: 0, moveSpeed: 0 }
    ];

    targetSpecs.forEach((spec, idx) => {
      if (spec.moveAmp > 0) {
        addObstacleBox(spec.moveAmp * 2 + 2.2, 0.10, 0.28, spec.x, 0.06, spec.z, darkSteelMat, false);
      }

      const carriage = new THREE.Group();
      carriage.position.set(spec.x, 0, spec.z);
      this.root.add(carriage);

      const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 0.65), darkSteelMat);
      base.position.y = 0.09;
      base.castShadow = true;
      carriage.add(base);

      const pivot = new THREE.Group();
      pivot.position.y = 0.18;
      carriage.add(pivot);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.10), darkSteelMat);
      post.position.y = 0.42;
      post.castShadow = true;
      pivot.add(post);

      // Armored torso silhouette + high-contrast chest A-zone + head plate
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.05, 0.08), armorPlateMat);
      torso.position.y = 1.25;
      torso.castShadow = true;
      pivot.add(torso);

      const chestZone = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 0.095), chestZoneMat);
      chestZone.position.y = 1.28;
      pivot.add(chestZone);

      const headPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.09, 18), headZoneMat);
      headPlate.rotation.x = Math.PI / 2;
      headPlate.position.y = 1.98;
      headPlate.castShadow = true;
      pivot.add(headPlate);

      const reactive: ReactiveTarget = {
        pivot,
        hitUntil: 0,
        baseX: spec.x,
        moveAmplitude: spec.moveAmp,
        moveSpeed: spec.moveSpeed,
        movePhase: idx * 1.1
      };
      this.reactiveTargets.push(reactive);

      for (const hitMesh of [torso, chestZone, headPlate]) {
        hitMesh.userData.reactiveTarget = reactive;
        hitMesh.userData.isHeadshotPlate = hitMesh === headPlate;
        this.targetMeshes.push(hitMesh);
      }
    });
  }

  public registerTargetHit(mesh: THREE.Object3D): boolean {
    const rt = mesh.userData?.reactiveTarget as ReactiveTarget | undefined;
    if (rt) {
      rt.hitUntil = performance.now() + 1750;
    }
    return Boolean(mesh.userData?.isHeadshotPlate);
  }

  public update(delta: number, nowSec: number): void {
    if (!this.built || !this.root.visible) return;
    const nowMs = performance.now();
    for (const rt of this.reactiveTargets) {
      if (rt.moveAmplitude > 0 && rt.pivot.parent) {
        rt.pivot.parent.position.x = rt.baseX + Math.sin(nowSec * rt.moveSpeed + rt.movePhase) * rt.moveAmplitude;
      }
      const targetTilt = nowMs < rt.hitUntil ? -Math.PI * 0.48 : 0;
      rt.pivot.rotation.x = THREE.MathUtils.damp(rt.pivot.rotation.x, targetTilt, 14, delta);
    }
  }

  private makeDistanceSignTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#18201e';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#c8a365';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#e7e2d4';
    ctx.font = '700 62px Teko, Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
