export interface MapOption {
  id: string;
  name: string;
  size: string;
  description: string;
  image: string;
}

export const AVAILABLE_MAPS: MapOption[] = [
  {
    id: 'ashen_valley',
    name: 'ASHEN VALLEY',
    size: '5KM × 5KM · 50 OPERATORS',
    description: 'Nine original drop sectors linked by a valley loop road: Old Town, Radio Ridge, Central Depot, Quarry, Airfield, Harbor, Farmstead, West Camp, and South Village.',
    image: '/assets/ashen-valley.png'
  },
  {
    id: 'training_ground',
    name: 'TRAINING GROUND',
    size: '500M × 500M · LIVE-FIRE RANGE',
    description: 'Quartermaster firing range compound stocked with all weapons, optics, muzzles, grips, and reactive knockdown + moving lateral targets up to 150m.',
    image: '/assets/training-range.svg'
  }
];

export class MapSelectUI {
  private container: HTMLElement;
  private rootEl: HTMLElement;
  public selectedMapId: string = 'ashen_valley';
  public onDeployMatchCallback?: (map: MapOption) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'map-select-root';
    this.rootEl.className = 'tactical-modal-overlay';
    this.container.appendChild(this.rootEl);
    this.render();
  }

  private render(): void {
    this.rootEl.innerHTML = `
      <div class="interactive map-select-shell">
        <div class="map-select-head">
          <div>
            <span class="operator-kicker">SECTOR BRIEFING // DEPLOYMENT ZONE</span>
            <h2 class="operator-modal-title">SELECT BATTLEFIELD</h2>
          </div>
          <button id="btn-cancel-map" class="armory-close-btn">← BACK</button>
        </div>

        <div class="map-select-grid">
          ${AVAILABLE_MAPS.map(m => `
            <button type="button" class="map-card-item ${m.id === this.selectedMapId ? 'selected' : ''}" data-id="${m.id}" aria-pressed="${m.id === this.selectedMapId}">
              <div class="map-card-thumb" style="background-image: url('${m.image}');">
                <span class="map-card-badge">${m.size}</span>
              </div>
              <div class="map-card-body">
                <strong>${m.name}</strong>
                <p>${m.description}</p>
              </div>
            </button>
          `).join('')}
        </div>

        <div class="map-select-actions">
          <button id="btn-confirm-map" class="btn-deploy">CONFIRM DEPLOYMENT SECTOR</button>
        </div>
      </div>
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    this.rootEl.querySelectorAll('.map-card-item').forEach(el => {
      el.addEventListener('click', (e) => {
        this.selectedMapId = (e.currentTarget as HTMLElement).dataset.id || 'ashen_valley';
        this.render();
      });
    });

    this.rootEl.querySelector('#btn-cancel-map')?.addEventListener('click', () => {
      this.hide();
    });

    this.rootEl.querySelector('#btn-confirm-map')?.addEventListener('click', () => {
      const selected = AVAILABLE_MAPS.find(m => m.id === this.selectedMapId) || AVAILABLE_MAPS[0];
      this.hide();
      if (this.onDeployMatchCallback) {
        this.onDeployMatchCallback(selected);
      }
    });
  }

  public show(): void {
    this.rootEl.style.display = 'flex';
  }

  public hide(): void {
    this.rootEl.style.display = 'none';
  }
}
