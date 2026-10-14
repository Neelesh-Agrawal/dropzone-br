import * as THREE from 'three';
import { OperatorModel } from '../world/OperatorModel';
import { createWeaponModel } from '../world/WeaponModel';
import { WeaponId } from '../../shared/types';

/** One reusable canvas per panel; rendering sleeps while the panel is hidden. */
export class ModelPreview {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.01, 30);
  private model?: THREE.Group;
  private pedestal?: THREE.Mesh;
  private last = performance.now();
  private frame = 0;
  private dragActive = false;
  private lastPointerX = 0;
  private userYaw = 0;
  private autoTime = 0;

  constructor(private kind: 'operator' | 'weapon') {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;

    this.scene.add(new THREE.HemisphereLight(0xe4eff8, 0x4b4e3e, 2.8));
    const key = new THREE.DirectionalLight(0xffe9c8, 4.8);
    key.position.set(2.4, 3.8, 3.2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xa2c6de, 2.4);
    fill.position.set(-3.0, 1.6, 2.2);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffcb85, 3.2);
    rim.position.set(-1.5, 2.4, -3.2);
    this.scene.add(rim);

    if (kind === 'operator') {
      const pedGeo = new THREE.CylinderGeometry(0.72, 0.82, 0.08, 32);
      const pedMat = new THREE.MeshStandardMaterial({ color: 0x222926, roughness: 0.5, metalness: 0.6 });
      this.pedestal = new THREE.Mesh(pedGeo, pedMat);
      this.pedestal.position.set(0, -0.04, 0);
      const ringGeo = new THREE.RingGeometry(0.66, 0.70, 36);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xc8a365, side: THREE.DoubleSide }));
      ring.position.y = 0.042;
      this.pedestal.add(ring);
      this.scene.add(this.pedestal);

      const op = new OperatorModel();
      op.aimPitch = -0.32;
      this.model = op;
      this.userYaw = Math.PI + 0.28;
      this.model.rotation.y = this.userYaw;
      this.scene.add(this.model);
    } else {
      this.userYaw = -Math.PI / 2 + 0.26;
    }

    const canvas = this.renderer.domElement;
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (e) => {
      this.dragActive = true;
      this.lastPointerX = e.clientX;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragActive) return;
      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      this.userYaw += dx * 0.012;
    });
    window.addEventListener('pointerup', () => {
      if (this.dragActive) {
        this.dragActive = false;
        canvas.style.cursor = 'grab';
      }
    });

    this.draw();
  }

  mount(host: HTMLElement) {
    host.appendChild(this.renderer.domElement);
  }

  appearance(color: string, skin: string, outfit: string) {
    (this.model as OperatorModel)?.setAppearance(color, skin, outfit);
  }

  weapon(id: WeaponId, optic = 'optic_reddot', attachments: Record<string, string | null> = {}) {
    if (this.kind === 'operator') {
      (this.model as OperatorModel).setWeapon(id, optic);
      return;
    }
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.model = createWeaponModel(id, { optic, ...attachments });
    this.model.rotation.set(0.08, this.userYaw, -0.06);
    this.scene.add(this.model);
  }

  private draw = () => {
    this.frame = requestAnimationFrame(this.draw);
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const host = this.renderer.domElement.parentElement;
    if (!host || !host.getClientRects().length) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (!this.dragActive) {
      this.autoTime += delta;
    }

    if (this.kind === 'operator') {
      this.camera.position.set(0, 1.02, 3.45);
      this.camera.lookAt(0, 0.94, 0);
      if (this.model instanceof OperatorModel) {
        this.model.rotation.y = this.userYaw + Math.sin(this.autoTime * 0.55) * 0.12;
        this.model.update(delta, 0);
      }
    } else {
      this.camera.position.set(0, 0.035, 0.86);
      this.camera.lookAt(0, 0.01, -0.05);
      if (this.model) {
        const sway = Math.sin(this.autoTime * 0.75) * 0.16;
        this.model.rotation.set(0.08, this.userYaw + sway, -0.04);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };
}
