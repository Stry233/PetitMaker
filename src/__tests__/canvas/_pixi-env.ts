/**
 * jsdom has no 2D canvas context, but pixi.js-legacy probes one at import time
 * (canvas blend-mode capability checks). This permissive stub lets renderer
 * layers be unit-tested headlessly: Graphics geometry building never touches a
 * real context, only the import-time probes and PIXI.Text's measurements do.
 * `measureText` answers a plausible width (PIXI.Text refuses to build without
 * one) and `getImageData` a real-size buffer, since the font-metrics probe
 * scans it pixel by pixel.
 */
const context2dStub = () =>
  new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'canvas'
          ? undefined
          : (...args: unknown[]) => {
            if (key === 'measureText') return { width: String(args[0] ?? '').length * 10 };
            if (key === 'getImageData') {
              const w = typeof args[2] === 'number' ? args[2] : 1;
              const h = typeof args[3] === 'number' ? args[3] : 1;
              return { data: new Uint8ClampedArray(Math.max(24, w * h * 4)) };
            }
            return undefined;
          },
      set: () => true,
    },
  );

const origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof origGetContext>) {
  const real = origGetContext.apply(this, args);
  return (real ?? context2dStub()) as ReturnType<typeof origGetContext>;
} as typeof origGetContext;

export {};
