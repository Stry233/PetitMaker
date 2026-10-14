import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecodedImage, StencilBrowser } from '../../../../tools/generation/stencil/stencil-browser';

/** Fresh module caches per test: decoded pictures and built plans are module state. */
async function load() {
  vi.resetModules();
  return {
    plan: await import('../../../../tools/generation/stencil/stencil-plan'),
    browser: await import('../../../../tools/generation/stencil/stencil-browser'),
  };
}

let uninstall: (() => void) | null = null;
afterEach(() => { uninstall?.(); uninstall = null; });

describe('stencil picture plans', () => {
  it('decode a picture again after a failed decode, and only then', async () => {
    const m = await load();
    let decodes = 0;
    let failing = true;
    const browser: StencilBrowser = {
      canvas: () => null,
      fonts: () => null,
      loadImage: () => {
        decodes++;
        return failing ? Promise.reject(new Error('decode failed')) : Promise.resolve({ width: 4, height: 4 } as unknown as DecodedImage);
      },
    };
    uninstall = m.browser.installStencilBrowser(browser);
    const inputs = { box: { origin: { x: 0, y: 0 }, width: 8, height: 8 } };
    const sample = { src: 'picture.png' };
    expect(await m.plan.buildStencilPlan(sample, inputs)).toBeNull();
    expect(m.plan.peekStencilPlan(sample, inputs)).toBeUndefined();
    failing = false;
    await m.plan.buildStencilPlan(sample, inputs);
    expect(decodes).toBe(2);
    await m.plan.buildStencilPlan(sample, inputs);
    expect(decodes).toBe(2);
  });

  it('keeps a bounded set of decoded pictures, the least recently asked leaving first', async () => {
    const m = await load();
    const decoded: string[] = [];
    uninstall = m.browser.installStencilBrowser({
      canvas: () => null,
      fonts: () => null,
      loadImage: (src) => { decoded.push(src); return Promise.resolve({ width: 4, height: 4 } as unknown as DecodedImage); },
    });
    const inputs = { box: { origin: { x: 0, y: 0 }, width: 8, height: 8 } };
    for (let i = 0; i <= 16; i++) await m.plan.buildStencilPlan({ src: `p${i}.png` }, inputs);
    expect(decoded).toHaveLength(17);
    // Built plans are a cache of their own; forgetting another picture clears them.
    m.plan.forgetStencilImage('other.png');
    await m.plan.buildStencilPlan({ src: 'p16.png' }, inputs);
    expect(decoded, 'the newest picture is still decoded').toHaveLength(17);
    await m.plan.buildStencilPlan({ src: 'p0.png' }, inputs);
    expect(decoded.at(-1), 'the oldest picture was dropped and decodes again').toBe('p0.png');
    expect(decoded).toHaveLength(18);
  });
});
