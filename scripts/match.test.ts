import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { RoomManager } from '../server/RoomManager';
import { GameLoop } from '../server/GameLoop';
import { WEAPONS } from '../src/shared/constants';
import { CombatSystem } from '../src/client/game/CombatSystem';

const socket = () => ({ readyState: WebSocket.OPEN, send() {} }) as unknown as WebSocket;
const manager = new RoomManager();
const {room,playerId} = manager.createRoom(socket(),'Host','#617a72',true);
const friend = manager.joinRoom(socket(),room.code,'Friend','#617a72')!;
const rival = manager.joinRoom(socket(),room.code,'Rival','#617a72')!;
const host=room.players.get(playerId)!.state, victim=room.players.get(friend.playerId)!.state, attacker=room.players.get(rival.playerId)!.state;
attacker.squadId='enemy'; victim.armor=0;
const game = new GameLoop(room,()=>{});
const simulation = game as any;
simulation.applyDamage(victim,attacker,150,'Viper AR',false);
assert.equal(victim.isDowned,true);
assert.equal(attacker.kills,0,'Downing does not count as an elimination');
simulation.updatePlayers(26);
assert.equal(victim.isEliminated,true);
assert.equal(attacker.kills,1,'Bleed-out credits the original attacker');

victim.isEliminated=false;victim.isDowned=false;victim.health=100;victim.position={...host.position};
simulation.applyDamage(victim,attacker,150,'Viper AR',false);
game.handleClientInput(host.id,{type:'REVIVE_PLAYER',targetPlayerId:victim.id});
assert.equal(victim.health,40);assert.equal(victim.isDowned,false);
assert.equal(simulation.downedBy.has(victim.id),false,'Revive clears stale kill attribution');

// A vehicle sweeping through an enemy between two sync packets hits them once.
victim.health=100;victim.armor=50;victim.isDowned=false;victim.vehicleId=null;victim.isDropping=false;
attacker.position={x:0,y:1.7,z:0};victim.position={x:5,y:1.7,z:.6};
simulation.runOverCheck(attacker,{x:0,z:0},{x:10,z:0},22);
assert.equal(victim.isDowned,true,'A 22 m/s vehicle impact downs an armored operator');
const hpAfterHit=victim.health;simulation.runOverCheck(attacker,{x:0,z:0},{x:10,z:0},22);
assert.equal(victim.health,hpAfterHit,'Impact cooldown prevents repeat hits');

// Test the full circle lifecycle without a running interval or players taking storm damage.
room.players.clear();
for(let i=0;i<5;i++){
  const duration=game.zone.phaseDuration,target=game.zone.targetRadius;
  simulation.updateZone(duration/2);assert.equal(game.zone.isShrinking,false);
  simulation.updateZone(duration/4);assert.equal(game.zone.isShrinking,true);
  const halfway=game.zone.currentRadius;assert.ok(halfway>target);
  simulation.updateZone(duration/4);assert.equal(game.zone.currentRadius,target,'Circle reaches its announced target exactly');
  assert.ok(game.zone.phaseTimer>=0);
}
simulation.updateZone(60);assert.equal(game.zone.phaseTimer,0);assert.equal(game.zone.currentRadius,0);
assert.equal(game.supplyDrops.length,1);
for(const loot of game.supplyDrops[0].loot){assert.ok(simulation.lootManager.lootItems.has(loot.id));assert.equal(loot.position.z,game.supplyDrops[0].position.z);}

// Exercise the actual client reload method under a controlled timer, without WebGL.
let finishReload:()=>void=()=>{};
Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:(fn:()=>void)=>{finishReload=fn;return 1;}}});
const combat=Object.create(CombatSystem.prototype) as any;
combat.controller={enabled:true};combat.soundManager={playReload(){}};combat.currentWeapon=WEAPONS.viper_ar;
combat.inventorySystem={activeSlot:1,magAmmo:{primary:20,secondary:0},ammo:{'Rifle Ammo':90},attachments:{primary:{mag:null}}};
combat.serverAuthoritative=true;combat.isReloading=false;
combat.reload();combat.inventorySystem.magAmmo.primary=30;combat.inventorySystem.ammo['Rifle Ammo']=80;finishReload();
assert.equal(combat.inventorySystem.magAmmo.primary,30,'Online reload must not add ammo a second time');
assert.equal(combat.inventorySystem.ammo['Rifle Ammo'],80);
combat.serverAuthoritative=false;combat.inventorySystem.magAmmo.primary=20;combat.reload();finishReload();
assert.equal(combat.inventorySystem.magAmmo.primary,30);assert.equal(combat.inventorySystem.ammo['Rifle Ammo'],70);
console.log('PASS: bleed-out credit, revive reset, vehicle run-over, all zone phases, final timer, collectible supply drops, online/offline reload reconciliation');
