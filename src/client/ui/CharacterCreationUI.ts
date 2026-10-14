import { ModelPreview } from './ModelPreview';
export interface UserProfile {
  name: string;
  color: string;
  level: number;
  xp: number;
  skin?: string;
  outfit?: string;
  weaponId?: import('../../shared/types').WeaponId;
  secondaryWeaponId?: import('../../shared/types').WeaponId;
  opticId?: import('../../shared/types').AttachmentType;
}

export class CharacterCreationUI {
  private preview = new ModelPreview('operator');
  private container: HTMLElement;
  private rootEl: HTMLElement;
  public onSaveProfileCallback?: (profile: UserProfile) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'char-creation-root';
    this.rootEl.className = 'tactical-modal-overlay';
    this.container.appendChild(this.rootEl);
    this.render();
  }

  private render(): void {
    const savedProfile = this.getSavedProfile() || { name: '', color: '#617a72', level: 1, xp: 0, skin: '#c99672', outfit: 'field' };

    this.rootEl.innerHTML = `
      <div class="interactive operator-modal-shell">
        <div class="operator-live-preview" aria-label="Live 3D operator preview"></div>
        <span class="operator-kicker">DOSSIER // PERSONNEL CUSTOMIZATION</span>
        <h2 class="operator-modal-title">YOUR OPERATOR</h2>
        <p class="operator-modal-sub">Configure your callsign, tactical rig, and camo coloration before deployment.</p>

        <div class="creation-options">
          <label for="create-player-name">OPERATOR CALLSIGN</label>
          <input id="create-player-name" class="operator-name-input" type="text" maxlength="18" placeholder="Enter callsign..." value="${savedProfile.name.replace(/[&<>"']/g, '')}" />
        </div>

        <div class="creation-options">
          <label>TACTICAL RIG COLOR</label>
          <div id="color-picker-group">
            ${['#617a72', '#8b7558', '#4e6378', '#8a4f49', '#454d49', '#b1a28c'].map(c => `
              <button type="button" aria-label="Outfit color ${c}" class="color-opt-item ${c === savedProfile.color ? 'selected' : ''}" data-color="${c}" style="background: ${c};"></button>
            `).join('')}
          </div>
        </div>

        <div class="creation-options">
          <label>APPEARANCE TONE</label>
          <div id="skin-picker-group">
            ${['#e2b992', '#c99672', '#966647', '#6d4435'].map(c => `
              <button type="button" class="skin-opt-item" data-skin="${c}" style="background:${c}" aria-label="Skin tone ${c}"></button>
            `).join('')}
          </div>
        </div>

        <div class="creation-options">
          <label>COMBAT LOADOUT RIG</label>
          <div id="outfit-picker-group">
            <button type="button" class="outfit-opt-item" data-outfit="field">FIELD RIG</button>
            <button type="button" class="outfit-opt-item" data-outfit="scout">RECON SCOUT</button>
            <button type="button" class="outfit-opt-item" data-outfit="armor">HEAVY PLATE</button>
          </div>
        </div>

        <p id="profile-error" role="alert" class="operator-error-msg"></p>

        <button id="btn-save-operator" class="btn-deploy operator-save-btn">CONFIRM OPERATOR</button>
      </div>
    `;

    this.preview.mount(this.rootEl.querySelector('.operator-live-preview') as HTMLElement);
    this.preview.weapon(savedProfile.weaponId || 'viper_ar', savedProfile.opticId || 'optic_reddot');
    this.attachEvents();
  }

  private attachEvents(): void {
    let selectedColor = this.getSavedProfile()?.color || '#617a72';
    let selectedSkin = this.getSavedProfile()?.skin || '#c99672';
    let selectedOutfit = this.getSavedProfile()?.outfit || 'field';

    const refresh = () => {
      this.preview.appearance(selectedColor, selectedSkin, selectedOutfit);
      this.rootEl.querySelectorAll('[data-color]').forEach(el => {
        const match = (el as HTMLElement).dataset.color === selectedColor;
        el.classList.toggle('selected', match);
      });
      this.rootEl.querySelectorAll('[data-skin]').forEach(el => {
        const match = (el as HTMLElement).dataset.skin === selectedSkin;
        el.classList.toggle('selected', match);
        el.setAttribute('aria-pressed', String(match));
      });
      this.rootEl.querySelectorAll('[data-outfit]').forEach(el => {
        const match = (el as HTMLElement).dataset.outfit === selectedOutfit;
        el.classList.toggle('selected', match);
        el.setAttribute('aria-pressed', String(match));
      });
    };
    refresh();

    this.rootEl.querySelectorAll('.color-opt-item').forEach(el => {
      el.addEventListener('click', (e) => {
        selectedColor = (e.currentTarget as HTMLElement).dataset.color || '#617a72';
        refresh();
      });
    });

    this.rootEl.querySelectorAll('.skin-opt-item').forEach(el => el.addEventListener('click', () => {
      selectedSkin = (el as HTMLElement).dataset.skin || selectedSkin;
      refresh();
    }));

    this.rootEl.querySelectorAll('.outfit-opt-item').forEach(el => el.addEventListener('click', () => {
      selectedOutfit = (el as HTMLElement).dataset.outfit || selectedOutfit;
      refresh();
    }));

    this.rootEl.querySelector('#btn-save-operator')?.addEventListener('click', () => {
      const nameInput = this.rootEl.querySelector('#create-player-name') as HTMLInputElement;
      const name = nameInput.value.trim();
      if (!/^[A-Za-z0-9_]{3,18}$/.test(name)) {
        (this.rootEl.querySelector('#profile-error') as HTMLElement).textContent = 'Use 3–18 letters, numbers, or underscores for your callsign.';
        return;
      }
      const previous = this.getSavedProfile();
      const profile: UserProfile = {
        name,
        color: selectedColor,
        skin: selectedSkin,
        outfit: selectedOutfit,
        level: previous?.level || 1,
        xp: previous?.xp || 0,
        weaponId: previous?.weaponId || 'viper_ar',
        secondaryWeaponId: previous?.secondaryWeaponId,
        opticId: previous?.opticId || 'optic_reddot'
      };

      localStorage.setItem('dropzone_profile', JSON.stringify(profile));
      this.hide();

      if (this.onSaveProfileCallback) {
        this.onSaveProfileCallback(profile);
      }
    });
  }

  public getSavedProfile(): UserProfile | null {
    const raw = localStorage.getItem('dropzone_profile');
    if (raw) {
      try {
        const profile = JSON.parse(raw);
        if (typeof profile.name === 'string' && profile.name.trim()) return profile;
      } catch { /* ignore */ }
    }
    return null;
  }

  public show(): void {
    this.render();
    this.rootEl.style.display = 'flex';
  }

  public hide(): void {
    this.rootEl.style.display = 'none';
  }
}
