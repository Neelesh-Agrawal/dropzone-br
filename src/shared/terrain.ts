import { MAP_SIZE, POI_LOCATIONS } from './constants';
export function getTerrainHeight(x: number, z: number): number {
    // Distance from center
    const distFromCenter = Math.sqrt(x * x + z * z);
    
    // Base noise
    let h = Math.sin(x * 0.005) * Math.cos(z * 0.005) * 12 +
            Math.sin(x * 0.015 + 1.2) * Math.cos(z * 0.012 + 0.5) * 6 +
            Math.sin(x * 0.03 + 2.5) * Math.cos(z * 0.025 + 1.1) * 2;

    // Boundary ridges keep players inside. They rise out of the base terrain
    // (no seam) with irregular peaks so the horizon reads as mountains.
    const band = MAP_SIZE / 2 - 260;
    if (Math.abs(x) > band || Math.abs(z) > band) {
      const edgeDist = Math.max(Math.abs(x), Math.abs(z)) - band;
      // Broad, rolling ridgelines (~60-120 m) rather than spiky cones.
      const ridge = .78 + .22 * Math.sin(x * .0045 + z * .003) * Math.cos(z * .006 - x * .002) + .07 * Math.sin(x * .017 + 1.3) * Math.sin(z * .015);
      return Math.max(h, 0) + Math.pow(edgeDist * .12, 1.35) * ridge;
    }

    // POI Specific Height Adjustments
    for (const poi of POI_LOCATIONS) {
      const dx = x - poi.x;
      const dz = z - poi.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < poi.radius) {
        const factor = d < poi.radius * .78 ? 1 : Math.cos(((d / poi.radius - .78) / .22) * (Math.PI / 2));
        if (poi.name === 'Radio Ridge') {
          h += factor * poi.elevation;
        } else if (poi.name === 'Quarry') {
          h += factor * poi.elevation; // excavation hole
        } else if (poi.name === 'Central Depot' || poi.name === 'Harbor') {
          // Flatten industrial areas for reliable vehicle and building placement.
          h = h * (1 - factor) + 1.5 * factor;
        } else if (['Old Town', 'Farmstead', 'West Camp', 'South Village', 'East Airfield'].includes(poi.name)) {
          // Keep settlements above the water plane and on a readable grassy pad.
          h = h * (1 - factor) + 1.5 * factor;
        } else {
          h += factor * poi.elevation;
        }
      }
    }

    return Math.max(-4.2, h);
  }

