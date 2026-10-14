import * as THREE from 'three';
import { AshenValleyMap, WATER_LEVEL } from '../world/AshenValleyMap';
import { SoundManager } from './SoundManager';
import { VehicleType } from '../../shared/types';
import { VEHICLE_SPECS } from '../../shared/vehicles';

export type DropStage = 'none' | 'plane' | 'freefall' | 'parachute';

const CELL = 32;
const cellKey = (x: number, z: number) => (x + 1000) * 4096 + (z + 1000);

export class PlayerController {
  public camera: THREE.PerspectiveCamera;
  public domElement: HTMLElement;
  private map: AshenValleyMap;
  private soundManager: SoundManager;

  public enabled: boolean = false; // Enabled only when match starts
  public position: THREE.Vector3 = new THREE.Vector3(0, 400, 0); // Start airborne for drop
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public yaw: number = 0;
  public pitch: number = 0;
  public sensitivity = 1;

  public isLocked: boolean = false;
  public isCrouching: boolean = false;
  public isGrounded: boolean = false;
  public isSwimming: boolean = false;
  public dropStage: DropStage = 'none';
  public isDriving: boolean = false;
  public drivingVehicleId: string | null = null;
  public drivingVehicleType: VehicleType = 'scout_runner';
  public trainingMode: boolean = false;
  private boxes: THREE.Box3[] = [];
  private grid = new Map<number, THREE.Box3[]>();
  private nearBoxes: THREE.Box3[] = [];
  /** True while an inventory or menu overlay is open: no mouse look or firing. */
  public uiOpen = false;
  public get collisionBoxes(): THREE.Box3[] { return this.boxes; }
  /** Buckets wall boxes into 32 m cells so collision only tests nearby walls. */
  public set collisionBoxes(boxes: THREE.Box3[]) {
    this.boxes = boxes; this.grid.clear();
    for (const box of boxes) {
      for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++)
        for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) {
          const key = cellKey(x, z); if (!this.grid.has(key)) this.grid.set(key, []); this.grid.get(key)!.push(box);
        }
    }
  }
  /** Boxes in the 3x3 cells around a point. */
  public boxesNear(x: number, z: number): THREE.Box3[] {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    this.nearBoxes.length = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const list = this.grid.get(cellKey(cx + dx, cz + dz)); if (list) for (const b of list) if (!this.nearBoxes.includes(b)) this.nearBoxes.push(b); }
    return this.nearBoxes;
  }
  public speedMultiplier = 1;
  public onLanded?: (position: THREE.Vector3, hard: boolean) => void;
  public onParachuteOpened?: () => void;
  private playerBox = new THREE.Box3();

  // Third person is the default for the battle-royale map; V switches to first person.
  public cameraMode: 'FPS' | 'TPS' = 'TPS';

  // Smooth TPS camera anchor & FOV
  private smoothCamPos = new THREE.Vector3();
  private camInitialized = false;

  // ADS
  public isScoped: boolean = false;
  public scopedFOV: number = 58;
  public scopeForcesFirstPerson = false;
  private lookUp: boolean = false;
  private lookDown: boolean = false;
  private lookLeft: boolean = false;
  private lookRight: boolean = false;

  private moveForward: boolean = false;
  private moveBackward: boolean = false;
  private moveLeft: boolean = false;
  private moveRight: boolean = false;
  private sprintHeld = false;
  private sprintBlockedUntil = 0;
  private parachuteRequested = false;

  private footstepTimer: number = 0;
  private baseFOV: number = 75;
  private drivingSpeed = 0;
  private cameraModeBeforeDriving: 'FPS' | 'TPS' = 'FPS';
  private eyeHeight = 1.7;
  private recoilDebt = 0;
  private lastRecoilAt = 0;
  private trauma = 0;
  private shakeTime = 0;
  private landingDip = 0;
  private bobTime = 0;
  private fallStartY = 0;

  /** Transport aircraft state while riding it. */
  public planePosition = new THREE.Vector3();
  public planeVelocity = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, map: AshenValleyMap, soundManager: SoundManager) {
    this.camera = camera;
    this.domElement = domElement;
    this.map = map;
    this.soundManager = soundManager;

    this.initEventListeners();
  }

  public canLock: boolean = true;
  private isDraggingAim = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  /** True when the player is skydiving or under canopy. */
  public get isDropping(): boolean { return this.dropStage !== 'none'; }
  public set isDropping(value: boolean) {
    if (value && this.dropStage === 'none') { this.dropStage = 'freefall'; this.dropHeading = this.yaw; this.fallStartY = this.position.y; this.parachuteRequested = false; }
    if (!value) this.dropStage = 'none';
  }

  public get isMoving(): boolean { return this.moveForward || this.moveBackward || this.moveLeft || this.moveRight; }

  public get isSprinting(): boolean {
    return this.sprintHeld && this.moveForward && !this.isCrouching && !this.isScoped && this.isGrounded && performance.now() >= this.sprintBlockedUntil && !this.isDropping;
  }

  /** First person when chosen, or when aiming down a magnified optic in third person. */
  public get firstPerson(): boolean { return this.cameraMode === 'FPS' || (this.isScoped && this.scopeForcesFirstPerson && !this.isDriving); }

  public get altitudeAboveGround(): number {
    return this.position.y - (this.trainingMode ? 0 : this.map.getTerrainHeight(this.position.x, this.position.z));
  }

  public blockSprint(ms: number): void { this.sprintBlockedUntil = performance.now() + ms; }

  public addRecoil(vertical: number, horizontal: number): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch + vertical, -1.45, 1.45);
    this.yaw += horizontal;
    this.recoilDebt = Math.min(.35, this.recoilDebt + vertical * .6);
    this.lastRecoilAt = performance.now();
  }

  public addShake(amount: number): void { this.trauma = Math.min(1, this.trauma + amount * .22); }

  private initEventListeners(): void {
    this.domElement.addEventListener('click', () => {
      if (this.enabled && !this.isLocked && !this.isDriving && this.canLock && !this.uiOpen) {
        this.domElement.requestPointerLock()?.catch?.(() => { /* Drag aiming remains available. */ });
      }
    });

    this.domElement.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.isDraggingAim = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });
    window.addEventListener('mouseup', () => { this.isDraggingAim = false; });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.uiOpen || (!this.isLocked && !this.isDraggingAim)) return;
      // Scale sensitivity with zoom so magnified optics feel consistent.
      const zoom = this.isScoped ? Math.max(.12, this.scopedFOV / this.baseFOV) : 1;
      const sens = .0022 * this.sensitivity * zoom;
      const dx = this.isLocked ? e.movementX : e.clientX - this.lastPointerX;
      const dy = this.isLocked ? e.movementY : e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.yaw -= dx * sens;
      this.yaw = THREE.MathUtils.euclideanModulo(this.yaw + Math.PI, Math.PI * 2) - Math.PI;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.45, 1.45);
      // Pulling down against recoil consumes the automatic recovery.
      if (dy > 0) this.recoilDebt = Math.max(0, this.recoilDebt - dy * sens);
    });

    document.addEventListener('mousedown', (e) => { if (e.button === 2 && this.enabled) this.isScoped = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 2) this.isScoped = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => { this.moveForward = this.moveBackward = this.moveLeft = this.moveRight = this.sprintHeld = this.isScoped = false; this.isDraggingAim = false; });
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled || (e.target instanceof HTMLInputElement)) return;
    if (['Space', 'Tab', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
    switch (e.code) {
      case 'KeyW': this.moveForward = true; break;
      case 'KeyS': this.moveBackward = true; break;
      case 'KeyA': this.moveLeft = true; break;
      case 'KeyD': this.moveRight = true; break;
      case 'ArrowUp': this.lookUp = true; break;
      case 'ArrowDown': this.lookDown = true; break;
      case 'ArrowLeft': this.lookLeft = true; break;
      case 'ArrowRight': this.lookRight = true; break;
      case 'ShiftLeft': case 'ShiftRight':
        this.sprintHeld = true;
        if (this.isCrouching && !e.repeat) this.isCrouching = false;
        break;
      case 'ControlLeft': case 'ControlRight': this.isScoped = true; break;
      case 'KeyC':
        if (!e.repeat && !this.isDropping && !this.isDriving) this.isCrouching = !this.isCrouching;
        break;
      case 'Space':
        if (this.dropStage === 'freefall') { this.parachuteRequested = true; break; }
        if (this.isSwimming && !this.isDropping && !this.isDriving) {
          this.velocity.y = 5.2;
          this.isSwimming = false;
          this.isGrounded = false;
          this.soundManager.playSwimStroke(true);
          break;
        }
        if (this.isGrounded && !this.isDropping && !this.isDriving) {
          if (this.isCrouching) { this.isCrouching = false; break; }
          this.velocity.y = 6.4;
          this.isGrounded = false;
          this.fallStartY = this.position.y;
        }
        break;
      case 'KeyV':
        if (e.repeat) break;
        this.cameraMode = this.cameraMode === 'TPS' ? 'FPS' : 'TPS';
        break;
      case 'KeyM':
      case 'Escape':
        if (this.isLocked) document.exitPointerLock();
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW': this.moveForward = false; break;
      case 'KeyS': this.moveBackward = false; break;
      case 'KeyA': this.moveLeft = false; break;
      case 'KeyD': this.moveRight = false; break;
      case 'ArrowUp': this.lookUp = false; break;
      case 'ArrowDown': this.lookDown = false; break;
      case 'ArrowLeft': this.lookLeft = false; break;
      case 'ArrowRight': this.lookRight = false; break;
      case 'ShiftLeft': case 'ShiftRight': this.sprintHeld = false; break;
      case 'ControlLeft': case 'ControlRight': this.isScoped = false; break;
    }
  }

  /** Leave the transport aircraft and start freefall. */
  public jumpFromPlane(): void {
    if (this.dropStage !== 'plane') return;
    this.position.copy(this.planePosition).add(new THREE.Vector3(0, -4, 0));
    this.velocity.copy(this.planeVelocity).multiplyScalar(.35);
    this.velocity.y = -6;
    this.dropStage = 'freefall';
    this.dropHeading = this.yaw;
    this.fallStartY = this.position.y;
    this.parachuteRequested = false;
  }

  public boardPlane(): void {
    this.dropStage = 'plane';
    this.isGrounded = false;
    this.isCrouching = false;
    this.isScoped = false;
  }

  /** Direction the body/canopy actually travels during the drop; eases toward the camera yaw. */
  public dropHeading = 0;
  /** Current turn rate (rad/s) while dropping, used to bank the body and canopy. */
  public dropTurnRate = 0;
  /** Seconds since the parachute opened. */
  public chuteOpenTime = 0;
  private blend = 1;
  private blendDuration = .6;
  private blendFrom = new THREE.Vector3();
  private blendFromQ = new THREE.Quaternion();
  private preFrame = new THREE.Vector3();
  private preFrameQ = new THREE.Quaternion();
  private lastStage: DropStage = 'none';

  public update(delta: number): void {
    if (!this.enabled || !this.canLock) return;
    // Compare against last frame's stage: jumping happens in a key handler between frames.
    const stageBefore = this.lastStage;
    this.preFrame.copy(this.camera.position); this.preFrameQ.copy(this.camera.quaternion);
    this.updateInner(delta);
    this.lastStage = this.dropStage;
    // Blend the camera across stage changes (plane → freefall → parachute → ground)
    // instead of cutting, so the drop reads as one continuous shot.
    if (stageBefore !== this.dropStage && stageBefore !== 'none' && this.preFrame.distanceTo(this.camera.position) < 65) {
      this.blend = 0;
      this.blendDuration = this.dropStage === 'freefall' ? 1.1 : this.dropStage === 'parachute' ? .9 : .7;
      this.blendFrom.copy(this.preFrame); this.blendFromQ.copy(this.preFrameQ);
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + delta / this.blendDuration);
      const e = this.blend * this.blend * (3 - 2 * this.blend);
      this.camera.position.lerpVectors(this.blendFrom, this.camera.position, e);
      this.camera.quaternion.slerpQuaternions(this.blendFromQ, this.camera.quaternion, e);
    }
  }

  private updateInner(delta: number): void {
    if (this.isDriving) { this.updateDriving(delta); return; }

    if (this.lookUp !== this.lookDown) {
      this.pitch += (this.lookUp ? 1 : -1) * delta * 1.35;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    }
    if (this.lookLeft !== this.lookRight) {
      this.yaw += (this.lookLeft ? 1 : -1) * delta * 1.85;
      this.yaw = THREE.MathUtils.euclideanModulo(this.yaw + Math.PI, Math.PI * 2) - Math.PI;
    }

    if (this.dropStage === 'plane') { this.updatePlaneCamera(delta); return; }
    if (this.dropStage === 'freefall' || this.dropStage === 'parachute') { this.updateDrop(delta); return; }

    // Recoil recovery: the sight settles back most of the way after a burst.
    if (this.recoilDebt > 0 && performance.now() - this.lastRecoilAt > 110) {
      const step = Math.min(this.recoilDebt, delta * (this.recoilDebt * 7 + .02));
      this.pitch -= step; this.recoilDebt -= step;
    }

    // Ground & Swimming movement with responsive COD/PUBG feel.
    const groundY = this.trainingMode ? 0 : this.map.getTerrainHeight(this.position.x, this.position.z);
    const inDeepWater = !this.trainingMode && groundY < WATER_LEVEL - 0.35 && this.position.y <= WATER_LEVEL + 0.95;
    if (inDeepWater && !this.isSwimming) {
      this.isSwimming = true;
      this.isCrouching = false;
      this.isScoped = false;
      this.isGrounded = true;
      this.velocity.y = 0;
      this.soundManager.playSwimStroke(true);
    } else if (!inDeepWater && this.isSwimming && groundY >= WATER_LEVEL - 0.32) {
      this.isSwimming = false;
    }

    const sprinting = this.isSprinting || (this.isSwimming && this.sprintHeld && (this.moveForward || this.moveLeft || this.moveRight));
    let speed = this.isSwimming ? (sprinting ? 6.8 : 4.6) : 5.4;
    if (!this.isSwimming && sprinting) speed = 8.4;
    if (!this.isSwimming && this.isCrouching) speed = 2.8;
    if (!this.isSwimming && this.isScoped) speed = Math.min(speed, 3.1);
    speed *= this.speedMultiplier;

    const forwardDir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rightDir = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (this.moveForward) wish.add(forwardDir);
    if (this.moveBackward) wish.sub(forwardDir);
    if (this.moveLeft) wish.sub(rightDir);
    if (this.moveRight) wish.add(rightDir);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(this.moveBackward && !this.moveForward ? speed * .84 : speed);

    // Responsive COD/BGMI acceleration & smooth air control
    const accel = this.isSwimming ? 8.5 : this.isGrounded ? (wish.lengthSq() > 0 ? 18 : 14) : 4.2;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, wish.x, accel, delta);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, wish.z, accel, delta);

    const oldX = this.position.x, oldZ = this.position.z;
    this.position.x += this.velocity.x * delta;
    if (this.hitsWall()) { this.position.x = oldX; this.velocity.x = 0; }
    this.position.z += this.velocity.z * delta;
    if (this.hitsWall()) { this.position.z = oldZ; this.velocity.z = 0; }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.isSwimming) {
      this.bobTime += delta * (horizontalSpeed > 0.5 ? (sprinting ? 8 : 5.5) : 2.2);
      if (horizontalSpeed > 0.6) {
        this.footstepTimer += delta * (sprinting ? 1.35 : 0.95);
        if (this.footstepTimer > 0.52) {
          this.soundManager.playSwimStroke(sprinting);
          this.footstepTimer = 0;
        }
      }
      const swimTargetY = WATER_LEVEL + 0.56 + Math.sin(this.bobTime * 1.4) * 0.04;
      this.position.y = THREE.MathUtils.damp(this.position.y, swimTargetY, 12, delta);
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      if (this.isGrounded && horizontalSpeed > .8) {
        this.bobTime += delta * (sprinting ? 13 : 9);
        this.footstepTimer += delta * (sprinting ? 1.55 : this.isCrouching ? .7 : 1);
        if (this.footstepTimer > .4) { this.soundManager.playFootstep(sprinting, this.isCrouching); this.footstepTimer = 0; }
      }

      // Gravity
      if (!this.isGrounded) {
        this.velocity.y -= 22 * delta;
        this.position.y += this.velocity.y * delta;
      }

      // Terrain contact with smooth vertical damping over slopes so the camera never jitters on hills
      const postGroundY = this.trainingMode ? 0 : this.map.getTerrainHeight(this.position.x, this.position.z);
      this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, this.isCrouching ? 1.05 : 1.7, 14, delta);
      const targetGroundEye = postGroundY + this.eyeHeight;
      if (this.isGrounded) {
        if (this.position.y - targetGroundEye > 1.15) {
          this.isGrounded = false;
          this.velocity.y = 0;
          this.fallStartY = this.position.y;
        } else {
          this.position.y = THREE.MathUtils.damp(this.position.y, targetGroundEye, 24, delta);
        }
      } else if (this.position.y <= targetGroundEye) {
        const fall = this.fallStartY - this.position.y;
        this.position.y = targetGroundEye;
        this.velocity.y = 0;
        this.isGrounded = true;
        this.landingDip = Math.min(.22, .04 + fall * .025);
        this.soundManager.playLanding(fall > 3);
      }
    }

    this.updateCamera(delta, sprinting && horizontalSpeed > 1);
  }

  private updateCamera(delta: number, sprinting: boolean): void {
    this.landingDip = THREE.MathUtils.damp(this.landingDip, 0, 10, delta);
    this.trauma = Math.max(0, this.trauma - delta * 2.6);
    this.shakeTime += delta * 38;
    const shake = this.trauma * this.trauma;
    const shakePitch = shake * .016 * Math.sin(this.shakeTime * 1.3);
    const shakeYaw = shake * .012 * Math.sin(this.shakeTime * .9 + 1.7);
    const shakeRoll = shake * .016 * Math.sin(this.shakeTime * 1.1 + 3.1);

    const eyePos = this.position.clone();
    eyePos.y -= this.landingDip;
    const first = this.firstPerson;
    if (first) {
      const bob = this.isScoped ? .12 : 1;
      eyePos.y += Math.sin(this.bobTime * 2) * .02 * bob * (sprinting ? 1.3 : 1) * (Math.hypot(this.velocity.x, this.velocity.z) > .8 ? 1 : 0);
      this.camera.position.copy(eyePos);
      this.smoothCamPos.copy(eyePos);
    } else {
      // Smooth over-the-shoulder TPS camera like PUBG / BGMI
      const aim = this.isScoped ? 1 : 0;
      const offset = new THREE.Vector3(THREE.MathUtils.lerp(.55, .62, aim), THREE.MathUtils.lerp(.46, .28, aim), THREE.MathUtils.lerp(3.55, 1.7, aim));
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const desired = eyePos.clone().add(offset.applyQuaternion(rotation));
      const toCam = desired.clone().sub(eyePos);
      const length = toCam.length();
      const ray = new THREE.Ray(eyePos, toCam.normalize());
      let allowed = length;
      const hit = new THREE.Vector3();
      for (const box of this.boxesNear(eyePos.x, eyePos.z)) {
        if (box.distanceToPoint(eyePos) > length + 1) continue;
        if (ray.intersectBox(box, hit)) allowed = Math.min(allowed, hit.distanceTo(eyePos) - .25);
      }
      const camPos = eyePos.clone().addScaledVector(toCam, Math.max(.3, allowed));
      const ground = (this.trainingMode ? 0 : this.map.getTerrainHeight(camPos.x, camPos.z)) + .32;
      if (camPos.y < ground) camPos.y = ground;
      if (!this.camInitialized || this.smoothCamPos.distanceTo(camPos) > 12) {
        this.smoothCamPos.copy(camPos);
        this.camInitialized = true;
      } else {
        this.smoothCamPos.lerp(camPos, 1 - Math.exp(-26 * delta));
      }
      this.camera.position.copy(this.smoothCamPos);
    }

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch + shakePitch, this.yaw + shakeYaw, shakeRoll, 'YXZ');

    let targetFOV = this.baseFOV;
    if (this.isScoped) targetFOV = first ? this.scopedFOV : Math.min(62, this.scopedFOV + 10);
    else if (sprinting) targetFOV = this.baseFOV + 6;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFOV, this.isScoped ? 16 : 9, delta);
    this.camera.updateProjectionMatrix();
  }

  private updatePlaneCamera(delta: number): void {
    this.position.copy(this.planePosition);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.min(this.pitch, .2) - .25, this.yaw, 0, 'YXZ'));
    const offset = new THREE.Vector3(0, 6, 38).applyQuaternion(rotation);
    this.camera.position.copy(this.planePosition).add(offset);
    this.camera.lookAt(this.planePosition.x, this.planePosition.y + 2, this.planePosition.z);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 70, 4, delta);
    this.camera.updateProjectionMatrix();
  }

  private updateDrop(delta: number): void {
    const groundY = this.trainingMode ? 0 : this.map.getTerrainHeight(this.position.x, this.position.z);
    const altitude = this.position.y - groundY;

    if (this.dropStage === 'freefall') {
      if (altitude < 140 || (this.parachuteRequested && altitude < 500)) {
        this.dropStage = 'parachute';
        this.chuteOpenTime = 0;
        this.soundManager.playParachuteOpen();
        this.onParachuteOpened?.();
      }
    }

    const freefall = this.dropStage === 'freefall';
    // Responsive PUBG / BGMI parachute & freefall controls:
    // A / D actively turn & bank the canopy/body AND strafe horizontally;
    // S flares/brakes the canopy (slows descent & pulls back);
    // W dives forward at high speed.
    const steerInput = (this.moveLeft ? 1 : 0) - (this.moveRight ? 1 : 0);
    if (steerInput !== 0) {
      const keyTurnSpeed = freefall ? 1.85 : 1.55;
      this.yaw = THREE.MathUtils.euclideanModulo(this.yaw + steerInput * keyTurnSpeed * delta + Math.PI, Math.PI * 2) - Math.PI;
    }

    const maxTurn = freefall ? 3.2 : 2.1;
    const diff = THREE.MathUtils.euclideanModulo(this.yaw - this.dropHeading + Math.PI, Math.PI * 2) - Math.PI;
    const turn = THREE.MathUtils.clamp(diff * 4.2 + steerInput * (freefall ? 1.6 : 1.35), -maxTurn, maxTurn);
    this.dropHeading = THREE.MathUtils.euclideanModulo(this.dropHeading + turn * delta + Math.PI, Math.PI * 2) - Math.PI;
    this.dropTurnRate = THREE.MathUtils.damp(this.dropTurnRate, turn, 8, delta);

    const forwardDir = new THREE.Vector3(-Math.sin(this.dropHeading), 0, -Math.cos(this.dropHeading));
    const rightDir = new THREE.Vector3(Math.cos(this.dropHeading), 0, -Math.sin(this.dropHeading));
    if (!freefall) this.chuteOpenTime += delta;

    // W + looking down dives faster; S flares/brakes canopy to hover or back-drift; A/D bank and strafe strongly.
    const dive = freefall && this.moveForward ? THREE.MathUtils.clamp(-this.pitch, 0.15, 1) : 0;
    const targetFall = freefall
      ? (this.moveForward ? -(46 + dive * 32) : this.moveBackward ? -26 : -36)
      : (this.moveForward ? -10.5 : this.moveBackward ? -3.2 : -6.2);
    const forwardSpeed = freefall
      ? (this.moveForward ? 42 * (1 - dive * .35) : this.moveBackward ? -6 : 16)
      : (this.moveForward ? 24 : this.moveBackward ? -5.5 : 11);
    const strafe = (this.moveRight ? 1 : 0) - (this.moveLeft ? 1 : 0);
    const wish = forwardDir.clone().multiplyScalar(forwardSpeed).addScaledVector(rightDir, strafe * (freefall ? 22 : 15));
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, wish.x, freefall ? 4.5 : 5.2, delta);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, wish.z, freefall ? 4.5 : 5.2, delta);
    this.velocity.y = THREE.MathUtils.damp(this.velocity.y, targetFall, freefall ? 2.4 : this.chuteOpenTime < 1.0 ? 4.0 : 3.4, delta);
    this.position.addScaledVector(this.velocity, delta);
    this.soundManager.setWind(freefall ? .6 + dive * .4 : .25);

    const landHeight = !this.trainingMode && groundY < WATER_LEVEL - 0.35 ? WATER_LEVEL + 0.56 : groundY + 1.7;
    if (this.position.y <= landHeight) {
      this.position.y = landHeight;
      this.dropStage = 'none';
      this.isGrounded = true;
      this.isSwimming = !this.trainingMode && groundY < WATER_LEVEL - 0.35;
      this.velocity.set(0, 0, 0);
      this.landingDip = .2;
      this.soundManager.setWind(0);
      if (this.isSwimming) this.soundManager.playSwimStroke(true);
      else this.soundManager.playLanding(true);
      this.onLanded?.(this.position.clone(), true);
      this.updateCamera(delta, false);
      return;
    }

    // Under canopy the camera sits further back and looks a little higher so
    // both the operator and the canopy above stay in frame.
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.clamp(this.pitch, -1.2, .4) - .15, this.yaw, 0, 'YXZ'));
    const offset = new THREE.Vector3(0, freefall ? 1.2 : 3, freefall ? 6.5 : 11).applyQuaternion(rotation);
    this.camera.position.copy(this.position).add(offset);
    this.camera.lookAt(this.position.x, this.position.y + (freefall ? 0 : 2.2), this.position.z);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, freefall ? 82 + dive * 8 : 74, 3, delta);
    this.camera.updateProjectionMatrix();
  }

  public enterVehicle(id: string, vehiclePosition: THREE.Vector3, yaw: number, vehicleType: VehicleType = 'scout_runner'): void {
    if (!this.isDriving) this.cameraModeBeforeDriving = this.cameraMode;
    this.drivingVehicleId = id;
    this.drivingVehicleType = vehicleType;
    this.isDriving = true;
    this.isSwimming = false;
    this.drivingSpeed = 0;
    this.cameraMode = 'TPS';
    this.isCrouching = false;
    this.yaw = yaw;
    this.position.copy(vehiclePosition);
    this.soundManager.playVehicleStart();
  }

  private hitsWall(): boolean {
    if (this.trainingMode) return false;
    this.playerBox.min.set(this.position.x - .3, this.position.y - this.eyeHeight + .35, this.position.z - .3);
    this.playerBox.max.set(this.position.x + .3, this.position.y + .15, this.position.z + .3);
    return this.boxesNear(this.position.x, this.position.z).some(box => box.intersectsBox(this.playerBox));
  }

  public exitVehicle(): void {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.position.addScaledVector(right, -2.4).addScaledVector(forward, .5);
    const groundY = this.trainingMode ? 0 : this.map.getTerrainHeight(this.position.x, this.position.z);
    if (!this.trainingMode && groundY < WATER_LEVEL - 0.35) {
      this.position.y = WATER_LEVEL + 0.56;
      this.isSwimming = true;
    } else {
      this.position.y = groundY + 1.7;
      this.isSwimming = false;
    }
    this.isDriving = false;
    this.drivingVehicleId = null;
    this.drivingSpeed = 0;
    this.velocity.set(0, 0, 0);
    this.isGrounded = true;
    this.cameraMode = this.cameraModeBeforeDriving;
  }

  public get vehicleSpeed(): number { return this.drivingSpeed; }
  /** -1 (right) .. 1 (left) steering input while driving. */
  public get steerInput(): number { return (this.moveLeft ? 1 : 0) - (this.moveRight ? 1 : 0); }
  /** Running into an operator bleeds off speed. */
  public vehicleImpact(): void { this.drivingSpeed *= .55; this.addShake(1.4); }

  private updateDriving(delta: number): void {
    const spec = VEHICLE_SPECS[this.drivingVehicleType] || VEHICLE_SPECS.scout_runner;
    const terrainY = this.trainingMode ? 0 : this.map.getTerrainHeight(this.position.x, this.position.z);
    const inWater = !this.trainingMode && terrainY < WATER_LEVEL - 0.25;
    const waterDrag = !spec.amphibious && inWater ? 0.55 : 1.0;

    if (this.moveForward) this.drivingSpeed = Math.min(spec.maxSpeed * waterDrag, this.drivingSpeed + spec.acceleration * delta);
    else if (this.moveBackward) this.drivingSpeed = Math.max(-spec.reverseSpeed * waterDrag, this.drivingSpeed - (spec.acceleration + 6) * delta);
    else this.drivingSpeed = THREE.MathUtils.damp(this.drivingSpeed, 0, 1.4, delta);
    if (this.sprintHeld && !this.moveForward) this.drivingSpeed = THREE.MathUtils.damp(this.drivingSpeed, 0, 4.5, delta);

    const steering = (this.moveLeft ? 1 : 0) - (this.moveRight ? 1 : 0);
    if (steering) {
      const turnFactor = (0.45 + Math.min(Math.abs(this.drivingSpeed) / 16, 0.75)) * (spec.turnRate / 2.0);
      this.yaw += steering * delta * turnFactor * (this.drivingSpeed < 0 ? -1 : 1);
    }
    const oldX = this.position.x, oldZ = this.position.z;
    this.position.x -= Math.sin(this.yaw) * this.drivingSpeed * delta;
    this.position.z -= Math.cos(this.yaw) * this.drivingSpeed * delta;
    this.playerBox.min.set(this.position.x - 1.1, this.position.y - .6, this.position.z - 1.1);
    this.playerBox.max.set(this.position.x + 1.1, this.position.y + .8, this.position.z + 1.1);
    if (!this.trainingMode && this.boxesNear(this.position.x, this.position.z).some(box => box.intersectsBox(this.playerBox))) {
      this.position.x = oldX; this.position.z = oldZ;
      if (Math.abs(this.drivingSpeed) > 8) this.addShake(2);
      this.drivingSpeed *= -.25;
    }
    const postTerrainY = this.trainingMode ? 0 : this.map.getTerrainHeight(this.position.x, this.position.z);
    const surfaceY = spec.amphibious ? Math.max(postTerrainY, WATER_LEVEL - 0.12) : Math.max(postTerrainY, WATER_LEVEL - 0.65);
    this.position.y = surfaceY + spec.seatHeight;
    this.velocity.set(-Math.sin(this.yaw) * this.drivingSpeed, 0, -Math.cos(this.yaw) * this.drivingSpeed);

    const camDist = this.drivingVehicleType === 'armored_truck' ? 8.8 : this.drivingVehicleType === 'strike_bike' ? 6.4 : 7.5;
    const camHeight = this.drivingVehicleType === 'armored_truck' ? 3.1 : 2.5;
    const cameraOffset = new THREE.Vector3(0, camHeight, camDist).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.camera.position.copy(this.position).add(cameraOffset);
    this.camera.lookAt(this.position.x, this.position.y + .6, this.position.z);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 75 + Math.abs(this.drivingSpeed) * .38, 4, delta);
    this.camera.updateProjectionMatrix();
  }
}
