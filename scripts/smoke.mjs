import WebSocket from 'ws';
import assert from 'node:assert/strict';

const url = process.env.DROPZONE_WS_URL || 'ws://127.0.0.1:8080/ws';
const connect = () => new Promise((resolve,reject)=>{const socket=new WebSocket(url);socket.once('open',()=>resolve(socket));socket.once('error',reject);});
const send=(s,p)=>s.send(JSON.stringify(p));
const waitFor=(socket,predicate,ms=6000)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off('message',listener);reject(new Error('Timed out waiting for packet'));},ms);
  const listener=data=>{const p=JSON.parse(data);if(predicate(p)){clearTimeout(timer);socket.off('message',listener);resolve(p);}};socket.on('message',listener);
});
const input=(position)=>({type:'PLAYER_INPUT',position,rotation:{yaw:0,pitch:0},velocity:{x:0,y:0,z:0},isSprinting:false,isCrouching:false,isDropping:false});

for(const cooperative of [true,false]){
  const host=await connect(),guest=await connect();
  try {
    const created=waitFor(host,p=>p.type==='ROOM_JOINED');
    send(host,{type:'CREATE_ROOM',playerName:'TestHost',characterColor:'#617a72',isSquad:cooperative,startingSecondaryWeapon:'rook_smg'});
    const room=await created;
    const joined=waitFor(guest,p=>p.type==='ROOM_JOINED');
    send(guest,{type:'JOIN_ROOM',roomCode:room.roomCode,playerName:'TestGuest',characterColor:'#617a72'});
    const friend=await joined;
    assert.equal(room.players[0].squadId===friend.players.find(p=>p.id===friend.playerId).squadId,cooperative);
    const pong=waitFor(host,p=>p.type==='PONG');send(host,{type:'PING',sentAt:123});assert.equal((await pong).sentAt,123);
    const start=waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT');send(host,{type:'START_MATCH'});
    const first=await start;assert.equal(first.players.length,50);
    const pos=first.players.find(p=>p.id===room.playerId).position;
    send(host,input(pos));send(guest,input({x:pos.x+5,y:pos.y,z:pos.z}));
    await waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT'&&!p.players.find(x=>x.id===room.playerId).isDropping&&Math.abs(p.players.find(x=>x.id===friend.playerId).position.x-pos.x-5)<.01);
    const shot={type:'FIRE_WEAPON',origin:pos,direction:{x:1,y:0,z:0},weaponId:'viper_ar'};
    const after=waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT'&&p.players.find(x=>x.id===room.playerId).magAmmo.primary===29);
    send(host,shot);send(host,shot); // Duplicate shot cannot bypass fire rate.
    const result=await after, victim=result.players.find(p=>p.id===friend.playerId);
    assert.equal(victim.health<100,!cooperative,'Friendly fire or opposing hit rule failed');
    assert.equal(result.players.find(p=>p.id===room.playerId).magAmmo.primary,29);
    const reloaded=waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT'&&p.players.find(x=>x.id===room.playerId).magAmmo.primary===30);
    send(host,{type:'RELOAD'});
    const during=await waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT');assert.equal(during.players.find(p=>p.id===room.playerId).magAmmo.primary,29,'Reload completed instantly');
    await reloaded;
    const swapped=waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT'&&p.players.find(x=>x.id===room.playerId).activeSlot===2);send(host,{type:'SWAP_WEAPON',slot:2});
    assert.equal((await swapped).players.find(p=>p.id===room.playerId).equippedWeapon,'rook_smg');
    // Loot is only resent when it changes (and every few seconds), so read it from the first snapshot.
    assert.ok(Array.isArray(first.loot) && first.loot.length>0,'First snapshot must carry the loot table');
    const lootCount=first.loot.length;
    send(host,{type:'PICKUP_LOOT',lootId:first.loot[0].id});
    const distant=await waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT'&&Array.isArray(p.loot));assert.equal(distant.loot.length,lootCount,'Distant loot was stolen');
    // Inventory: swap the two weapon slots, then drop one (which adds it to the loot table).
    const me=p=>p.players.find(x=>x.id===room.playerId);
    const swappedSlots=waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT'&&me(p).primaryWeapon==='rook_smg');send(host,{type:'SWAP_SLOTS'});
    const afterSwap=me(await swappedSlots);assert.equal(afterSwap.secondaryWeapon,'viper_ar');assert.equal(afterSwap.equippedWeapon,'rook_smg','Gun in hand stays in hand after slot swap');
    const droppedGun=waitFor(host,p=>p.type==='MATCH_STATE_SNAPSHOT'&&!me(p).secondaryWeapon&&Array.isArray(p.loot));send(host,{type:'DROP_ITEM',slot:2});
    const afterDrop=await droppedGun;assert.equal(me(afterDrop).primaryWeapon,'rook_smg');assert.equal(afterDrop.loot.length,lootCount+1,'Dropped weapon appears as loot');
    console.log(`PASS: ${cooperative?'co-op friendly-fire protection':'free-for-all damage'}, 50 operators, ping, fire-rate limit, timed reload, weapon swap, slot swap, weapon drop, loot distance`);
  } finally { host.close();guest.close(); }
}
const host=await connect(),guest=await connect();
try{
  const created=waitFor(host,p=>p.type==='ROOM_JOINED');send(host,{type:'CREATE_ROOM',playerName:'Host',characterColor:'#617a72',isSquad:true});const room=await created;
  const joined=waitFor(guest,p=>p.type==='ROOM_JOINED');send(guest,{type:'JOIN_ROOM',roomCode:room.roomCode,playerName:'Guest',characterColor:'#617a72'});const friend=await joined;
  const promoted=waitFor(guest,p=>p.type==='ROOM_UPDATED'&&p.players.find(x=>x.id===friend.playerId)?.isHost);host.close();await promoted;
  send(guest,{type:'LEAVE_ROOM'});
  const recreated=waitFor(guest,p=>p.type==='ROOM_JOINED');send(guest,{type:'CREATE_ROOM',playerName:'Guest',characterColor:'#617a72',isSquad:false});await recreated;
  console.log('PASS: host migration, leave room, create another room on same connection');
}finally{host.close();guest.close();}
