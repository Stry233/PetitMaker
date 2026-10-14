// @vitest-environment jsdom
/**
 * The 3D presenter takes its pixel ratio from `device-quality:maxRenderScale` at boot and on every
 * resize, sizes its multisampled target off the renderer's ratio, and asks for shader diagnostics
 * in development only. maxRenderScale answers the lite tier itself and never exceeds the display,
 * so a page zoomed under 100% boots no larger buffer than the screen has.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { maxRenderScale, setGlQualityOverride } from '../../../../platform/device/device-quality';
import { rendererLog } from '../../../_support/three-stand-in';

vi.mock('three', async (importOriginal) =>
  (await import('../../../_support/three-stand-in')).withStandInRenderer(await importOriginal()));

function setDpr(dpr: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
}

/** The low-end signal reads the host's own cores through jsdom; the hardware-tier assertion pins
 *  the machine it means (a 4-core CI runner is genuinely low-end and would answer 1.5). */
function setCores(cores: number): void {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true });
}

beforeEach(() => { setCores(8); rendererLog.length = 0; });
afterEach(() => { setGlQualityOverride(null); setDpr(1); setCores(8); vi.unstubAllEnvs(); });

async function presenter(w: number, h: number, lite: boolean) {
  const { Presenter } = await import('../../../../view/map3d/scene/presenter');
  return new Presenter(document.createElement('div'), w, h, lite, 1);
}

const ratios = (): number[] => rendererLog.filter((e) => e.startsWith('pixelRatio=')).map((e) => Number(e.slice(11)));

describe('the presenter sets its pixel ratio from one source', () => {
  it('boot and resize ask maxRenderScale for the surface they size', async () => {
    setGlQualityOverride('full');
    setDpr(2);
    const p = await presenter(800, 600, false);
    p.resize(400, 300, 2);
    expect(ratios()).toEqual([
      maxRenderScale({ width: 800, height: 600, budgetScale: 1 }),
      maxRenderScale({ width: 400, height: 300, budgetScale: 2 }),
    ]);
  });

  it('boots a zoomed-out page at the display ratio, under one', async () => {
    setDpr(0.5);
    await presenter(800, 600, true);
    expect(ratios()).toEqual([0.5]);
  });

  it('sizes the multisampled target off the renderer ratio', async () => {
    setGlQualityOverride('full');
    setDpr(1.5);
    const p = await presenter(800, 600, false);
    const target = (p as unknown as { msaaTarget: { width: number; height: number } }).msaaTarget;
    const pr = p.renderer.getPixelRatio();
    expect([target.width, target.height]).toEqual([Math.round(800 * pr), Math.round(600 * pr)]);
  });
});

describe('shader diagnostics', () => {
  it('are asked for in development only', async () => {
    vi.stubEnv('DEV', false);
    expect((await presenter(100, 100, true)).renderer.debug.checkShaderErrors).toBe(false);
    vi.stubEnv('DEV', true);
    expect((await presenter(100, 100, true)).renderer.debug.checkShaderErrors).toBe(true);
  });
});

describe('the cap the presenter reads', () => {
  it('never exceeds the display, so the boot value cannot over-allocate on a zoomed-out page', () => {
    setDpr(0.5);
    expect(maxRenderScale()).toBe(0.5); // jsdom has no GL, so the probe reads lite
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(0.5);
  });

  it('answers the lite tier itself, so the presenter needs no branch of its own', () => {
    setDpr(2);
    expect(maxRenderScale()).toBe(1);
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(2);
  });
});
