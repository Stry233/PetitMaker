// @vitest-environment jsdom
/** The share picture's export pipeline, driven through a stand-in view host. */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { runImageExport, type ImageExportHost, type ImageExportRequest } from '../../../io/export/run-image-export';
import { captureMapBase } from '../../../io/export/composition-assets';
import { exportComposition } from '../../../io/export/render';
import { makeState } from '../../_support/map-state';
import type { MapProvenanceSummary } from '../../../core/provenance/types';
import type { ExportComposition, ExportOptions } from '../../../io/export/types';

const painted = vi.hoisted(() => ({ comps: [] as ExportComposition[] }));
vi.mock('../../../io/export/paint', async (orig) => {
  const real = await orig<typeof import('../../../io/export/paint')>();
  return { ...real, paintComposition: vi.fn((_ctx: unknown, comp: ExportComposition) => { painted.comps.push(comp); }) };
});
vi.mock('../../../io/export/composition-assets', async (orig) => {
  const real = await orig<typeof import('../../../io/export/composition-assets')>();
  return { ...real, capture3dStills: vi.fn(async () => []) };
});

const SUMMARY = {
  exportDisclosure: 'human_created', containsAi: false, containsProcedural: false,
  aiEverUsed: false, aiUsedNoRemaining: false, aiTerrainPct: 0, aiObjectCount: 0, proceduralAreaPct: 0,
  humanAfterAi: false, aiAfterHuman: false,
} as MapProvenanceSummary;

const OPTIONS = { title: '', description: '', preset: 'share', showBadge: true, layerPreview: true, card3d: false, grid: true, footer: true, annotations: true, footerTemplate: '', resolution: 'standard' } as ExportOptions;

function hostWith(over: Partial<ImageExportHost> = {}): ImageExportHost {
  return {
    capture2d: vi.fn(() => null), capture2dImage: vi.fn(() => null), capture2dTextureCap: () => 16384,
    capture3dStills: vi.fn(async () => []), ...over,
  };
}

function request(over: Partial<ImageExportRequest> = {}): ImageExportRequest {
  return {
    state: makeState(8, 8), summary: SUMMARY, options: OPTIONS, stylized: null, shots: [], footerTokens: {},
    brand: { lockup: null, url: '', label: '', powerText: '' }, translate: (k) => k,
    shareCode: async () => null, limits: { maxDim: 16384, maxArea: 268_435_456 }, ...over,
  };
}

describe('the image export pipeline', () => {
  it('reports a map it could not capture rather than painting a blank picture', async () => {
    const host = hostWith();
    const result = await runImageExport(host, request(), new AbortController().signal, () => {});
    expect(result).toEqual({ status: 'no-capture' });
    expect(host.capture2dImage).toHaveBeenCalledWith({ maxPx: 2400, grid: true, annotations: true });
  });

  it('answers nothing once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const canvas = document.createElement('canvas');
    const result = await runImageExport(hostWith(), request({ stylized: () => canvas }), controller.signal, () => {});
    expect(result).toBeNull();
  });
});

describe('the map band picture', () => {
  it('lays a stylized picture under the grid and ink the host captures, never capturing the map', async () => {
    const host = hostWith();
    const composed = document.createElement('canvas');
    const compose = vi.fn(() => composed);
    const picture = await captureMapBase(host, { px: 640, grid: true, annotations: true, stylized: compose });
    expect(picture).toBe(composed);
    expect(vi.mocked(host.capture2dImage).mock.calls).toEqual([[{ content: 'notes', maxPx: 640 }], [{ content: 'grid', maxPx: 640 }]]);
    expect(compose).toHaveBeenCalledWith(null, null);
  });
});

describe('a part the export could not fill', () => {
  beforeEach(() => {
    painted.comps.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'])));
  });
  afterEach(() => vi.restoreAllMocks());

  const stylized = () => document.createElement('canvas');
  const layoutWithout = (options: ExportOptions) => {
    const map = stylized();
    const px = { w: map.width, h: map.height };
    return exportComposition(options, makeState(8, 8), SUMMARY, { aspect: px.w / px.h, px }, { limits: request().limits });
  };
  const rows = (c: ExportComposition) => ({ height: c.height, footer: c.footer, brand: c.brand });

  it('closes the code band row when the share code fails to build', async () => {
    const failing = async () => { throw new Error('encoder'); };
    const result = await runImageExport(hostWith(), request({ stylized, shareCode: failing }), new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'done', codeFailed: true, carriesCode: false });
    const comp = painted.comps.at(-1)!;
    expect(comp.codeBand).toBeUndefined();
    expect(rows(comp)).toEqual(rows(layoutWithout({ ...OPTIONS, preset: 'plain' })));
  });

  it('closes the 3D card row when no still renders', async () => {
    const options: ExportOptions = { ...OPTIONS, preset: 'plain', card3d: true };
    await runImageExport(hostWith(), request({ stylized, options }), new AbortController().signal, () => {});
    const comp = painted.comps.at(-1)!;
    expect(comp.card3d).toBeUndefined();
    expect(rows(comp)).toEqual(rows(layoutWithout({ ...options, card3d: false })));
  });
});
