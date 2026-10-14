import { zoneStageSeconds } from '../../shared/zone';
import { PlayerState, ZoneState, KillFeedEntry } from '../../shared/types';
import { ATTACHMENT_INFO, MAP_SIZE, POI_LOCATIONS, WEAPONS } from '../../shared/constants';
import { getTopographicMapCanvas } from './MapCanvas';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const rifle = '<svg viewBox="0 0 160 44" aria-hidden="true"><path d="M6 15h26l8-5h41V6h21v7h44v5h10v5h-52l-6 8H74l4-10H58l-7 17H39l5-17H29L8 29z M65 5h12v5H65z M91 27l9 12h-13l-7-12z" fill="currentColor"/></svg>';

const SCOPE_RETICLE_SVG = `
<svg class="scope-reticle-svg" viewBox="-200 -200 400 400" aria-hidden="true">
  <defs>
    <radialGradient id="scope-lens-tint" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(160, 220, 210, 0.0)" />
      <stop offset="82%" stop-color="rgba(30, 58, 54, 0.08)" />
      <stop offset="100%" stop-color="rgba(6, 12, 11, 0.55)" />
    </radialGradient>
  </defs>
  <circle cx="0" cy="0" r="196" fill="url(#scope-lens-tint)" />
  <!-- Outer etched crosshairs -->
  <g class="reticle-main-lines" stroke="rgba(16, 22, 20, 0.85)" stroke-width="1.3">
    <line x1="-196" y1="0" x2="-18" y2="0" />
    <line x1="18" y1="0" x2="196" y2="0" />
    <line x1="0" y1="-196" x2="0" y2="-18" />
    <line x1="0" y1="18" x2="0" y2="196" />
    <!-- Thick outer guide posts -->
    <line x1="-196" y1="0" x2="-115" y2="0" stroke-width="3.6" />
    <line x1="115" y1="0" x2="196" y2="0" stroke-width="3.6" />
    <line x1="0" y1="125" x2="0" y2="196" stroke-width="3.6" />
  </g>
  <!-- Windage & BDC range stadia ticks -->
  <g class="reticle-mil-ticks" stroke="rgba(16, 22, 20, 0.82)" stroke-width="1.2" fill="rgba(220, 230, 222, 0.72)" font-family="JetBrains Mono, monospace" font-size="7.5" text-anchor="start">
    <line x1="-90" y1="-4" x2="-90" y2="4" /><line x1="-60" y1="-3" x2="-60" y2="3" /><line x1="-30" y1="-4" x2="-30" y2="4" />
    <line x1="30" y1="-4" x2="30" y2="4" /><line x1="60" y1="-3" x2="60" y2="3" /><line x1="90" y1="-4" x2="90" y2="4" />
    <line x1="-8" y1="28" x2="8" y2="28" /><text x="12" y="30.5" stroke="none">2</text>
    <line x1="-12" y1="54" x2="12" y2="54" /><text x="16" y="56.5" stroke="none">4</text>
    <line x1="-16" y1="82" x2="16" y2="82" /><text x="20" y="84.5" stroke="none">6</text>
    <line x1="-20" y1="110" x2="20" y2="110" /><text x="24" y="112.5" stroke="none">8</text>
  </g>
  <!-- Illuminated center combat chevron & ring -->
  <circle class="reticle-combat-ring" cx="0" cy="0" r="24" fill="none" stroke="rgba(255, 74, 52, 0.86)" stroke-width="1.6" stroke-dasharray="26 11.7" />
  <path class="reticle-chevron" d="M -7 6 L 0 -2 L 7 6" fill="none" stroke="#ff3b28" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  <circle class="reticle-center-dot" cx="0" cy="0" r="1.8" fill="#ff3b28" />
</svg>
`;

