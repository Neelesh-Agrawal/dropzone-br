import * as THREE from 'three';

/**
 * Disabled floating dust motes so the player never sees distracting
 * screen blinks or floating dots while sprinting across the map.
 */
export class CombatAtmosphere {
  constructor(_scene: THREE.Scene) {}
  public update(_delta: number, _position: THREE.Vector3, _active: boolean): void {}
}
