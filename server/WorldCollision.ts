import * as THREE from 'three';
import { BuildingGenerator } from '../src/client/world/BuildingGenerator';
import type { AshenValleyMap } from '../src/client/world/AshenValleyMap';
import { getTerrainHeight } from '../src/shared/terrain';
import type { Vector3Data } from '../src/shared/types';

// Build the same deterministic static geometry once; only retain collision bounds.
const scene = new THREE.Scene();
const world = new BuildingGenerator(scene, { getTerrainHeight } as AshenValleyMap, false);
scene.updateMatrixWorld(true);
const boxes = world.buildings.map(mesh => new THREE.Box3().setFromObject(mesh));
scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(m=>m.dispose()); } });
scene.clear();
export function wallDistance(origin: Vector3Data, direction: Vector3Data, max: number): number {
  const ray = new THREE.Ray(new THREE.Vector3(origin.x,origin.y,origin.z),new THREE.Vector3(direction.x,direction.y,direction.z));
  const point = new THREE.Vector3();
  for (const box of boxes) if (ray.intersectBox(box,point)) max=Math.min(max,point.distanceTo(ray.origin));
  return max;
}
export function blocksMovement(position: Vector3Data): boolean {
  const body=new THREE.Box3(new THREE.Vector3(position.x-.28,position.y-1.25,position.z-.28),new THREE.Vector3(position.x+.28,position.y+.15,position.z+.28));
  return boxes.some(box=>box.intersectsBox(body));
}
