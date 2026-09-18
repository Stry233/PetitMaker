/**
 * The 3D scene's pixel ratio comes from ONE place, `device-quality:maxRenderScale`, and the boot
 * value must be the same answer the resize path re-reads.
 *
 * The scene holds a `lite` flag for the software-rasterizer profile (no shadows, no MSAA target, no
 * fly-in), and maxRenderScale already answers the lite tier — a cap spelled out beside it as
 * `lite ? 1 : maxRenderScale()` would agree with the resize path at every dpr of 1 or more and
 * disagree below it: `min(dpr, 1)` is the cap, and a page zoomed under 100% puts dpr under 1, so a
 * fixed 1 boots the tier that pays for every pixel in CPU time asking for more pixels than the
 * display has (the resize then quietly correcting it).
 *
 * The scene's constructor needs a WebGL context, which no test environment here has, so the wiring
 * is read off the source — the same way the shader-diagnostics flag is pinned.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { maxRenderScale, setGlQualityOverride } from '../../core/runtime/device-quality';

const SOURCE = readFileSync('src/canvas/map3d/scene/scene.ts', 'utf8');

function setDpr(dpr: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
}

/** The low-end signal reads the HOST's own cores through jsdom; the hardware-tier assertion pins
 *  the machine it means (a 4-core CI runner is genuinely low-end and would answer 1.5). */
function setCores(cores: number): void {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true });
}

beforeEach(() => { setCores(8); });
afterEach(() => { setGlQualityOverride(null); setDpr(1); setCores(8); });

describe('the scene sets its pixel ratio from one source', () => {
  it('boot and resize obtain the same surface-aware cap', () => {
    const calls = SOURCE.match(/setPixelRatio\(.*/g) ?? [];
    expect(calls).toEqual(Array(2).fill('setPixelRatio(maxRenderScale({ width: w, height: h, budgetScale: this.budgetScale }));'));
  });

  it('the MSAA target sizes itself off the renderer, not off a second read of the cap', () => {
    const body = SOURCE.slice(SOURCE.indexOf('private targetSize('));
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('const pr = this.renderer.getPixelRatio();');
  });
});

describe('the cap the scene reads', () => {
  it('never exceeds the display, so the boot value cannot over-allocate on a zoomed-out page', () => {
    setDpr(0.5);
    expect(maxRenderScale()).toBe(0.5); // jsdom has no GL, so the probe reads lite
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(0.5);
  });

  it('answers the lite tier itself, so the scene needs no branch of its own', () => {
    setDpr(2);
    expect(maxRenderScale()).toBe(1);
    setGlQualityOverride('full');
    expect(maxRenderScale()).toBe(2);
  });
});
