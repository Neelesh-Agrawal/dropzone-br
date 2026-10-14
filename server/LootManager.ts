import { getTerrainHeight } from '../src/shared/terrain';
import { LootItem, WeaponId, Rarity } from '../src/shared/types';
import { POI_LOCATIONS, WEAPONS } from '../src/shared/constants';

export class LootManager {
  public lootItems: Map<string, LootItem> = new Map();

  constructor() {
    this.generateMapLoot();
  }

  public generateMapLoot(): void {
    this.lootItems.clear();
    let lootIdCounter = 1;

    // Spawn 120 loot items distributed across POIs
    for (const poi of POI_LOCATIONS) {
      const itemsInPoi = 26;
      for (let i = 0; i < itemsInPoi; i++) {
        const id = `loot_${lootIdCounter++}`;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (poi.radius * 0.7);
        const x = poi.x + Math.cos(angle) * radius;
        const z = poi.z + Math.sin(angle) * radius;

        const randType = Math.random();
        let item: LootItem;

        if (randType < 0.3) {
          const ammoTypes = ['Rifle Ammo', 'Rifle Ammo', 'SMG Ammo', 'Shotgun Shells', 'Sniper Ammo'];
          const ammoType = ammoTypes[Math.floor(Math.random() * ammoTypes.length)];
          item = {
            id,
            type: 'ammo',
            rarity: 'common',
            position: { x, y: getTerrainHeight(x, z), z },
            ammoType,
            ammoAmount: ammoType === 'Sniper Ammo' ? 10 : ammoType === 'Shotgun Shells' ? 12 : 30
          };
        } else if (randType < 0.55) {
          // Weapon
          const weaponKeys: WeaponId[] = ['viper_ar', 'rook_smg', 'sentinel_dmr', 'hammer_shotgun', 'longbow'];
          const wId = weaponKeys[Math.floor(Math.random() * weaponKeys.length)];
          const wConfig = WEAPONS[wId];

          item = {
            id,
            type: 'weapon',
            rarity: wConfig.rarity,
            position: { x, y: getTerrainHeight(x, z), z },
            weaponId: wId,
            ammoType: wConfig.ammoType,
            ammoAmount: wConfig.magazineSize * 2
          };
        } else if (randType < 0.77) {
          // Healing / Consumable
          const heals: ('medkit' | 'bandage' | 'shieldCell')[] = ['bandage', 'shieldCell', 'medkit'];
          const hType = heals[Math.floor(Math.random() * heals.length)];
          item = {
            id,
            type: 'healing',
            rarity: hType === 'medkit' ? 'rare' : 'common',
            position: { x, y: getTerrainHeight(x, z), z },
            healType: hType,
            healAmount: hType === 'medkit' ? 100 : hType === 'shieldCell' ? 25 : 15
          };
        } else if (randType < 0.87) {
          // Armor
          item = {
            id,
            type: 'armor',
            rarity: 'uncommon',
            position: { x, y: getTerrainHeight(x, z), z },
            armorValue: 50
          };
        } else {
          // Attachment
          const attachments: ('optic_reddot' | 'optic_holo' | 'optic_2x' | 'optic_4x' | 'optic_6x' | 'optic_8x' | 'muzzle_suppressor' | 'muzzle_compensator' | 'grip_vertical' | 'grip_angled' | 'mag_extended')[] = [
            'optic_reddot', 'optic_holo', 'optic_2x', 'optic_4x', 'optic_6x', 'optic_8x', 'muzzle_suppressor', 'muzzle_compensator', 'grip_vertical', 'grip_angled', 'mag_extended'
          ];
          const aType = attachments[Math.floor(Math.random() * attachments.length)];
          item = {
            id,
            type: 'attachment',
            rarity: aType.includes('6x') || aType.includes('8x') ? 'epic' : aType.includes('4x') || aType.includes('suppressor') ? 'rare' : 'uncommon',
            position: { x, y: getTerrainHeight(x, z), z },
            attachmentType: aType as any
          };
        }

        this.lootItems.set(id, item);
      }
    }
  }

  public pickupItem(lootId: string): LootItem | undefined {
    const item = this.lootItems.get(lootId);
    if (item) {
      this.lootItems.delete(lootId);
    }
    return item;
  }

  public getLootArray(): LootItem[] {
    return Array.from(this.lootItems.values());
  }
}
