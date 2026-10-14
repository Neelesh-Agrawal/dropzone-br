import { Vector3Data } from './types';

/** Eye-position player convention. Returns the closest ray/sphere intersection. */
export function raySphere(origin: Vector3Data, dir: Vector3Data, center: Vector3Data, radius: number): number | null {
  const x = center.x - origin.x, y = center.y - origin.y, z = center.z - origin.z;
  const projection = x * dir.x + y * dir.y + z * dir.z;
  const perpendicular = x*x + y*y + z*z - projection*projection;
  if (perpendicular > radius*radius) return null;
  const offset = Math.sqrt(Math.max(0, radius*radius - perpendicular));
  const near = projection - offset, far = projection + offset;
  return far < 0 ? null : Math.max(0, near);
}

export function playerHit(origin: Vector3Data, dir: Vector3Data, eye: Vector3Data): { distance: number; headshot: boolean } | null {
  const head = raySphere(origin, dir, { ...eye, y: eye.y + .08 }, .25);
  const torso = raySphere(origin, dir, { ...eye, y: eye.y - .55 }, .43);
  const legs = raySphere(origin, dir, { ...eye, y: eye.y - 1.12 }, .35);
  const body = Math.min(torso ?? Infinity, legs ?? Infinity);
  if (head !== null && head < body) return { distance: head, headshot: true };
  return Number.isFinite(body) ? { distance: body, headshot: false } : null;
}
