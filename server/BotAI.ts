import { getTerrainHeight } from '../src/shared/terrain';
import { blocksMovement, wallDistance } from './WorldCollision';
import { PlayerState, ZoneState, LootItem, Vector3Data, WeaponId } from '../src/shared/types';
import { POI_LOCATIONS, WEAPONS } from '../src/shared/constants';

export type BotBehaviorState = 'LOOTING' | 'PATROLLING' | 'ENGAGING' | 'ROTATING_TO_ZONE' | 'TAKING_COVER';

export interface BotController {
  state: PlayerState;
  behavior: BotBehaviorState;
  targetPos: Vector3Data;
  targetPlayerId: string | null;
  fireTimer: number;
  reactionDelay: number;
  moveSpeed: number;
}

export class BotAIManager {
  public bots: Map<string, BotController> = new Map();

  public spawnBots(count: number, isSquad: boolean): BotController[] {
    this.bots.clear();
    const botNames = [
      'ViperGhost', 'ShadowSniper', 'FalconEye', 'ApexPredator',
      'Spectre_99', 'RogueAgent', 'Ironclad', 'TitanRider',
      'Nexus_X', 'StormBreaker', 'PhantomZero'
    ];

    const botColors = ['#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];
    const spawned: BotController[] = [];

    for (let i = 0; i < count; i++) {
      const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
      const name = botNames[i % botNames.length];
      const poi = POI_LOCATIONS[i % POI_LOCATIONS.length];

      // Spawn near POI
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (poi.radius * 0.6);
      const spawnX = poi.x + Math.cos(angle) * dist;
      const spawnZ = poi.z + Math.sin(angle) * dist;

      const loadout: WeaponId[] = ['viper_ar', 'viper_ar', 'rook_smg', 'rook_smg', 'sentinel_dmr', 'hammer_shotgun'];
      const weapon = loadout[i % loadout.length];
      const playerState: PlayerState = {
        id: botId,
        name: `[BOT] ${name}`,
        squadId: isSquad ? `squad_bot_${Math.floor(i / 2)}` : `squad_${botId}`,
        position: { x: spawnX, y: getTerrainHeight(spawnX, spawnZ) + 1.7, z: spawnZ },
        rotation: { yaw: Math.random() * Math.PI * 2, pitch: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        health: 100,
        maxHealth: 100,
        armor: 50,
        maxArmor: 50,
        isDowned: false,
        downedTimer: 0,
        isEliminated: false,
        isHost: false,
        isReady: true,
        isDropping: false,
        altitude: 0,
        equippedWeapon: weapon,
        primaryWeapon: weapon,
        secondaryWeapon: null,
        activeSlot: 1,
        ammo: { 'Rifle Ammo': 150, 'SMG Ammo': 180, 'Shotgun Shells': 30, 'Sniper Ammo': 20 },
        magAmmo: { primary: WEAPONS[weapon].magazineSize, secondary: 0 },
        healingItems: { medkit: 1, bandage: 4, shieldCell: 2 },
        attachments: {
          primary: { optic: null, muzzle: null, grip: null, mag: null },
          secondary: { optic: null, muzzle: null, grip: null, mag: null }
        },
        vehicleId: null,
        kills: 0,
        damageDealt: 0,
        revives: 0,
        color: botColors[i % botColors.length]
      };

      const controller: BotController = {
        state: playerState,
        behavior: 'PATROLLING',
        targetPos: { x: spawnX, y: 0, z: spawnZ },
        targetPlayerId: null,
        fireTimer: 0,
        reactionDelay: 0.6 + Math.random() * 0.6,
        moveSpeed: 6.0
      };

      this.bots.set(botId, controller);
      spawned.push(controller);
    }

    return spawned;
  }

  public updateBots(delta: number, allPlayers: PlayerState[], zone: ZoneState, onBotFire: (botState: PlayerState, origin: Vector3Data, dir: Vector3Data, wId: WeaponId) => void): void {
    for (const bot of this.bots.values()) {
      if (bot.state.isEliminated || bot.state.isDowned) continue;

      // 1. Evaluate State Transitions
      this.evaluateState(bot, allPlayers, zone);

      // 2. Execute Navigation & Movement
      this.executeMovement(bot, delta);

      // 3. Execute Combat & Firing
      this.executeCombat(bot, delta, allPlayers, onBotFire);
    }
  }

  private evaluateState(bot: BotController, allPlayers: PlayerState[], zone: ZoneState): void {
    const pos = bot.state.position;

    // Check storm distance
    const distToZoneCenter = Math.sqrt((pos.x - zone.currentCenter.x) ** 2 + (pos.z - zone.currentCenter.z) ** 2);
    if (distToZoneCenter > zone.currentRadius * .97) {
      bot.behavior = 'ROTATING_TO_ZONE';
      bot.targetPos = {
        x: zone.currentCenter.x + (Math.random() - 0.5) * (zone.currentRadius * 0.5),
        y: 0,
        z: zone.currentCenter.z + (Math.random() - 0.5) * (zone.currentRadius * 0.5)
      };
      return;
    }

    // Find nearest enemy within 200m line of sight
    let nearestEnemy: PlayerState | null = null;
    let minEnemyDist = 200;

    for (const p of allPlayers) {
      if (p.id === bot.state.id || p.isEliminated || p.squadId === bot.state.squadId) continue;

      const dx = p.position.x - pos.x;
      const dz = p.position.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minEnemyDist) {
        minEnemyDist = dist;
        nearestEnemy = p;
      }
    }

    if (nearestEnemy) {
      bot.behavior = 'ENGAGING';
      bot.targetPlayerId = nearestEnemy.id;
      bot.targetPos = nearestEnemy.position;
    } else {
      bot.behavior = 'PATROLLING';
      bot.targetPlayerId = null;
      
      // Select new patrol waypoint if reached target
      const distToTarget = Math.sqrt((pos.x - bot.targetPos.x) ** 2 + (pos.z - bot.targetPos.z) ** 2);
      if (distToTarget < 5) {
        const poi = POI_LOCATIONS[Math.floor(Math.random() * POI_LOCATIONS.length)];
        bot.targetPos = { x: poi.x + (Math.random() - 0.5) * 80, y: 0, z: poi.z + (Math.random() - 0.5) * 80 };
      }
    }
  }

  private executeMovement(bot: BotController, delta: number): void {
    const pos = bot.state.position;
    const dx = bot.targetPos.x - pos.x;
    const dz = bot.targetPos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    bot.state.velocity = {x:0,y:0,z:0};
    if (dist > (bot.behavior === 'ENGAGING' ? 45 : 1.5)) {
      const dirX = dx / dist;
      const dirZ = dz / dist;

      const previousX=pos.x, previousZ=pos.z;
      bot.state.position.x += dirX * bot.moveSpeed * delta;
      bot.state.position.z += dirZ * bot.moveSpeed * delta;
      if (blocksMovement(pos)) {
        pos.x=previousX;pos.z=previousZ;
        bot.targetPos={x:pos.x+(Math.random()-.5)*60,y:pos.y,z:pos.z+(Math.random()-.5)*60};
      }

      bot.state.position.y = getTerrainHeight(pos.x, pos.z) + 1.7;
      bot.state.velocity = { x: dirX * bot.moveSpeed, y: 0, z: dirZ * bot.moveSpeed };
      // Update yaw angle towards movement direction or target enemy
      bot.state.rotation.yaw = Math.atan2(-dirX, -dirZ);
    }
  }

  private executeCombat(bot: BotController, delta: number, allPlayers: PlayerState[], onBotFire: (botState: PlayerState, origin: Vector3Data, dir: Vector3Data, wId: WeaponId) => void): void {
    if (bot.behavior !== 'ENGAGING' || !bot.targetPlayerId) return;

    const target = allPlayers.find(p => p.id === bot.targetPlayerId);
    if (!target || target.isEliminated) return;

    bot.fireTimer += delta;
    if (bot.fireTimer >= bot.reactionDelay) {
      bot.fireTimer = 0;

      const pos = bot.state.position;
      const dx = target.position.x - pos.x;
      const dy = target.position.y - pos.y;
      const dz = target.position.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Add slight recoil dispersion to bot aim
      if(dist<.1)return;
      if(wallDistance(pos,{x:dx/dist,y:dy/dist,z:dz/dist},dist)<dist-.5)return;
      for(let i=1;i<12;i++)if(getTerrainHeight(pos.x+dx*i/12,pos.z+dz*i/12)>pos.y+dy*i/12)return;
      const config = WEAPONS[bot.state.equippedWeapon || 'viper_ar'];
      if (dist > config.range * .85) return;
      if(bot.state.magAmmo.primary<=0){bot.state.magAmmo.primary=config.magazineSize;bot.fireTimer=-config.reloadTime;return;}
      bot.state.magAmmo.primary--;
      bot.state.rotation.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const dispersion = config.category === 'shotgun' ? .06 : config.category === 'dmr' ? .012 : .025;
      const dir = {
        x: (dx / dist) + (Math.random() - 0.5) * dispersion,
        y: (dy / dist) + (Math.random() - 0.5) * dispersion,
        z: (dz / dist) + (Math.random() - 0.5) * dispersion
      };

      const wId = bot.state.equippedWeapon || 'viper_ar';
      onBotFire(bot.state, { x: pos.x, y: pos.y, z: pos.z }, dir, wId);
    }
  }
}
