// Mixes captured game SFX over the score (music ducks under gunfire) and muxes
// the result into the trailer video.
//   node scripts/mix-trailer.mjs <video.mp4> <sfx.wav> <music.wav> <out.mp4>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [video, sfxPath, musicPath, out] = process.argv.slice(2);
const read = file => { const b = fs.readFileSync(file); return new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length)); };
const sfx = read(sfxPath), music = read(musicPath);
const frames = Math.max(sfx.length, music.length) / 2;
const SR = 44100, MUSIC = .6, SFX = 1.15;
const mix = new Int16Array(frames * 2);
let env = 0;
const attack = 1 - Math.exp(-1 / (SR * .005)), release = 1 - Math.exp(-1 / (SR * .3));
for (let i = 0; i < frames; i++) {
  const sl = (sfx[i * 2] ?? 0) / 32768, sr = (sfx[i * 2 + 1] ?? 0) / 32768;
  const level = Math.max(Math.abs(sl), Math.abs(sr));
  env += (level - env) * (level > env ? attack : release);
  // Duck the score by up to ~6 dB while weapons fire.
  const duck = 1 - .5 * Math.min(1, env / .35);
  const ml = (music[i * 2] ?? 0) / 32768, mr = (music[i * 2 + 1] ?? 0) / 32768;
  mix[i * 2] = Math.round(Math.tanh(ml * MUSIC * duck + sl * SFX) * .97 * 32767);
  mix[i * 2 + 1] = Math.round(Math.tanh(mr * MUSIC * duck + sr * SFX) * .97 * 32767);
}
const pcm = Buffer.from(mix.buffer);
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
const mixPath = out.replace(/\.mp4$/, '-mix.wav');
fs.writeFileSync(mixPath, Buffer.concat([header, pcm]));
const result = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', video, '-i', mixPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', out], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Wrote ${out}`);
