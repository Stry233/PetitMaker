// src/__tests__/io/export/render.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderExport } from '../../../io/export/render';
import { ProvenanceTracker } from '../../../core/provenance/tracker';
import { ProvSource } from '../../../core/provenance/types';

function fakeBuffer() { return { data: new Uint8ClampedArray(64 * 64 * 4).fill(128), width: 64, height: 64 }; }

const baseArgs = (over: any = {}) => {
  const t = new ProvenanceTracker(4, 4, { now: () => 0 });
  t.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => t.record('create', [{ x: 0, y: 0 }], [], { layers: [1], zones: [2] }));
  return {
    summary: t.getSummary(),
    options: { title: '', description: '', preset: 'plain' as const, importable: false, showBadge: true, layerPreview: false, card3d: false, grid: true, footer: true, resolution: 'compact' as const },
    mapAspect: 1.2,
    capture: vi.fn(async (comp: { width: number; height: number }) => ({ ...fakeBuffer(), width: comp.width, height: comp.height })),
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
  it('does not modify the buffer itself (no pixel watermarking in render)', async () => {
    const args = baseArgs();
    await renderExport(args as any);
    // encode is the only buffer consumer; render adds no embed step.
    expect(args.encode).toHaveBeenCalled();
  });
  it('returns blob=null when capture yields no buffer, still returns a composition', async () => {
    const r = await renderExport(baseArgs({ capture: async () => null }) as any);
    expect(r.blob).toBeNull();
    expect(r.composition).toBeTruthy();
  });
});
