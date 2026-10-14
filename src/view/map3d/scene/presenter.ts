/**
 * The 3D view's WebGL renderer and the way a frame reaches the canvas: the scene renders into an
 * in-app multisampled target and a fullscreen copy pass presents the resolved frame. Lite and
 * software rendering draw straight to the canvas.
 */
import * as THREE from 'three';
import { IS_LITE } from '../../../platform/build/edition';
import { maxRenderScale } from '../../../platform/device/device-quality';

export class Presenter {
  readonly renderer: THREE.WebGLRenderer;
  /** Draw calls and triangles of the last scene pass, for the Lite frame budget. */
  frameCalls = 0;
  frameTriangles = 0;
  // In-app 4×MSAA: the scene renders into this multisampled target, and a
  // fullscreen copy pass presents the resolved frame (see the renderer options
  // comment for why the canvas must stay single-sample).
  private msaaTarget: THREE.WebGLRenderTarget | null = null;
  private copyScene: THREE.Scene | null = null;
  private readonly copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly disposables: { dispose(): void }[] = [];

  /** `lite` drops the shadow maps and the multisampled target. */
  constructor(private readonly container: HTMLElement, w: number, h: number, lite: boolean, budgetScale: number) {
    // A standard depth buffer: logarithmicDepthBuffer writes gl_FragDepth per fragment, collapsing
    // every MSAA sample of an edge pixel onto one depth, so small silhouettes flicker as the camera
    // moves. near=0.5 already gives ~0.003-unit precision, well under the 0.02-unit road decal lift.

    // Antialiasing happens in the app's own multisampled target, never on the canvas: canvas MSAA
    // hands the resolve to the browser's present path, which on Chromium/ANGLE over nvidia OpenGL
    // strobes silhouette edges between identical frames and washes out instanced vertex colours.
    // preserveDrawingBuffer stays off for the same reason; a capture renders synchronously right
    // before toDataURL. alpha: false, since the sky fills every frame and Firefox composites an
    // alpha canvas with out-of-range colour as fully transparent.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    // Shader diagnostics are development-only: three fetches the program and shader logs
    // synchronously at each program's first use, which forces the driver to finish linking and costs
    // over a second per program on a software rasterizer, during an orbit or the first edit. The
    // shaders are build-time constants, so a link failure is a development bug; nothing at runtime
    // reads a shader log (Editor3DCanvas toasts `view3d.unavailable`, the scene handles context loss).
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    // maxRenderScale carries the lite tier itself (1x there, ≤2×/≤1.5× on hardware) and never asks
    // for more pixels than the display has, which a fixed 1 would on a page zoomed below 100%.
    // resize re-reads it, so the two sites must read the same one thing.
    this.renderer.setPixelRatio(maxRenderScale({ width: w, height: h, budgetScale }));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // keep colours vivid, no filmic desaturation
    this.renderer.shadowMap.enabled = !lite;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    if (!lite) this.setupMsaaTarget(w, h);
  }

  /** The drawing buffer's device px per css px, which the draped grid's line widths read. */
  gridPixelRatio(): number {
    return this.msaaTarget
      ? this.msaaTarget.height / Math.max(1, this.container.clientHeight)
      : this.renderer.getPixelRatio();
  }

  /** Draws one frame: the scene into the MSAA target, then the resolved copy to the canvas. */
  present(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.msaaTarget && this.copyScene) {
      this.renderer.setRenderTarget(this.msaaTarget);
      this.renderer.render(scene, camera);
      this.frameCalls = this.renderer.info.render.calls;
      this.frameTriangles = this.renderer.info.render.triangles;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.copyScene, this.copyCam);
    } else {
      this.renderer.render(scene, camera);
      this.frameCalls = this.renderer.info.render.calls;
      this.frameTriangles = this.renderer.info.render.triangles;
    }
  }

  /** Render the scene once with the shadow pass switched off, so three has set the light state up
   *  before the shadow map is ever baked.
   *
   *  `WebGLRenderer.render` runs `shadowMap.render` before `setupLights`, and a render state's light
   *  arrays start empty, so a scene's first render keys every depth program with zero lights, counts
   *  no later frame repeats. The programs are byte-identical but cached under keys nothing asks for
   *  again, so the next bake, the user's first edit on a frozen map, links the whole set a second
   *  time (over a second of driver link on a software rasterizer).
   *
   *  Offscreen: it draws into the target the next frame overwrites and skips the copy pass. Only the
   *  profile with shadows pays for it (lite has neither shadows nor the MSAA target). */
  primeLightState(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.renderer.shadowMap.enabled || !this.msaaTarget) return;
    this.renderer.shadowMap.needsUpdate = false;
    this.renderer.setRenderTarget(this.msaaTarget);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
  }

  /** Follows the container's css size; the pixel ratio is re-read, since page zoom moves it. */
  resize(w: number, h: number, budgetScale: number): void {
    // Re-read the pixel ratio: it is devicePixelRatio-derived, and page zoom
    // moves devicePixelRatio while inflating the CSS viewport. Leaving it at the
    // boot value multiplies the two effects instead of cancelling them, so a
    // zoomed-out page asks for a buffer several times the screen's pixel count.
    this.renderer.setPixelRatio(maxRenderScale({ width: w, height: h, budgetScale }));
    this.renderer.setSize(w, h);
    const size = this.targetSize(w, h);
    this.msaaTarget?.setSize(size.w, size.h);
  }

  /** Drops the shadow maps and the multisampled target for the lite profile. */
  enterLite(): void {
    this.renderer.shadowMap.enabled = false;
    this.msaaTarget?.dispose();
    this.msaaTarget = null;
    this.copyScene = null;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  /** The scene → multisampled target → resolved fullscreen copy to the canvas.
   *  HalfFloat keeps the linear intermediate banding-free; the sRGB output
   *  transform still happens on the final canvas pass, so colours match a
   *  direct render exactly. */
  private setupMsaaTarget(w: number, h: number): void {
    // Rendering into a HalfFloat target needs EXT_color_buffer_float; where it's
    // missing, an 8-bit target still gives correct (slightly more banded) output.
    const half = !IS_LITE && this.renderer.extensions.has('EXT_color_buffer_float');
    const size = this.targetSize(w, h);
    this.msaaTarget = new THREE.WebGLRenderTarget(size.w, size.h, {
      samples: IS_LITE ? 2 : 4,
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const copyMat = new THREE.MeshBasicMaterial({ map: this.msaaTarget.texture, depthTest: false, depthWrite: false, toneMapped: false });
    this.copyScene = new THREE.Scene();
    this.copyScene.add(new THREE.Mesh(quadGeo, copyMat));
    this.disposables.push(quadGeo, copyMat, this.msaaTarget);
  }

  /** The multisampled target's pixel size for a CSS size, clamped to what the GL
   *  context can actually allocate. A renderbuffer past MAX_RENDERBUFFER_SIZE
   *  leaves the framebuffer incomplete and every frame resolves to nothing — a
   *  black view. Reachable by zooming the page out: that inflates the CSS
   *  viewport (a 33% zoom makes it 3x wider) while the pixel ratio caps the
   *  buffer, so the clamp is the backstop for whatever the ratio does not catch. */
  private targetSize(w: number, h: number): { w: number; h: number } {
    const pr = this.renderer.getPixelRatio();
    const gl = this.renderer.getContext();
    const limit = Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    ) || 4096;
    const k = Math.min(1, limit / Math.max(1, Math.max(w, h) * pr));
    return {
      w: Math.max(1, Math.round(w * pr * k)),
      h: Math.max(1, Math.round(h * pr * k)),
    };
  }
}