export class GameHUD {
  public vehicleLocations: { x: number; z: number; type?: string }[] = [];
  public gunfireBlips: { x: number; z: number; time: number }[] = [];
  private rootEl: HTMLElement;
  public onExitMatchCallback?: () => void;
  public onUseHealCallback?: (healType: 'medkit' | 'bandage') => void;
  private damageHideTimer?: number;
  private lootToastTimer?: number;
  private hitTimer?: number;
  private eliminationTimer?: number;
  private roster: PlayerState[] = [];
  private minimap: CanvasRenderingContext2D;
  private lastFeed = '';
  private lastLoadout = '';
  private lastSquad = '';
  private lastKills = 0;
  private fireMode: 'auto' | 'single' = 'auto';
  private dropText = '';

  constructor(container: HTMLElement) {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'hud-root';
    this.rootEl.className = 'combat-hud';
    container.appendChild(this.rootEl);
    this.rootEl.innerHTML = `
      <div class="combat-vignette"></div>
      <header class="combat-top">
        <div class="combat-match"><button id="hud-exit" class="interactive" aria-label="Return to lobby">EXIT</button><span id="hud-mode">SOLO / AI</span><span id="hud-network">LOCAL</span></div>
        <div class="combat-counters"><span><b id="hud-alive">50</b> ALIVE</span><span><b id="hud-kills">0</b> KILLS</span><span class="combat-damage-stat"><b id="hud-damage">0</b> DAMAGE</span><span id="hud-population">1 PLAYER · 49 AI</span></div>
        <div class="combat-loadout"><div class="combat-loadout-title"><span id="hud-weapon-name">VIPER AR</span><small id="hud-fire-mode">AUTO · SLOT 1</small></div><div id="hud-attachments"></div></div>
      </header>
      <div class="combat-navigation"><div class="combat-compass"><span id="hud-heading-left">NW</span><span>· ┆ · ┆ ·</span><strong id="hud-heading-main">N 000°</strong><span>· ┆ · ┆ ·</span><span id="hud-heading-right">NE</span></div><div class="combat-zone"><span id="hud-zone-label">ZONE 1</span><b id="hud-zone-timer">02:00</b><span id="hud-camera-badge">TPS [V]</span></div></div>
      <section class="combat-radar"><canvas id="hud-radar" width="200" height="200" aria-label="Minimap showing squad and zone"></canvas><div><strong id="hud-location">ASHEN VALLEY</strong><span>M · MAP</span></div></section>
      <div id="hud-kill-feed"></div><div id="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
      <div id="scope-overlay"><div class="scope-glass">${SCOPE_RETICLE_SVG}</div><span id="hud-scope-label"></span></div>
      <div id="hit-marker"><i></i><i></i><i></i><i></i></div><div id="hud-hit-score"></div>
      <div id="hud-action" aria-live="polite"><span></span><div><b></b></div></div><div id="hud-drop" role="status"></div>
      <div id="hud-damage-flash" aria-hidden="true"></div><div id="hud-hit-direction" aria-hidden="true"></div>
      <div id="hud-damage-callout" role="status"></div><div id="hud-elimination" role="status"></div>
      <div id="hud-pickup-prompt"></div><div id="hud-loot-toast" role="status"></div><div id="hud-life-state" role="status"></div>
      <section class="combat-vitals"><div id="hud-squad-list"></div><div class="combat-health-label"><strong id="hud-operator">OPERATOR</strong><span><b id="hud-hp-text">100</b> HP</span></div><div class="combat-health-track"><div id="hud-hp-bar"></div></div><div class="combat-armor"><div class="combat-armor-track"><div id="hud-armor-bar"></div></div><span id="hud-armor-text">50</span></div><div class="combat-medical"><button id="hud-use-medkit" class="interactive">H · MED <b>1</b></button><button id="hud-use-bandage" class="interactive">J · BAND <b>5</b></button></div></section>
      <section class="combat-weapons"><div id="hud-reload"><span>RELOADING</span><b></b></div><div class="combat-active-gun">${rifle}<div><strong id="hud-mag-ammo">30</strong><span>/ <b id="hud-reserve-ammo">90</b></span></div></div><div id="hud-weapon-slots"></div><span id="hud-ammo-hint">R · RELOAD</span></section>
      <footer id="hud-controls-hint">WASD MOVE <i>·</i> SHIFT SPRINT <i>·</i> RMB AIM <i>·</i> C CROUCH <i>·</i> R RELOAD <i>·</i> B FIRE MODE <i>·</i> E INTERACT <i>·</i> TAB INVENTORY <i>·</i> P SCOREBOARD</footer>
      <section id="hud-scoreboard"><h2>FIELD REPORT</h2><p>LIVE MATCH STANDINGS</p><div class="score-heading"><span>OPERATOR</span><span>KILLS</span><span>DAMAGE</span><span>STATUS</span></div><div id="hud-score-rows"></div><small>Release P to return to combat</small></section>`;
    this.minimap = (this.el('hud-radar') as HTMLCanvasElement).getContext('2d')!;
    this.el('hud-exit').addEventListener('click', () => this.onExitMatchCallback?.());
    this.el('hud-use-medkit').addEventListener('click', () => this.onUseHealCallback?.('medkit'));
    this.el('hud-use-bandage').addEventListener('click', () => this.onUseHealCallback?.('bandage'));
    window.addEventListener('keydown', e => {
      if (e.code === 'KeyP' && this.rootEl.style.display !== 'none' && !(e.target instanceof HTMLInputElement)) {
        this.renderScoreboard();
        this.rootEl.classList.add('show-scoreboard');
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'KeyP') this.rootEl.classList.remove('show-scoreboard');
    });
    window.addEventListener('blur', () => this.rootEl.classList.remove('show-scoreboard'));
  }

