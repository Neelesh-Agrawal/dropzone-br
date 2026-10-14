import { ModelPreview } from './ModelPreview';
import { UserProfile } from './CharacterCreationUI';
import { AttachmentType, WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/constants';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const OPTIC_OPTIONS: { id: AttachmentType; label: string; zoom: string }[] = [
  { id: 'optic_reddot', label: 'RED DOT', zoom: '1×' },
  { id: 'optic_holo', label: 'HOLO', zoom: '1×' },
  { id: 'optic_2x', label: 'COMBAT', zoom: '2×' },
  { id: 'optic_4x', label: 'ACOG', zoom: '4×' },
  { id: 'optic_6x', label: 'LPVO', zoom: '6×' },
  { id: 'optic_8x', label: 'SNIPER', zoom: '8×' }
];

export class LobbyUI {
  private preview = new ModelPreview('weapon');
  private previewWeapon: WeaponId = 'viper_ar';
  private rootEl: HTMLElement;
  public onStartMatchCallback?: () => void;
  public onJoinRoomCallback?: (code: string, playerName: string, color: string) => void;
  public onOpenMapSelectCallback?: () => void;
  public onOpenProfileEditCallback?: () => void;
  public onSelectWeaponCallback?: (weapon: WeaponId, slot: 1 | 2) => void;
  public onSelectOpticCallback?: (optic: AttachmentType) => void;
  public selectedMode: 'single_player' | 'private_room' = 'single_player';
  public selectedMapName = 'ASHEN VALLEY';
  private currentProfile: UserProfile = { name: 'Operator', color: '#617a72', level: 1, xp: 0 };
  public cooperative = true;
  public onLeaveRoomCallback?: () => void;
  private networkStatus = 'Connecting to match server…';
  private inviteCode = new URLSearchParams(window.location.search).get('room')?.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || '';
  private roomCode = '';
  private roomHost = false;
  private players: { name: string }[] = [];
  private armoryOpen = false;

  constructor(container: HTMLElement) {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'lobby-screen';
    this.rootEl.className = 'interactive';
    container.appendChild(this.rootEl);
    if (this.inviteCode) this.selectedMode = 'private_room';
    this.render();
    this.hide();
  }

  public setProfile(profile: UserProfile): void {
    this.currentProfile = profile;
    this.render();
  }

  public setMap(name: string): void {
    this.selectedMapName = name;
    this.render();
  }

  public updateRoomState(roomCode: string, isHost: boolean, players: { name: string }[]): void {
    this.roomCode = roomCode;
    this.roomHost = isHost;
    this.players = players;
    this.selectedMode = 'private_room';
    this.render();
    this.show();
  }

  public setNetworkStatus(status: string): void {
    this.networkStatus = status;
    const el = this.rootEl.querySelector('.lobby-network');
    if (el) el.textContent = status;
  }

  public clearRoom(): void {
    this.roomCode = '';
    this.players = [];
    this.roomHost = false;
    this.render();
  }

  public showError(message: string): void {
    const el = this.rootEl.querySelector('#lobby-error');
    if (el) el.textContent = message;
  }

