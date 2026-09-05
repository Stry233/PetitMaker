// Hostile, malformed, and oversized inputs return typed failures from the raster-first importer.
import { describe, it, expect } from 'vitest';
import { buildShareCode } from '../../../io/share/export';
import { importFromRaster, importFromBytes } from '../../../io/share/import';
import { DEFAULT_LIMITS } from '../../../io/share/errors';
import { encodePng } from '../../../io/share/raster/png-raster';
import { deserialize } from '../../../io/json-codec';
import { getMapTemplate } from '../../../config/maps';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';

function fixture() {
  const raw = readFileSync('src/__tests__/io/__fixtures__/petit-planet-hexia-1782022830197.json', 'utf8');
  return deserialize(raw, getMapTemplate((JSON.parse(raw) as { templateId?: string }).templateId));
}

describe('security & robustness', () => {
  it('a plain (non-PNG) byte blob never crashes importFromBytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const r = await importFromBytes(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-an-image');
  });

  it('a blank (no-code) raster fails cleanly, no crash', async () => {
    const width = 400, height = 150;
    const rgba = new Uint8Array(width * height * 4).fill(255);
    const r = await importFromRaster(rgba, width, height);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no-payload');
  });

  it('a structurally valid but codeless PNG fails cleanly through importFromBytes', async () => {
    const width = 300, height = 120;
    const data = new Uint8Array(width * height * 4).fill(240);
    const png = await encodePng({ width, height, data });
    const r = await importFromBytes(png);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no-payload');
  });

  it('a truncated/corrupt PNG never crashes importFromBytes', async () => {
    const width = 300, height = 120;
    const data = new Uint8Array(width * height * 4).fill(128);
    const png = await encodePng({ width, height, data });
    const truncated = png.slice(0, Math.floor(png.length / 2));
    const r = await importFromBytes(truncated);
    expect(r.ok).toBe(false);
  });

  it('an over-tight maxCanonicalBytes limit rejects a real code without crashing', async () => {
    const state = fixture();
    const code = await buildShareCode(state, null, { appVersion: '1.0-test', saveVersion: 3 }, 1600);
    expect(code).not.toBeNull();
    const png = await encodePng({ width: code!.width, height: code!.height, data: code!.rgba });
    const r = await importFromBytes(png, { ...DEFAULT_LIMITS, maxCanonicalBytes: 8 });
    expect(r.ok).toBe(false);
  });

  it('tampering random bytes in a real code never yields a crash, only a typed result', async () => {
    const state = fixture();
    const code = await buildShareCode(state, null, { appVersion: '1.0-test', saveVersion: 3 }, 1600);
    expect(code).not.toBeNull();
    const rgba = new Uint8Array(code!.rgba);
    // Flip every 37th byte hard — gross corruption, not a scattered-noise robustness probe.
    for (let i = 0; i < rgba.length; i += 37) rgba[i] = rgba[i]! ^ 0xff;
    const r = await importFromRaster(rgba, code!.width, code!.height);
    expect(typeof r.ok).toBe('boolean');
    if (!r.ok) expect(['no-payload', 'corrupt', 'decode-failed']).toContain(r.error.code);
  });
});
