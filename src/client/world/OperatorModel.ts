import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createWeaponModel, disposeObject } from './WeaponModel';
import { WeaponId } from '../../shared/types';
import { FxTextures } from '../game/ParticleSystem';

let source: ReturnType<GLTFLoader['loadAsync']> | undefined;

export type OperatorPose = 'ground' | 'freefall' | 'parachute' | 'driving' | 'swimming' | 'downed' | 'dead';

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpQ3 = new THREE.Quaternion();
const ikShoulder = new THREE.Vector3(), ikElbow = new THREE.Vector3(), ikWrist = new THREE.Vector3(), ikDir = new THREE.Vector3(), ikBend = new THREE.Vector3(), ikElbowTarget = new THREE.Vector3(), ikHand = new THREE.Vector3();
const gripLocal = new THREE.Vector3(), guardLocal = new THREE.Vector3(), poleR = new THREE.Vector3(), poleL = new THREE.Vector3();

/** Rotate `bone` (in world space) so the direction to `child` points at `target`. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  const from = child.getWorldPosition(tmpA).sub(bone.getWorldPosition(tmpB)).normalize();
  const to = tmpC.copy(target).sub(tmpB).normalize();
  if (from.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) return;
  const delta = tmpQ.setFromUnitVectors(from, to);
  const worldQ = bone.getWorldQuaternion(tmpQ2);
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(tmpQ3) : tmpQ3.identity();
  bone.quaternion.copy(parentQ.invert().multiply(delta.multiply(worldQ)));
  bone.updateMatrixWorld(true);
}

/** Analytic two-bone IK: places the hand at `target`, bending the elbow toward `pole`. */
function solveArm(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  const shoulder = upper.getWorldPosition(ikShoulder);
  const elbow = lower.getWorldPosition(ikElbow);
  const wrist = hand.getWorldPosition(ikWrist);
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
  const toTarget = ikDir.copy(target).sub(shoulder);
  const c = THREE.MathUtils.clamp(toTarget.length(), Math.abs(a - b) + .01, a + b - .005);
  const dir = toTarget.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
  const bend = ikBend.copy(pole).sub(shoulder);
  bend.addScaledVector(dir, -bend.dot(dir)).normalize();
  const elbowTarget = ikElbowTarget.copy(shoulder).addScaledVector(dir, a * cosA).addScaledVector(bend, a * Math.sqrt(1 - cosA * cosA));
  const handTarget = ikHand.copy(shoulder).addScaledVector(dir, c);
  aimBone(upper, lower, elbowTarget);
  aimBone(lower, hand, handTarget);
}