  private render(): void {
    const profile = this.currentProfile;
    const toNext = 1000 - (profile.xp % 1000);
    let contract = { date: new Date().toISOString().slice(0, 10), kills: 0, complete: false };
    try {
      const saved = JSON.parse(localStorage.getItem('dropzone_daily_contract') || 'null');
      if (saved?.date === contract.date) contract = { ...contract, kills: Math.min(3, saved.kills || 0), complete: !!saved.complete };
    } catch { /* Start a fresh contract if local data is invalid. */ }

    const activeOptic = profile.opticId || 'optic_reddot';
    const wInfo = WEAPONS[this.previewWeapon];

    this.rootEl.innerHTML = `
      <div class="lobby-top"><div class="brand"><strong>DROPZONE</strong><span>BATTLE ROYALE</span></div>
        <nav aria-label="Lobby"><button class="${!this.armoryOpen ? 'active' : ''}" id="btn-nav-play">Play</button><button class="${this.armoryOpen ? 'active' : ''}" id="btn-armory">Armory</button><button id="btn-edit-profile">Operator</button></nav>
        <div class="rank"><span class="rank-number">${profile.level}</span><div><strong>${escapeHtml(profile.name)}</strong><small>LVL ${profile.level} · ${toNext} XP</small></div></div>
      </div>
      <div class="lobby-main">
        <div class="lobby-brief">
          <span class="season-chip">SEASON 01</span>
          <h1>ASHEN VALLEY</h1>
          <p class="rotate-hint">DRAG TO ROTATE OPERATOR</p>
        </div>
        <div class="lobby-actions"><div class="panel-heading">MATCHMAKING · <span class="lobby-network">${escapeHtml(this.networkStatus)}</span></div>
          <div class="mode-grid"><button id="mode-single-player" class="mode-card-select ${this.selectedMode === 'single_player' ? 'active' : ''}"><strong>SOLO BR</strong><span>50 Players</span></button><button id="mode-private-room" class="mode-card-select ${this.selectedMode === 'private_room' ? 'active' : ''}"><strong>SQUAD ROOM</strong><span>Private Lobby</span></button></div>
          ${this.selectedMode === 'private_room' && !this.roomCode ? `<div class="room-rules"><button id="rule-coop" class="${this.cooperative ? 'active' : ''}">Squad vs AI</button><button id="rule-versus" class="${!this.cooperative ? 'active' : ''}">Free-for-all</button></div>` : ''}
          <button id="btn-open-map-select" class="map-choice"><span><small>MAP</small><strong>${escapeHtml(this.selectedMapName)}</strong></span><span>CHANGE</span></button>
          <div class="lobby-contract"><span><small>DAILY MISSION</small><strong>3 Eliminations</strong></span><span class="contract-progress">${contract.complete ? 'DONE · +250 XP' : `${contract.kills} / 3`}</span><i><b style="width:${contract.complete ? 100 : (contract.kills / 3) * 100}%"></b></i></div>
          ${this.selectedMode === 'private_room' && !this.roomCode ? '<div class="join-row"><input id="input-room-code" maxlength="6" value="' + escapeHtml(this.inviteCode) + '" placeholder="ROOM CODE" aria-label="Room code"><button id="btn-join-code">JOIN</button></div>' : ''}
          ${this.roomCode ? `<div class="room-state"><small>ROOM CODE</small><strong>${escapeHtml(this.roomCode)}</strong><p>${this.players.length} in squad · ${this.players.map(p => escapeHtml(p.name)).join(' · ')}</p><input aria-label="Room invitation link" readonly value="${escapeHtml(window.location.origin + window.location.pathname + '?room=' + this.roomCode)}"><div class="room-share-actions"><button id="btn-copy-invite">Copy link</button><button id="btn-leave-room">Leave</button></div></div>` : ''}
          <button id="btn-main-play" class="btn-deploy" ${this.roomCode && !this.roomHost ? 'disabled' : ''}>${this.roomCode ? (this.roomHost ? 'START MATCH' : 'WAITING FOR HOST') : 'DEPLOY'}</button>
          <p id="lobby-error" role="alert"></p>
        </div>
      </div>
      <div class="lobby-footer"><span>DROPZONE // 50-PLAYER BATTLE ROYALE</span><span>READY</span></div>
      ${this.armoryOpen ? `
        <div class="armory-backdrop">
          <section class="armory-panel">
            <div class="armory-head">
              <div><small>GUNSMITH // OPERATOR LOADOUT</small><h2>Armory</h2></div>
              <button id="btn-close-armory" class="armory-close-btn">CLOSE [ESC]</button>
            </div>
            <div class="armory-showcase">
              <div class="armory-showcase-meta">
                <div>
                  <small>INSPECTING WEAPON PLATFORM</small>
                  <h3>${wInfo.name}</h3>
                  <span>${wInfo.category.toUpperCase()} · ${wInfo.ammoType.toUpperCase()} · ${wInfo.fireRate} RPM</span>
                </div>
                <span class="armory-drag-badge">DRAG TO ROTATE 3D</span>
              </div>
              <div id="weapon-preview" aria-label="3D weapon preview"></div>
              <div class="weapon-stats">
                ${[
                  ['DAMAGE', wInfo.damage, Math.min(100, wInfo.damage)],
                  ['FIRE RATE', `${wInfo.fireRate} RPM`, Math.min(100, Math.round(wInfo.fireRate / 9.5))],
                  ['MAGAZINE', `${wInfo.magazineSize} RDS`, Math.min(100, wInfo.magazineSize * 3)],
                  ['EFF. RANGE', `${Math.round(wInfo.range)} M`, Math.min(100, Math.round(wInfo.range / 3.2))]
                ].map(([label, value, pct]) => `<div><span>${label}</span><strong>${value}</strong><i style="width:${pct}%"></i></div>`).join('')}
              </div>
            </div>
            <div class="armory-right-col">
              <div class="armory-list">
                ${(Object.keys(WEAPONS) as WeaponId[]).map(id => {
                  const isPrimary = profile.weaponId === id || (!profile.weaponId && id === 'viper_ar');
                  const isSecondary = profile.secondaryWeaponId === id;
                  const isPreviewed = this.previewWeapon === id;
                  return `
                    <div class="armory-weapon-row ${isPreviewed ? 'previewing' : ''}" data-preview="${id}">
                      <span>
                        <strong>${WEAPONS[id].name}</strong>
                        <small>${WEAPONS[id].category.toUpperCase()} · ${WEAPONS[id].damage} DMG · ${WEAPONS[id].magazineSize} RDS</small>
                      </span>
                      <button class="armory-slot ${isPrimary ? 'selected' : ''}" data-weapon="${id}" data-slot="1">1 ${isPrimary ? 'PRIMARY' : 'EQUIP 1'}</button>
                      <button class="armory-slot ${isSecondary ? 'selected' : ''}" data-weapon="${id}" data-slot="2">2 ${isSecondary ? 'SECONDARY' : 'EQUIP 2'}</button>
                    </div>
                  `;
                }).join('')}
              </div>
              <div class="armory-optic-section">
                <label class="armory-optic-label" for="armory-optic">PRIMARY OPTIC ATTACHMENT</label>
                <div class="armory-optic-pills">
                  ${OPTIC_OPTIONS.map(opt => `
                    <button type="button" class="armory-optic-pill ${activeOptic === opt.id ? 'active' : ''}" data-optic="${opt.id}">
                      <strong>${opt.zoom}</strong><span>${opt.label}</span>
                    </button>
                  `).join('')}
                </div>
                <select id="armory-optic" class="armory-optic" style="display:none">
                  ${OPTIC_OPTIONS.map(opt => `<option value="${opt.id}" ${activeOptic === opt.id ? 'selected' : ''}>${opt.label} · ${opt.zoom}</option>`).join('')}
                </select>
              </div>
            </div>
          </section>
        </div>
      ` : ''}
    `;

    if (this.armoryOpen) {
      this.preview.mount(this.rootEl.querySelector('#weapon-preview') as HTMLElement);
      this.preview.weapon(this.previewWeapon, activeOptic);
    }

    this.rootEl.querySelector('#rule-coop')?.addEventListener('click', () => { this.cooperative = true; this.render(); });
    this.rootEl.querySelector('#rule-versus')?.addEventListener('click', () => { this.cooperative = false; this.render(); });
    this.rootEl.querySelector('#btn-leave-room')?.addEventListener('click', () => this.onLeaveRoomCallback?.());
    this.rootEl.querySelector('#btn-copy-invite')?.addEventListener('click', async () => {
      const input = this.rootEl.querySelector('[aria-label="Room invitation link"]') as HTMLInputElement;
      try {
        await navigator.clipboard.writeText(input.value);
        const button = this.rootEl.querySelector('#btn-copy-invite');
        if (button) button.textContent = 'Link copied';
      } catch {
        input.focus();
        input.select();
        this.showError('Select and copy the invitation link above.');
      }
    });
    this.rootEl.querySelector('#btn-edit-profile')?.addEventListener('click', () => this.onOpenProfileEditCallback?.());
    this.rootEl.querySelector('#btn-nav-play')?.addEventListener('click', () => {
      if (this.armoryOpen) { this.armoryOpen = false; this.render(); }
    });
    this.rootEl.querySelector('#btn-armory')?.addEventListener('click', () => { this.armoryOpen = true; this.render(); });
    this.rootEl.querySelector('#btn-close-armory')?.addEventListener('click', () => { this.armoryOpen = false; this.render(); });

    this.rootEl.querySelectorAll('.armory-weapon-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.armory-slot')) return;
        const wId = (row as HTMLElement).dataset.preview as WeaponId;
        if (wId && wId !== this.previewWeapon) {
          this.previewWeapon = wId;
          this.render();
        }
      });
    });

    this.rootEl.querySelectorAll('.armory-slot').forEach(el => el.addEventListener('click', () => {
      const button = el as HTMLElement;
      const weapon = button.dataset.weapon as WeaponId;
      this.previewWeapon = weapon;
      this.onSelectWeaponCallback?.(weapon, button.dataset.slot === '2' ? 2 : 1);
      this.render();
    }));

    this.rootEl.querySelectorAll('.armory-optic-pill').forEach(el => el.addEventListener('click', () => {
      const optic = (el as HTMLElement).dataset.optic as AttachmentType;
      if (optic) {
        this.onSelectOpticCallback?.(optic);
      }
    }));

    this.rootEl.querySelector('#armory-optic')?.addEventListener('change', (event) => {
      this.onSelectOpticCallback?.((event.currentTarget as HTMLSelectElement).value as AttachmentType);
    });

    this.rootEl.querySelector('#btn-open-map-select')?.addEventListener('click', () => this.onOpenMapSelectCallback?.());
    this.rootEl.querySelector('#mode-single-player')?.addEventListener('click', () => { this.selectedMode = 'single_player'; this.render(); });
    this.rootEl.querySelector('#mode-private-room')?.addEventListener('click', () => { this.selectedMode = 'private_room'; this.render(); });
    this.rootEl.querySelector('#btn-join-code')?.addEventListener('click', () => {
      const code = (this.rootEl.querySelector('#input-room-code') as HTMLInputElement).value.trim().toUpperCase();
      if (code) this.onJoinRoomCallback?.(code, profile.name, profile.color);
    });
    this.rootEl.querySelector('#btn-main-play')?.addEventListener('click', () => this.onStartMatchCallback?.());
    if (this.roomCode) {
      for (const id of ['mode-single-player', 'mode-private-room', 'btn-open-map-select', 'btn-armory', 'btn-edit-profile']) {
        const control = this.rootEl.querySelector('#' + id) as HTMLButtonElement | null;
        if (control) {
          control.disabled = true;
          control.title = 'Leave the room to change mode or loadout.';
        }
      }
    }
  }

  public hide(): void {
    this.rootEl.style.display = 'none';
  }

  public show(): void {
    this.rootEl.style.display = 'flex';
  }
}
