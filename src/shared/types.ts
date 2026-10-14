export type MatchPhase = 'LOBBY' | 'COUNTDOWN' | 'DROP' | 'ACTIVE' | 'MATCH_END';

export type WeaponId = 'viper_ar' | 'rook_smg' | 'sentinel_dmr' | 'hammer_shotgun' | 'longbow';

export type WeaponCategory = 'ar' | 'smg' | 'dmr' | 'shotgun' | 'sniper';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';

export type LootType = 'weapon' | 'ammo' | 'armor' | 'healing' | 'attachment';

export type AttachmentType = 'optic_reddot' | 'optic_holo' | 'optic_2x' | 'optic_4x' | 'optic_6x' | 'optic_8x' | 'muzzle_suppressor' | 'muzzle_compensator' | 'grip_vertical' | 'grip_angled' | 'mag_extended';


export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface RotationData {
  yaw: number;
  pitch: number;
}

export interface WeaponConfig {
  id: WeaponId;
  name: string;
  category: WeaponCategory;
  damage: number;
  headshotMultiplier: number;
  fireRate: number; // rounds per minute
  magazineSize: number;
  reloadTime: number; // seconds
  recoil: number;
  range: number;
  rarity: Rarity;
  ammoType: string;
  pellets?: number;
}

export interface LootItem {
  id: string;
  type: LootType;
  rarity: Rarity;
  position: Vector3Data;
  weaponId?: WeaponId;
  ammoType?: string;
  ammoAmount?: number;
  armorValue?: number;
  healType?: 'medkit' | 'bandage' | 'shieldCell';
  healAmount?: number;
  attachmentType?: AttachmentType;
}

export interface PlayerState {
  id: string;
  name: string;
  squadId: string;
  position: Vector3Data;
  rotation: RotationData;
  velocity: Vector3Data;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  isDowned: boolean;
  downedTimer: number;
  isEliminated: boolean;
  isHost: boolean;
  isReady: boolean;
  isDropping: boolean;
  altitude: number;
  equippedWeapon: WeaponId | null;
  primaryWeapon?: WeaponId | null;
  secondaryWeapon: WeaponId | null;
  activeSlot: 1 | 2;
  ammo: Record<string, number>;
  magAmmo: { primary: number; secondary: number };
  healingItems: { medkit: number; bandage: number; shieldCell: number };
  attachments: {
    primary: { optic: AttachmentType | null; muzzle: AttachmentType | null; grip: AttachmentType | null; mag: AttachmentType | null };
    secondary: { optic: AttachmentType | null; muzzle: AttachmentType | null; grip: AttachmentType | null; mag: AttachmentType | null };
  };
  vehicleId: string | null;
  /** Spare attachments carried in the backpack. */
  backpackAttachments?: AttachmentType[];
  kills: number;
  damageDealt: number;
  revives: number;
  color: string;
  skin?: string;
  outfit?: string;
}

export interface ZoneState {
  currentCenter: Vector3Data;
  currentRadius: number;
  targetCenter: Vector3Data;
  targetRadius: number;
  phase: number;
  phaseTimer: number;
  phaseDuration: number;
  isShrinking: boolean;
  dps: number;
}

export interface SupplyDrop {
  id: string;
  position: Vector3Data;
  landed: boolean;
  loot: LootItem[];
}

export type VehicleType = 'scout_runner' | 'armored_truck' | 'strike_bike' | 'patrol_boat';

export interface VehicleState {
  id: string;
  type: VehicleType;
  position: Vector3Data;
  rotation: { yaw: number; pitch: number; roll: number };
  velocity: Vector3Data;
  driverId: string | null;
  health: number;
}

export interface PingMarker {
  id: string;
  playerId: string;
  playerName: string;
  type: 'location' | 'enemy' | 'loot' | 'danger';
  position: Vector3Data;
  timestamp: number;
}

export interface KillFeedEntry {
  id: string;
  killerName: string;
  victimName: string;
  weaponName: string;
  isHeadshot: boolean;
  timestamp: number;
}

export interface MatchSummaryStats {
  playerId: string;
  playerName: string;
  placement: number;
  kills: number;
  damage: number;
  revives: number;
  survivalTimeSeconds: number;
  xpEarned: number;
}

