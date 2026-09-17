import { prepareOwnImageReceipt } from '../../io/image-ownership';
import { captureImageAttribution } from '../../core/provenance/image-attribution';
// Routing + outcome-shape coverage for the shared file-import routine (ImportModal's
// picker/drop-zone AND the window-level drag-drop overlay both call this — see
// src/io/import-file.ts). Drives the JSON path with a real serialize()/deserialize() round
// trip and stubs the raster path (createImageBitmap has no jsdom implementation, and a
// synthetic image carries no real share code), matching the pattern in
// __tests__/ui/chrome/import-modal.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { importFile, inspectImportFile, type ImportFileDeps } from '../../io/import-file';
import { MAX_IMPORT_BYTES } from '../../io/import-limits';
import { serialize } from '../../io/json-codec';
import { TerrainType, type GridState } from '../../core/model/types';
import { setTerrain } from '../rules/_helpers';
import { createGrid } from '../../core/model/grid-model';
import { getMapTemplate } from '../../config/maps';
import type { ImportResult as RasterImportResult } from '../../io/share';

// deserialize() resolves the save's templateId against the REAL catalog (config/maps), so a
// round-trippable fixture must use a real template — the shared `_helpers.makeState()` template
// (id 'test') would silently fall back to the default map and mismatch on cell count.
function makeState(): GridState {
  const template = getMapTemplate(undefined);
  return { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
}

vi.mock('../../io/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../io/share')>();
  return { ...actual, importFromRaster: vi.fn() };
});
import { importFromRaster } from '../../io/share';

function makeDeps(): ImportFileDeps & { loadMap: ReturnType<typeof vi.fn> } {
  const loadMap = vi.fn();
  return {
    loadMap,
    getSectionDeps: () => ({
      executor: null,
      state: makeState(),
      setLayerLocked: vi.fn(),
      setCamera: vi.fn(),
    }),
  };
}

// A real jsdom File/Blob has no `.text()` implementation (a jsdom gap, not a browser one — see
// MDN File extends Blob), so a bare object satisfying the two members `importFile` actually reads
// (`type`, `text()`) stands in for it. `name` is passed to `importFile` separately, exactly like
// the real call sites do (File.name isn't read directly by the routing logic).
function jsonFile(text: string, type = ''): File {
  return { type, text: async () => text } as unknown as File;
}

