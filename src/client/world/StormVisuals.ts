import * as THREE from 'three';
import { ZoneState } from '../../shared/types';

export class StormVisuals {
  private scene: THREE.Scene;
  public stormMesh: THREE.Mesh;
  private stormMaterial: THREE.ShaderMaterial;
  public nextZoneMesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // A restrained boundary is only shown when the zone becomes active.
    // A tall wall that fades out with height, so its top edge never shows as
    // a hard arc across the sky; faint scrolling bands keep it readable.
    const stormGeo = new THREE.CylinderGeometry(1, 1, 900, 96, 1, true);
    this.stormMaterial = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0x2f8fff) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform float time; uniform vec3 color; varying vec2 vUv;
        void main(){
          float fade = (1. - smoothstep(.0, .55, vUv.y)) * smoothstep(0., .01, vUv.y);
          float bands = .75 + .25 * sin(vUv.y * 140. - time * 2.) * sin(vUv.x * 400. + time * .5);
          // Bright seam where the wall meets the ground, then a fading curtain.
          float seam = 1.0 - smoothstep(.0, .025, vUv.y);
          gl_FragColor = vec4(color + seam * .5, .48 * fade * bands + seam * .35);
        }`
    });
    this.stormMesh = new THREE.Mesh(stormGeo, this.stormMaterial);
    this.stormMesh.position.y = 430;
    this.stormMesh.visible = false;
    this.scene.add(this.stormMesh);

    // Next Safe Zone Ring Indicator (dashed ring)
    const ringGeo = new THREE.RingGeometry(0.98, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x66dfff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    this.nextZoneMesh = new THREE.Mesh(ringGeo, ringMat);
    this.nextZoneMesh.position.y = 1.0;
    this.nextZoneMesh.visible = false;
    this.scene.add(this.nextZoneMesh);
  }

  public updateZone(zoneState: ZoneState): void {
    if (!zoneState) return;
    this.stormMaterial.uniforms.time.value = performance.now() / 1000;
    this.stormMesh.visible = true;
    // The next circle is shown on the minimap/tactical map only (as in PUBG);
    // in-world, a ring thousands of metres wide reads as a glitch from the air.
    this.nextZoneMesh.visible = false;

    // Smoothly scale storm cylinder to currentRadius
    const r = Math.max(1, zoneState.currentRadius);
    this.stormMesh.scale.set(r, 1, r);
    this.stormMesh.position.x = zoneState.currentCenter.x;
    this.stormMesh.position.z = zoneState.currentCenter.z;

    // Next zone ring scale & position
    const tr = Math.max(1, zoneState.targetRadius);
    this.nextZoneMesh.scale.set(tr, 1, tr);
    this.nextZoneMesh.position.x = zoneState.targetCenter.x;
    this.nextZoneMesh.position.z = zoneState.targetCenter.z;
  }
}