// Network Packets

export type ClientPacket =
  | { type: 'PING'; sentAt: number }
  | { type: 'LEAVE_ROOM' }
  | { type: 'JOIN_ROOM'; roomCode: string; playerName: string; characterColor: string; skin?: string; outfit?: string; startingWeapon?: WeaponId; startingSecondaryWeapon?: WeaponId; startingOptic?: AttachmentType }
  | { type: 'CREATE_ROOM'; playerName: string; characterColor: string; skin?: string; outfit?: string; isSquad: boolean; startingWeapon?: WeaponId; startingSecondaryWeapon?: WeaponId; startingOptic?: AttachmentType }
  | { type: 'TOGGLE_READY' }
  | { type: 'START_MATCH' }
  | { type: 'PLAYER_INPUT'; position: Vector3Data; rotation: RotationData; velocity: Vector3Data; isSprinting: boolean; isCrouching: boolean; isDropping: boolean }
  | { type: 'SELECT_DROP_POINT'; position: Vector3Data }
  | { type: 'FIRE_WEAPON'; origin: Vector3Data; direction: Vector3Data; weaponId: WeaponId }
  | { type: 'RELOAD' }
  | { type: 'SWAP_WEAPON'; slot: 1 | 2 }
  | { type: 'PICKUP_LOOT'; lootId: string }
  | { type: 'USE_HEAL'; healType: 'medkit' | 'bandage' | 'shieldCell' }
  | { type: 'DROP_ITEM'; slot: 1 | 2 }
  | { type: 'MOVE_ATTACHMENT'; attachment: AttachmentType; from: 'primary' | 'secondary' | 'backpack'; to: 'primary' | 'secondary' | 'backpack' }
  | { type: 'SWAP_SLOTS' }
  | { type: 'REVIVE_PLAYER'; targetPlayerId: string }
  | { type: 'PING_LOCATION'; pingType: 'location' | 'enemy' | 'loot' | 'danger'; position: Vector3Data }
  | { type: 'ENTER_VEHICLE'; vehicleId: string }
  | { type: 'EXIT_VEHICLE' }
  | { type: 'DRIVE_VEHICLE'; vehicleId: string; position: Vector3Data; rotation: { yaw: number; pitch: number; roll: number }; velocity: Vector3Data };

export type ServerPacket =
  | { type: 'PONG'; sentAt: number }
  | { type: 'SHOT_FIRED'; playerId: string; origin: Vector3Data; end: Vector3Data; weaponId: WeaponId; hit: boolean }
  | { type: 'HIT_CONFIRMED'; damage: number; headshot: boolean; eliminated: boolean; victimName: string }
  | { type: 'ROOM_JOINED'; roomId: string; roomCode: string; playerId: string; isHost: boolean; players: PlayerState[] }
  | { type: 'ROOM_UPDATED'; players: PlayerState[]; isSquad: boolean }
  | { type: 'MATCH_STARTING'; countdown: number }
  | { type: 'MATCH_STATE_SNAPSHOT'; phase: MatchPhase; phaseTimer: number; players: PlayerState[]; zone: ZoneState; loot?: LootItem[]; supplyDrops: SupplyDrop[]; vehicles: VehicleState[]; pings: PingMarker[]; killFeed: KillFeedEntry[] }
  | { type: 'PLAYER_DAMAGE_TAKEN'; attackerId: string; attackerName: string; damage: number; remainingHp: number; remainingArmor: number; isHeadshot: boolean }
  | { type: 'PLAYER_DOWNED_EVENT'; victimId: string; victimName: string; attackerName: string }
  | { type: 'PLAYER_ELIMINATED_EVENT'; victimId: string; victimName: string; attackerName: string; weaponName: string }
  | { type: 'LOOT_PICKED_UP'; lootId: string; playerId: string }
  | { type: 'LOOT_SPAWNED'; loot: LootItem }
  | { type: 'MATCH_OVER_EVENT'; winnerName: string; winnerSquadId: string; stats: MatchSummaryStats[] }
  | { type: 'ERROR_MESSAGE'; message: string };
