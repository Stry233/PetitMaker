/*
 * jsdom has no WebGL, so a test of the 3D scene replaces three's renderer with an object that
 * accepts every call and draws nothing, while recording the calls a test asserts on. Install it
 * from a `vi.mock('three', ...)` factory with `withStandInRenderer`.
 */
type Three = typeof import('three');

/** Every renderer call a stand-in recorded, in order, shared by all stand-ins of a test file. */
export const rendererLog: string[] = [];

/** A 2D context whose every method is a no-op returning another such object. */
export function anyContext(): object {
  const noop: object = new Proxy(function () {}, {
    get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getImageData'
      ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }) : noop),
    apply: () => noop,
    set: () => true,
  });
  return noop;
}

/** `real` with its WebGLRenderer replaced by the recording stand-in. */
export function withStandInRenderer(real: Three): Three {
  class StandInRenderer {
    domElement = document.createElement('canvas');
    shadowMap = (() => {
      const map = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
      return new Proxy(map, {
        set: (t, p, v) => {
          if (p === 'autoUpdate' || p === 'needsUpdate') rendererLog.push(`shadow.${String(p)}=${v}`);
          (t as Record<string | symbol, unknown>)[p] = v;
          return true;
        },
      });
    })();
    debug = { checkShaderErrors: false };
    capabilities = { maxSamples: 4, isWebGL2: true, getMaxAnisotropy: () => 1, maxTextureSize: 4096 };
    extensions = { has: () => false, get: () => null };
    info = { render: { calls: 0, triangles: 0 }, memory: {}, programs: [], autoReset: true, reset() {} };
    outputColorSpace = '';
    toneMapping = 0;
    private pixelRatio = 1;
    getContext() {
      return { isContextLost: () => false, getExtension: () => null, getParameter: () => 8192, MAX_RENDERBUFFER_SIZE: 1, MAX_TEXTURE_SIZE: 2 };
    }
    setPixelRatio(ratio: number) { this.pixelRatio = ratio; rendererLog.push(`pixelRatio=${ratio}`); }
    getPixelRatio() { return this.pixelRatio; }
    getSize(target: InstanceType<Three['Vector2']>) { return target.set(1, 1); }
    getDrawingBufferSize(target: InstanceType<Three['Vector2']>) { return target.set(1, 1); }
    getRenderTarget() { return null; }
    setRenderTarget(target: unknown) { rendererLog.push(target ? 'target:offscreen' : 'target:canvas'); }
    render() { rendererLog.push('render'); }
    constructor() {
      return new Proxy(this, { get: (t, p) => (p in t ? (t as never)[p] : () => undefined) });
    }
  }
  return { ...real, WebGLRenderer: StandInRenderer } as unknown as Three;
}