describe('importFile routing', () => {
  afterEach(() => vi.clearAllMocks());

  it('inspects a file without installing it, and commits it on request', async () => {
    const state = makeState();
    setTerrain(state, 2, 2, TerrainType.Mountain, 1);
    state.notes = { title: 'River garden', description: 'three homes' };
    const inspection = await inspectImportFile(jsonFile(serialize(state)), 'map.json');
    expect(inspection.status).toBe('ready');
    if (inspection.status !== 'ready') return;
    expect(inspection.preview.source).toBe('json');
    expect(inspection.preview.notes).toEqual(state.notes);
    expect(inspection.preview.state.cells[2]![2]!.terrain?.type).toBe(TerrainType.Mountain);
    const deps = makeDeps();
    expect(deps.loadMap).not.toHaveBeenCalled();
    const outcome = inspection.commit(deps);
    expect(deps.loadMap).toHaveBeenCalledWith(inspection.preview.state);
    expect(outcome).toEqual({ status: 'imported', source: 'json', warnings: [], notes: state.notes });
  });

  it('reports an unreadable file from the inspection alone', async () => {
    expect(await inspectImportFile(jsonFile('{not json'), 'map.json')).toEqual({ status: 'failed' });
    expect(await inspectImportFile(new File(['x'], 'notes.txt', { type: 'text/plain' }), 'notes.txt')).toEqual({ status: 'unsupported' });
  });

  it('routes a .json-named file to the JSON path by extension', async () => {
    const state = makeState();
    setTerrain(state, 2, 2, TerrainType.Mountain, 1);
    state.notes = { title: 'River garden' };
    const deps = makeDeps();
    const outcome = await importFile(jsonFile(serialize(state)), 'map.json', deps);
    expect(outcome).toEqual({ status: 'imported', source: 'json', warnings: [], notes: { title: 'River garden' } });
    expect(deps.loadMap).toHaveBeenCalledTimes(1);
    // No registry: `deps.loadMap` (kit/operations/map.ts:loadMap in production) builds its own
    // default one, so importFile must not build a second, discarded RuleRegistry to hand it.
    expect(deps.loadMap.mock.calls[0]).toHaveLength(1);
  });

  it('routes an extensionless file with application/json MIME to the JSON path', async () => {
    const state = makeState();
    const deps = makeDeps();
    const outcome = await importFile(jsonFile(serialize(state), 'application/json'), 'upload', deps);
    expect(outcome.status).toBe('imported');
    expect(deps.loadMap).toHaveBeenCalledTimes(1);
  });

  it('reports a dropped optional section without failing the import', async () => {
    const raw = JSON.parse(serialize(makeState())) as Record<string, unknown>;
    raw.session = { v: 2 }; // wrong schema version -> applyOptionalSections drops it
    const deps = makeDeps();
    const outcome = await importFile(jsonFile(JSON.stringify(raw)), 'map.json', deps);
    expect(outcome).toEqual({
      status: 'imported',
      source: 'json',
      warnings: [{ kind: 'dropped-section', section: 'session' }],
    });
  });

  it('flags a tampered export as modified but still imports it', async () => {
    const raw = JSON.parse(serialize(makeState())) as Record<string, unknown>;
    raw.manifest = { integrity: 'not-the-real-checksum' };
    const deps = makeDeps();
    const outcome = await importFile(jsonFile(JSON.stringify(raw)), 'map.json', deps);
    expect(outcome).toEqual({
      status: 'imported',
      source: 'json',
      warnings: [{ kind: 'modified-after-export' }],
    });
  });

  it('fails without crashing on unparsable JSON', async () => {
    const deps = makeDeps();
    const outcome = await importFile(jsonFile('{not json'), 'map.json', deps);
    expect(outcome).toEqual({ status: 'failed' });
    expect(deps.loadMap).not.toHaveBeenCalled();
  });

  it('treats a non-json, non-image file as unsupported (no decode attempt)', async () => {
    const deps = makeDeps();
    const outcome = await importFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }), 'notes.txt', deps);
    expect(outcome).toEqual({ status: 'unsupported' });
    expect(deps.loadMap).not.toHaveBeenCalled();
  });

  it('routes anything image/* (or a known image extension) through the raster path', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2 } as unknown as ImageBitmap));
    const getImageDataMock = vi.fn(() => ({ data: new Uint8ClampedArray(2 * 2 * 4) }));
    const ctxSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: getImageDataMock,
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    const state = makeState();
    vi.mocked(importFromRaster).mockResolvedValue({ ok: true, state, warnings: ['template-drift'], provenance: null } as unknown as RasterImportResult);

    const deps = makeDeps();
    const outcome = await importFile(new File(['x'], 'map.jpg', { type: 'image/jpeg' }), 'map.jpg', deps);
    expect(outcome).toEqual({ status: 'imported', source: 'raster', warnings: [{ kind: 'template-drift' }] });
    expect(deps.loadMap).toHaveBeenCalledWith(state);

    ctxSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it.each([true, false])('uses a private own-export receipt during image inspection (%s)', async (own) => {
    localStorage.clear();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2 }));
    const ctx = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(16) }),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    try {
      const state = makeState();
      state.notes = { title: 'Garden' };
      if (own) (await prepareOwnImageReceipt(state))();
      state.imageAttribution = captureImageAttribution(state);
      vi.mocked(importFromRaster).mockResolvedValue({ ok: true, state, warnings: [], provenance: { aiUsed: false, proceduralUsed: false, appVersion: 'test', saveVersion: 1 } });
      const inspection = await inspectImportFile(new File(['x'], 'map.png', { type: 'image/png' }), 'map.png');
      expect(inspection.status).toBe('ready');
      if (inspection.status === 'ready') expect(!!inspection.preview.state.imageAttribution).toBe(!own);
    } finally {
      ctx.mockRestore();
      vi.unstubAllGlobals();
      localStorage.clear();
    }
  });

  it('maps an unknown-catalog-item raster warning to catalog-drift', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2 } as unknown as ImageBitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(2 * 2 * 4) }),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    vi.mocked(importFromRaster).mockResolvedValue({ ok: true, state: makeState(), warnings: ['catalog-drift'], provenance: null } as unknown as RasterImportResult);

    const outcome = await importFile(new File(['x'], 'map.png', { type: 'image/png' }), 'map.png', makeDeps());
    expect(outcome).toEqual({ status: 'imported', source: 'raster', warnings: [{ kind: 'catalog-drift' }] });
    vi.unstubAllGlobals();
  });

  it('rejects a file past the import byte cap without reading it', async () => {
    const text = vi.fn(async () => '{}');
    const huge = { type: 'application/json', size: MAX_IMPORT_BYTES + 1, text } as unknown as File;
    const deps = makeDeps();
    expect(await importFile(huge, 'map.json', deps)).toEqual({ status: 'failed' });
    expect(text).not.toHaveBeenCalled();
    expect(deps.loadMap).not.toHaveBeenCalled();
  });

  it('reads a bitmap past the raster pixel cap at a reduced size, releasing the full bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 20000, height: 20000, close } as unknown as ImageBitmap));
    const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    vi.mocked(importFromRaster).mockResolvedValue({ ok: false, error: { code: 'no-payload', message: '' } } as unknown as RasterImportResult);
    const deps = makeDeps();
    const outcome = await importFile(new File(['x'], 'map.png', { type: 'image/png' }), 'map.png', deps);
    expect(outcome).toEqual({ status: 'failed', code: 'no-payload' });
    expect(close).toHaveBeenCalled();
    const [, width, height] = vi.mocked(importFromRaster).mock.calls[0]!;
    expect(width * height).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(deps.loadMap).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('surfaces a raster decode failure with its ShareErrorCode, without loading a map', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2 } as unknown as ImageBitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(2 * 2 * 4) }),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    vi.mocked(importFromRaster).mockResolvedValue({ ok: false, error: { code: 'no-payload' } } as unknown as RasterImportResult);

    const deps = makeDeps();
    const outcome = await importFile(new File(['x'], 'map.png', { type: 'image/png' }), 'map.png', deps);
    expect(outcome).toEqual({ status: 'failed', code: 'no-payload' });
    expect(deps.loadMap).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
