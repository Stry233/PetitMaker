/**
 * The GL quality probe (#31): a software rasterizer (or no GL at all) reads 'lite', and the
 * override pins the answer for the headless capture pipelines, which run on SwiftShader by
 * choice and still want the shipped look.
 *
 * The same answer carries the 2D render-scale tier: on a software rasterizer every pixel is CPU
 * work, so the cap drops to 1 and a dpr-2 screen stops paying four times the fill for it.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { glQuality, glRendererName, hasWebGL2, maxRenderScale, setGlQualityOverride, __resetWebGL2Probe } from '../../core/runtime/device-quality';
import { writePref } from '../../core/runtime/prefs';

/** jsdom reports no `devicePixelRatio` of its own; the cap is only visible above 1. */
function setDpr(dpr: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
}

/** The low-end signal reads the HOST's own cores through jsdom, so the hardware-tier assertions
 *  pin the machine they mean: a 4-core CI runner is genuinely low-end and would answer 1.5. */
function setCores(cores: number): void {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true });
}

beforeEach(() => { setCores(8); });
afterEach(() => { setGlQualityOverride(null); writePref('quality3d', 'auto'); setDpr(1); setCores(8); });

describe('glQuality', () => {
  it('reads lite where no GL context exists (jsdom has none)', () => {
    expect(glQuality()).toBe('lite');
  });

  it('the Settings choice outranks the probe', () => {
    writePref('quality3d', 'full');
    expect(glQuality()).toBe('full');
    writePref('quality3d', 'lite');
    expect(glQuality()).toBe('lite');
    writePref('quality3d', 'auto');
    expect(glQuality()).toBe('lite'); // back to the probe (jsdom has no GL)
  });

  it('the override wins over the probe, and clearing it restores the probe', () => {
    setGlQualityOverride('full');
    expect(glQuality()).toBe('full');
    setGlQualityOverride(null);
    expect(glQuality()).toBe('lite');
  });

  it('names no renderer where there is no GL to name', () => {
    expect(glRendererName()).toBe('');
  });
});

describe('maxRenderScale', () => {
  it('keeps web hardware resolution independent of the container pixel budget', () => {
    setDpr(2);
    setGlQualityOverride('full');
    expect(maxRenderScale({ width: 3840, height: 2160, budgetScale: 0.5 })).toBe(2);
  });
  it('caps a software rasterizer at 1, where the hardware tier would take 2', () => {
    setDpr(2);
    expect(maxRenderScale()).toBe(1); // jsdom has no GL, so the probe reads lite
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(2);
  });

  it('the Settings quality choice moves the cap with it', () => {
    setDpr(2);
    writePref('quality3d', 'full');
    expect(maxRenderScale()).toBe(2);
    writePref('quality3d', 'lite');
    expect(maxRenderScale()).toBe(1);
  });

  it('changes nothing on a dpr-1 display, whichever tier applies', () => {
    setDpr(1);
    expect(maxRenderScale()).toBe(1);
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(1);
  });

  it('never asks for more pixels than the display has', () => {
    setDpr(1.5);
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(1.5);
  });

  it('a low-end machine caps the hardware tier at 1.5', () => {
    setCores(4);
    setDpr(2);
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(1.5);
  });
});

/**
 * three r169 needs WebGL2, so the views and offers that lead to the 3D scene ask this first rather
 * than letting the scene build and fail.
 */
describe('hasWebGL2', () => {
  beforeEach(() => { __resetWebGL2Probe(); });
  afterEach(() => { __resetWebGL2Probe(); vi.restoreAllMocks(); });

  it('is false where no GL context exists (jsdom)', () => {
    expect(hasWebGL2()).toBe(false);
  });

  it('accepts a webgl2 context, releases it, and answers once', () => {
    const lose = vi.fn();
    const getContext = vi.fn((kind: string) => (kind === 'webgl2'
      ? { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: lose } : null) }
      : null));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext as never);
    expect(hasWebGL2()).toBe(true);
    expect(lose).toHaveBeenCalledTimes(1);
    expect(hasWebGL2()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('refuses a device that offers webgl1 only', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => (kind === 'webgl'
      ? { getExtension: () => null }
      : null)) as never);
    expect(hasWebGL2()).toBe(false);
  });
});
