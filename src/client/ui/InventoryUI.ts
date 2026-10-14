import { AttachmentType, WeaponId } from '../../shared/types';
import { ATTACHMENT_INFO, WEAPONS } from '../../shared/constants';
import { Holder, Socket, SocketSet, canFit, capacity, socketOf } from '../../shared/loadout';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const SOCKETS: [Socket, string][] = [['optic', 'Optic'], ['muzzle', 'Muzzle'], ['grip', 'Grip'], ['mag', 'Magazine']];
const RARITY: Record<string, string> = { common: '#c9cbbd', uncommon: '#7fd26a', rare: '#58b4ff', epic: '#c678ff' };
const short = (a: AttachmentType) => ATTACHMENT_INFO[a].name.replace(' Sight', '').replace('Sound ', '');

export interface InventoryView {
  primaryWeapon: WeaponId | null;
  secondaryWeapon: WeaponId | null;
  activeSlot: 1 | 2;
  attachments: { primary: SocketSet; secondary: SocketSet };
  magAmmo: { primary: number; secondary: number };
  ammo: Record<string, number>;
  healing: { medkit: number; bandage: number };
  health: number;
  armor: number;
  maxArmor: number;
  backpack: AttachmentType[];
}

/** PUBG-style inventory: two weapon cards with attachment sockets, plus the backpack. */
export class InventoryUI {
  private root: HTMLElement;
  private view?: InventoryView;
  private lastKey = '';
  public isOpen = false;
  public onToggle?: (open: boolean) => void;
  public onMoveAttachment?: (attachment: AttachmentType, from: Holder, to: Holder) => void;
  public onSwapSlots?: () => void;
  public onDropWeapon?: (slot: 1 | 2) => void;
  public onEquip?: (slot: 1 | 2) => void;
  public onUseHeal?: (type: 'medkit' | 'bandage') => void;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'inventory-root';
    this.root.className = 'interactive';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Inventory');
    container.appendChild(this.root);
    this.root.addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('dragstart', e => {
      const chip = (e.target as HTMLElement).closest('[data-attachment]') as HTMLElement | null;
      if (!chip || !e.dataTransfer) return;
      e.dataTransfer.setData('text/plain', JSON.stringify({ attachment: chip.dataset.attachment, from: chip.dataset.from }));
      e.dataTransfer.effectAllowed = 'move';
      this.root.classList.add('dragging');
      this.markTargets(chip.dataset.attachment as AttachmentType);
    });
    this.root.addEventListener('dragend', () => { this.root.classList.remove('dragging'); this.root.querySelectorAll('.can-drop').forEach(el => el.classList.remove('can-drop')); });
    this.root.addEventListener('dragover', e => { if ((e.target as HTMLElement).closest('.can-drop')) e.preventDefault(); });
    this.root.addEventListener('drop', e => {
      const target = (e.target as HTMLElement).closest('.can-drop') as HTMLElement | null;
      const raw = e.dataTransfer?.getData('text/plain');
      if (!target || !raw) return;
      e.preventDefault();
      const { attachment, from } = JSON.parse(raw) as { attachment: AttachmentType; from: Holder };
      this.onMoveAttachment?.(attachment, from, target.dataset.holder as Holder);
    });
  }

  public toggle(force?: boolean): void {
    this.isOpen = force ?? !this.isOpen;
    this.root.classList.toggle('open', this.isOpen);
    this.lastKey = '';
    if (this.isOpen && this.view) this.render(this.view);
    this.onToggle?.(this.isOpen);
  }

  /** Highlight every socket or the backpack that can accept this attachment. */
  private markTargets(attachment: AttachmentType): void {
    const v = this.view; if (!v) return;
    const socket = socketOf(attachment);
    this.root.querySelectorAll<HTMLElement>('[data-holder]').forEach(el => {
      const holder = el.dataset.holder as Holder;
      const ok = holder === 'backpack' || (el.dataset.socket === socket && canFit(holder === 'primary' ? v.primaryWeapon : v.secondaryWeapon, attachment));
      el.classList.toggle('can-drop', ok);
    });
  }

  private onClick(e: MouseEvent): void {
    const button = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!button) return;
    const { action, attachment, from, to, slot, heal } = button.dataset;
    if (action === 'close') this.toggle(false);
    else if (action === 'move' && attachment) this.onMoveAttachment?.(attachment as AttachmentType, from as Holder, to as Holder);
    else if (action === 'swap') this.onSwapSlots?.();
    else if (action === 'drop' && slot) this.onDropWeapon?.(Number(slot) as 1 | 2);
    else if (action === 'equip' && slot) this.onEquip?.(Number(slot) as 1 | 2);
    else if (action === 'heal' && heal) this.onUseHeal?.(heal as 'medkit' | 'bandage');
  }

  public update(view: InventoryView): void {
    this.view = view;
    if (this.isOpen) this.render(view);
  }

  private render(v: InventoryView): void {
    const key = JSON.stringify(v);
    // Re-rendering mid-drag would destroy the element being dragged.
    if (key === this.lastKey || this.root.classList.contains('dragging')) return;
    this.lastKey = key;
    const weaponCard = (slot: 1 | 2) => {
      const holder = slot === 1 ? 'primary' : 'secondary';
      const other = slot === 1 ? 'secondary' : 'primary';
      const id = slot === 1 ? v.primaryWeapon : v.secondaryWeapon;
      const otherId = slot === 1 ? v.secondaryWeapon : v.primaryWeapon;
      if (!id) return `<article class="inv-weapon empty"><header><kbd>${slot}</kbd><strong>Empty slot</strong></header><p>Pick up a weapon to fill this slot.</p></article>`;
      const w = WEAPONS[id], sockets = v.attachments[holder];
      const cells = SOCKETS.map(([socket, label]) => {
        const a = sockets[socket];
        const blocked = socket === 'mag' && id === 'hammer_shotgun';
        const chip = a ? `<div class="inv-chip" draggable="true" data-attachment="${a}" data-from="${holder}" title="${escape(ATTACHMENT_INFO[a].effect)}"><b>${escape(short(a))}</b><span>${otherId && canFit(otherId, a) ? `<button data-action="move" data-attachment="${a}" data-from="${holder}" data-to="${other}" aria-label="Move to slot ${slot === 1 ? 2 : 1}">→ ${slot === 1 ? 2 : 1}</button>` : ''}<button data-action="move" data-attachment="${a}" data-from="${holder}" data-to="backpack" aria-label="Detach to backpack">Detach</button></span></div>` : `<em>${blocked ? 'Not compatible' : 'Empty'}</em>`;
        return `<div class="inv-socket ${blocked ? 'blocked' : ''}" data-holder="${holder}" data-socket="${socket}"><small>${label}</small>${chip}</div>`;
      }).join('');
      return `<article class="inv-weapon ${v.activeSlot === slot ? 'active' : ''}" style="--rarity:${RARITY[w.rarity] || '#c9cbbd'}">
        <header><kbd>${slot}</kbd><strong>${escape(w.name)}</strong><span>${w.category.toUpperCase()}</span>${v.activeSlot === slot ? '<i>IN HAND</i>' : ''}</header>
        <div class="inv-ammo"><b>${v.magAmmo[holder]}</b> / ${capacity(id, sockets)} loaded · <b>${v.ammo[w.ammoType] || 0}</b> ${escape(w.ammoType)}</div>
        <div class="inv-sockets">${cells}</div>
        <footer>${v.activeSlot !== slot ? `<button data-action="equip" data-slot="${slot}">Equip</button>` : ''}<button data-action="drop" data-slot="${slot}">Drop weapon</button></footer>
      </article>`;
    };
    const backpack = v.backpack.map(a => {
      const fits = ([['primary', v.primaryWeapon, 1], ['secondary', v.secondaryWeapon, 2]] as const).filter(([, id]) => id && canFit(id, a));
      return `<div class="inv-chip" draggable="true" data-attachment="${a}" data-from="backpack" title="${escape(ATTACHMENT_INFO[a].effect)}"><b>${escape(short(a))}</b><span>${fits.map(([holder, , n]) => `<button data-action="move" data-attachment="${a}" data-from="backpack" data-to="${holder}">Fit ${n}</button>`).join('')}</span></div>`;
    }).join('') || '<em>No spare attachments</em>';
    const ammoRows = ['Rifle Ammo', 'SMG Ammo', 'Shotgun Shells', 'Sniper Ammo'].map(t => `<div><span>${t}</span><b>${v.ammo[t] || 0}</b></div>`).join('');
    this.root.innerHTML = `
      <section class="inv-panel">
        <div class="inv-head"><div><small>LOADOUT</small><h2>Inventory</h2></div><button data-action="close" aria-label="Close inventory">Close · Tab</button></div>
        <div class="inv-body">
          <div class="inv-weapons">${weaponCard(1)}<button class="inv-swap" data-action="swap" ${v.primaryWeapon || v.secondaryWeapon ? '' : 'disabled'}>⇅ Swap slots 1 and 2</button>${weaponCard(2)}</div>
          <div class="inv-backpack" data-holder="backpack">
            <h3>Backpack</h3>
            <div class="inv-group"><small>AMMUNITION</small><div class="inv-ammo-list">${ammoRows}</div></div>
            <div class="inv-group"><small>MEDICAL</small>
              <div class="inv-med"><span>Medkit <b>×${v.healing.medkit}</b><em>Full health · 6 s</em></span><button data-action="heal" data-heal="medkit" ${v.healing.medkit && v.health < 100 ? '' : 'disabled'}>Use · H</button></div>
              <div class="inv-med"><span>Bandage <b>×${v.healing.bandage}</b><em>+25 up to 75 · 3 s</em></span><button data-action="heal" data-heal="bandage" ${v.healing.bandage && v.health < 75 ? '' : 'disabled'}>Use · J</button></div>
            </div>
            <div class="inv-group"><small>ARMOR</small><div class="inv-armor"><i style="width:${Math.min(100, v.armor / Math.max(1, v.maxArmor) * 100)}%"></i><span>${Math.round(v.armor)} / ${v.maxArmor}</span></div></div>
            <div class="inv-group"><small>SPARE ATTACHMENTS · DRAG ONTO A WEAPON</small><div class="inv-spares">${backpack}</div></div>
          </div>
        </div>
        <p class="inv-hint">Drag attachments between weapons and the backpack, or use the buttons. Picking up an attachment for an occupied socket sends the old one to your backpack.</p>
      </section>`;
  }
}
