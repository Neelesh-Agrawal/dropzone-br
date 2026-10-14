// Burns animated captions onto a finished trailer (no re-render needed).
//   node scripts/caption-trailer.mjs <in.mp4> <out.mp4>
// Each caption is drawn once in Chrome (same fonts as the game), saved as a
// transparent PNG, then slid + faded in over its time window by ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';

const [input, out] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// start/end in seconds of the trailer; side = which edge the caption hugs.
const CAPTIONS = [
  { start: 26.0, end: 29.9, side: 'left', kicker: 'VIPER AR · FULL AUTO', headline: "LIGHT 'EM UP" },
  { start: 37.7, end: 39.4, side: 'right', kicker: 'LONGBOW SNIPER · 4× SCOPE', headline: 'ONE SHOT. ONE KILL.' },
  { start: 40.0, end: 44.2, side: 'right', kicker: "DRIVABLE BUGGIES · RUN 'EM DOWN", headline: 'RIDE OR DIE' }
];

const html = c => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@700&family=Teko:wght@600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1920px;height:1080px;background:transparent}
  .cap{position:absolute;top:560px;${c.side}:90px;text-align:${c.side};color:#f2ecdc;text-shadow:0 4px 22px #000c,0 2px 4px #000a}
  .cap::before{content:'';position:absolute;z-index:-1;top:-50px;bottom:-40px;${c.side}:-90px;width:calc(100% + 260px);background:linear-gradient(to ${c.side === 'left' ? 'right' : 'left'},#000000a0,#00000070 55%,transparent);-webkit-mask-image:linear-gradient(transparent,#000 30%,#000 70%,transparent)}
  .kicker{font:700 22px Inter,sans-serif;letter-spacing:.32em;color:#edc27c;display:flex;align-items:center;gap:16px;justify-content:${c.side === 'left' ? 'flex-start' : 'flex-end'}}
  .bar{width:46px;height:4px;background:#edc27c;box-shadow:0 2px 10px #0008}
  .head{font:600 118px/0.9 Teko,sans-serif;letter-spacing:.04em;margin-top:10px}
</style></head><body><div class="cap">
  <div class="kicker">${c.side === 'left' ? '<span class="bar"></span>' : ''}${c.kicker}${c.side === 'right' ? '<span class="bar"></span>' : ''}</div>
  <div class="head">${c.headline}</div>
</div></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-captions-'));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const pngs = [];
for (const [i, c] of CAPTIONS.entries()) {
  await page.setContent(html(c), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(dir, `cap-${i}.png`);
  await page.screenshot({ path: file, omitBackground: true });
  pngs.push(file);
}
await browser.close();

// Ease-out slide of 70 px from the caption's own edge, plus alpha fades.
const inputs = ['-i', input];
const filters = [];
let last = '0:v';
for (const [i, c] of CAPTIONS.entries()) {
  inputs.push('-loop', '1', '-t', String(c.end + .1), '-i', pngs[i]);
  const dirSign = c.side === 'left' ? -1 : 1;
  filters.push(`[${i + 1}:v]format=rgba,fade=in:st=${c.start}:d=0.3:alpha=1,fade=out:st=${(c.end - .4).toFixed(2)}:d=0.4:alpha=1[c${i}]`);
  filters.push(`[${last}][c${i}]overlay=x='${dirSign * 70}*pow(max(0,1-(t-${c.start})/0.45),3)':y=0:enable='between(t,${c.start},${c.end})':eval=frame[v${i}]`);
  last = `v${i}`;
}
const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', `[${last}]`, '-map', '0:a',
  '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.rmSync(dir, { recursive: true, force: true });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Wrote ${out}`);
