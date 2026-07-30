// Routing + outcome-shape coverage for the shared file-import routine (ImportModal's
// picker/drop-zone AND the window-level drag-drop overlay both call this — see
// src/io/import-file.ts). Drives the JSON path with a real serialize()/deserialize() round
// trip and stubs the raster path (createImageBitmap has no jsdom implementation, and a
// synthetic image carries no real share code), matching the pattern in
// __tests__/ui/import-modal.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { importFile, type ImportFileDeps } from '../../io/import-file';
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

  it('routes a .json-named file to the JSON path by extension', async () => {
    const state = makeState();
    setTerrain(state, 2, 2, TerrainType.Mountain, 1);
    const deps = makeDeps();
    const outcome = await importFile(jsonFile(serialize(state)), 'map.json', deps);
    expect(outcome).toEqual({ status: 'imported', source: 'json', warnings: [] });
    expect(deps.loadMap).toHaveBeenCalledTimes(1);
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
    } as unknown as CanvasRenderingContext2D);
    const state = makeState();
    vi.mocked(importFromRaster).mockResolvedValue({ ok: true, state, warnings: ['template-drift'], provenance: null } as unknown as RasterImportResult);

    const deps = makeDeps();
    const outcome = await importFile(new File(['x'], 'map.jpg', { type: 'image/jpeg' }), 'map.jpg', deps);
    expect(outcome).toEqual({ status: 'imported', source: 'raster', warnings: [{ kind: 'template-drift' }] });
    expect(deps.loadMap).toHaveBeenCalledWith(state, expect.anything());

    ctxSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('maps an unknown-catalog-item raster warning to catalog-drift', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2 } as unknown as ImageBitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(2 * 2 * 4) }),
    } as unknown as CanvasRenderingContext2D);
    vi.mocked(importFromRaster).mockResolvedValue({ ok: true, state: makeState(), warnings: ['catalog-drift'], provenance: null } as unknown as RasterImportResult);

    const outcome = await importFile(new File(['x'], 'map.png', { type: 'image/png' }), 'map.png', makeDeps());
    expect(outcome).toEqual({ status: 'imported', source: 'raster', warnings: [{ kind: 'catalog-drift' }] });
    vi.unstubAllGlobals();
  });

  it('surfaces a raster decode failure with its ShareErrorCode, without loading a map', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2 } as unknown as ImageBitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(2 * 2 * 4) }),
    } as unknown as CanvasRenderingContext2D);
    vi.mocked(importFromRaster).mockResolvedValue({ ok: false, error: { code: 'no-payload' } } as unknown as RasterImportResult);

    const deps = makeDeps();
    const outcome = await importFile(new File(['x'], 'map.png', { type: 'image/png' }), 'map.png', deps);
    expect(outcome).toEqual({ status: 'failed', code: 'no-payload' });
    expect(deps.loadMap).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
