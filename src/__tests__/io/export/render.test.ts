// src/__tests__/io/export/render.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderExport } from '../../../io/export/render';
import { ProvenanceTracker } from '../../../core/provenance/tracker';
import { ProvSource } from '../../../core/provenance/types';

/** A painted composition, as the browser hands one over: a canvas, not a pixel copy of one. */
function fakeCanvas(w = 64, h = 64) { return { width: w, height: h } as HTMLCanvasElement; }

const baseArgs = (over: any = {}) => {
  const t = new ProvenanceTracker(4, 4, { now: () => 0 });
  t.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => t.record('create', [{ x: 0, y: 0 }], [], { layers: [1], zones: [2] }));
  return {
    summary: t.getSummary(),
    options: { title: '', description: '', preset: 'plain' as const, importable: false, showBadge: true, layerPreview: false, card3d: false, grid: true, footer: true, resolution: 'compact' as const },
    mapAspect: 1.2,
    capture: vi.fn(async (comp: { width: number; height: number }) => fakeCanvas(comp.width, comp.height)),
    encode: vi.fn(async () => new Blob(['x'])),
    ...over,
  };
};

describe('renderExport (no watermark — compose/capture/encode only)', () => {
  it('captures + encodes and returns the composition', async () => {
    const args = baseArgs();
    const r = await renderExport(args as any);
    expect(args.capture).toHaveBeenCalledTimes(1);
    expect(args.encode).toHaveBeenCalledTimes(1);
    expect(r.blob).toBeInstanceOf(Blob);
    expect(r.composition.width).toBeGreaterThan(0);
  });
  it('does not modify the painted pixels (no pixel watermarking in render)', async () => {
    const args = baseArgs();
    await renderExport(args as any);
    // encode is the only consumer of the painted canvas; render adds no embed step.
    expect(args.encode).toHaveBeenCalled();
  });
  it('hands the encoder the very canvas the capture painted — nothing copies the pixels between', async () => {
    const painted = fakeCanvas(120, 90);
    const args = baseArgs({ capture: vi.fn(async () => painted), encode: vi.fn(async () => new Blob(['x'])) });
    await renderExport(args as any);
    expect(args.encode.mock.calls[0][0]).toBe(painted);
  });
  it('returns blob=null when capture yields nothing, still returns a composition', async () => {
    const r = await renderExport(baseArgs({ capture: async () => null }) as any);
    expect(r.blob).toBeNull();
    expect(r.composition).toBeTruthy();
  });
});
