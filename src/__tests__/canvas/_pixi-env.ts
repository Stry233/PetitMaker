/**
 * jsdom has no 2D canvas context, but pixi.js-legacy probes one at import time
 * (canvas blend-mode capability checks). This permissive stub lets renderer
 * layers be unit-tested headlessly: Graphics geometry building never touches a
 * real context, only the import-time probes do.
 */
const context2dStub = () =>
  new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'canvas'
          ? undefined
          : (..._args: unknown[]) => (key === 'getImageData' ? { data: new Uint8ClampedArray(24) } : undefined),
      set: () => true,
    },
  );

const origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof origGetContext>) {
  // jsdom either returns null or throws "Not implemented" — stub both ways.
  let real: ReturnType<typeof origGetContext> = null;
  try {
    real = origGetContext.apply(this, args);
  } catch {
    real = null;
  }
  return (real ?? context2dStub()) as ReturnType<typeof origGetContext>;
} as typeof origGetContext;

export {};
