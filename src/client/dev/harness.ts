/**
 * Development-only helpers for automated playtesting and video capture.
 * Loaded only by `vite dev` (import.meta.env.DEV); never shipped in builds.
 */
type Game = {
  animate(): void;
  lastFrame: number;
  renderer: { render: (...args: unknown[]) => void };
};

declare global {
  interface Window {
    __dropzone: Game;
    __harness: Harness;
  }
}

export class Harness {
  private realRaf = window.requestAnimationFrame.bind(window);
  private paused = false;

  /** Stop the browser-driven loop so frames advance only via step(). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    (window.__dropzone as unknown as { qualityLocked: boolean }).qualityLocked = true;
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    window.requestAnimationFrame = this.realRaf;
    window.__dropzone.lastFrame = performance.now();
    window.__dropzone.animate();
  }

  /** Advance game time deterministically. Rendering is skipped unless asked for. */
  step(seconds: number, fps = 60, render = false): void {
    const game = window.__dropzone;
    const realRender = game.renderer.render;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
    if (!render) game.renderer.render = () => { /* fast-forward */ };
    const frames = Math.max(1, Math.round(seconds * fps));
    try {
      for (let i = 0; i < frames; i++) {
        game.lastFrame = performance.now() - 1000 / fps;
        game.animate();
      }
    } finally {
      game.renderer.render = realRender;
      window.requestAnimationFrame = raf;
    }
  }

  /** Render exactly one frame at the given timestep. */
  frame(fps = 30): void { this.step(1 / fps, fps, true); }

  /** Start a solo match and put the player on the ground at (x, z) facing yaw. */
  land(x: number, z: number, yaw = 0, firstPerson = false): void {
    const g = window.__dropzone as unknown as {
      lobbyUI: { onStartMatchCallback(): void };
      playerController: { jumpFromPlane(): void; position: { set(x: number, y: number, z: number): void }; yaw: number; pitch: number; cameraMode: string };
      map: { getTerrainHeight(x: number, z: number): number };
    };
    this.pause();
    g.lobbyUI.onStartMatchCallback();
    this.step(.5);
    g.playerController.jumpFromPlane();
    g.playerController.position.set(x, g.map.getTerrainHeight(x, z) + 2.5, z);
    g.playerController.yaw = yaw; g.playerController.pitch = 0;
    g.playerController.cameraMode = firstPerson ? 'FPS' : 'TPS';
    this.step(2);
  }

  key(code: string, down: boolean): void {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  }
}

window.__harness = new Harness();
void import('./director');
