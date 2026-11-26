// @vitest-environment jsdom
// Hostile, malformed, and oversized inputs return typed failures from the raster-first importer.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildShareCode } from '../../../io/share/export';
import { importFromRaster } from '../../../io/share/import';
import { inspectImportFile } from '../../../io/import/file';
import { deserialize } from '../../_support/save-file';
import { getMapTemplate } from '../../../config/maps';
import { readFileSync } from 'node:fs';
import { exportable } from '../../_support/exportable';
import { stubCanvasContext } from '../../_support/canvas-context';

function fixture() {
  const raw = readFileSync('src/__tests__/fixtures/saves/petit-planet-hexia-1782022830197.json', 'utf8');
  return deserialize(raw, getMapTemplate((JSON.parse(raw) as { templateId?: string }).templateId));
}

/** jsdom has no picture decoder: the browser's `createImageBitmap` hands over `rgba`. */
function decodesTo(rgba: Uint8Array, width: number, height: number): void {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close: () => {} }));
  stubCanvasContext({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(rgba) }) });
}

const picture = (name = 'map.png') => new File([new Uint8Array([1, 2, 3, 4, 5])], name, { type: 'image/png' });

describe('security & robustness', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('bytes that are no picture are refused unread', async () => {
    expect(await inspectImportFile(new File([new Uint8Array([1, 2, 3, 4, 5])], 'blob.bin'), 'blob.bin')).toEqual({ status: 'unsupported' });
  });

  it("a picture the browser cannot decode is the raster reader's refusal, never a crash", async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('decode', 'InvalidStateError')));
    vi.stubGlobal('Image', class { onerror: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onerror?.()); } });
    expect(await inspectImportFile(picture(), 'map.png')).toEqual({ status: 'failed', source: 'raster' });
  });

  it('a blank (no-code) raster fails cleanly, no crash', async () => {
    const width = 400, height = 150;
    const rgba = new Uint8Array(width * height * 4).fill(255);
    const r = await importFromRaster(rgba, width, height);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no-payload');
  });

  it('a decoded picture without a code fails cleanly through the import', async () => {
    const width = 300, height = 120;
    decodesTo(new Uint8Array(width * height * 4).fill(240), width, height);
    expect(await inspectImportFile(picture(), 'map.png')).toEqual({ status: 'failed', code: 'no-payload', source: 'raster' });
  });

  it('tampering random bytes in a real code never yields a crash, only a typed result', async () => {
    const state = fixture();
    const code = await buildShareCode(exportable(state), null, { appVersion: '1.0-test', saveVersion: 3 }, 1600);
    expect(code).not.toBeNull();
    const rgba = new Uint8Array(code!.rgba);
    // Flip every 37th byte hard: gross corruption, not a scattered-noise robustness probe.
    for (let i = 0; i < rgba.length; i += 37) rgba[i] = rgba[i]! ^ 0xff;
    decodesTo(rgba, code!.width, code!.height);
    const inspection = await inspectImportFile(picture(), 'map.png');
    if (inspection.status !== 'ready') expect(inspection).toMatchObject({ status: 'failed', code: expect.stringMatching(/^(?:no-payload|corrupt|decode-failed)$/), source: 'raster' });
  });
});
