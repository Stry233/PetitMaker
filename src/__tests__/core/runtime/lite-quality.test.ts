import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../core/runtime/edition', () => ({ IS_LITE: true }));
import { writePref } from '../../../core/runtime/prefs';
import { glQuality, maxRenderScale, setGlQualityOverride } from '../../../core/runtime/device-quality';

beforeEach(() => { vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 }); });

afterEach(() => { vi.unstubAllGlobals(); setGlQualityOverride(null); writePref('quality3d', 'auto'); });

describe('Lite drawing-buffer budget', () => {
  it('caps a high-density large surface at one million pixels', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const scale = maxRenderScale({ width: 2000, height: 1000, budgetScale: 1 });
    expect(2000 * 1000 * scale * scale).toBeCloseTo(1_000_000);
    expect(scale).toBeLessThanOrEqual(1);
  });
  it('keeps a zoomed-out display below native density and can lower quality further', () => {
    vi.stubGlobal('devicePixelRatio', 0.5);
    expect(maxRenderScale({ width: 500, height: 500, budgetScale: 0.75 })).toBe(0.375);
  });
  it('can reach the ordinary hardware density after measured headroom', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    expect(maxRenderScale({ width: 1440, height: 900, budgetScale: 4 })).toBe(2);
  });
  it('bounds enhanced rendering and keeps low-memory density conservative', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const scale = maxRenderScale({ width: 3840, height: 2160, budgetScale: 4 });
    expect(3840 * 2160 * scale * scale).toBeLessThanOrEqual(8_000_001);
    vi.stubGlobal('navigator', { hardwareConcurrency: 4, deviceMemory: 4 });
    expect(maxRenderScale({ width: 500, height: 500, budgetScale: 4 })).toBe(1.5);
  });
  it('starts conservatively in Auto and honors explicit quality choices', () => {
    writePref('quality3d', 'auto');
    expect(glQuality()).toBe('lite');
    writePref('quality3d', 'full');
    expect(glQuality()).toBe('full');
    writePref('quality3d', 'lite');
    expect(glQuality()).toBe('lite');
  });
});
