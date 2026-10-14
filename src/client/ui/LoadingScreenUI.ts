export class LoadingScreenUI {
  private container: HTMLElement;
  private rootEl: HTMLElement;
  private progressBarEl!: HTMLElement;
  private progressTextEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'loading-screen-root';
    this.rootEl.className = 'loading-screen-overlay';
    this.container.appendChild(this.rootEl);
    this.render();
  }

  private render(): void {
    this.rootEl.innerHTML = `
      <div class="loading-brand-header">
        <div class="loading-kicker">SECTOR 01 // ASHEN VALLEY OPERATIONS</div>
        <h1 class="loading-title">
          DROPZONE <span>OPERATIONS</span>
        </h1>
      </div>

      <div class="loading-footer-block">
        <div id="loading-tip" class="loading-tip-text">
          FIELD MANUAL: WASD MOVE · SHIFT SPRINT · RMB AIM · V SWITCH CAMERA · TAB INVENTORY · M TACTICAL MAP
        </div>

        <div class="loading-bar-track">
          <div id="loading-progress-bar" class="loading-bar-fill"></div>
        </div>

        <div id="loading-progress-text" class="loading-status-readout">
          INITIALIZING ASHEN VALLEY SECTOR... 0%
        </div>
      </div>
    `;

    this.progressBarEl = this.rootEl.querySelector('#loading-progress-bar') as HTMLElement;
    this.progressTextEl = this.rootEl.querySelector('#loading-progress-text') as HTMLElement;
  }

  public simulateLoading(onComplete: () => void): void {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        this.progressBarEl.style.width = '100%';
        this.progressTextEl.innerText = 'DEPLOYMENT READY · 100%';
        setTimeout(() => {
          this.fadeOut();
          onComplete();
        }, 400);
      } else {
        this.progressBarEl.style.width = `${progress}%`;
        this.progressTextEl.innerText = `INITIALIZING ASHEN VALLEY SECTOR... ${progress}%`;
      }
    }, 120);
  }

  public fadeOut(): void {
    this.rootEl.style.opacity = '0';
    setTimeout(() => {
      this.rootEl.style.display = 'none';
    }, 500);
  }
}
