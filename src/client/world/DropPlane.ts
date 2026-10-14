import * as THREE from 'three';

/** Four-engine transport that carries operators across the valley before the jump. */
export class DropPlane {
  public group = new THREE.Group();
  public start = new THREE.Vector3();
  public end = new THREE.Vector3();
  public speed = 95;
  public progress = 0;
  private props: THREE.Object3D[] = [];
  private length = 1;

  constructor(scene: THREE.Scene) {
    const hull = new THREE.MeshStandardMaterial({ color: 0x5c6553, roughness: .55, metalness: .35 });
    const belly = new THREE.MeshStandardMaterial({ color: 0x8a8f86, roughness: .6, metalness: .3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: .5, metalness: .5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x15232a, roughness: .05, metalness: .9 });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; this.group.add(mesh); return mesh;
    };
    // Rounded fuselage with a lighter belly, tapered tail boom and glazed nose.
    add(new THREE.CapsuleGeometry(2.5, 22, 8, 20), hull, 0, 0, 0, Math.PI / 2).scale.set(1, 1, .95);
    add(new THREE.CapsuleGeometry(2.3, 21, 6, 20, ), belly, 0, -.35, 0, Math.PI / 2).scale.set(.98, 1, .85);
    add(new THREE.CylinderGeometry(.75, 2.45, 11, 20), hull, 0, .55, 16.5, -Math.PI / 2 - .05);
    add(new THREE.SphereGeometry(1.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), glass, 0, 1.3, -12.6, -Math.PI / 2.6).scale.set(1.3, 1, .9);
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) add(new THREE.CircleGeometry(.28, 12), glass, s * 2.48, .9, -8 + i * 2.2, 0, s * Math.PI / 2);
    // Tapered, slightly swept high wing.
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -2.6); wingShape.lineTo(21, -1.4); wingShape.lineTo(21.4, .4); wingShape.lineTo(0, 1.8); wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: .45, bevelEnabled: true, bevelThickness: .12, bevelSize: .12, bevelSegments: 2 });
    for (const s of [-1, 1]) { const w = add(wingGeo, hull, 0, 2.4, -2.5, Math.PI / 2, 0, 0); w.scale.set(s, 1, 1); }
    // Tailplane and fin
    const tailShape = new THREE.Shape(); tailShape.moveTo(0, -1.4); tailShape.lineTo(6.5, -.5); tailShape.lineTo(6.6, .5); tailShape.lineTo(0, 1.2); tailShape.closePath();
    const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: .25, bevelEnabled: false });
    for (const s of [-1, 1]) { const t = add(tailGeo, hull, 0, 2.0, 20.5, Math.PI / 2, 0, 0); t.scale.set(s, 1, 1); }
    const finShape = new THREE.Shape(); finShape.moveTo(0, 0); finShape.lineTo(5, 0); finShape.lineTo(3.4, 6.5); finShape.lineTo(1.8, 6.5); finShape.closePath();
    add(new THREE.ExtrudeGeometry(finShape, { depth: .3, bevelEnabled: false }), hull, -.15, 1.6, 23.5, 0, Math.PI / 2, 0);
    // Engine nacelles with spinners and four-blade props.
    for (const x of [-13, -6.5, 6.5, 13]) {
      add(new THREE.CapsuleGeometry(.75, 3.6, 6, 14), hull, x, 1.6, -3.4, Math.PI / 2);
      add(new THREE.ConeGeometry(.42, 1, 14), dark, x, 1.6, -6.1, -Math.PI / 2);
      const prop = new THREE.Group(); prop.position.set(x, 1.6, -5.8); this.group.add(prop);
      for (let i = 0; i < 4; i++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(.3, 2.8, .06), dark); blade.rotation.z = i * Math.PI / 2; blade.position.y = 0; blade.geometry.translate(0, 1.4, 0); prop.add(blade); }
      this.props.push(prop);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Pick a random straight flight path across the map at drop altitude. */
  public launch(halfSize = 2100, altitude = 520): void {
    const angle = Math.random() * Math.PI * 2;
    const offset = (Math.random() - .5) * halfSize * .9;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(offset);
    this.start.copy(dir).multiplyScalar(-halfSize * 1.1).add(side).setY(altitude);
    this.end.copy(dir).multiplyScalar(halfSize * 1.1).add(side).setY(altitude);
    this.length = this.start.distanceTo(this.end);
    this.progress = 0;
    this.group.visible = true;
    this.group.position.copy(this.start);
    this.group.lookAt(this.end);
    this.group.rotateY(Math.PI);
  }

  public get direction(): THREE.Vector3 { return this.end.clone().sub(this.start).normalize(); }
  public get velocity(): THREE.Vector3 { return this.direction.multiplyScalar(this.speed); }
  public get finished(): boolean { return this.progress >= 1; }

  public update(delta: number): void {
    if (!this.group.visible) return;
    this.progress = Math.min(1.08, this.progress + this.speed * delta / this.length);
    this.group.position.lerpVectors(this.start, this.end, this.progress);
    this.group.position.y += Math.sin(this.progress * 40) * .6;
    for (const prop of this.props) prop.rotation.z += delta * 40;
    if (this.progress >= 1.08) this.group.visible = false;
  }

  public hide(): void { this.group.visible = false; }
}
