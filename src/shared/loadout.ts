import { AttachmentType, WeaponId } from './types';
import { WEAPONS } from './constants';

export type Socket = 'optic' | 'muzzle' | 'grip' | 'mag';
export type Holder = 'primary' | 'secondary' | 'backpack';
export type SocketSet = Record<Socket, AttachmentType | null>;

export const BACKPACK_ATTACHMENT_LIMIT = 12;

/** Shape shared by the server PlayerState and the client inventory. */
export interface Loadout {
  primaryWeapon?: WeaponId | null;
  secondaryWeapon: WeaponId | null;
  activeSlot: 1 | 2;
  attachments: { primary: SocketSet; secondary: SocketSet };
  magAmmo: { primary: number; secondary: number };
  ammo: Record<string, number>;
  backpackAttachments?: AttachmentType[];
}

export function socketOf(attachment: AttachmentType): Socket {
  return attachment.split('_')[0] as Socket;
}

/** Shotguns are tube-fed, so they cannot take a magazine. */
export function canFit(weapon: WeaponId | null | undefined, attachment: AttachmentType): boolean {
  if (!weapon) return false;
  return !(weapon === 'hammer_shotgun' && socketOf(attachment) === 'mag');
}

export function weaponIn(loadout: Loadout, slot: 'primary' | 'secondary'): WeaponId | null {
  return (slot === 'primary' ? loadout.primaryWeapon : loadout.secondaryWeapon) ?? null;
}

export function capacity(weapon: WeaponId, sockets: SocketSet): number {
  return Math.round(WEAPONS[weapon].magazineSize * (sockets.mag === 'mag_extended' ? 1.5 : 1));
}

/** Keep loaded rounds within capacity, returning any excess to the reserve. */
function clampMagazine(loadout: Loadout, slot: 'primary' | 'secondary'): void {
  const weapon = weaponIn(loadout, slot);
  if (!weapon) return;
  const cap = capacity(weapon, loadout.attachments[slot]);
  const excess = loadout.magAmmo[slot] - cap;
  if (excess > 0) {
    loadout.magAmmo[slot] = cap;
    const type = WEAPONS[weapon].ammoType;
    loadout.ammo[type] = (loadout.ammo[type] || 0) + excess;
  }
}

function stash(loadout: Loadout, attachment: AttachmentType): void {
  loadout.backpackAttachments ??= [];
  if (loadout.backpackAttachments.length < BACKPACK_ATTACHMENT_LIMIT) loadout.backpackAttachments.push(attachment);
}

/**
 * Move an attachment between a weapon and the backpack (or the other weapon).
 * An attachment already in the target socket swaps back to the source.
 */
export function moveAttachment(loadout: Loadout, attachment: AttachmentType, from: Holder, to: Holder): boolean {
  if (from === to) return false;
  const socket = socketOf(attachment);
  loadout.backpackAttachments ??= [];
  // Verify the item is where the request says it is.
  if (from === 'backpack') { if (!loadout.backpackAttachments.includes(attachment)) return false; }
  else if (loadout.attachments[from][socket] !== attachment) return false;
  if (to !== 'backpack' && !canFit(weaponIn(loadout, to), attachment)) return false;

  if (from === 'backpack') loadout.backpackAttachments.splice(loadout.backpackAttachments.indexOf(attachment), 1);
  else loadout.attachments[from][socket] = null;

  if (to === 'backpack') stash(loadout, attachment);
  else {
    const occupant = loadout.attachments[to][socket];
    loadout.attachments[to][socket] = attachment;
    if (occupant) {
      if (from !== 'backpack' && canFit(weaponIn(loadout, from), occupant)) loadout.attachments[from][socket] = occupant;
      else stash(loadout, occupant);
    }
  }
  if (from !== 'backpack') clampMagazine(loadout, from);
  if (to !== 'backpack') clampMagazine(loadout, to);
  return true;
}

/** Fit a newly picked-up attachment; anything it replaces goes to the backpack. */
export function fitPickedAttachment(loadout: Loadout, attachment: AttachmentType): 'primary' | 'secondary' | 'backpack' {
  const socket = socketOf(attachment);
  const active = loadout.activeSlot === 1 ? 'primary' : 'secondary', other = active === 'primary' ? 'secondary' : 'primary';
  const target = canFit(weaponIn(loadout, active), attachment) ? active : canFit(weaponIn(loadout, other), attachment) ? other : null;
  if (!target) { stash(loadout, attachment); return 'backpack'; }
  const occupant = loadout.attachments[target][socket];
  if (occupant) stash(loadout, occupant);
  loadout.attachments[target][socket] = attachment;
  clampMagazine(loadout, target);
  return target;
}

/** Swap the two weapon slots; the gun in hand stays in hand. */
export function swapSlots(loadout: Loadout): void {
  [loadout.primaryWeapon, loadout.secondaryWeapon] = [loadout.secondaryWeapon, loadout.primaryWeapon ?? null];
  [loadout.attachments.primary, loadout.attachments.secondary] = [loadout.attachments.secondary, loadout.attachments.primary];
  [loadout.magAmmo.primary, loadout.magAmmo.secondary] = [loadout.magAmmo.secondary, loadout.magAmmo.primary];
  loadout.activeSlot = loadout.activeSlot === 1 ? 2 : 1;
}

/**
 * Remove a weapon from its slot. Its attachments go to the backpack and loaded
 * rounds return to the reserve. Returns the dropped weapon.
 */
export function removeWeapon(loadout: Loadout, slot: 1 | 2): WeaponId | null {
  const key = slot === 1 ? 'primary' : 'secondary';
  const weapon = weaponIn(loadout, key);
  if (!weapon) return null;
  for (const socket of ['optic', 'muzzle', 'grip', 'mag'] as Socket[]) {
    const a = loadout.attachments[key][socket];
    if (a) stash(loadout, a);
    loadout.attachments[key][socket] = null;
  }
  const type = WEAPONS[weapon].ammoType;
  loadout.ammo[type] = (loadout.ammo[type] || 0) + loadout.magAmmo[key];
  loadout.magAmmo[key] = 0;
  if (slot === 1) loadout.primaryWeapon = null; else loadout.secondaryWeapon = null;
  if (loadout.activeSlot === slot && weaponIn(loadout, slot === 1 ? 'secondary' : 'primary')) loadout.activeSlot = slot === 1 ? 2 : 1;
  return weapon;
}