  private el(id: string): HTMLElement {
    return this.rootEl.querySelector('#' + id)!;
  }

  private text(id: string, value: string): void {
    const el = this.el(id);
    if (el.textContent !== value) el.textContent = value;
  }

  public show(): void {
    this.rootEl.style.display = 'block';
  }

  public hide(): void {
    this.rootEl.style.display = 'none';
  }

  public setMode(mode: string): void {
    this.text('hud-mode', mode);
  }

  public setNetwork(label: string): void {
    this.text('hud-network', label);
  }

  public setPracticeScore(hits: number): void {
    this.text('hud-zone-label', 'TRAINING RANGE');
    this.text('hud-zone-timer', `${hits} HITS`);
  }

  public setReload(progress: number | null): void {
    this.el('hud-reload').classList.toggle('active', progress !== null);
    (this.el('hud-reload').querySelector('b') as HTMLElement).style.transform = `scaleX(${progress ?? 0})`;
  }

  public update(player: PlayerState, zone: ZoneState, squad: PlayerState[], feed: KillFeedEntry[], scoped = false, camera: 'FPS' | 'TPS' = 'TPS', allPlayers: PlayerState[] = squad): void {
    this.roster = allPlayers;
    this.text('hud-alive', `${allPlayers.filter(p => !p.isEliminated).length}`);
    this.text('hud-kills', `${player.kills}`);
    this.text('hud-damage', `${Math.round(player.damageDealt)}`);
    const humans = allPlayers.filter(p => !p.id.includes('bot_')).length;
    this.text('hud-population', `${humans} PLAYER${humans === 1 ? '' : 'S'} · ${allPlayers.length - humans} AI`);
    this.text('hud-operator', player.name.toUpperCase());
    this.text('hud-hp-text', `${Math.ceil(player.health)}`);
    this.text('hud-armor-text', `${Math.ceil(player.armor)}`);
    this.el('hud-hp-bar').style.transform = `scaleX(${Math.max(0, player.health / player.maxHealth)})`;
    this.el('hud-armor-bar').style.transform = `scaleX(${Math.min(1, Math.max(0, player.armor / player.maxArmor))})`;
    this.rootEl.classList.toggle('critical-health', player.health < 30);
    this.text('hud-life-state', player.isEliminated ? 'ELIMINATED · WATCHING THE FIELD' : player.isDowned ? `DOWNED · ${Math.ceil(player.downedTimer)}s · SQUAD CAN REVIVE WITH E` : '');
    for (const heal of ['medkit', 'bandage'] as const) {
      const button = this.el(`hud-use-${heal}`) as HTMLButtonElement;
      button.querySelector('b')!.textContent = `${player.healingItems[heal]}`;
      button.disabled = !player.healingItems[heal] || player.health >= player.maxHealth || player.isDowned || player.isEliminated;
    }
    const weapon = player.equippedWeapon ? WEAPONS[player.equippedWeapon] : null;
    const key = player.activeSlot === 1 ? 'primary' : 'secondary';
    const attachments = player.attachments[key];
    this.text('hud-weapon-name', weapon?.name.toUpperCase() || 'UNARMED');
    const selectable = weapon?.category === 'ar' || weapon?.category === 'smg';
    this.text('hud-fire-mode', `${selectable ? (this.fireMode === 'auto' ? 'AUTO' : 'SINGLE') + ' [B]' : weapon?.category === 'sniper' ? 'BOLT' : weapon?.category === 'shotgun' ? 'PUMP' : 'SEMI'} · SLOT ${player.activeSlot}`);
    this.text('hud-mag-ammo', `${player.magAmmo[key]}`);
    this.text('hud-reserve-ammo', `${weapon ? player.ammo[weapon.ammoType] || 0 : 0}`);
    const capacity = weapon ? Math.round(weapon.magazineSize * (attachments.mag ? 1.5 : 1)) : 30;
    this.el('hud-mag-ammo').classList.toggle('low-ammo', player.magAmmo[key] <= Math.max(1, Math.floor(capacity * 0.25)));
    this.text('hud-ammo-hint', player.magAmmo[key] === 0 ? 'PRESS R TO RELOAD' : '');
    const loadout = JSON.stringify([attachments, player.primaryWeapon, player.secondaryWeapon, player.activeSlot]);
    if (loadout !== this.lastLoadout) {
      this.lastLoadout = loadout;
      this.el('hud-attachments').innerHTML = (['optic', 'muzzle', 'grip', 'mag'] as const).map(slot => {
        const item = attachments[slot];
        const info = item ? ATTACHMENT_INFO[item] : null;
        return `<span class="${item ? 'fitted' : ''}" title="${info ? escape(info.effect) : 'No attachment'}"><small>${slot === 'mag' ? 'MAGAZINE' : slot.toUpperCase()}</small><b>${info ? escape(info.name.replace(' Sight', '').replace('Sound ', '')) : '—'}</b></span>`;
      }).join('');
      this.el('hud-weapon-slots').innerHTML = [player.primaryWeapon || player.equippedWeapon, player.secondaryWeapon].map((id, i) => `<span class="${player.activeSlot === i + 1 ? 'selected' : ''}"><kbd>${i + 1}</kbd>${id ? WEAPONS[id].name : 'EMPTY SLOT'}</span>`).join('');
    }
    this.el('scope-overlay').style.display = scoped ? 'grid' : 'none';
    this.rootEl.classList.toggle('scoped', scoped);
    const opticId = attachments.optic || 'optic_reddot';
    this.el('scope-overlay').dataset.optic = opticId;
    const rangeStadia = opticId === 'optic_8x' ? ' · BDC 100–800M' : opticId === 'optic_6x' ? ' · BDC 100–600M' : opticId === 'optic_4x' ? ' · ACOG 100–400M' : ' · CQB 50–200M';
    this.text('hud-scope-label', (attachments.optic ? ATTACHMENT_INFO[attachments.optic].name.toUpperCase() : 'IRON SIGHTS') + rangeStadia);
    this.el('crosshair').style.opacity = scoped ? '0' : '1';
    this.text('hud-camera-badge', `${camera}`);
    this.text('hud-zone-timer', `${Math.floor(zoneStageSeconds(zone) / 60).toString().padStart(2, '0')}:${Math.floor(zoneStageSeconds(zone) % 60).toString().padStart(2, '0')}`);
    this.text('hud-zone-label', `ZONE ${zone.phase}`);
    this.el('hud-zone-label').classList.toggle('zone-closing', zone.isShrinking);
    const degrees = ((-player.rotation.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const headings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    this.text('hud-heading-main', `${headings[index]} ${Math.round(degrees).toString().padStart(3, '0')}°`);
    this.text('hud-heading-left', headings[(index + 7) % 8]);
    this.text('hud-heading-right', headings[(index + 1) % 8]);
    const squadKey = JSON.stringify(squad.map(p => [p.name, p.health, p.isDowned, p.isEliminated]));
    if (squadKey !== this.lastSquad) {
      this.lastSquad = squadKey;
      this.el('hud-squad-list').innerHTML = squad.filter(p => p.id !== player.id).slice(0, 7).map((p, i) => `<div><b>${String(i + 2).padStart(2, '0')}</b><span>${escape(p.name)}</span><small>${p.isEliminated ? 'OUT' : p.isDowned ? 'DOWN' : `${Math.ceil(p.health)} HP`}</small></div>`).join('');
    }
    const recent = feed.filter(k => Date.now() - k.timestamp < 12000).slice(-4);
    const feedKey = recent.map(k => k.id).join();
    if (feedKey !== this.lastFeed) {
      this.lastFeed = feedKey;
      this.el('hud-kill-feed').innerHTML = recent.map(k => `<div><strong>${escape(k.killerName)}</strong><small>${escape(k.weaponName)}${k.isHeadshot ? ' · HS' : ''}</small><span>${escape(k.victimName)}</span></div>`).join('');
    }
    if (player.kills > this.lastKills) this.showElimination([...feed].reverse().find(k => k.killerName === player.name)?.victimName || 'Enemy');
    this.lastKills = player.kills;
    this.drawRadar(player, zone, squad);
    if (this.rootEl.classList.contains('show-scoreboard')) this.renderScoreboard();
  }

  private drawRadar(player: PlayerState, zone: ZoneState, squad: PlayerState[]): void {
    const ctx = this.minimap;
    const scale = 0.23; // 200px canvas = ~870m world window around player
    const x = player.position.x;
    const z = player.position.z;

    ctx.fillStyle = '#12211f';
    ctx.fillRect(0, 0, 200, 200);

    // Draw zoomed topographic terrain slice centered on the operator
    const topo = getTopographicMapCanvas();
    const worldSpan = 200 / scale; // ~869.5m
    const srcSpan = (worldSpan / MAP_SIZE) * topo.width;
    const srcCenterX = ((x + MAP_SIZE / 2) / MAP_SIZE) * topo.width;
    const srcCenterY = ((z + MAP_SIZE / 2) / MAP_SIZE) * topo.height;
    ctx.drawImage(
      topo,
      srcCenterX - srcSpan / 2,
      srcCenterY - srcSpan / 2,
      srcSpan,
      srcSpan,
      0,
      0,
      200,
      200
    );

    // Subtle tactical grid lines
    ctx.strokeStyle = 'rgba(231, 226, 212, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const gx = ((i * 50 - x * scale) % 250 + 250) % 250;
      const gy = ((i * 50 - z * scale) % 250 + 250) % 250;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, 200);
      ctx.moveTo(0, gy);
      ctx.lineTo(200, gy);
      ctx.stroke();
    }

    // Safe Zone Ring
    ctx.strokeStyle = '#6fe3cf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(100 + (zone.currentCenter.x - x) * scale, 100 + (zone.currentCenter.z - z) * scale, zone.currentRadius * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Squad Teammates
    for (const mate of squad) {
      if (mate.id === player.id || mate.isEliminated) continue;
      ctx.fillStyle = '#91d7b8';
      ctx.beginPath();
      ctx.arc(100 + (mate.position.x - x) * scale, 100 + (mate.position.z - z) * scale, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Nearby Vehicles (High-contrast cyan/amber tactical icons)
    for (const v of this.vehicleLocations) {
      const vx = 100 + (v.x - x) * scale;
      const vz = 100 + (v.z - z) * scale;
      if (vx > 8 && vx < 192 && vz > 14 && vz < 186) {
        ctx.fillStyle = v.type === 'patrol_boat' ? '#20e3d2' : v.type === 'armored_truck' ? '#ff9f2e' : '#ffe169';
        ctx.strokeStyle = '#0a1214';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(vx - 4.5, vz - 3, 9, 6, 1.5);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Active Enemy Recon & Gunfire Radar Blips (within radar window)
    const now = performance.now();
    this.gunfireBlips = this.gunfireBlips.filter(b => now - b.time < 2600);
    for (const blip of this.gunfireBlips) {
      const bx = 100 + (blip.x - x) * scale;
      const bz = 100 + (blip.z - z) * scale;
      if (bx > 6 && bx < 194 && bz > 6 && bz < 194) {
        const age = (now - blip.time) / 2600;
        ctx.strokeStyle = `rgba(255, 68, 56, ${(1 - age) * 0.85})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, bz, 4 + age * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const op of this.roster) {
      if (op.id === player.id || op.isEliminated || op.squadId === player.squadId) continue;
      const dist = Math.hypot(op.position.x - x, op.position.z - z);
      if (dist > 280) continue;
      const ex = 100 + (op.position.x - x) * scale;
      const ez = 100 + (op.position.z - z) * scale;
      if (ex > 8 && ex < 192 && ez > 8 && ez < 192) {
        ctx.fillStyle = '#ff4738';
        ctx.strokeStyle = '#140807';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ex, ez, 3.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Player FOV Wedge & Directional Chevron
    ctx.save();
    ctx.translate(100, 100);
    ctx.rotate(-player.rotation.yaw);
    const fovGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 38);
    fovGrad.addColorStop(0, 'rgba(244, 206, 137, 0.34)');
    fovGrad.addColorStop(1, 'rgba(244, 206, 137, 0.0)');
    ctx.fillStyle = fovGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 38, -Math.PI / 2 - 0.44, -Math.PI / 2 + 0.44);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f4ce89';
    ctx.strokeStyle = '#121816';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -8.5);
    ctx.lineTo(5.8, 5.8);
    ctx.lineTo(0, 2.8);
    ctx.lineTo(-5.8, 5.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(15, 20, 18, 0.72)';
    ctx.fillRect(90, 3, 20, 14);
    ctx.fillStyle = '#e7e2d4';
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', 100, 13);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(15, 20, 18, 0.68)';
    ctx.fillRect(5, 181, 38, 14);
    ctx.fillStyle = '#d8d2c3';
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillText('200m', 9, 191);

    const closest = [...POI_LOCATIONS].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    const col = String.fromCharCode(65 + Math.max(0, Math.min(9, Math.floor(((x + MAP_SIZE / 2) / MAP_SIZE) * 10))));
    const row = Math.max(1, Math.min(10, Math.floor(((z + MAP_SIZE / 2) / MAP_SIZE) * 10) + 1));
    this.text('hud-location', `${closest.name.toUpperCase()} · ${col}${row}`);
  }

  private renderScoreboard(): void {
    this.el('hud-score-rows').innerHTML = [...this.roster]
      .sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)
      .slice(0, 50)
      .map(p => `<div><span>${escape(p.name)}</span><b>${p.kills}</b><span>${Math.round(p.damageDealt)}</span><small>${p.isEliminated ? 'OUT' : p.isDowned ? 'DOWN' : 'ALIVE'}</small></div>`)
      .join('');
  }

  public showHitMarker(damage?: number, headshot = false, kill = false): void {
    const marker = this.el('hit-marker');
    marker.classList.remove('pop');
    void marker.offsetWidth;
    marker.classList.add('pop');
    marker.style.opacity = '1';
    marker.classList.toggle('headshot', headshot);
    marker.classList.toggle('kill', kill);
    this.text('hud-hit-score', damage ? `${headshot ? 'HEADSHOT · ' : ''}${damage}` : 'HIT');
    this.el('hud-hit-score').style.opacity = '1';
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => {
      marker.style.opacity = '0';
      this.el('hud-hit-score').style.opacity = '0';
    }, kill ? 520 : 260);
  }

  public setFireMode(mode: 'auto' | 'single'): void {
    this.fireMode = mode;
  }

  public setCrosshairSpread(gap: number, hidden = false): void {
    const crosshair = this.el('crosshair');
    crosshair.style.setProperty('--gap', `${Math.round(Math.min(60, Math.max(3, gap)))}px`);
    crosshair.classList.toggle('hidden-cross', hidden);
  }

  public setAction(label: string | null, progress = 0): void {
    const action = this.el('hud-action');
    action.classList.toggle('active', !!label);
    if (label) {
      (action.querySelector('span') as HTMLElement).textContent = label;
      (action.querySelector('b') as HTMLElement).style.transform = `scaleX(${Math.min(1, progress)})`;
    }
  }

  public setDropStatus(text: string | null): void {
    if ((text || '') === this.dropText) return;
    this.dropText = text || '';
    this.el('hud-drop').innerHTML = text || '';
    this.el('hud-drop').classList.toggle('visible', !!text);
  }

  public showElimination(name: string): void {
    this.el('hud-elimination').innerHTML = `<span>ELIMINATED</span><strong>${escape(name.replace('[BOT] ', ''))}</strong><em>+150 XP</em>`;
    this.el('hud-elimination').classList.add('visible');
    window.clearTimeout(this.eliminationTimer);
    this.eliminationTimer = window.setTimeout(() => this.el('hud-elimination').classList.remove('visible'), 2400);
  }

  public showDamageIndicator(attacker: string, bearing: number): void {
    this.el('hud-damage-flash').style.opacity = '1';
    this.el('hud-hit-direction').style.opacity = attacker === 'ZONE' ? '0' : '1';
    this.el('hud-hit-direction').style.transform = `translate(-50%, -50%) rotate(${bearing}rad)`;
    this.text('hud-damage-callout', attacker === 'ZONE' ? 'OUTSIDE SAFE ZONE · MOVE INSIDE' : `UNDER FIRE · ${attacker.replace('[BOT] ', '')}`);
    this.el('hud-damage-callout').style.opacity = '1';
    window.clearTimeout(this.damageHideTimer);
    this.damageHideTimer = window.setTimeout(() => {
      for (const id of ['hud-damage-flash', 'hud-hit-direction', 'hud-damage-callout']) this.el(id).style.opacity = '0';
    }, 1600);
  }

  public setPickupPrompt(label: string | null, color = '#c9cbbd'): void {
    const el = this.el('hud-pickup-prompt');
    this.text('hud-pickup-prompt', label ? `E · ${label}` : '');
    el.style.opacity = label ? '1' : '0';
    el.style.setProperty('--rarity', color);
  }

  public showLootToast(title: string, detail: string): void {
    this.el('hud-loot-toast').innerHTML = `<strong>${escape(title)}</strong><span>${escape(detail)}</span>`;
    this.el('hud-loot-toast').classList.add('visible');
    window.clearTimeout(this.lootToastTimer);
    this.lootToastTimer = window.setTimeout(() => this.el('hud-loot-toast').classList.remove('visible'), 3000);
  }
}
