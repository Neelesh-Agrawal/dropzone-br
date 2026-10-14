// Records trailer / gameplay videos by stepping the game frame-by-frame in a
// real Chrome (GPU) and piping screenshots into ffmpeg. Requires `npm run dev`.
//   node scripts/record.mjs --sequence trailer      (cinematic cuts + titles)
//   node scripts/record.mjs --sequence gameplay     (HUD on, game cameras only)
//   node scripts/record.mjs --only plane,drive --stills
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : fallback; };
const sequenceName = arg('sequence', 'trailer');
const fps = Number(arg('fps', 30));
const width = Number(arg('width', 1920)), height = Number(arg('height', 1080));
const url = arg('url', 'http://localhost:5173/');
const headed = !!arg('headed', false);
const stills = !!arg('stills', false);
const SEQUENCES = {
  trailer: ['lobby', 'plane', 'freefall', 'parachute', 'landing', 'loot', 'fpsFight', 'tpsFight', 'sniper', 'drive', 'zone', 'outro'],
  gameplay: ['plane', 'freefall', 'parachute', 'landing', 'loot', 'fpsFight', 'tpsFight', 'sniper', 'drive']
};
const shots = arg('only', null) ? String(arg('only')).split(',') : SEQUENCES[sequenceName];
const cinematic = sequenceName !== 'gameplay';
const outDir = path.resolve('recordings');
fs.mkdirSync(path.join(outDir, 'stills'), { recursive: true });
const outFile = path.join(outDir, `dropzone-${arg('only', null) ? 'preview' : sequenceName}.mp4`);

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const browser = await chromium.launch({
  executablePath: chrome,
  headless: !headed,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', `--window-size=${width},${height}`, '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('[page error]', e.message));
await page.addInitScript(() => {
  localStorage.setItem('dropzone_profile', JSON.stringify({ name: 'Ghost', color: '#5d6b4c', level: 7, xp: 6420, skin: '#c99672', outfit: 'armor', weaponId: 'viper_ar', opticId: 'optic_reddot' }));
});
await page.goto(url);
await page.waitForFunction(() => window.__harness && window.__director && document.querySelector('#lobby-screen')?.style.display === 'flex', null, { timeout: 60000 });
await page.waitForTimeout(2500); // let the operator model and fonts settle
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
console.log(`GPU: ${gpu}`);
if (/SwiftShader|Basic Render/i.test(gpu) && !headed) console.warn('Software rendering detected; re-run with --headed for GPU capture.');

await page.evaluate(c => { window.__cinematic = c; window.__harness.pause(); window.__director.startAudioLog(); window.__videoTime = 0; }, cinematic);

const encoder = spawn(ffmpegPath, ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'ignore', 'inherit'] });

const dt = 1 / fps;
let total = 0;
const started = Date.now();
for (const name of shots) {
  const duration = await page.evaluate(n => { const s = window.__director.SHOTS[n]; s.setup(); window.__shotT = 0; return s.duration; }, name);
  const frames = Math.round(duration * fps);
  process.stdout.write(`${name} (${frames} frames) `);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(({ n, dt, vt }) => {
      window.__videoTime = vt;
      const s = window.__director.SHOTS[n];
      s.frame(window.__shotT, dt);
      window.__harness.step(dt, 1 / dt, true);
      window.__shotT += dt;
    }, { n: name, dt, vt: total / fps });
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!encoder.stdin.write(jpeg)) await new Promise(r => encoder.stdin.once('drain', r));
    if (stills && i === Math.floor(frames * .45)) await page.screenshot({ path: path.join(outDir, 'stills', `${String(shots.indexOf(name) + 1).padStart(2, '0')}-${name}.png`) });
    total++;
  }
  await page.evaluate(n => window.__director.SHOTS[n].teardown?.(), name);
  console.log('✓');
}
encoder.stdin.end();
await new Promise(r => encoder.on('close', r));
// Replay the logged game sounds offline, sample-accurate to the frames.
const sfxBase64 = await page.evaluate(d => window.__director.renderAudio(d), total / fps);
const pcm = Buffer.from(sfxBase64, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(44100, 24);
header.writeUInt32LE(44100 * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
const sfxFile = outFile.replace(/\.mp4$/, '-sfx.wav');
fs.writeFileSync(sfxFile, Buffer.concat([header, pcm]));
console.log(`Wrote ${sfxFile}`);
await browser.close();
console.log(`Wrote ${outFile} — ${total} frames (${(total / fps).toFixed(1)} s) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
