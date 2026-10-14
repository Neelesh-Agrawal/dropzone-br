import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CombatSystem } from '../src/client/game/CombatSystem';
import { createWeaponModel } from '../src/client/world/WeaponModel';
import { zoneAtTime, zoneStageSeconds } from '../src/shared/zone';
import { ZONE_PHASES } from '../src/shared/constants';
import { getTerrainHeight } from '../src/shared/terrain';
import { readFileSync } from 'node:fs';
const combat: any=Object.create(CombatSystem.prototype);
Object.assign(combat,{controller:{enabled:false},weaponMeshGroup:new THREE.Group(),muzzleFlashLight:new THREE.PointLight()});
combat.setThirdPersonView(false);assert.equal(combat.weaponMeshGroup.visible,false);
combat.controller.enabled=true;combat.setThirdPersonView(false);assert.equal(combat.weaponMeshGroup.visible,true);
combat.setThirdPersonView(true);assert.equal(combat.weaponMeshGroup.visible,false);
const sizes=['rook_smg','viper_ar','longbow'].map(id=>new THREE.Box3().setFromObject(createWeaponModel(id as any)).getSize(new THREE.Vector3()).z);
assert.ok(sizes[0]<sizes[1]&&sizes[1]<sizes[2], 'Weapon selections have distinct physical silhouettes');
const bytes=readFileSync('public/assets/soldier.glb');const model=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
for(const name of ['Idle','Walk','Run'])assert.ok(model.animations.some((clip:any)=>clip.name===name));
assert.ok(model.skins.length>0,'Operator must be a skeletal model');
let elapsed=0;
for(const phase of ZONE_PHASES){
 const hold=zoneAtTime(elapsed+phase.durationSeconds*.25);assert.equal(hold.isShrinking,false);assert.equal(hold.currentRadius,phase.radius);
 const closing=zoneAtTime(elapsed+phase.durationSeconds*.75);assert.equal(closing.isShrinking,true);assert.ok(closing.currentRadius<phase.radius);
 assert.ok(zoneStageSeconds(hold)>0);elapsed+=phase.durationSeconds;
}
assert.ok(elapsed>=1200);assert.equal(zoneAtTime(60).dps,.25);
assert.ok(Math.abs(getTerrainHeight(-1570,-1170)-getTerrainHeight(-1570,-1150))<.01,'Town road and walking surface are level');
console.log('PASS: skeletal model, distinct weapons, FPS/TPS visibility, every zone hold/shrink, gentle damage and town ground');