export class OperatorModel extends THREE.Group {
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private active = '';
  private bodyScale = new THREE.Vector3(1,1,1);
  private body?: THREE.Object3D;
  private bones: Record<string, THREE.Object3D> = {};
  private equipment = new THREE.Group();
  private rifle?: THREE.Group;
  private rig = new THREE.Group();
  private parachute?: THREE.Group;
  private flash: THREE.Sprite;
  private flashUntil = 0;
  private cloth = '#617a72';
  private skin = '#c99672';
  private outfit = 'field';
  private weapon: WeaponId = 'viper_ar';
  private optic = 'optic_reddot';
  private deathTime = 0;
  private deathSide = 1;
  public pose: OperatorPose = 'ground';
  /** Distant operators skip arm IK. */
  public detailed = true;
  private castsShadow = true;
  public setShadow(enabled: boolean): void {
    if (enabled === this.castsShadow) return;
    this.castsShadow = enabled;
    this.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = enabled; });
  }
  public aimPitch = 0;
  public ready: Promise<void>;
  constructor(){
    super();
    this.add(this.rig);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: FxTextures.get('muzzle'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false; this.flash.scale.setScalar(.5);
    source ??= new GLTFLoader().loadAsync('/assets/soldier.glb');
    this.ready=source.then(gltf=>{
      const body=clone(gltf.scene);
      body.scale.setScalar(.995);
      this.bodyScale.copy(body.scale);
      this.rig.add(body);this.body=body;
      body.traverse(o=>{
        if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;o.material=(o.material as THREE.MeshStandardMaterial).clone();}
        const name=o.name.replace('mixamorig:','').replace('mixamorig','');
        if((o as THREE.Bone).isBone)this.bones[name]=o;
      });
      this.mixer=new THREE.AnimationMixer(body);
      for(const clip of gltf.animations)this.actions[clip.name]=this.mixer.clipAction(clip);
      this.rig.add(this.equipment);
      this.applyAppearance();this.setWeapon(this.weapon,this.optic);this.update(0,0);
    }).catch(error=>{console.error('Operator model failed to load',error);});
  }
  public setAppearance(color:string,skin='#c99672',outfit='field'){
    this.cloth=color;this.skin=skin;this.outfit=outfit;this.applyAppearance();
  }
  private applyAppearance(){
    this.body?.traverse(o=>{
      if(!(o instanceof THREE.Mesh))return;
      const mat=o.material as THREE.MeshStandardMaterial;
      if(mat.name.includes('Visor')){
        mat.color.set(0x182629);
        mat.roughness = 0.14;
        mat.metalness = 0.86;
        mat.needsUpdate = true;
        return;
      }
      mat.color.set(0xffffff);
      mat.roughness = 0.52;
      mat.metalness = 0.18;
      mat.userData.clothColor ??= { value: new THREE.Color(this.cloth) };
      mat.userData.clothColor.value.set(this.cloth);
      mat.userData.skinColor ??= { value: new THREE.Color(this.skin) };
      mat.userData.skinColor.value.set(this.skin);
      mat.onBeforeCompile = shader => {
        shader.uniforms.operatorSkin = mat.userData.skinColor;
        shader.uniforms.operatorCloth = mat.userData.clothColor;
        shader.vertexShader = 'varying vec3 operatorPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\noperatorPosition = transformed;');
        shader.fragmentShader = 'varying vec3 operatorPosition; uniform vec3 operatorSkin; uniform vec3 operatorCloth;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
vec3 baseTex = texture2D(map, vMapUv).rgb;
float luma = dot(baseTex, vec3(.299, .587, .114));
float ao = smoothstep(0.02, 0.28, luma);
float warmPlate = smoothstep(0.01, 0.12, baseTex.r - baseTex.b) * smoothstep(0.08, 0.24, luma);
vec3 darkGear = vec3(0.11, 0.12, 0.12) * (0.35 + luma * 1.45);
vec3 plateCol = operatorCloth * (0.28 + pow(luma, 0.85) * 1.35);
vec3 suitCol = mix(darkGear, plateCol, warmPlate * 0.88 + 0.12);
suitCol *= mix(0.42, 1.0, ao);
float skinZone = smoothstep(150.0, 155.0, operatorPosition.z) * (1.0 - smoothstep(171.0, 176.0, operatorPosition.z)) * (1.0 - smoothstep(9.5, 12.0, abs(operatorPosition.x)));
float skinToneMask = skinZone * smoothstep(0.01, 0.08, baseTex.r - baseTex.g) * smoothstep(0.16, 0.30, luma);
diffuseColor.rgb = mix(suitCol, operatorSkin * (0.45 + luma * 1.05), skinToneMask);
#endif`);
      };
      mat.customProgramCacheKey = () => 'operator-skin-v2';
      mat.needsUpdate=true;
    });
    disposeObject(this.equipment);
    this.equipment.clear();
    const packMat = new THREE.MeshStandardMaterial({ color: this.cloth, roughness: 0.72, metalness: 0.12 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x222826, roughness: 0.55, metalness: 0.35 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x3b4441, roughness: 0.38, metalness: 0.65 });
    if(this.outfit!=='scout'){
      const h = this.outfit==='armor' ? 0.38 : 0.30;
      const pack=new THREE.Mesh(new THREE.BoxGeometry(0.28, h, 0.13), packMat);
      pack.position.set(0, 1.23, 0.17); pack.castShadow=true; this.equipment.add(pack);
      const flap=new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.07, 0.145), trimMat);
      flap.position.set(0, 1.23 + h * 0.42, 0.17); flap.castShadow=true; this.equipment.add(flap);
      const pouchL=new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.06), trimMat);
      pouchL.position.set(-0.07, 1.18, 0.245); this.equipment.add(pouchL);
      const pouchR=new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.06), trimMat);
      pouchR.position.set(0.07, 1.18, 0.245); this.equipment.add(pouchR);
      const roll=new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.28, 10), trimMat);
      roll.rotation.z = Math.PI / 2; roll.position.set(0, 1.23 - h * 0.52, 0.17); this.equipment.add(roll);
      const antenna=new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.34, 6), metalMat);
      antenna.position.set(0.11, 1.23 + h * 0.5 + 0.15, 0.15); this.equipment.add(antenna);
    } else {
      const camel=new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.24, 0.075), trimMat);
      camel.position.set(0, 1.25, 0.15); camel.castShadow=true; this.equipment.add(camel);
    }
    if(this.outfit==='armor'){
      for(const x of [-.24,.24]){
        const plate=new THREE.Mesh(new THREE.BoxGeometry(.13,.15,.22), metalMat);
        plate.position.set(x, 1.42, -0.01); plate.rotation.z = x < 0 ? 0.18 : -0.18;
        plate.castShadow = true; this.equipment.add(plate);
      }
      for(const x of [-0.09, 0, 0.09]){
        const magPouch=new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.11, 0.045), trimMat);
        magPouch.position.set(x, 1.14, -0.155); this.equipment.add(magPouch);
      }
    }
  }
  public setWeapon(id:WeaponId,optic='optic_reddot'){
    this.weapon=id;this.optic=optic;
    if(this.rifle){this.flash.removeFromParent();this.rig.remove(this.rifle);disposeObject(this.rifle);}
    this.rifle=createWeaponModel(id,{optic});
    this.rifle.getObjectByName('muzzle')?.add(this.flash);
    this.rig.add(this.rifle);
  }

  /** Flash the muzzle of this operator's weapon. */
  public fire(): void { this.flashUntil = performance.now() + 50; this.flash.material.rotation = Math.random() * Math.PI; }

  public getMuzzle(): { position: THREE.Vector3; direction: THREE.Vector3 } | null {
    const muzzle = this.rifle?.getObjectByName('muzzle');
    if (!muzzle || !this.visible) return null;
    this.updateMatrixWorld(true);
    const position = muzzle.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rifle!.getWorldQuaternion(new THREE.Quaternion()));
    return { position, direction };
  }

  public setPose(pose: OperatorPose): void {
    if (pose === this.pose) return;
    if (pose === 'dead') { this.deathTime = performance.now(); this.deathSide = Math.random() < .5 ? -1 : 1; }
    this.pose = pose;
  }

  /**
   * Square ram-air canopy: an arched wing made of alternating cells, with
   * suspension lines fanning from its underside to two risers at the shoulders.
   */
  private ensureParachute(): THREE.Group {
    if (this.parachute) return this.parachute;
    const chute = new THREE.Group();
    const canopy = new THREE.Group();
    const span = 7.2, chord = 2.7, thickness = .42, radius = 5.2, cells = 9, height = 6.4;
    const geometry = new THREE.BoxGeometry(span, thickness, chord, cells * 4, 1, 6);
    const pos = geometry.attributes.position, colors = new Float32Array(pos.count * 3);
    const olive = new THREE.Color(0x5d6a48), tan = new THREE.Color(0xc79a58), dark = new THREE.Color(0x4a5539);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Bend the flat wing into an arc and give it an aerofoil: thicker at the leading edge.
      const a = x / radius;
      const profile = 1 - ((z / chord) + .5) * .6;
      pos.setXYZ(i, Math.sin(a) * (radius + y * profile), Math.cos(a) * (radius + y * profile) - radius, z);
      const cell = Math.floor((x / span + .5) * cells);
      const c = y < 0 ? dark : cell === Math.floor(cells / 2) || cell === 0 || cell === cells - 1 ? tan : olive;
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const wing = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, side: THREE.DoubleSide }));
    wing.castShadow = true;
    canopy.add(wing);
    canopy.position.y = height;
    chute.add(canopy);
    // Suspension lines: several attachment points along the underside, front and back, to each riser.
    const points: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const x = (i / 6 - .5) * span * .92, a = x / radius;
      const px = Math.sin(a) * (radius - thickness / 2), py = Math.cos(a) * (radius - thickness / 2) - radius + height;
      const riserX = x < 0 ? -.24 : .24;
      for (const z of [-chord * .38, chord * .3]) points.push(px, py, z, riserX, 2.05, z * .05);
    }
    points.push(-.24, 2.05, 0, -.2, 1.5, 0, .24, 2.05, 0, .2, 1.5, 0);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    chute.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0x1e211c, transparent: true, opacity: .8 })));
    chute.userData.canopy = canopy;
    chute.visible = false;
    this.parachute = chute; this.add(chute);
    return chute;
  }

  /** Turn rate while dropping (rad/s); banks the body and canopy into turns. */
  public bank = 0;
  private chuteBlend = 0;

  private updateParachute(delta: number): void {
    const open = this.pose === 'parachute';
    if (!open && !this.parachute) return;
    const chute = this.ensureParachute();
    // Inflate quickly with a slight overshoot; collapse and sink after landing.
    // Quick collapse on landing so the canopy never drapes over the camera.
    this.chuteBlend = THREE.MathUtils.damp(this.chuteBlend, open ? 1 : 0, open ? 4.5 : 9, delta);
    chute.visible = open ? this.chuteBlend > .02 : this.chuteBlend > .3;
    if (!chute.visible) return;
    const canopy = chute.userData.canopy as THREE.Group;
    const b = this.chuteBlend, overshoot = open ? 1 + Math.sin(Math.min(1, b) * Math.PI) * .08 : 1;
    canopy.scale.set(Math.max(.15, b) * overshoot, Math.max(.3, b), Math.max(.2, b) * overshoot);
    canopy.position.y = 6.4 - (1 - b) * (open ? 2.5 : 4);
    chute.rotation.z = THREE.MathUtils.damp(chute.rotation.z, open ? THREE.MathUtils.clamp(-this.bank * .35, -.35, .35) : .6, 3, delta);
    chute.rotation.x = open ? Math.sin(performance.now() / 900) * .03 : THREE.MathUtils.damp(chute.rotation.x, -.8, 2, delta);
  }

  public update(delta:number,speed:number,crouching=false,grounded=true){
    const now = performance.now();
    const ground = this.pose === 'ground';
    const swimming = this.pose === 'swimming';
    const next = this.pose === 'dead' || this.pose === 'downed' || this.pose === 'driving' ? 'Idle'
      : swimming ? (speed > .4 ? 'Run' : 'Idle')
      : this.pose !== 'ground' ? 'TPose' : grounded && speed > .4 ? speed > 6 ? 'Run' : 'Walk' : 'Idle';
    if(next!==this.active&&this.actions[next]){
      this.actions[this.active]?.fadeOut(.2);this.actions[next].reset().fadeIn(.2).play();this.active=next;
    }
    if(this.actions[next])this.actions[next].timeScale=swimming?(speed>.4?0.85:0.45):next==='Run'?Math.min(1.5,speed/6.5):next==='Walk'?Math.min(1.4,speed/2.4):1;
    this.mixer?.update(delta);

    // Whole-body pose transforms.
    let tilt = 0, roll = 0, drop = 0;
    if (this.pose === 'freefall') tilt = -1.35;
    else if (swimming) {
      const stroke = now * 0.0055;
      tilt = speed > 0.35 ? -1.12 : -0.45;
      roll = speed > 0.35 ? Math.sin(stroke) * 0.16 : Math.sin(stroke * 0.5) * 0.05;
      drop = speed > 0.35 ? -0.95 : -0.65;
    } else if (this.pose === 'dead') {
      const t = Math.min(1, (now - this.deathTime) / 650);
      const ease = t * t * (3 - 2 * t);
      tilt = ease * 1.45; roll = ease * .25 * this.deathSide;
    } else if (this.pose === 'downed') { tilt = .9; drop = -.55; }
    // Lean into turns while skydiving; swing gently under canopy.
    if (this.pose === 'freefall') roll = THREE.MathUtils.clamp(-this.bank * .3, -.5, .5);
    if (this.pose === 'parachute') { roll = THREE.MathUtils.clamp(-this.bank * .25, -.3, .3); tilt = .08; }
    this.rig.rotation.x = THREE.MathUtils.damp(this.rig.rotation.x, tilt, this.pose === 'dead' ? 30 : 8, delta);
    this.rig.rotation.z = THREE.MathUtils.damp(this.rig.rotation.z, roll, 8, delta);
    this.rig.position.y = THREE.MathUtils.damp(this.rig.position.y, drop + (this.pose === 'freefall' ? 1 : 0), 8, delta);
    this.updateParachute(delta);

    if(this.body){
      const crouch = crouching && ground;
      this.body.position.y = THREE.MathUtils.damp(this.body.position.y, crouch ? -.32 : 0, 12, delta);
      this.body.scale.y = THREE.MathUtils.damp(this.body.scale.y, this.bodyScale.y * (crouch ? .8 : 1), 12, delta);
    }
    this.equipment.position.y = this.body?.position.y ?? 0;

    if(this.rifle && this.body){
      const armed = ground || this.pose === 'downed';
      this.rifle.visible = this.pose !== 'driving' && this.pose !== 'dead' && this.pose !== 'freefall' && this.pose !== 'parachute' && !swimming;
      // Rifle held at the shoulder and pitched with aim; the arms follow via IK.
      const shoulderY = 1.42 + (this.body.position.y) * 1.1 - (crouching && ground ? .05 : 0);
      const sprint = ground && speed > 6;
      const pitch = armed ? THREE.MathUtils.clamp(this.aimPitch, -1, 1) : 0;
      // Pivot around the butt in the shoulder pocket: raising or lowering the
      // gun moves the muzzle, while the stock stays against the shoulder.
      this.rifle.rotation.set(sprint ? -.5 : pitch, sprint ? .55 : 0, sprint ? .15 : 0);
      this.rifle.position.set(.13, shoulderY - .08 - (sprint ? .12 : 0), .26);
      this.rifle.translateZ(-.36);
      if (this.pose === 'parachute') { this.rifle.position.set(.18, 1.1, .12); this.rifle.rotation.set(-1.2, 0, .4); }

      const b = this.bones;
      const arms = b.RightArm && b.RightForeArm && b.RightHand && b.LeftArm && b.LeftForeArm && b.LeftHand;
      // Arm IK is only worth its cost when the operator is close enough to see the hands.
      if (arms && this.detailed) {
        this.updateMatrixWorld(true);
        if (this.rifle.visible) {
          const front = this.rifle.getObjectByName('muzzle')!.position.z;
          const gripWorld = this.rifle.localToWorld(gripLocal.set(0, -.08, .085));
          const guardWorld = this.rifle.localToWorld(guardLocal.set(-.01, -.03, Math.max(front + .28, -.4)));
          // Spine follows aim pitch slightly so the upper body leans into the shot.
          if (b.Spine1 && armed) { b.Spine1.rotation.x += -pitch * .35; b.Spine1.updateMatrixWorld(true); }
          solveArm(b.RightArm, b.RightForeArm, b.RightHand, gripWorld, this.localToWorld(poleR.set(.6, .6, .4)));
          solveArm(b.LeftArm, b.LeftForeArm, b.LeftHand, guardWorld, this.localToWorld(poleL.set(-.6, .7, -.1)));
        } else if (swimming) {
          const stroke = now * 0.0065;
          const rReach = Math.sin(stroke) * 0.36;
          const lReach = Math.sin(stroke + Math.PI) * 0.36;
          solveArm(b.RightArm, b.RightForeArm, b.RightHand, this.rig.localToWorld(gripLocal.set(.42 + Math.max(0, -rReach) * .25, 1.55 + rReach, .25 + Math.cos(stroke) * .22)), this.rig.localToWorld(poleR.set(.85, 1.3, .45)));
          solveArm(b.LeftArm, b.LeftForeArm, b.LeftHand, this.rig.localToWorld(guardLocal.set(-.42 - Math.max(0, -lReach) * .25, 1.55 + lReach, .25 + Math.cos(stroke + Math.PI) * .22)), this.rig.localToWorld(poleL.set(-.85, 1.3, .45)));
        } else if (this.pose === 'parachute') {
          solveArm(b.RightArm, b.RightForeArm, b.RightHand, this.localToWorld(gripLocal.set(.26, 2.02, .04)), this.localToWorld(poleR.set(1, 1.4, .3)));
          solveArm(b.LeftArm, b.LeftForeArm, b.LeftHand, this.localToWorld(guardLocal.set(-.26, 2.02, .04)), this.localToWorld(poleL.set(-1, 1.4, .3)));
        } else if (this.pose === 'freefall') {
          solveArm(b.RightArm, b.RightForeArm, b.RightHand, this.rig.localToWorld(gripLocal.set(.75, 1.75, -.15)), this.rig.localToWorld(poleR.set(.8, 1.4, .5)));
          solveArm(b.LeftArm, b.LeftForeArm, b.LeftHand, this.rig.localToWorld(guardLocal.set(-.75, 1.75, -.15)), this.rig.localToWorld(poleL.set(-.8, 1.4, .5)));
        }
      }
    }
    this.flash.visible = now < this.flashUntil;
  }
}
