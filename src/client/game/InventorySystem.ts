import * as THREE from 'three';
import { AttachmentType, LootItem, WeaponId } from '../../shared/types';
import { SocketSet } from '../../shared/loadout';
import { ATTACHMENT_INFO, WEAPONS } from '../../shared/constants';
import { SoundManager } from './SoundManager';
import { PlayerController } from './PlayerController';
import { createWeaponModel, disposeObject } from '../world/WeaponModel';

export const RARITY_COLORS: Record<string, number> = { common: 0xc9cbbd, uncommon: 0x7fd26a, rare: 0x58b4ff, epic: 0xc678ff, legendary: 0xffc34d };

const AMMO_COLORS: Record<string, number> = { 'Rifle Ammo': 0xc9a24a, 'SMG Ammo': 0x8bb7d9, 'Shotgun Shells': 0xc5523f, 'Sniper Ammo': 0x6aa36b };

export function lootLabel(item: LootItem): string {
  if (item.type === 'weapon' && item.weaponId) return WEAPONS[item.weaponId].name;
  if (item.type === 'attachment' && item.attachmentType) return ATTACHMENT_INFO[item.attachmentType].name;
  if (item.type === 'ammo') return `${item.ammoType || 'Ammo'} ×${item.ammoAmount || 30}`;
  if (item.type === 'armor') return `Armor Vest +${item.armorValue || 50}`;
  if (item.type === 'healing') return item.healType === 'medkit' ? 'Medkit' : item.healType === 'shieldCell' ? 'Armor Plate' : 'Bandage';
  return item.type;
}

/** Shared geometry and materials so hundreds of pickups stay cheap. */
const shared = {
  ring: new THREE.RingGeometry(.45, .62, 32),
  beam: new THREE.CylinderGeometry(.05, .12, 3.2, 8, 1, true),
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 14),
  ringMats: {} as Record<string, THREE.MeshBasicMaterial>,
  beamMats: {} as Record<string, THREE.MeshBasicMaterial>,
  mats: {} as Record<string, THREE.MeshStandardMaterial>,
  mat(color: number, rough = .8, metal = .1): THREE.MeshStandardMaterial {
    const key = `${color}_${rough}_${metal}`;
    return this.mats[key] ??= Object.assign(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), { userData: { shared: true } });
  }
};
for (const [rarity, color] of Object.entries(RARITY_COLORS)) {
  shared.ringMats[rarity] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  shared.beamMats[rarity] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
}

export class InventorySystem {
  private scene: THREE.Scene;
  private controller: PlayerController;
  private soundManager: SoundManager;

  public primaryWeapon: WeaponId | null = 'viper_ar';
  public secondaryWeapon: WeaponId | null = null;
  public activeSlot: 1 | 2 = 1;

  public ammo: Record<string, number> = {
    'Rifle Ammo': 90,
    'SMG Ammo': 120,
    'Shotgun Shells': 24,
    'Sniper Ammo': 15
  };

  public magAmmo: { primary: number; secondary: number } = { primary: 30, secondary: 0 };

  public healingItems = { medkit: 1, bandage: 5, shieldCell: 2 };

  public armor: number = 50;

  public backpackAttachments: AttachmentType[] = [];

  public attachments: { primary: SocketSet; secondary: SocketSet } = {
    primary: { optic: null, muzzle: null, grip: null, mag: null },
    secondary: { optic: null, muzzle: null, grip: null, mag: null }
  };

  public lootMeshes: Map<string, THREE.Group> = new Map();
  public lootItems: Map<string, LootItem> = new Map();

  public onPickupLootCallback?: (lootId: string) => void;
  public onSwapWeaponCallback?: (weaponId: WeaponId, slot: 1 | 2) => void;
  public onInteractCallback?: () => boolean;
  public canSwap?: () => boolean;
  private lastWheel = 0;

