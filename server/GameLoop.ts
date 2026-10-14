import { VEHICLE_SPAWNS, VEHICLE_SPECS } from '../src/shared/vehicles';
import { playerHit } from '../src/shared/combat';
import { wallDistance } from './WorldCollision';
import { getTerrainHeight } from '../src/shared/terrain';
import WebSocket from 'ws';
import { Room } from './RoomManager';
import { LootManager } from './LootManager';
import { BotAIManager } from './BotAI';
import { PlayerState, ZoneState, MatchPhase, ServerPacket, ClientPacket, PingMarker, KillFeedEntry, MatchSummaryStats, SupplyDrop, VehicleState, WeaponId, LootItem } from '../src/shared/types';
import { MAX_PLAYERS_PER_ROOM, ZONE_PHASES, WEAPONS, XP_REWARDS, ATTACHMENT_INFO } from '../src/shared/constants';
import { fitPickedAttachment, moveAttachment, removeWeapon, swapSlots } from '../src/shared/loadout';

export class GameLoop {
  private room: Room;
  private broadcastFn: (packet: ServerPacket) => void;
  private lootManager: LootManager;
  public botManager: BotAIManager;
  private intervalId: NodeJS.Timeout | null = null;
  public phase: MatchPhase = 'DROP';
  public phaseTimer: number = 0;
  public currentPhaseIdx: number = 0;

  private lastShots = new Map<string, number>();
  private reloads = new Map<string, { finish: number; slot: 1 | 2; weapon: WeaponId }>();
  private zoneOriginRadius = ZONE_PHASES[0].radius;
  private zoneOriginCenter = { x: 0, y: 0, z: 0 };
  private downedBy = new Map<string, { attackerId: string; cause: string; headshot: boolean }>();
  private eliminatedAt = new Map<string, number>();
  public zone: ZoneState;
  public pings: PingMarker[] = [];
  public killFeed: KillFeedEntry[] = [];
  public supplyDrops: SupplyDrop[] = [];
  public vehicles: VehicleState[] = [];
  public matchStartTime: number = Date.now();

