import { createWeaponModel, disposeObject } from '../world/WeaponModel';
import * as THREE from 'three';
import { WeaponConfig, WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/constants';
import { SoundManager } from './SoundManager';
import { PlayerController } from './PlayerController';
import { ParticleSystem, FxTextures } from './ParticleSystem';
import { InventorySystem } from './InventorySystem';

export interface ShotResult { point: THREE.Vector3; normal: THREE.Vector3; kind: 'world' | 'player' | 'none'; distance: number; headshot?: boolean; surface?: 'hard' | 'soft'; }

/** Spread cone half-angles in radians: [hip, aimed]. */
const SPREAD: Record<string, [number, number]> = {
  ar: [.032, .0035], smg: [.028, .0065], dmr: [.045, .0012], shotgun: [.075, .055], sniper: [.09, .0004]
};
const BLOOM: Record<string, number> = { ar: .0045, smg: .0035, dmr: .012, shotgun: 0, sniper: 0 };
const SHAKE: Record<string, number> = { ar: .35, smg: .25, dmr: .6, shotgun: 1, sniper: 1 };

export class CombatSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controller: PlayerController;
  private soundManager: SoundManager;
  private particleSystem: ParticleSystem;
  private inventorySystem: InventorySystem;

  public currentWeapon: WeaponConfig | null = null;
  public isReloading: boolean = false;
  public serverAuthoritative = false;
  public fireMode: 'auto' | 'single' = 'auto';
  public readonly viewModelScene = new THREE.Scene();
  public readonly viewModelCamera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, .01, 10);

  private triggerHeld = false;
  private triggerConsumed = false;
  private reloadStarted = 0;
  private reloadTimer?: number;
  private reloadEmpty = false;
  private motionTime = 0;
  private lastPosition = new THREE.Vector3();
  private reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  public get reloadProgress(): number | null { return this.isReloading && this.currentWeapon ? Math.min(1, (performance.now()-this.reloadStarted)/(this.currentWeapon.reloadTime*1000)) : null; }
  private lastFireTime: number = 0;
  private readyAt = 0;
  private equipStarted = 0;
  private bloom = 0;
  private ads = 0;
  private sprintBlend = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private sway = new THREE.Vector2();
  private kick = 0;
  private kickRot = 0;
  private kickSide = 0;
  private flashUntil = 0;

  private viewRoot = new THREE.Group();
  private weaponPivot = new THREE.Group();
  private weaponModel?: THREE.Group;
  private magazine?: THREE.Object3D;
  private bolt?: THREE.Object3D;
  private muzzleFlash: THREE.Sprite;
  private sleeveMaterial = new THREE.MeshStandardMaterial({ color: 0x4c5846, roughness: .82, metalness: .06 });
  private gloveMaterial = new THREE.MeshStandardMaterial({ color: 0x1e2326, roughness: .62, metalness: .18 });
  private knuckleMaterial = new THREE.MeshStandardMaterial({ color: 0x111518, roughness: .35, metalness: .55 });

  public onFireCallback?: (origin: THREE.Vector3, direction: THREE.Vector3, weaponId: WeaponId, pellets?: THREE.Vector3[]) => void;
  public onReloadCallback?: () => void;
  /** Raycasts the world for visuals and TPS aim convergence. */
  public resolveShot?: (origin: THREE.Vector3, direction: THREE.Vector3, range: number) => ShotResult;
  /** Third-person muzzle in world space, provided by the operator model. */
  public getThirdPersonMuzzle?: () => { position: THREE.Vector3; direction: THREE.Vector3 } | null;
  /** Healing, vehicles or menus that should block the trigger. */
  public isBusy?: () => boolean;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, controller: PlayerController, soundManager: SoundManager, particleSystem: ParticleSystem, inventorySystem: InventorySystem) {
    this.scene = scene;
    this.camera = camera;
    this.controller = controller;
    this.soundManager = soundManager;
    this.particleSystem = particleSystem;
    this.inventorySystem = inventorySystem;

    this.viewModelScene.add(new THREE.HemisphereLight(0xdfe6e8, 0x4a4436, 1.6));
    const key = new THREE.DirectionalLight(0xffe2ba, 2.2); key.position.set(.6, 1, .4); this.viewModelScene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8c9, .8); rim.position.set(-1, .4, -1); this.viewModelScene.add(rim);
    this.viewModelScene.add(this.viewModelCamera);
    this.viewModelCamera.add(this.viewRoot);
    this.viewRoot.add(this.weaponPivot);
    this.muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: FxTextures.get('muzzle'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.muzzleFlash.visible = false;

    this.initEventListeners();
    this.setEquippedWeapon('viper_ar');
  }

  private initEventListeners(): void {
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.controller.enabled && (e.target === this.controller.domElement || this.controller.isLocked)) {
        this.triggerHeld = true; this.triggerConsumed = false;
        this.attemptFire();
      }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.triggerHeld = false; });
    window.addEventListener('blur', () => { this.triggerHeld = false; });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this.triggerHeld = false; });

    window.addEventListener('keydown', (e) => {
      if (!this.controller.enabled || e.repeat) return;
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyB' && this.currentWeapon && (this.currentWeapon.category === 'ar' || this.currentWeapon.category === 'smg')) {
        this.fireMode = this.fireMode === 'auto' ? 'single' : 'auto';
        this.soundManager.playFireModeSwitch();
      }
    });
  }

  public setSleeveColor(color: string): void {
    this.sleeveMaterial.color.set(color).lerp(new THREE.Color(0x1f262e), 0.65);
  }

  public setEquippedWeapon(weaponId: WeaponId | null, animate = true): void {
    const changed = weaponId !== this.currentWeapon?.id;
    if (changed) { window.clearTimeout(this.reloadTimer); this.isReloading = false; }
    if (!weaponId) {
      this.currentWeapon = null;
      this.clearViewModel();
      return;
    }
    this.currentWeapon = WEAPONS[weaponId];
    if (changed) this.fireMode = this.currentWeapon.category === 'ar' || this.currentWeapon.category === 'smg' ? 'auto' : 'single';
    this.createDetailedWeaponMesh(weaponId);
    if (changed && animate && this.controller.enabled) {
      this.equipStarted = performance.now();
      this.readyAt = this.equipStarted + 450;
      this.soundManager.playEquip();
    }
  }

  public setThirdPersonView(enabled: boolean): void {
    this.viewRoot.visible = this.controller.enabled && !enabled && !!this.currentWeapon && !this.controller.isDriving && !this.controller.isDropping && !this.controller.isSwimming;
  }

  public get viewModelVisible(): boolean { return this.viewRoot.visible; }

  private clearViewModel(): void {
    if (this.weaponModel) { this.weaponPivot.remove(this.weaponModel); disposeObject(this.weaponModel); this.weaponModel = undefined; }
  }

  private activeAttachments() {
    return this.inventorySystem.activeSlot === 1 ? this.inventorySystem.attachments.primary : this.inventorySystem.attachments.secondary;
  }

  private createDetailedWeaponMesh(weaponId: WeaponId): void {
    this.clearViewModel();
    const model = createWeaponModel(weaponId, this.activeAttachments());
    this.weaponModel = model;
    this.magazine = model.getObjectByName('mag');
    this.bolt = model.getObjectByName('bolt');
    const muzzle = model.getObjectByName('muzzle')!;
    muzzle.add(this.muzzleFlash);
    this.muzzleFlash.position.set(0, 0, -.06);
    // Articulated tactical gloves on the pistol grip and handguard, with compact armored sleeves.
    const front = muzzle.position.z;
    const hands: [THREE.Vector3, THREE.Vector3, boolean][] = [
      [new THREE.Vector3(0.008, -0.078, 0.088), new THREE.Vector3(0.19, -0.34, 0.38), false],
      [new THREE.Vector3(-0.014, -0.018, Math.max(front + 0.19, -0.26)), new THREE.Vector3(-0.22, -0.32, 0.24), true]
    ];
    for (const [hand, elbow, isSupportHand] of hands) {
      const handGroup = new THREE.Group();
      handGroup.position.copy(hand);
      handGroup.rotation.set(isSupportHand ? 0.15 : 0.28, isSupportHand ? 0.24 : -0.12, isSupportHand ? -0.35 : 0.14);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.048, 0.078), this.gloveMaterial);
      const knuckleGuard = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.014, 0.052), this.knuckleMaterial);
      knuckleGuard.position.set(isSupportHand ? -0.004 : 0.004, 0.020, -0.006);
      handGroup.add(palm, knuckleGuard);
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0058, 0.042, 8), this.gloveMaterial);
        finger.rotation.z = Math.PI / 2;
        finger.position.set(isSupportHand ? 0.018 : -0.018, 0.012 - f * 0.010, -0.016 - f * 0.003);
        handGroup.add(finger);
      }
      const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0065, 0.044, 8), this.gloveMaterial);
      thumb.position.set(isSupportHand ? 0.014 : -0.014, 0.026, -0.010);
      thumb.rotation.set(0.4, 0, isSupportHand ? -0.6 : 0.6);
      handGroup.add(thumb);
      model.add(handGroup);

      const length = hand.distanceTo(elbow);
      const dir = elbow.clone().sub(hand).normalize();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, length, 12), this.sleeveMaterial);
      sleeve.position.copy(hand).lerp(elbow, 0.52);
      sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      model.add(sleeve);

      const forearmGuard = new THREE.Mesh(new THREE.BoxGeometry(0.046, length * 0.52, 0.024), this.knuckleMaterial);
      forearmGuard.position.set(isSupportHand ? -0.012 : 0.012, 0, -0.016);
      sleeve.add(forearmGuard);

      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.036, 0.030, 12), this.gloveMaterial);
      cuff.position.copy(hand).lerp(elbow, 0.08);
      cuff.quaternion.copy(sleeve.quaternion);
      model.add(cuff);

      if (isSupportHand) {
        const watchBand = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.040, 0.016, 12), this.knuckleMaterial);
        watchBand.position.copy(hand).lerp(elbow, 0.14);
        watchBand.quaternion.copy(sleeve.quaternion);
        const watchFace = new THREE.Mesh(
          new THREE.CylinderGeometry(0.014, 0.014, 0.005, 12),
          new THREE.MeshBasicMaterial({ color: 0x38d9a9 })
        );
        watchFace.position.set(0.034, 0, -0.012);
        watchFace.rotation.z = Math.PI / 2;
        watchBand.add(watchFace);
        model.add(watchBand);
      }
    }
    model.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.weaponPivot.add(model);
  }

  public spreadAngle(): number {
    const weapon = this.currentWeapon!;
    const [hip, aimed] = SPREAD[weapon.category] || SPREAD.ar;
    let spread = THREE.MathUtils.lerp(hip, aimed, this.ads);
    const speed = Math.hypot(this.controller.velocity.x, this.controller.velocity.z);
    spread *= 1 + Math.min(1.5, speed / 5) * (this.ads > .5 ? .6 : 1.2);
    if (!this.controller.isGrounded) spread *= 2.5;
    if (this.controller.isCrouching) spread *= .75;
    return spread + this.bloom * (this.ads > .5 ? .35 : 1);
  }

  private randomCone(direction: THREE.Vector3, angle: number): THREE.Vector3 {
    if (angle <= 0) return direction.clone();
    const up = Math.abs(direction.y) > .99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(direction, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, direction).normalize();
    const r = Math.sqrt(Math.random()) * Math.tan(angle), a = Math.random() * Math.PI * 2;
    return direction.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(realUp, Math.sin(a) * r).normalize();
  }

  public attemptFire(): void {
    if (!this.controller.enabled || !this.controller.canLock || !this.currentWeapon || this.controller.isDropping || this.controller.isDriving) return;
    if (this.isBusy?.()) return;
    const now = performance.now();
    if (this.isReloading || now < this.readyAt) return;
    const magKey = this.inventorySystem.activeSlot === 1 ? 'primary' : 'secondary';
    if (this.inventorySystem.magAmmo[magKey] <= 0) {
      if (!this.triggerConsumed) { this.soundManager.playDryFire(); this.triggerConsumed = true; this.reload(); }
      return;
    }
    const fireIntervalMs = (60 / this.currentWeapon.fireRate) * 1000;
    if (now - this.lastFireTime < fireIntervalMs) return;
    if (this.fireMode === 'single' && this.triggerConsumed && this.triggerHeld) return;
    this.triggerConsumed = true;

    this.lastFireTime = now;
    this.inventorySystem.magAmmo[magKey]--;
    this.controller.blockSprint(320);
    const weapon = this.currentWeapon;
    const attachments = this.activeAttachments();
    const suppressed = attachments.muzzle === 'muzzle_suppressor';
    this.soundManager.playGunshot(weapon.category, suppressed);

    // Recoil, modified by attachments and aiming.
    let recoilMod = 1.0;
    if (attachments.grip === 'grip_vertical') recoilMod *= 0.8;
    if (attachments.grip === 'grip_angled') recoilMod *= 0.9;
    if (attachments.muzzle === 'muzzle_compensator') recoilMod *= 0.85;
    if (attachments.muzzle === 'muzzle_suppressor') recoilMod *= 0.95;
    if (this.controller.isCrouching) recoilMod *= .85;
    // Camera climb per shot; the view-model kick sells the rest of the force.
    const vertical = weapon.recoil * .42 * recoilMod * (this.ads > .5 ? .8 : 1);
    this.controller.addRecoil(vertical, (Math.random() - .45) * weapon.recoil * recoilMod * .22);
    this.controller.addShake((SHAKE[weapon.category] || .4) * recoilMod);
    this.kick = Math.min(.09, this.kick + .022 + weapon.recoil * .25);
    this.kickRot = Math.min(.25, this.kickRot + weapon.recoil * 1.6);
    this.kickSide = (Math.random() - .5) * weapon.recoil;

    // Aim: camera ray, converged from the operator's eye in third person.
    this.camera.updateMatrixWorld();
    const cameraOrigin = this.camera.getWorldPosition(new THREE.Vector3());
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    let origin = cameraOrigin.clone(), aim = cameraForward.clone();
    if (!this.controller.firstPerson) {
      const skip = cameraOrigin.distanceTo(this.controller.position) + .5;
      const start = cameraOrigin.clone().addScaledVector(cameraForward, skip);
      const target = this.resolveShot?.(start, cameraForward, weapon.range)?.point ?? start.clone().addScaledVector(cameraForward, weapon.range);
      origin = this.controller.position.clone();
      aim = target.sub(origin).normalize();
      if (aim.dot(cameraForward) < .2) aim.copy(cameraForward);
    }
    const spread = this.spreadAngle();
    this.bloom = Math.min(.03, this.bloom + (BLOOM[weapon.category] || 0));
    const direction = this.randomCone(aim, weapon.pellets ? spread * .25 : spread);
    const pellets = weapon.pellets ? Array.from({ length: weapon.pellets }, () => this.randomCone(aim, spread)) : undefined;

    // Visual muzzle in world space.
    let muzzlePos: THREE.Vector3;
    if (this.controller.firstPerson && this.weaponModel) {
      this.viewModelCamera.updateMatrixWorld(true);
      const local = this.weaponModel.getObjectByName('muzzle')!.getWorldPosition(new THREE.Vector3());
      muzzlePos = this.camera.localToWorld(local);
      this.flashUntil = suppressed ? 0 : now + 45;
      this.muzzleFlash.material.rotation = Math.random() * Math.PI;
      this.muzzleFlash.scale.setScalar((weapon.category === 'shotgun' || weapon.category === 'sniper' ? .32 : .22) * (.8 + Math.random() * .4));
      if (!suppressed) this.particleSystem.spawnMuzzleLight(cameraOrigin.clone().addScaledVector(cameraForward, 1));
      this.particleSystem.spawnMuzzleSmoke(muzzlePos, cameraForward);
    } else {
      const tps = this.getThirdPersonMuzzle?.();
      muzzlePos = tps?.position ?? origin.clone().addScaledVector(aim, .8);
      this.particleSystem.spawnMuzzleFlash(muzzlePos, aim, weapon.category === 'shotgun' || weapon.category === 'sniper' ? 1.3 : 1, suppressed);
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.particleSystem.ejectShell(muzzlePos.clone().addScaledVector(aim, -.45), right);

    for (const dir of pellets ?? [direction]) {
      const result = this.resolveShot?.(origin, dir, weapon.range);
      const end = result && result.kind !== 'none' ? result.point : origin.clone().addScaledVector(dir, weapon.range);
      if (!pellets || Math.random() < .5) this.particleSystem.spawnTracer(muzzlePos, end, weapon.category === 'sniper' ? 900 : 650);
      if (result?.kind === 'world') {
        this.particleSystem.spawnImpactSparks(result.point, result.normal, result.surface);
        this.soundManager.playImpact(result.surface === 'soft' ? 'soft' : 'hard', result.distance);
      } else if (result?.kind === 'player') this.particleSystem.spawnBloodHit(result.point, dir, result.headshot);
    }

    this.onFireCallback?.(origin, direction, weapon.id, pellets);
    if (this.inventorySystem.magAmmo[magKey] === 0) window.setTimeout(() => this.reload(), Math.max(120, fireIntervalMs));
  }

  public reload(): void {
    if (!this.controller.enabled || this.isReloading || !this.currentWeapon) return;
    const magKey = this.inventorySystem.activeSlot === 1 ? 'primary' : 'secondary';
    const needed = this.getActiveMagazineCapacity() - this.inventorySystem.magAmmo[magKey];
    if (needed <= 0 || (this.inventorySystem.ammo[this.currentWeapon.ammoType] || 0) <= 0) return;
    const weapon = this.currentWeapon;
    this.isReloading = true;
    this.reloadEmpty = this.inventorySystem.magAmmo[magKey] === 0;
    this.reloadStarted = performance.now();
    this.onReloadCallback?.();
    this.soundManager.playReload(weapon.reloadTime, this.reloadEmpty);

    this.reloadTimer = window.setTimeout(() => {
      if (!this.controller.enabled || this.currentWeapon?.id !== weapon.id || (this.inventorySystem.activeSlot === 1 ? 'primary' : 'secondary') !== magKey) { this.isReloading = false; return; }
      if (!this.serverAuthoritative) {
        const remaining = Math.max(0, this.getActiveMagazineCapacity() - this.inventorySystem.magAmmo[magKey]);
        const amount = Math.min(remaining, this.inventorySystem.ammo[weapon.ammoType] || 0);
        this.inventorySystem.ammo[weapon.ammoType] -= amount;
        this.inventorySystem.magAmmo[magKey] += amount;
      }
      this.isReloading = false;
    }, weapon.reloadTime * 1000);
  }

  public cancelReload(): void { window.clearTimeout(this.reloadTimer); this.isReloading = false; }

  public getActiveMagazineCapacity(): number {
    if (!this.currentWeapon) return 0;
    const slot = this.inventorySystem.activeSlot === 1 ? this.inventorySystem.attachments.primary : this.inventorySystem.attachments.secondary;
    return Math.round(this.currentWeapon.magazineSize * (slot.mag === 'mag_extended' ? 1.5 : 1));
  }

  public get isMagnifiedOptic(): boolean {
    const optic = this.activeAttachments().optic;
    return !!optic && !['optic_reddot', 'optic_holo'].includes(optic);
  }

  public update(delta: number): void {
    const auto = this.fireMode === 'auto' && (this.currentWeapon?.category === 'ar' || this.currentWeapon?.category === 'smg');
    if (this.triggerHeld && auto) this.attemptFire();
    const now = performance.now();
    this.bloom = Math.max(0, this.bloom - delta * .06);

    const travel = Math.hypot(this.controller.position.x - this.lastPosition.x, this.controller.position.z - this.lastPosition.z);
    this.lastPosition.copy(this.controller.position);
    const moving = travel > .004 && this.controller.isGrounded;
    const sprinting = moving && this.controller.isSprinting && !this.isReloading;
    this.motionTime += delta * (sprinting ? 13 : moving ? 9 : 1.2);
    this.ads = THREE.MathUtils.damp(this.ads, this.controller.isScoped && !this.isReloading && !sprinting ? 1 : 0, 14, delta);
    this.sprintBlend = THREE.MathUtils.damp(this.sprintBlend, sprinting && !this.controller.isScoped ? 1 : 0, 9, delta);

    // Look sway: the weapon lags behind fast mouse movement.
    const dYaw = THREE.MathUtils.euclideanModulo(this.controller.yaw - this.lastYaw + Math.PI, Math.PI * 2) - Math.PI;
    const dPitch = this.controller.pitch - this.lastPitch;
    this.lastYaw = this.controller.yaw; this.lastPitch = this.controller.pitch;
    const swayScale = (this.reducedMotion ? .3 : 1) * (1 - this.ads * .8);
    this.sway.x = THREE.MathUtils.damp(this.sway.x, THREE.MathUtils.clamp(dYaw * 2.2, -.08, .08) * swayScale, 8, delta);
    this.sway.y = THREE.MathUtils.damp(this.sway.y, THREE.MathUtils.clamp(-dPitch * 2.2, -.06, .06) * swayScale, 8, delta);

    const bobAmount = this.reducedMotion ? 0 : (moving ? (sprinting ? 1 : .55) : .12) * (1 - this.ads * .85);
    const bobX = Math.sin(this.motionTime) * .011 * bobAmount;
    const bobY = -Math.abs(Math.cos(this.motionTime)) * .012 * bobAmount;

    // Reload choreography: tilt, magazine out, new magazine in, charge.
    const reload = this.reloadProgress;
    let reloadTilt = 0, magDrop = 0, chargeJerk = 0;
    if (reload !== null) {
      reloadTilt = Math.sin(Math.min(1, reload / .92) * Math.PI);
      if (reload < .14) magDrop = 0;
      else if (reload < .3) magDrop = (reload - .14) / .16;
      else if (reload < .45) magDrop = 1.6;
      else if (reload < .6) magDrop = 1 - (reload - .45) / .15;
      if (this.reloadEmpty && reload > .74 && reload < .9) chargeJerk = Math.sin((reload - .74) / .16 * Math.PI);
    }
    if (this.magazine) {
      this.magazine.position.y = -.045 - Math.min(1, magDrop) * .32;
      this.magazine.visible = magDrop < 1.2;
    }
    if (this.bolt) {
      this.bolt.position.z = Math.min(0.055, this.kick * 0.65 + chargeJerk * 0.048);
    }
    const equip = THREE.MathUtils.clamp((now - this.equipStarted) / 450, 0, 1);
    const equipDrop = 1 - (1 - (1 - equip) * (1 - equip));

    // Recoil springs.
    this.kick = THREE.MathUtils.damp(this.kick, 0, 16, delta);
    this.kickRot = THREE.MathUtils.damp(this.kickRot, 0, 12, delta);
    this.kickSide = THREE.MathUtils.damp(this.kickSide, 0, 12, delta);

    const sight = (this.weaponModel?.userData.sightHeight as number) ?? .12;
    const hip = new THREE.Vector3(.15, -.2, -.47), aimed = new THREE.Vector3(0, -sight, -.34);
    this.weaponPivot.position.lerpVectors(hip, aimed, this.ads);
    this.weaponPivot.position.x += bobX + this.sway.x * .5 + this.sprintBlend * .03;
    this.weaponPivot.position.y += bobY + this.sway.y * .5 - reloadTilt * .06 - equipDrop * .25 - this.sprintBlend * .03;
    this.weaponPivot.position.z += this.kick + chargeJerk * .03;
    this.weaponPivot.rotation.set(
      this.kickRot * (1 - this.ads * .6) - reloadTilt * .25 - equipDrop * .9 - this.sprintBlend * .35 + this.sway.y,
      this.sway.x + this.sprintBlend * .75 + this.kickSide,
      reloadTilt * .55 + bobX * 2 + this.sprintBlend * .25
    );
    this.muzzleFlash.visible = now < this.flashUntil;
    if (this.weaponModel) this.weaponModel.visible = !(this.ads > .85 && this.isMagnifiedOptic);
    this.viewModelCamera.fov = THREE.MathUtils.lerp(54, 40, this.ads);
    this.viewModelCamera.updateProjectionMatrix();

    // Scoped FOV for the world camera.
    const optic = this.activeAttachments().optic;
    this.controller.scopedFOV = optic === 'optic_2x' ? 38 : optic === 'optic_4x' ? 21 : optic === 'optic_6x' ? 14 : optic === 'optic_8x' ? 10 : 58;
    this.controller.scopeForcesFirstPerson = this.isMagnifiedOptic;

    this.particleSystem.update(delta);
  }

  public resize(aspect: number): void { this.viewModelCamera.aspect = aspect; this.viewModelCamera.updateProjectionMatrix(); }
}