  constructor(scene: THREE.Scene, controller: PlayerController, soundManager: SoundManager) {
    this.scene = scene;
    this.controller = controller;
    this.soundManager = soundManager;
    this.initEventListeners();
  }

  public selectSlot(slot: 1 | 2): void {
    if (this.canSwap && !this.canSwap()) return;
    const weapon = slot === 1 ? this.primaryWeapon : this.secondaryWeapon;
    if (!weapon || slot === this.activeSlot) return;
    this.activeSlot = slot;
    this.onSwapWeaponCallback?.(weapon, slot);
  }

  private initEventListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.controller.enabled || e.repeat || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Digit1') this.selectSlot(1);
      else if (e.code === 'Digit2') this.selectSlot(2);
      else if (e.code === 'KeyE') { if (!this.onInteractCallback?.()) this.attemptPickupNearestLoot(); }
    });
    window.addEventListener('wheel', (e) => {
      if (!this.controller.enabled || !this.controller.isLocked || performance.now() - this.lastWheel < 250) return;
      this.lastWheel = performance.now();
      this.selectSlot(this.activeSlot === 1 ? 2 : 1);
      void e;
    }, { passive: true });
  }

  public updateWorldLoot(lootList: LootItem[]): void {
    const activeIds = new Set(lootList.map(l => l.id));
    for (const [id, meshGroup] of this.lootMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(meshGroup);
        meshGroup.traverse(o => { if (o instanceof THREE.Mesh && o.userData.ownMaterial) disposeObject(o); });
        this.lootMeshes.delete(id);
        this.lootItems.delete(id);
      }
    }
    for (const item of lootList) {
      this.lootItems.set(item.id, item);
      if (!this.lootMeshes.has(item.id)) {
        const group = this.createLootMesh(item);
        group.position.set(item.position.x, item.position.y + .04, item.position.z);
        group.rotation.y = (parseInt(item.id.replace(/\D/g, '').slice(-4) || '0', 10) % 628) / 100;
        this.scene.add(group);
        this.lootMeshes.set(item.id, group);
      }
    }
  }

  private part(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(sx, sy, sz); mesh.position.set(x, y, z); mesh.rotation.set(rx, 0, rz);
    mesh.castShadow = true; group.add(mesh);
    return mesh;
  }

  private createLootMesh(item: LootItem): THREE.Group {
    const group = new THREE.Group();
    const rarity: string = item.rarity in RARITY_COLORS ? item.rarity : 'common';
    const ring = new THREE.Mesh(shared.ring, shared.ringMats[rarity]);
    ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.renderOrder = 2; group.add(ring);
    if (rarity === 'uncommon' || rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
      const beam = new THREE.Mesh(shared.beam, shared.beamMats[rarity]); beam.position.y = 1.6; beam.renderOrder = 3; group.add(beam);
    }
    const { box, cylinder } = shared;
    if (item.type === 'weapon' && item.weaponId) {
      const weapon = createWeaponModel(item.weaponId);
      weapon.rotation.set(0, 0, Math.PI / 2);
      weapon.position.y = .05;
      weapon.scale.setScalar(1.15);
      weapon.traverse(o => { if (o instanceof THREE.Mesh) o.userData.ownMaterial = true; });
      group.add(weapon);
    } else if (item.type === 'ammo') {
      const color = AMMO_COLORS[item.ammoType || 'Rifle Ammo'] ?? 0xc9a24a;
      this.part(group, box, shared.mat(0x4a5340), .34, .2, .22, 0, .1, 0);
      this.part(group, box, shared.mat(color, .6, .3), .345, .045, .225, 0, .15, 0);
      this.part(group, box, shared.mat(0x2a2f2a), .08, .03, .05, 0, .215, 0);
    } else if (item.type === 'healing') {
      if (item.healType === 'medkit') {
        this.part(group, box, shared.mat(0xd8d4c8, .6), .42, .16, .3, 0, .08, 0);
        this.part(group, box, shared.mat(0xb3261e, .6), .26, .165, .06, 0, .081, 0);
        this.part(group, box, shared.mat(0xb3261e, .6), .06, .165, .2, 0, .081, 0);
      } else if (item.healType === 'shieldCell') {
        this.part(group, box, shared.mat(0x34404a, .5, .4), .3, .24, .06, 0, .13, 0, -.25);
        this.part(group, box, shared.mat(0x58b4ff, .4, .2), .22, .16, .065, 0, .13, 0, -.25);
      } else {
        this.part(group, cylinder, shared.mat(0xe6dfcd, .9), .07, .12, .07, 0, .07, 0, 0, Math.PI / 2);
        this.part(group, cylinder, shared.mat(0xe6dfcd, .9), .07, .12, .07, .17, .07, .05, 0, Math.PI / 2);
        this.part(group, box, shared.mat(0xb3261e, .7), .05, .005, .02, 0, .142, 0);
      }
    } else if (item.type === 'armor') {
      this.part(group, box, shared.mat(0x3c4434, .85), .5, .08, .55, 0, .05, 0);
      this.part(group, box, shared.mat(0x2b3029, .7, .2), .36, .06, .3, 0, .11, -.05);
      for (const x of [-.14, 0, .14]) this.part(group, box, shared.mat(0x55604a, .85), .1, .04, .12, x, .15, .17);
    } else {
      // Attachment case with a tiny model of the part on top.
      this.part(group, box, shared.mat(0x2d332f, .7, .2), .4, .12, .26, 0, .06, 0);
      const kind = item.attachmentType || '';
      const accent = shared.mat(0x15191a, .5, .5);
      if (kind.startsWith('optic')) { this.part(group, cylinder, accent, .04, .2, .04, 0, .17, 0, Math.PI / 2); this.part(group, cylinder, shared.mat(0x5fb9c4, .1, .6), .033, .01, .033, 0, .17, -.1, Math.PI / 2); }
      else if (kind.startsWith('muzzle')) this.part(group, cylinder, accent, .035, kind.includes('suppressor') ? .3 : .12, .035, 0, .16, 0, Math.PI / 2);
      else if (kind.startsWith('grip')) this.part(group, box, accent, .04, .12, .05, 0, .2, 0, kind.includes('angled') ? .6 : 0);
      else this.part(group, box, accent, .05, .2, .08, 0, .21, 0, .2);
    }
    group.userData.baseRing = ring;
    return group;
  }

  private cullFrame = 0;

  /** Subtle pulse on loot rings; loot beyond 140 m is not drawn at all. */
  public animate(time: number, viewer?: THREE.Vector3): void {
    const pulse = .4 + Math.sin(time * 3) * .15;
    for (const mat of Object.values(shared.ringMats)) mat.opacity = pulse;
    if (!viewer || ++this.cullFrame % 15) return;
    for (const mesh of this.lootMeshes.values()) {
      mesh.visible = Math.abs(mesh.position.x - viewer.x) < 140 && Math.abs(mesh.position.z - viewer.z) < 140 && viewer.y - mesh.position.y < 140;
    }
  }

  public getNearestLoot(position: THREE.Vector3, maxDistance = 3.2): LootItem | null {
    let nearest: LootItem | null = null, best = maxDistance;
    for (const [id, mesh] of this.lootMeshes) {
      const d = Math.hypot(mesh.position.x - position.x, mesh.position.z - position.z);
      if (d < best && Math.abs(mesh.position.y - position.y) < 3) { best = d; nearest = this.lootItems.get(id) || null; }
    }
    return nearest;
  }

  public getActiveWeaponId(): WeaponId | null {
    return this.activeSlot === 1 ? this.primaryWeapon : this.secondaryWeapon;
  }

  private attemptPickupNearestLoot(): void {
    const item = this.getNearestLoot(this.controller.position);
    if (item && this.onPickupLootCallback) {
      this.soundManager.playLootPickup(item.type);
      this.onPickupLootCallback(item.id);
    }
  }
}