  constructor(room: Room, broadcastFn: (packet: ServerPacket) => void) {
    this.room = room;
    this.broadcastFn = broadcastFn;
    this.lootManager = new LootManager();
    this.botManager = new BotAIManager();

    // Initial Safe Zone
    const p1 = ZONE_PHASES[0];
    this.zone = {
      currentCenter: { x: 0, y: 0, z: 0 },
      currentRadius: p1.radius,
      targetCenter: { x: (Math.random() - 0.5) * 400, y: 0, z: (Math.random() - 0.5) * 400 },
      targetRadius: ZONE_PHASES[1].radius,
      phase: 1,
      phaseTimer: p1.durationSeconds,
      phaseDuration: p1.durationSeconds,
      isShrinking: false,
      dps: p1.dps
    };

    // Place driveable vehicles across the map so online players can reach one
    // from every major region, matching the offline world placements.
    const runnerSpawns = VEHICLE_SPAWNS;
    this.vehicles.push(...runnerSpawns.map(({ id, type, x, z, yaw }) => ({
      id,
      type,
      position: { x, y: Math.max(getTerrainHeight(x, z), type === 'patrol_boat' ? -1.2 : -99), z },
      rotation: { yaw: yaw ?? 0, pitch: 0, roll: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      driverId: null,
      health: VEHICLE_SPECS[type].maxHealth
    })));
  }

  public start(): void {
    this.phase = 'DROP';
    this.phaseTimer = 15; // 15 seconds drop phase
    this.matchStartTime = Date.now();

    // Fill small lobbies into a 50-operator match; a full public room can reach 100 humans.
    const targetOperators = Math.min(50, MAX_PLAYERS_PER_ROOM);
    const bots = this.botManager.spawnBots(Math.max(0, targetOperators - this.room.players.size), this.room.isSquad);
    for (const bot of bots) {
      this.room.players.set(bot.state.id, { socket: null as unknown as WebSocket, state: bot.state });
    }

    // 20 Ticks / sec (50ms interval)
    this.intervalId = setInterval(() => this.tick(), 50);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    const delta = 0.05; // 50ms
    this.updatePlayers(delta);

    if (this.phase === 'DROP') {
      this.phaseTimer -= delta;
      if (this.phaseTimer <= 0) {
        this.phase = 'ACTIVE';
        this.phaseTimer = ZONE_PHASES[0].durationSeconds;
      }
    } else if (this.phase === 'ACTIVE') {
      this.updateZone(delta);

      // AI Bot update tick
      const allPlayerStates = Array.from(this.room.players.values()).map(p => p.state);
      this.botManager.updateBots(delta, allPlayerStates, this.zone, (botState, origin, dir, wId) => {
        this.processWeaponFire(botState, origin, dir, wId);
      });

      this.checkVictoryCondition();
    }

    this.broadcastSnapshot();
  }

  private updateZone(delta: number): void {
    this.zone.phaseTimer = Math.max(0, this.zone.phaseTimer - delta);
    const progress = 1 - this.zone.phaseTimer / this.zone.phaseDuration;
    const shrink = Math.max(0, Math.min(1, (progress - .5) * 2));
    this.zone.isShrinking = shrink > 0 && shrink < 1;
    this.zone.currentRadius = THREE_Math_lerp(this.zoneOriginRadius, this.zone.targetRadius, shrink);
    this.zone.currentCenter = {
      x: THREE_Math_lerp(this.zoneOriginCenter.x, this.zone.targetCenter.x, shrink), y: 0,
      z: THREE_Math_lerp(this.zoneOriginCenter.z, this.zone.targetCenter.z, shrink)
    };
    if (this.zone.phaseTimer === 0 && this.currentPhaseIdx < ZONE_PHASES.length - 1) {
      this.currentPhaseIdx++;
      const config = ZONE_PHASES[this.currentPhaseIdx];
      this.zoneOriginRadius = this.zone.currentRadius;
      this.zoneOriginCenter = { ...this.zone.currentCenter };
      this.zone.phase = this.currentPhaseIdx + 1;
      this.zone.phaseTimer = this.zone.phaseDuration = config.durationSeconds;
      this.zone.targetRadius = ZONE_PHASES[this.currentPhaseIdx + 1]?.radius ?? 0;
      const travel = (this.zone.currentRadius - this.zone.targetRadius) * .3;
      this.zone.targetCenter = { x: this.zone.currentCenter.x + (Math.random()-.5)*travel, y:0, z: this.zone.currentCenter.z + (Math.random()-.5)*travel };
      this.zone.dps = config.dps;
      this.zone.isShrinking = false;
      if (this.currentPhaseIdx === 2) this.spawnSupplyDrop();
    }

    // Tick Storm Damage to players outside currentRadius
    for (const { state } of this.room.players.values()) {
      if (state.isEliminated) continue;

      const distSq = (state.position.x - this.zone.currentCenter.x) ** 2 + (state.position.z - this.zone.currentCenter.z) ** 2;
      if (distSq > this.zone.currentRadius ** 2) {
        this.applyDamage(state, null, this.zone.dps * delta, 'Storm', false);
      }
    }
  }

  private updatePlayers(delta: number): void {
    for (const { state } of this.room.players.values()) {
      if (state.isEliminated) continue;
      const reload = this.reloads.get(state.id);
      if (reload && Date.now() >= reload.finish) {
        this.reloads.delete(state.id);
        if (state.activeSlot === reload.slot && state.equippedWeapon === reload.weapon && !state.isDowned) {
          const config = WEAPONS[reload.weapon], key = reload.slot === 1 ? 'primary' : 'secondary';
          const capacity = Math.round(config.magazineSize * (state.attachments[key].mag === 'mag_extended' ? 1.5 : 1));
          const amount = Math.max(0, Math.min(capacity - state.magAmmo[key], state.ammo[config.ammoType] || 0));
          state.magAmmo[key] += amount; state.ammo[config.ammoType] -= amount;
        }
      }
      // Downed timer tick
      if (state.isDowned) {
        state.downedTimer -= delta;
        if (state.downedTimer <= 0) {
          this.eliminatePlayer(state, null, 'Bleed Out');
        }
      }
    }
  }

  public handleClientInput(playerId: string, packet: ClientPacket): void {
    const playerData = this.room.players.get(playerId);
    if (!playerData || playerData.state.isEliminated) return;

    const state = playerData.state;
    if (state.isDowned && packet.type !== 'PING_LOCATION') return;
    const finiteVector = (v: any) => v && [v.x, v.y, v.z].every(Number.isFinite);
    if ('position' in packet && !finiteVector(packet.position)) return;
    if (packet.type === 'PLAYER_INPUT' && (!finiteVector(packet.velocity) || !Number.isFinite(packet.rotation?.yaw) || !Number.isFinite(packet.rotation?.pitch))) return;
    if (packet.type === 'FIRE_WEAPON' && (!finiteVector(packet.origin) || !finiteVector(packet.direction))) return;

    switch (packet.type) {
      case 'PLAYER_INPUT':
        state.position = packet.position;
        state.rotation = packet.rotation;
        state.velocity = packet.velocity;
        state.isDropping = packet.isDropping;
        break;

      case 'FIRE_WEAPON':
        if (!WEAPONS[packet.weaponId] || this.reloads.has(state.id) || state.isDropping) break;
        if (Date.now() - (this.lastShots.get(state.id) || 0) < 60000 / WEAPONS[packet.weaponId].fireRate - 8) break;
        this.lastShots.set(state.id, Date.now());
        if (state.equippedWeapon !== packet.weaponId || state.magAmmo[state.activeSlot === 1 ? 'primary' : 'secondary'] <= 0) break;
        state.magAmmo[state.activeSlot === 1 ? 'primary' : 'secondary']--;
        this.processWeaponFire(state, packet.origin, packet.direction, packet.weaponId);
        break;

      case 'RELOAD': {
        const weapon = state.equippedWeapon;
        if (!weapon || this.reloads.has(state.id)) break;
        const config = WEAPONS[weapon];
        const key = state.activeSlot === 1 ? 'primary' : 'secondary';
        const cap = Math.round(config.magazineSize * (state.attachments[key].mag === 'mag_extended' ? 1.5 : 1));
        if (state.magAmmo[key] >= cap || !state.ammo[config.ammoType]) break;
        this.reloads.set(state.id, { finish: Date.now() + config.reloadTime * 1000, slot: state.activeSlot, weapon });
        break;
      }

      case 'SWAP_WEAPON':
        this.reloads.delete(state.id);
        if (packet.slot !== 1 && packet.slot !== 2) break;
        if (packet.slot === 1 ? state.primaryWeapon : state.secondaryWeapon) {
          state.activeSlot = packet.slot;
          state.equippedWeapon = (packet.slot === 1 ? state.primaryWeapon : state.secondaryWeapon) ?? null;
        }
        break;

      case 'SWAP_SLOTS':
        this.reloads.delete(state.id);
        swapSlots(state);
        break;

      case 'MOVE_ATTACHMENT':
        if (!ATTACHMENT_INFO[packet.attachment]) break;
        if (moveAttachment(state, packet.attachment, packet.from, packet.to)) this.reloads.delete(state.id);
        break;

      case 'DROP_ITEM': {
        if (packet.slot !== 1 && packet.slot !== 2) break;
        this.reloads.delete(state.id);
        const dropped = removeWeapon(state, packet.slot);
        if (!dropped) break;
        this.dropLoot({ type: 'weapon', rarity: WEAPONS[dropped].rarity, weaponId: dropped }, state.position.x + Math.cos(state.rotation.yaw) * .9, state.position.z - Math.sin(state.rotation.yaw) * .9);
        state.equippedWeapon = (state.activeSlot === 1 ? state.primaryWeapon : state.secondaryWeapon) ?? null;
        break;
      }

      case 'ENTER_VEHICLE': {
        const vehicle = this.vehicles.find(v => v.id === packet.vehicleId);
        if (!vehicle || vehicle.driverId || state.vehicleId) break;
        const distance = Math.hypot(state.position.x - vehicle.position.x, state.position.z - vehicle.position.z);
        if (distance > 8) break;
        vehicle.driverId = state.id;
        state.vehicleId = vehicle.id;
        state.position = { x: vehicle.position.x, y: vehicle.position.y + 1.05, z: vehicle.position.z };
        break;
      }

      case 'EXIT_VEHICLE': {
        const vehicle = this.vehicles.find(v => v.driverId === state.id);
        if (!vehicle) break;
        vehicle.driverId = null;
        state.vehicleId = null;
        state.position = {
          x: vehicle.position.x + Math.sin(vehicle.rotation.yaw) * 3,
          y: vehicle.position.y + 1.7,
          z: vehicle.position.z + Math.cos(vehicle.rotation.yaw) * 3
        };
        break;
      }

      case 'DRIVE_VEHICLE': {
        const vehicle = this.vehicles.find(v => v.id === packet.vehicleId && v.driverId === state.id);
        if (!vehicle) break;
        const distance = Math.hypot(packet.position.x - state.position.x, packet.position.z - state.position.z);
        if (distance > 8) break;
        this.runOverCheck(state, vehicle.position, { x: packet.position.x, z: packet.position.z }, Math.hypot(packet.velocity.x, packet.velocity.z));
        vehicle.position = { x: packet.position.x, y: packet.position.y - 1.05, z: packet.position.z };
        vehicle.rotation = packet.rotation;
        vehicle.velocity = packet.velocity;
        state.position = packet.position;
        state.rotation = { yaw: packet.rotation.yaw, pitch: 0 };
        state.velocity = packet.velocity;
        break;
      }

      case 'PICKUP_LOOT':
        const nearby = this.lootManager.lootItems.get(packet.lootId);
        if (!nearby || Math.hypot(nearby.position.x-state.position.x, nearby.position.z-state.position.z) > 4.5) break;
        if (nearby.type === 'armor' && state.armor >= 100) break;
        const item = this.lootManager.pickupItem(packet.lootId);
        if (item) {
          this.lootDirty = true;
          if (item.type === 'weapon' && item.weaponId) {
            // Fill an empty slot first; otherwise swap with the weapon in hand and drop it.
            const slot: 1 | 2 = !state.primaryWeapon ? 1 : !state.secondaryWeapon ? 2 : state.activeSlot;
            const key = slot === 1 ? 'primary' : 'secondary';
            // The replaced gun's attachments move to the backpack.
            const keepSlot = state.activeSlot;
            const replaced = removeWeapon(state, slot);
            state.activeSlot = keepSlot;
            if (replaced) this.dropLoot({ type: 'weapon', rarity: WEAPONS[replaced].rarity, weaponId: replaced }, state.position.x + Math.cos(state.rotation.yaw) * .9, state.position.z - Math.sin(state.rotation.yaw) * .9);
            if (slot === 1) state.primaryWeapon = item.weaponId; else state.secondaryWeapon = item.weaponId;
            if (!(state.activeSlot === 1 ? state.primaryWeapon : state.secondaryWeapon)) state.activeSlot = slot;
            state.magAmmo[key] = WEAPONS[item.weaponId].magazineSize;
            if (state.activeSlot === slot) { state.equippedWeapon = item.weaponId; this.reloads.delete(state.id); }
            const ammoType = WEAPONS[item.weaponId].ammoType;
            state.ammo[ammoType] = (state.ammo[ammoType] || 0) + WEAPONS[item.weaponId].magazineSize;
          } else if (item.type === 'ammo' && item.ammoType) {
            state.ammo[item.ammoType] = (state.ammo[item.ammoType] || 0) + (item.ammoAmount || 30);
          } else if (item.type === 'healing') {
            if (item.healType === 'medkit') state.healingItems.medkit++;
            if (item.healType === 'bandage') state.healingItems.bandage++;
            if (item.healType === 'shieldCell') state.healingItems.shieldCell++;
          } else if (item.type === 'armor') {
            state.maxArmor = 100;
            state.armor = Math.min(100, state.armor + (item.armorValue || 50));
          } else if (item.type === 'attachment' && item.attachmentType) {
            fitPickedAttachment(state, item.attachmentType);
          }
          this.broadcastFn({ type: 'LOOT_PICKED_UP', lootId: packet.lootId, playerId: state.id });
        }
        break;

      case 'USE_HEAL':
        if (packet.healType === 'medkit' && state.healingItems.medkit > 0) {
          state.healingItems.medkit--;
          state.health = state.maxHealth;
        } else if (packet.healType === 'bandage' && state.healingItems.bandage > 0 && state.health < 75) {
          state.healingItems.bandage--;
          state.health = Math.min(75, state.health + 25);
        } else if (packet.healType === 'shieldCell' && state.healingItems.shieldCell > 0) {
          state.healingItems.shieldCell--;
          state.armor = Math.min(state.maxArmor, state.armor + 25);
        }
        break;

      case 'REVIVE_PLAYER':
        const targetData = this.room.players.get(packet.targetPlayerId);
        if (targetData && targetData.state.squadId === state.squadId && Math.hypot(targetData.state.position.x-state.position.x, targetData.state.position.z-state.position.z) < 3 && targetData.state.isDowned && !targetData.state.isEliminated) {
          targetData.state.isDowned = false;
          this.downedBy.delete(targetData.state.id);
          targetData.state.health = 40;
          state.revives++;
        }
        break;

      case 'PING_LOCATION':
        this.pings.push({
          id: `ping_${Date.now()}`,
          playerId: state.id,
          playerName: state.name,
          type: packet.pingType,
          position: packet.position,
          timestamp: Date.now()
        });
        if (this.pings.length > 10) this.pings.shift();
        break;
    }
  }

  private processWeaponFire(attacker: PlayerState, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, weaponId: WeaponId): void {
    const config = WEAPONS[weaponId];
    if (!config) return;

    if (attacker.isEliminated || attacker.isDowned) return;
    if (Math.hypot(origin.x-attacker.position.x, origin.y-attacker.position.y, origin.z-attacker.position.z) > 6) return;
    const length = Math.hypot(dir.x, dir.y, dir.z);
    if (!Number.isFinite(length) || length < .9 || length > 1.1) return;
    dir = { x: dir.x/length, y: dir.y/length, z: dir.z/length };
    let nearest: PlayerState | null = null, distance = config.range, headshot = false;
    for (const { state: target } of this.room.players.values()) {
      if (target.id === attacker.id || target.isEliminated || target.squadId === attacker.squadId) continue;
      const hit = playerHit(origin, dir, target.position);
      if (hit && hit.distance < distance) { nearest = target; distance = hit.distance; headshot = hit.headshot; }
    }
    for (let t = 1; t < distance; t += 2) {
      if (getTerrainHeight(origin.x+dir.x*t, origin.z+dir.z*t) > origin.y+dir.y*t) { nearest = null; distance = t; break; }
    }
    const wall = wallDistance(origin, dir, distance);
    if (wall < distance) { nearest = null; distance = wall; }
    const end = { x: origin.x+dir.x*distance, y: origin.y+dir.y*distance, z: origin.z+dir.z*distance };
    this.broadcastFn({ type: 'SHOT_FIRED', playerId: attacker.id, origin, end, weaponId, hit: !!nearest });
    if (nearest) {
      const damage = config.damage * (config.pellets ? Math.max(1, Math.round(config.pellets * (1-distance/config.range))) : 1) * (headshot ? config.headshotMultiplier : 1);
      attacker.damageDealt += Math.min(nearest.health + nearest.armor, Math.round(damage));
      this.applyDamage(nearest, attacker, damage, config.name, headshot);
      this.room.players.get(attacker.id)?.socket?.send(JSON.stringify({ type: 'HIT_CONFIRMED', damage: Math.round(damage), headshot, eliminated: nearest.isEliminated, victimName: nearest.name }));
    }
  }

  private applyDamage(target: PlayerState, attacker: PlayerState | null, rawDamage: number, weaponName: string, isHeadshot: boolean, armorShare = 0.6): void {
    let remaining = rawDamage;

    // Armor absorbs a share of damage (60% for bullets)
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, remaining * armorShare);
      target.armor -= absorbed;
      remaining -= absorbed;
    }

