import { PlayerState, ZoneState, PingMarker } from '../../shared/types';
import { MAP_SIZE, POI_LOCATIONS } from '../../shared/constants';
import { getTopographicMapCanvas } from './MapCanvas';

export class TacticalMapUI {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private isOpen: boolean = false;
  public enabled: boolean = false;
  public onPingCallback?: (worldPos: { x: number; z: number }) => void;
  public onVisibilityChange?: (visible: boolean) => void;
  public vehicleLocations: { x: number; z: number }[] = [];
  public flightPath: { startX: number; startZ: number; endX: number; endZ: number } | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'map-ui-root';
    this.container.className = 'map-modal-backdrop';
    this.render();
    parent.appendChild(this.container);

    this.canvas = document.getElementById('tactical-map-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.initEvents();
    this.hide();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="map-modal-shell">
        <div class="map-header">
          <div>
            <span class="map-kicker">SAT-RECON // SECTOR ASHEN VALLEY (5.0 × 5.0 KM)</span>
            <h2 class="map-title">TACTICAL OPERATIONS MAP</h2>
          </div>
          <div class="map-legend-row">
            <span class="map-legend-chip"><i style="background:#f5d061"></i>YOU</span>
            <span class="map-legend-chip"><i style="background:#56d8c0"></i>SAFE ZONE</span>
            <span class="map-legend-chip"><i style="background:#d96248"></i>STORM WALL</span>
            <span class="map-legend-chip"><i style="background:#b8c794"></i>VEHICLE</span>
            <button id="btn-close-map" class="map-close-btn">CLOSE [M / ESC]</button>
          </div>
        </div>
        <div class="map-canvas-frame">
          <canvas id="tactical-map-canvas" width="760" height="760"></canvas>
        </div>
        <div class="map-footer-bar">
          <span>LEFT CLICK MAP TO TRANSMIT SQUAD WAYPOINT PING</span>
          <span id="map-coord-readout">GRID SECTOR: E5 · ALTITUDE LOCKED</span>
        </div>
      </div>
    `;
  }

  private initEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.repeat) return;
      if (e.code === 'KeyM' && this.enabled) {
        if (this.isOpen) this.hide();
        else this.show();
      } else if (e.code === 'Escape' && this.isOpen) {
        this.hide();
      }
    });

    document.getElementById('btn-close-map')?.addEventListener('click', () => {
      this.hide();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const nx = Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width));
      const nz = Math.max(0, Math.min(0.999, (e.clientY - rect.top) / rect.height));
      const col = String.fromCharCode(65 + Math.floor(nx * 10));
      const row = Math.floor(nz * 10) + 1;
      const wx = Math.round((nx - 0.5) * MAP_SIZE);
      const wz = Math.round((nz - 0.5) * MAP_SIZE);
      const readout = document.getElementById('map-coord-readout');
      if (readout) readout.textContent = `CURSOR GRID: ${col}${row}  ·  UTM (${wx}m, ${wz}m)`;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.onPingCallback) {
        const rect = this.canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        const worldX = ((clickX / rect.width) - 0.5) * MAP_SIZE;
        const worldZ = ((clickY / rect.height) - 0.5) * MAP_SIZE;

        this.onPingCallback({ x: worldX, z: worldZ });
      }
    });
  }

  public drawMap(localPlayer: PlayerState, allPlayers: PlayerState[], zone: ZoneState, pings: PingMarker[]): void {
    if (!this.isOpen) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    // 1. Draw cached satellite topographic base map
    const topo = getTopographicMapCanvas();
    ctx.drawImage(topo, 0, 0, w, h);

    const worldToCanvasX = (wx: number) => ((wx + MAP_SIZE / 2) / MAP_SIZE) * w;
    const worldToCanvasY = (wz: number) => ((wz + MAP_SIZE / 2) / MAP_SIZE) * h;

    // 2. 10x10 Military Grid Overlay (A-J, 1-10)
    ctx.strokeStyle = 'rgba(231, 226, 212, 0.14)';
    ctx.lineWidth = 1;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(231, 226, 212, 0.55)';
    for (let i = 0; i <= 10; i++) {
      const pos = (i / 10) * w;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, h);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(w, pos);
      ctx.stroke();

      if (i < 10) {
        ctx.textAlign = 'center';
        ctx.fillText(String.fromCharCode(65 + i), pos + w / 20, 14);
        ctx.textAlign = 'left';
        ctx.fillText(String(i + 1), 6, pos + h / 20 + 4);
      }
    }

    // 3. Draw Named POI Callouts with clean military stencil badges
    for (const poi of POI_LOCATIONS) {
      const px = worldToCanvasX(poi.x);
      const py = worldToCanvasY(poi.z);
      const label = poi.name.toUpperCase();

      ctx.font = '700 11px "Barlow Condensed", sans-serif';
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15, 20, 18, 0.78)';
      ctx.strokeStyle = 'rgba(200, 163, 101, 0.52)';
      ctx.lineWidth = 1;
      ctx.fillRect(px - textW / 2 - 6, py - 8, textW + 12, 16);
      ctx.strokeRect(px - textW / 2 - 6, py - 8, textW + 12, 16);

      ctx.fillStyle = '#ece6d8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px, py + 0.5);
    }

    // 4. Draw Scout Runner Vehicle Locations
    for (const v of this.vehicleLocations) {
      const vx = worldToCanvasX(v.x);
      const vy = worldToCanvasY(v.z);
      ctx.save();
      ctx.translate(vx, vy);
      ctx.fillStyle = '#b8c794';
      ctx.strokeStyle = '#141917';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-4.5, -3, 9, 6);
      ctx.strokeRect(-4.5, -3, 9, 6);
      ctx.restore();
    }

    // 5. Draw Drop Plane Flight Path when active
    if (this.flightPath) {
      const sx = worldToCanvasX(this.flightPath.startX);
      const sz = worldToCanvasY(this.flightPath.startZ);
      const ex = worldToCanvasX(this.flightPath.endX);
      const ez = worldToCanvasY(this.flightPath.endZ);
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 208, 97, 0.68)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, sz);
      ctx.lineTo(ex, ez);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 6. Draw Storm Wall & Next Safe Zone Ring
    const curX = worldToCanvasX(zone.currentCenter.x);
    const curY = worldToCanvasY(zone.currentCenter.z);
    const curR = (zone.currentRadius / MAP_SIZE) * w;

    // Tint storm area outside current zone using even-odd fill
    ctx.save();
    ctx.fillStyle = 'rgba(185, 58, 42, 0.18)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(curX, curY, curR, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    ctx.strokeStyle = 'rgba(225, 92, 68, 0.92)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(curX, curY, curR, 0, Math.PI * 2);
    ctx.stroke();

    const tarX = worldToCanvasX(zone.targetCenter.x);
    const tarY = worldToCanvasY(zone.targetCenter.z);
    const tarR = (zone.targetRadius / MAP_SIZE) * w;

    ctx.strokeStyle = 'rgba(236, 232, 220, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(tarX, tarY, tarR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 7. Draw Squad Members & Local Operator with FOV Cone + Directional Chevron
    const squadPlayers = allPlayers.filter((p) => p.squadId === localPlayer.squadId && !p.isEliminated);
    for (const p of squadPlayers) {
      const px = worldToCanvasX(p.position.x);
      const py = worldToCanvasY(p.position.z);
      const isMe = p.id === localPlayer.id;

      if (isMe) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-p.rotation.yaw);

        // Tactical view cone
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 44);
        grad.addColorStop(0, 'rgba(245, 208, 97, 0.38)');
        grad.addColorStop(1, 'rgba(245, 208, 97, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 44, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
        ctx.closePath();
        ctx.fill();

        // Directional operator chevron
        ctx.fillStyle = '#f5d061';
        ctx.strokeStyle = '#111615';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(6.5, 6.5);
        ctx.lineTo(0, 3.2);
        ctx.lineTo(-6.5, 6.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = p.color || '#56d8c0';
        ctx.strokeStyle = '#111615';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = '#f7f3e8';
      ctx.font = '700 11px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isMe ? 'YOU' : p.name, px, py - 14);
    }

    // 8. Draw Squad Waypoint Pings with animated pulse rings
    const pulse = (performance.now() % 1200) / 1200;
    for (const ping of pings) {
      const px = worldToCanvasX(ping.position.x);
      const py = worldToCanvasY(ping.position.z);

      ctx.strokeStyle = `rgba(245, 196, 81, ${1 - pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 6 + pulse * 18, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#f5c451';
      ctx.strokeStyle = '#141816';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f5c451';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ping.playerName.toUpperCase(), px, py + 15);
    }
  }

  public show(): void {
    this.isOpen = true;
    this.container.style.display = 'flex';
    this.onVisibilityChange?.(true);
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  public hide(): void {
    this.isOpen = false;
    this.container.style.display = 'none';
    this.onVisibilityChange?.(false);
  }
}
