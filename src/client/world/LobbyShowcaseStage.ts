import { OperatorModel, OperatorPose } from './OperatorModel';
import { createWeaponModel } from './WeaponModel';
import { getConcreteTexture, getNoiseTexture } from './Textures';
import { WeaponId } from '../../shared/types';
import * as THREE from 'three';

export class LobbyShowcaseStage {
  private scene: THREE.Scene;
  public characterGroup: THREE.Group;
  private pedestal: THREE.Mesh;
  private backdropGroup: THREE.Group;
  private studioLightsGroup: THREE.Group;
  private operatorModel?: OperatorModel;
  private lastGameplayPosition = new THREE.Vector3();
  private holoRing?: THREE.Mesh;
  private lobbyClock = 0;
  public isVisible: boolean = false;

  private isDragging: boolean = false;
  private previousMouseX: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.characterGroup = new THREE.Group();
    this.backdropGroup = new THREE.Group();
    this.studioLightsGroup = new THREE.Group();

    // 1. Studio 3-Point + Hangar Practical Lights
    const keyLight = new THREE.DirectionalLight(0xffe4bc, 2.45);
    keyLight.position.set(2.8, 4.2, 3.4);
    this.studioLightsGroup.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x9bb4c4, 0.95);
    fillLight.position.set(-4.2, 2.4, 2.2);
    this.studioLightsGroup.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffcb88, 1.9);
    rimLight.position.set(-0.5, 3.4, -3.8);
    this.studioLightsGroup.add(rimLight);

    const bayWarmSpot = new THREE.PointLight(0xffaa55, 3.2, 9.5, 1.6);
    bayWarmSpot.position.set(-2.9, 2.6, -2.0);
    this.studioLightsGroup.add(bayWarmSpot);

    const holoCoolSpot = new THREE.PointLight(0x48d1b5, 2.4, 7.5, 1.6);
    holoCoolSpot.position.set(2.4, 1.5, -1.7);
    this.studioLightsGroup.add(holoCoolSpot);

    this.scene.add(this.studioLightsGroup);

    // 2. Architectural Forward Operating Hangar Bay
    const backdropTexture = new THREE.TextureLoader().load('/assets/ashen-valley.png');
    backdropTexture.colorSpace = THREE.SRGBColorSpace;
    const vistaMat = new THREE.MeshBasicMaterial({ map: backdropTexture, color: 0xb5bdb2, fog: false });
    const vistaWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 9.5), vistaMat);
    vistaWall.position.set(0, 4.1, -6.4);
    this.backdropGroup.add(vistaWall);

    const concreteTex = getConcreteTexture();
    const noiseTex = getNoiseTexture();

    const floorGeo = new THREE.PlaneGeometry(24, 20);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x353b36,
      map: concreteTex,
      bumpMap: noiseTex,
      bumpScale: 0.015,
      roughness: 0.76,
      metalness: 0.14
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.21;
    floor.receiveShadow = true;
    this.backdropGroup.add(floor);

    const steelBeamMat = new THREE.MeshStandardMaterial({ color: 0x18201f, roughness: 0.52, metalness: 0.68 });
    const concreteWallMat = new THREE.MeshStandardMaterial({ color: 0x282f2b, map: concreteTex, roughness: 0.86, metalness: 0.08 });
    const brassStripMat = new THREE.MeshBasicMaterial({ color: 0xc8a365, fog: false });
    const warmLightStripMat = new THREE.MeshBasicMaterial({ color: 0xffdfad, fog: false });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x394439, roughness: 0.78, metalness: 0.12 });

    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, ry = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.backdropGroup.add(mesh);
      return mesh;
    };

    // Hangar side bulkheads & low blast wall framing the panoramic bay opening
    addBox(16, 1.25, 0.38, 0, 0.42, -5.2, concreteWallMat);
    addBox(16.2, 0.09, 0.44, 0, 1.08, -5.18, steelBeamMat);
    addBox(4.2, 8.5, 0.48, -6.4, 3.9, -5.0, concreteWallMat);
    addBox(4.2, 8.5, 0.48, 6.4, 3.9, -5.0, concreteWallMat);
    addBox(18, 1.6, 1.2, 0, 5.2, -4.8, steelBeamMat);

    // Structural hangar columns, floor expansion joints & overhead light trusses
    for (const x of [-4.4, -1.65, 1.65, 4.4]) {
      addBox(0.24, 6.2, 0.38, x, 2.8, -4.95, steelBeamMat);
      addBox(0.08, 0.014, 12, x, -0.20, -1.0, steelBeamMat);
    }
    for (const z of [-3.6, -1.8, 0.2]) {
      addBox(14, 0.18, 0.24, 0, 4.35, z, steelBeamMat);
      addBox(2.4, 0.04, 0.12, -2.6, 4.24, z, warmLightStripMat);
      addBox(2.4, 0.04, 0.12, 2.6, 4.24, z, warmLightStripMat);
    }

    // Floor safety lane markings leading to the operator turntable
    for (const x of [-1.85, 1.85]) {
      addBox(0.055, 0.012, 6.4, x, -0.20, -0.6, brassStripMat);
    }

    // Left Rear Bay: Parked "Scout Runner" Tactical Recon Buggy + Supply Crates
    const buggy = this.buildShowcaseBuggy();
    buggy.position.set(-2.75, -0.21, -2.55);
    buggy.rotation.y = 0.52;
    this.backdropGroup.add(buggy);

    for (const [x, y, z, w, h, ry] of [
      [-4.1, 0.24, -3.5, 1.1, 0.9, 0.12],
      [-3.8, 0.86, -3.55, 0.78, 0.52, -0.08],
      [3.45, 0.22, -3.2, 1.35, 0.85, -0.22]
    ] as const) {
      addBox(w, h, 0.78, x, y, z, crateMat, ry);
      addBox(w + 0.03, 0.06, 0.81, x, y + h * 0.34, z, steelBeamMat, ry);
    }

    // Right Rear Bay: Illuminated Tactical Holo-Table + Gunsmith Rack
    const tableGroup = new THREE.Group();
    tableGroup.position.set(2.35, -0.21, -2.05);
    tableGroup.rotation.y = -0.38;
    const tableBase = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.78, 0.92), steelBeamMat);
    tableBase.position.y = 0.39;
    const tableRim = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.08, 1.02), concreteWallMat);
    tableRim.position.y = 0.80;
    const holoScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.36, 0.82),
      new THREE.MeshBasicMaterial({ map: backdropTexture, color: 0x56d8c0, transparent: true, opacity: 0.78, fog: false })
    );
    holoScreen.rotation.x = -Math.PI / 2;
    holoScreen.position.y = 0.845;
    const holoRingGeo = new THREE.RingGeometry(0.28, 0.31, 32);
    holoRingGeo.rotateX(-Math.PI / 2);
    this.holoRing = new THREE.Mesh(
      holoRingGeo,
      new THREE.MeshBasicMaterial({ color: 0x72f5db, transparent: true, opacity: 0.65, side: THREE.DoubleSide, fog: false })
    );
    this.holoRing.position.y = 0.86;
    tableGroup.add(tableBase, tableRim, holoScreen, this.holoRing);
    this.backdropGroup.add(tableGroup);

    // Standing Weapon Rack behind the Holo-Table
    const rackGroup = new THREE.Group();
    rackGroup.position.set(3.2, -0.21, -3.65);
    rackGroup.rotation.y = -0.32;
    const rackBack = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.05, 0.12), steelBeamMat);
    rackBack.position.y = 1.02;
    const rackHeader = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.05, 0.16), brassStripMat);
    rackHeader.position.set(0, 1.96, 0.02);
    rackGroup.add(rackBack, rackHeader);
    const rackWeapons: [WeaponId, string | null, number][] = [
      ['longbow', 'optic_8x', 1.48],
      ['sentinel_dmr', 'optic_4x', 1.06],
      ['viper_ar', 'optic_holo', 0.64]
    ];
    for (const [wId, optic, wy] of rackWeapons) {
      const wMesh = createWeaponModel(wId, { optic });
      wMesh.position.set(0.05, wy, 0.11);
      wMesh.rotation.y = Math.PI / 2;
      rackGroup.add(wMesh);
    }
    this.backdropGroup.add(rackGroup);

    this.scene.add(this.backdropGroup);

    // 3. Dual-Ring Illuminated Operator Turntable Pedestal
    const pedGeo = new THREE.CylinderGeometry(1.75, 1.98, 0.36, 40);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x222926, metalness: 0.55, roughness: 0.48 });
    this.pedestal = new THREE.Mesh(pedGeo, pedMat);
    this.pedestal.position.set(0, -0.2, 0);

    const ringGeo = new THREE.RingGeometry(1.64, 1.73, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, brassStripMat);
    ring.position.set(0, 0.182, 0);
    this.pedestal.add(ring);

    const innerRingGeo = new THREE.RingGeometry(1.18, 1.22, 48);
    innerRingGeo.rotateX(-Math.PI / 2);
    const innerRing = new THREE.Mesh(
      innerRingGeo,
      new THREE.MeshBasicMaterial({ color: 0x68c6b0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, fog: false })
    );
    innerRing.position.set(0, 0.183, 0);
    this.pedestal.add(innerRing);

    this.pedestal.scale.set(0.68, 1, 0.68);
    this.characterGroup.add(this.pedestal);
    this.createCharacterMesh('#4b5563');

    this.characterGroup.position.set(0, 0, 0);
    this.scene.add(this.characterGroup);

    this.initMouseDragEvents();
  }

  private buildShowcaseBuggy(): THREE.Group {
    const g = new THREE.Group();
    const oliveArmor = new THREE.MeshStandardMaterial({ color: 0x3d4839, roughness: 0.56, metalness: 0.28 });
    const darkFrame = new THREE.MeshStandardMaterial({ color: 0x1a201e, roughness: 0.48, metalness: 0.65 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141617, roughness: 0.88, metalness: 0.08 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0, fog: false });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.46, 3.1), oliveArmor);
    chassis.position.y = 0.52;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.28, 1.05), oliveArmor);
    hood.position.set(0, 0.82, 0.85);
    hood.rotation.x = 0.14;
    const cageTop = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.08, 1.55), darkFrame);
    cageTop.position.set(0, 1.58, -0.18);
    g.add(chassis, hood, cageTop);

    for (const [px, pz, rx] of [
      [-0.64, 0.52, -0.28],
      [0.64, 0.52, -0.28],
      [-0.64, -0.88, 0.22],
      [0.64, -0.88, 0.22]
    ] as const) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.88, 8), darkFrame);
      pillar.position.set(px, 1.18, pz);
      pillar.rotation.x = rx;
      g.add(pillar);
    }

    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.30, 12);
    hubGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [
      [-0.88, 1.02],
      [0.88, 1.02],
      [-0.88, -1.02],
      [0.88, -1.02]
    ] as const) {
      const wheel = new THREE.Mesh(wheelGeo, tireMat);
      wheel.position.set(wx, 0.38, wz);
      const hub = new THREE.Mesh(hubGeo, darkFrame);
      hub.position.set(wx, 0.38, wz);
      g.add(wheel, hub);
    }

    for (const hx of [-0.48, 0.48]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.10, 0.05), headlightMat);
      lamp.position.set(hx, 0.72, 1.56);
      g.add(lamp);
    }
    g.scale.setScalar(0.78);
    return g;
  }

  public createCharacterMesh(colorHex: string, skinHex = '#c99672', outfit = 'field'): void {
    if (!this.operatorModel) { this.operatorModel = new OperatorModel(); this.characterGroup.add(this.operatorModel); }
    this.operatorModel.setAppearance(colorHex, skinHex, outfit);
  }
  public setWeapon(id: WeaponId, optic = 'optic_reddot'): void { this.operatorModel?.setWeapon(id, optic); }

  public updateLobby(delta: number): void {
    this.lobbyClock += delta;
    this.operatorModel?.setPose('ground');
    if (this.operatorModel) this.operatorModel.aimPitch = -0.32 + Math.sin(this.lobbyClock * 1.4) * 0.025;
    this.operatorModel?.update(delta, 0);
    if (this.holoRing) {
      const pulse = 0.88 + 0.18 * Math.sin(this.lobbyClock * 2.4);
      this.holoRing.scale.setScalar(pulse);
    }
  }

  private initMouseDragEvents(): void {
    window.addEventListener('mousedown', (e) => {
      if (this.isVisible && e.clientX < window.innerWidth * 0.65) {
        this.isDragging = true;
        this.previousMouseX = e.clientX;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging && this.isVisible) {
        const deltaX = e.clientX - this.previousMouseX;
        this.characterGroup.rotation.y += deltaX * 0.012;
        this.previousMouseX = e.clientX;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) this.characterGroup.rotation.y = Math.PI;
    this.characterGroup.visible = visible;
    this.backdropGroup.visible = visible;
    this.studioLightsGroup.visible = visible;
    this.pedestal.visible = visible;
    if (this.operatorModel) this.operatorModel.visible = visible;
  }

  public get operator(): OperatorModel | undefined { return this.operatorModel; }

  public setGameplayView(thirdPerson: boolean, position: THREE.Vector3, yaw: number, hideOperator = false, delta = 1 / 60, crouching = false, grounded = true, pose: OperatorPose = 'ground', pitch = 0, groundY?: number): void {
    this.backdropGroup.visible = false;
    this.studioLightsGroup.visible = false;
    this.pedestal.visible = false;
    const feet = groundY ?? position.y - (crouching ? 1.05 : 1.7);
    this.characterGroup.position.set(position.x, pose === 'ground' ? feet : position.y - 1.7, position.z);
    this.characterGroup.rotation.y = yaw;
    this.characterGroup.visible = thirdPerson && !hideOperator;
    const travel = Math.hypot(position.x - this.lastGameplayPosition.x, position.z - this.lastGameplayPosition.z);
    if (this.operatorModel) { this.operatorModel.setPose(pose); this.operatorModel.aimPitch = pitch; }
    this.operatorModel?.update(delta, travel < 3 ? travel / delta : 0, crouching, grounded);
    this.lastGameplayPosition.copy(position);
    if (this.operatorModel) this.operatorModel.visible = thirdPerson && !hideOperator;
  }
}
