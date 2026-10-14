import { MAP_SIZE, POI_LOCATIONS } from '../../shared/constants';
import { getTerrainHeight } from '../../shared/terrain';
import { WATER_LEVEL } from '../world/Environment';

let cachedMapCanvas: HTMLCanvasElement | null = null;

/**
 * Generates and caches a 1024x1024 military satellite & topographic terrain canvas
 * directly from Ashen Valley's heightfield, water level, road network, and POI sectors.
 */
export function getTopographicMapCanvas(): HTMLCanvasElement {
  if (cachedMapCanvas) return cachedMapCanvas;

  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Pre-sample height grid for fast normal & contour calculation
  const heights = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    const wz = ((py / size) - 0.5) * MAP_SIZE;
    for (let px = 0; px < size; px++) {
      const wx = ((px / size) - 0.5) * MAP_SIZE;
      heights[py * size + px] = getTerrainHeight(wx, wz);
    }
  }

  const sunX = 0.58;
  const sunY = 0.52;
  const sunZ = 0.62;
  const stepMeters = MAP_SIZE / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = py * size + px;
      const h = heights[idx];
      const hx = heights[py * size + Math.min(size - 1, px + 1)] - heights[py * size + Math.max(0, px - 1)];
      const hz = heights[Math.min(size - 1, py + 1) * size + px] - heights[Math.max(0, py - 1) * size + px];

      // Surface normal for hillshading
      const nx = -hx / (2 * stepMeters);
      const nz = -hz / (2 * stepMeters);
      const ny = 1.0;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const shade = Math.max(0.32, Math.min(1.28, (nx * sunX + ny * sunY + nz * sunZ) / nLen * 1.18 + 0.15));
      const slope = 1 - ny / nLen;

      let r = 0;
      let g = 0;
      let b = 0;

      if (h < WATER_LEVEL) {
        const depth = Math.min(1, (WATER_LEVEL - h) / 4.2);
        // Crystal coastal turquoise to deep sapphire navy
        r = 12 + (1 - depth) * 34;
        g = 86 + (1 - depth) * 96;
        b = 128 + (1 - depth) * 78;
        // White shoreline surf line right at the water's edge
        if (WATER_LEVEL - h < 0.45) {
          r += 52;
          g += 58;
          b += 54;
        }
      } else {
        const aboveWater = h - WATER_LEVEL;
        if (aboveWater < 2.0) {
          // Golden sandy shoreline / littoral bank
          r = 198;
          g = 178;
          b = 132;
        } else if (h < 32) {
          // Lush emerald valley floor & meadow
          const t = (h - WATER_LEVEL) / 28;
          r = 42 + t * 24;
          g = 112 + t * 26;
          b = 58 + t * 14;
        } else if (h < 78) {
          // Mid-altitude alpine pine & highland
          const t = (h - 32) / 46;
          r = 66 + t * 38;
          g = 132 + t * 14;
          b = 72 + t * 24;
        } else {
          // Alpine granite ridge & snow-dusted summit
          const t = Math.min(1, (h - 78) / 55);
          r = 118 + t * 88;
          g = 126 + t * 84;
          b = 112 + t * 94;
        }

        // Steep cliff scree darkening
        if (slope > 0.22) {
          const rockBlend = Math.min(0.65, (slope - 0.22) * 2.2);
          r = r * (1 - rockBlend) + 92 * rockBlend;
          g = g * (1 - rockBlend) + 88 * rockBlend;
          b = b * (1 - rockBlend) + 78 * rockBlend;
        }

        r *= shade;
        g *= shade;
        b *= shade;

        // Topographic elevation contour lines every 14m (major every 42m)
        const contourMod = ((h % 14) + 14) % 14;
        const majorMod = ((h % 42) + 42) % 42;
        if (majorMod < 0.55) {
          r *= 0.72;
          g *= 0.74;
          b *= 0.70;
        } else if (contourMod < 0.42) {
          r *= 0.85;
          g *= 0.86;
          b *= 0.84;
        }
      }

      const outIdx = idx * 4;
      data[outIdx] = Math.max(0, Math.min(255, r));
      data[outIdx + 1] = Math.max(0, Math.min(255, g));
      data[outIdx + 2] = Math.max(0, Math.min(255, b));
      data[outIdx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const toPx = (wx: number) => ((wx + MAP_SIZE / 2) / MAP_SIZE) * size;

  // Draw the main valley ring road & spur roads connecting POIs
  const ringOrder = [0, 3, 2, 7, 1, 8, 4, 6, 0];
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Road casing
  ctx.strokeStyle = 'rgba(24, 26, 22, 0.78)';
  ctx.lineWidth = 6.5;
  ctx.beginPath();
  ringOrder.forEach((poiIdx, i) => {
    const p = POI_LOCATIONS[poiIdx];
    if (i === 0) ctx.moveTo(toPx(p.x), toPx(p.z));
    else ctx.lineTo(toPx(p.x), toPx(p.z));
  });
  // Cross-valley highway through Military Base (5)
  ctx.moveTo(toPx(POI_LOCATIONS[0].x), toPx(POI_LOCATIONS[0].z));
  ctx.lineTo(toPx(POI_LOCATIONS[5].x), toPx(POI_LOCATIONS[5].z));
  ctx.lineTo(toPx(POI_LOCATIONS[1].x), toPx(POI_LOCATIONS[1].z));
  ctx.moveTo(toPx(POI_LOCATIONS[2].x), toPx(POI_LOCATIONS[2].z));
  ctx.lineTo(toPx(POI_LOCATIONS[5].x), toPx(POI_LOCATIONS[5].z));
  ctx.lineTo(toPx(POI_LOCATIONS[4].x), toPx(POI_LOCATIONS[4].z));
  ctx.stroke();

  // Asphalt fill
  ctx.strokeStyle = 'rgba(168, 152, 114, 0.72)';
  ctx.lineWidth = 3.2;
  ctx.stroke();

  // Draw POI compound perimeters & building blocks on the topo map
  for (const poi of POI_LOCATIONS) {
    const cx = toPx(poi.x);
    const cz = toPx(poi.z);
    const pr = (poi.radius / MAP_SIZE) * size;

    ctx.fillStyle = 'rgba(32, 36, 30, 0.28)';
    ctx.beginPath();
    ctx.arc(cx, cz, pr * 0.72, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(212, 186, 122, 0.42)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(cx, cz, pr * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Architectural building footprints inside each POI
    ctx.fillStyle = 'rgba(218, 204, 174, 0.72)';
    ctx.strokeStyle = 'rgba(22, 26, 22, 0.85)';
    ctx.lineWidth = 1;
    for (let b = 0; b < 9; b++) {
      const a = b * 2.1 + poi.x * 0.01;
      const dist = (0.18 + (b % 3) * 0.2) * pr;
      const bx = cx + Math.cos(a) * dist;
      const bz = cz + Math.sin(a) * dist;
      const bw = 4 + (b % 3) * 2.5;
      const bh = 3.5 + ((b + 1) % 2) * 2.5;
      ctx.save();
      ctx.translate(bx, bz);
      ctx.rotate(a * 0.5);
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
    }
  }
  ctx.restore();

  cachedMapCanvas = canvas;
  return canvas;
}