    target.health -= remaining;

    this.room.players.get(target.id)?.socket?.send(JSON.stringify({ type: 'PLAYER_DAMAGE_TAKEN', attackerId: attacker?.id || '', attackerName: attacker?.name || 'ZONE', damage: rawDamage, remainingHp: target.health, remainingArmor: target.armor, isHeadshot }));
    if (target.health <= 0) {
      target.health = 0;
      const teammateAlive = [...this.room.players.values()].some(p => p.state.id !== target.id && p.state.squadId === target.squadId && !p.state.isEliminated && !p.state.isDowned);
      if (!target.isDowned && teammateAlive) {
        target.isDowned = true; target.downedTimer = 25;
        if (attacker) this.downedBy.set(target.id, { attackerId: attacker.id, cause: weaponName, headshot: isHeadshot });
        this.broadcastFn({ type: 'PLAYER_DOWNED_EVENT', victimId: target.id, victimName: target.name, attackerName: attacker?.name || 'ZONE' });
      } else this.eliminatePlayer(target, attacker, weaponName, isHeadshot);
    }
  }

  private eliminatePlayer(target: PlayerState, attacker: PlayerState | null, cause: string, headshot = false): void {
    if (target.isEliminated) return;
    const downer = this.downedBy.get(target.id);
    if (!attacker && downer) {
      attacker = this.room.players.get(downer.attackerId)?.state || null;
      if (attacker) { cause = downer.cause; headshot = downer.headshot; }
    }
    this.downedBy.delete(target.id);
    this.eliminatedAt.set(target.id, (Date.now() - this.matchStartTime) / 1000);
    target.isEliminated = true; target.isDowned = false; target.health = 0;
    this.reloads.delete(target.id);
    if (attacker) attacker.kills++;
    this.killFeed.push({ id: 'kf_' + target.id + '_' + Date.now(), killerName: attacker?.name || cause, victimName: target.name, weaponName: cause, isHeadshot: headshot, timestamp: Date.now() });
    // Death crate: the victim's gun, ammo for it and a med.
    const { x, z } = target.position;
    const weapon = target.equippedWeapon || target.primaryWeapon;
    if (weapon) {
      this.dropLoot({ type: 'weapon', rarity: WEAPONS[weapon].rarity, weaponId: weapon }, x + .8, z);
      this.dropLoot({ type: 'ammo', rarity: 'common', ammoType: WEAPONS[weapon].ammoType, ammoAmount: Math.max(12, Math.min(60, target.ammo[WEAPONS[weapon].ammoType] || 30)) }, x - .6, z + .5);
    }
    if (target.healingItems.medkit + target.healingItems.bandage > 0) this.dropLoot({ type: 'healing', rarity: 'common', healType: target.healingItems.medkit > 0 ? 'medkit' : 'bandage' }, x, z - .8);
    if (this.killFeed.length > 8) this.killFeed.shift();
    this.broadcastFn({ type: 'PLAYER_ELIMINATED_EVENT', victimId: target.id, victimName: target.name, attackerName: attacker?.name || cause, weaponName: cause });
  }

  private vehicleHits = new Map<string, number>();

  /** Damage operators the vehicle swept through between two sync updates. */
  private runOverCheck(driver: PlayerState, from: { x: number; z: number }, to: { x: number; z: number }, speed: number): void {
    if (!Number.isFinite(speed) || speed < 4) return;
    const dx = to.x - from.x, dz = to.z - from.z, lengthSq = dx * dx + dz * dz;
    for (const { state: target } of this.room.players.values()) {
      if (target.id === driver.id || target.isEliminated || target.vehicleId || target.isDropping) continue;
      if (this.room.isSquad && target.squadId === driver.squadId) continue;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((target.position.x - from.x) * dx + (target.position.z - from.z) * dz) / lengthSq)) : 0;
      const distance = Math.hypot(target.position.x - (from.x + dx * t), target.position.z - (from.z + dz * t));
      if (distance > 2.4) continue;
      const key = driver.id + ':' + target.id;
      if (Date.now() - (this.vehicleHits.get(key) || 0) < 800) continue;
      this.vehicleHits.set(key, Date.now());
      const damage = Math.min(160, speed * 6);
      driver.damageDealt += Math.min(target.health + target.armor, Math.round(damage));
      // Vehicle impacts mostly bypass armor.
      this.applyDamage(target, driver, damage, 'Scout Runner', false, .15);
      this.room.players.get(driver.id)?.socket?.send(JSON.stringify({ type: 'HIT_CONFIRMED', damage: Math.round(damage), headshot: false, eliminated: target.isEliminated, victimName: target.name }));
    }
  }

  private dropCounter = 0;
  private lootDirty = true;
  private lastLootBroadcast = 0;

  private dropLoot(item: Omit<LootItem, 'id' | 'position'>, x: number, z: number): void {
    const id = `drop_${++this.dropCounter}_${Date.now().toString(36)}`;
    this.lootManager.lootItems.set(id, { ...item, id, position: { x, y: getTerrainHeight(x, z), z } } as LootItem);
    this.lootDirty = true;
  }

  private spawnSupplyDrop(): void {
    this.lootDirty = true;
    const drop: SupplyDrop = {
      id: `sd_${Date.now()}`,
      position: {
        x: this.zone.currentCenter.x + (Math.random() - 0.5) * 100,
        y: 0.5,
        z: this.zone.currentCenter.z + (Math.random() - 0.5) * 100
      },
      landed: true,
      loot: [
        { id: `sd_w1`, type: 'weapon', rarity: 'epic', position: { x: 0, y: 0, z: 0 }, weaponId: 'longbow', ammoAmount: 30 },
        { id: `sd_a1`, type: 'armor', rarity: 'epic', position: { x: 0, y: 0, z: 0 }, armorValue: 100 }
      ]
    };
    drop.position.y = getTerrainHeight(drop.position.x, drop.position.z);
    for (const [index, item] of drop.loot.entries()) {
      item.id = `${drop.id}_${index}`;
      item.position = { ...drop.position, x: drop.position.x + index * 1.5 };
      item.position.y = getTerrainHeight(item.position.x, item.position.z);
      this.lootManager.lootItems.set(item.id, item);
    }
    this.supplyDrops.push(drop);
  }

  private checkVictoryCondition(): void {
    const alivePlayers = Array.from(this.room.players.values()).filter(p => !p.state.isEliminated);
    const aliveSquads = new Set(alivePlayers.map(p => p.state.squadId));

    if (aliveSquads.size <= 1) {
      this.phase = 'MATCH_END';
      this.room.phase = 'MATCH_END';
      const winner = alivePlayers[0] ? alivePlayers[0].state : null;
      const stats = this.calculateMatchSummary();

      this.broadcastFn({
        type: 'MATCH_OVER_EVENT',
        winnerName: winner ? winner.name : 'Unknown Survivor',
        winnerSquadId: winner ? winner.squadId : 'squad_1',
        stats
      });

      this.stop();
    }
  }

  private calculateMatchSummary(): MatchSummaryStats[] {
    const elapsedMinutes = (Date.now() - this.matchStartTime) / 60000;
    const ranked = Array.from(this.room.players.values()).map(p => p.state).sort((a,b) => Number(a.isEliminated) - Number(b.isEliminated) || (this.eliminatedAt.get(b.id) || 0) - (this.eliminatedAt.get(a.id) || 0));
    return ranked.map((state, idx) => {
      const placement = idx + 1;
      const xpEarned = (state.kills * XP_REWARDS.KILL) +
                       Math.floor(state.damageDealt / 100) * XP_REWARDS.DAMAGE_PER_100 +
                       (state.revives * XP_REWARDS.REVIVE) +
                       Math.floor(elapsedMinutes * XP_REWARDS.SURVIVAL_MINUTE) +
                       (placement === 1 ? XP_REWARDS.PLACEMENT_1ST : placement <= 3 ? XP_REWARDS.PLACEMENT_TOP3 : 15);

      return {
        playerId: state.id,
        playerName: state.name,
        placement,
        kills: state.kills,
        damage: state.damageDealt,
        revives: state.revives,
        survivalTimeSeconds: Math.floor(this.eliminatedAt.get(state.id) ?? elapsedMinutes * 60),
        xpEarned
      };
    });
  }

  private broadcastSnapshot(): void {
    // Loot only changes on pickups and drops; resend it then (and periodically for late joiners).
    const now = Date.now();
    const sendLoot = this.lootDirty || now - this.lastLootBroadcast > 3000;
    if (sendLoot) { this.lootDirty = false; this.lastLootBroadcast = now; }
    const snapshot: ServerPacket = {
      type: 'MATCH_STATE_SNAPSHOT',
      phase: this.phase,
      phaseTimer: Math.max(0, Math.floor(this.phaseTimer)),
      players: Array.from(this.room.players.values()).map(p => p.state),
      zone: this.zone,
      loot: sendLoot ? this.lootManager.getLootArray() : undefined,
      supplyDrops: this.supplyDrops,
      vehicles: this.vehicles,
      pings: this.pings,
      killFeed: this.killFeed
    };
    this.broadcastFn(snapshot);
  }
}

function THREE_Math_lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}

