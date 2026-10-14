import { AttachmentType, WeaponConfig, WeaponId } from './types';

export const MAP_SIZE = 5000; // 5km x 5km (-2500 to +2500)
export const MAX_PLAYERS_PER_ROOM = 100;
export const MIN_PLAYERS_TO_START = 2;

export const ATTACHMENT_INFO: Record<AttachmentType, { name: string; slot: string; effect: string }> = {
  optic_reddot: { name: 'Red Dot Sight · 1×', slot: 'Optic', effect: 'Fast close-range sight picture' },
  optic_holo: { name: 'Holographic Sight · 1×', slot: 'Optic', effect: 'Clear close-range reticle' },
  optic_2x: { name: 'Combat Optic · 2×', slot: 'Optic', effect: 'Fixed 2× magnification while aiming' },
  optic_4x: { name: 'Marksman Optic · 4×', slot: 'Optic', effect: 'Fixed 4× magnification while aiming' },
  optic_6x: { name: 'Variable Optic · 6×', slot: 'Optic', effect: 'Fixed 6× magnification while aiming' },
  optic_8x: { name: 'Precision Optic · 8×', slot: 'Optic', effect: 'Fixed 8× magnification while aiming' },
  muzzle_suppressor: { name: 'Sound Suppressor', slot: 'Muzzle', effect: 'Quieter shots and slightly steadier recoil' },
  muzzle_compensator: { name: 'Compensator', slot: 'Muzzle', effect: 'Reduces recoil by 15%' },
  grip_vertical: { name: 'Vertical Grip', slot: 'Underbarrel', effect: 'Reduces recoil by 20%' },
  grip_angled: { name: 'Angled Grip', slot: 'Underbarrel', effect: 'Reduces recoil by 10%' },
  mag_extended: { name: 'Extended Magazine', slot: 'Magazine', effect: 'Adds 50% magazine capacity' }
};

export const POI_LOCATIONS = [
  { name: 'Radio Ridge', x: 100, z: -1900, radius: 380, elevation: 115, description: 'High ground, relay station and long sightlines' },
  { name: 'Old Town', x: -1650, z: -1250, radius: 400, elevation: 8, description: 'Residential blocks, courtyards and narrow streets' },
  { name: 'Quarry', x: 1650, z: -1250, radius: 380, elevation: -28, description: 'Open pit, processing plant and high ground' },
  { name: 'Central Depot', x: 0, z: 0, radius: 440, elevation: 0, description: 'Freight yards, warehouses and a central road hub' },
  { name: 'Farmstead', x: -1600, z: 1550, radius: 370, elevation: 4, description: 'Barns, fields and scattered homesteads' },
  { name: 'Harbor', x: 1650, z: 1550, radius: 390, elevation: 0, description: 'Cargo docks, container stacks and coastal roads' },
  { name: 'West Camp', x: -1850, z: 50, radius: 300, elevation: 4, description: 'Forest outpost and field barracks' },
  { name: 'East Airfield', x: 1800, z: 100, radius: 420, elevation: 1, description: 'Runways, hangars and exposed approaches' },
  { name: 'South Village', x: 100, z: 1850, radius: 360, elevation: 3, description: 'Roadside homes and a small market square' }
];

export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  viper_ar: {
    id: 'viper_ar',
    name: 'Viper AR',
    category: 'ar',
    damage: 28,
    headshotMultiplier: 1.5,
    fireRate: 600,
    magazineSize: 30,
    reloadTime: 2.2,
    recoil: 0.025,
    range: 250,
    rarity: 'common',
    ammoType: 'Rifle Ammo'
  },
  rook_smg: {
    id: 'rook_smg',
    name: 'Rook SMG',
    category: 'smg',
    damage: 20,
    headshotMultiplier: 1.4,
    fireRate: 900,
    magazineSize: 40,
    reloadTime: 1.8,
    recoil: 0.018,
    range: 120,
    rarity: 'common',
    ammoType: 'SMG Ammo'
  },
  sentinel_dmr: {
    id: 'sentinel_dmr',
    name: 'Sentinel DMR',
    category: 'dmr',
    damage: 52,
    headshotMultiplier: 1.75,
    fireRate: 240,
    magazineSize: 12,
    reloadTime: 2.6,
    recoil: 0.06,
    range: 400,
    rarity: 'rare',
    ammoType: 'Rifle Ammo'
  },
  hammer_shotgun: {
    id: 'hammer_shotgun',
    name: 'Hammer Shotgun',
    category: 'shotgun',
    damage: 12, // per pellet (8 pellets = 96 total)
    pellets: 8,
    headshotMultiplier: 1.25,
    fireRate: 90,
    magazineSize: 6,
    reloadTime: 3.0,
    recoil: 0.12,
    range: 40,
    rarity: 'uncommon',
    ammoType: 'Shotgun Shells'
  },
  longbow: {
    id: 'longbow',
    name: 'Longbow Sniper',
    category: 'sniper',
    damage: 95,
    headshotMultiplier: 2.2,
    fireRate: 45,
    magazineSize: 5,
    reloadTime: 3.2,
    recoil: 0.18,
    range: 600,
    rarity: 'epic',
    ammoType: 'Sniper Ammo'
  }
};

export const ZONE_PHASES = [
  { durationSeconds: 300, radius: 3000, dps: 0.25, name: 'Phase 1 - Initial Gathering' },
  { durationSeconds: 270, radius: 2200, dps: 0.5, name: 'Phase 2 - Mid Game Rotation' },
  { durationSeconds: 240, radius: 1400, dps: 0.8, name: 'Phase 3 - High Pressure' },
  { durationSeconds: 210, radius: 700, dps: 1.2, name: 'Phase 4 - Final Enclosure' },
  { durationSeconds: 180, radius: 250, dps: 2.0, name: 'Phase 5 - Sudden Death' }
];

export const XP_PER_LEVEL = 1000;
export const XP_REWARDS = {
  KILL: 150,
  DAMAGE_PER_100: 50,
  REVIVE: 100,
  PLACEMENT_1ST: 500,
  PLACEMENT_TOP3: 250,
  SURVIVAL_MINUTE: 30
};
