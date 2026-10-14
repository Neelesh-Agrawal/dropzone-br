import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Colour grade: saturation, contrast, split toning, vignette and fine grain. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uResolution; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(.2126, .7152, .0722));
      // Vibrant next-gen saturation & crisp S-curve contrast without muddy darkening
      c = max(mix(vec3(l), c, 1.18), 0.0);
      c = max((c - .14) * 1.09 + .15, 0.0);
      // Clean sapphire shadow tint, luminous sunlit highlights
      c *= mix(vec3(.95, .99, 1.06), vec3(1.04, 1.01, .96), smoothstep(.05, .62, l));
      vec2 d = vUv - .5; d.x *= uResolution.x / uResolution.y;
      c *= mix(.90, 1.0, smoothstep(1.05, .36, length(d)));
      c += (hash(vUv * uResolution + fract(uTime) * 91.7) - .5) * .0015;
      gl_FragColor = vec4(c, 1.0);
    }`
};

export type FxQuality = 'high' | 'medium' | 'low';

/**
 * Post-processing chain. The weapon view model renders as a second pass on
 * top of the world (after clearing depth) so it never clips into walls.
 * 'low' bypasses the composer entirely.
 */
export class PostFX {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private viewModelPass: RenderPass;
  private worldPass: RenderPass;
  public quality: FxQuality = 'high';

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, private viewModelScene: THREE.Scene, private viewModelCamera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.worldPass = new RenderPass(scene, camera);
    this.viewModelPass = new RenderPass(viewModelScene, viewModelCamera);
    this.viewModelPass.clear = false;
    this.viewModelPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), .34, .45, 1.12);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.viewModelPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setSize(window.innerWidth, window.innerHeight);
  }

  public setQuality(quality: FxQuality): void {
    this.quality = quality;
    this.bloom.enabled = quality === 'high';
  }

  public setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.grade.uniforms.uResolution.value.set(width, height);
  }

  /** loom false skips the glow (e.g. in the lobby, where the backdrop art should stay crisp). */
  public render(viewModel: boolean, time: number, bloom = true): void {
    if (this.quality === 'low') {
      this.renderer.render(this.scene, this.camera);
      if (viewModel) {
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.viewModelScene, this.viewModelCamera);
        this.renderer.autoClear = true;
      }
      return;
    }
    this.viewModelPass.enabled = viewModel;
    this.bloom.enabled = bloom && this.quality === 'high';
    this.grade.uniforms.uTime.value = time;
    this.composer.render();
  }
}
