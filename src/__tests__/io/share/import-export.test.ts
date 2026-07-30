// src/__tests__/io/share/import-export.test.ts — E2E for the PetitGlyph v2 raster-first
// orchestrators (export.ts/import.ts). Exercises buildShareCode → importFromRaster on the
// rendered code band ALONE (no PNG/pixels-through-capture round trip — e2e.test.ts covers that).
import { describe, it, expect } from 'vitest';
import { buildShareCode, type ShareCode } from '../../../io/share/export';
import { importFromRaster } from '../../../io/share/import';
import { canonicalize, canonicalBytes } from '../../../io/share/canonical';
import { GRID_ROWS, TOP_ROWS } from '../../../io/share/glyph/geometry';
import type { ShareCodeMeta } from '../../../io/share/codec/payload';
import { corpusCases } from './corpus';

const META: ShareCodeMeta = { appVersion: '1.0-test', saveVersion: 3 };

/** Deterministic tiny LCG — matches the style of other codec tests' seeded noise. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
}

/** Flip `count` scattered pixels within the DATA region only (below the finder/calibration/header
 *  rows) hard: xor 0x80 on all 3 color channels. */
function tamperDataRegion(code: ShareCode, count: number, seed: number): Uint8Array {
  const out = new Uint8Array(code.rgba);
  const mb = code.height / GRID_ROWS;
  const y0 = Math.ceil(TOP_ROWS * mb);
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * code.width);
    const y = y0 + Math.floor(rand() * (code.height - y0));
    const idx = (y * code.width + x) * 4;
    out[idx] = out[idx]! ^ 0x80;
    out[idx + 1] = out[idx + 1]! ^ 0x80;
    out[idx + 2] = out[idx + 2]! ^ 0x80;
  }
  return out;
}

describe('PetitGlyph v2 raster-first import/export', () => {
  it('buildShareCode → importFromRaster round-trips a hand-edited corpus map exactly', async () => {
    const cases = await corpusCases();
    const { state } = cases.find((c) => c.name === 'hand-edit-small')!;

    const code = await buildShareCode(state, null, META, 1600);
    expect(code).not.toBeNull();

    const result = await importFromRaster(code!.rgba, code!.width, code!.height);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(canonicalBytes(canonicalize(result.state))).toEqual(canonicalBytes(canonicalize(state)));
  });

  it('a blank (no-code) raster fails with no-payload', async () => {
    const width = 400, height = 150;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 0xf0; rgba[i * 4 + 1] = 0xf0; rgba[i * 4 + 2] = 0xeb; rgba[i * 4 + 3] = 255;
    }
    const result = await importFromRaster(rgba, width, height);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no-payload');
  });

  it('tampering ~40 scattered data-region pixels never yields a wrong canonical', async () => {
    const cases = await corpusCases();
    const { state } = cases.find((c) => c.name === 'hand-edit-small')!;
    const code = await buildShareCode(state, null, META, 1600);
    expect(code).not.toBeNull();

    const tampered = tamperDataRegion(code!, 40, 0xC0FFEE);
    const result = await importFromRaster(tampered, code!.width, code!.height);
    if (result.ok) {
      // RS/hash self-correction: the recovered canonical must be IDENTICAL to the original, never
      // a plausible-but-different map.
      expect(canonicalBytes(canonicalize(result.state))).toEqual(canonicalBytes(canonicalize(state)));
    } else {
      // Uncorrectable: must fail cleanly, never silently produce a different map. decodeGlyph can
      // reject before ever reaching decodeMapPayload's hash gate (no-payload) as well as after
      // (corrupt/decode-failed) — the binding invariant is "never ok with a different canonical",
      // asserted above; this branch only confirms the failure mode is one of the expected codes.
      expect(['no-payload', 'corrupt', 'decode-failed']).toContain(result.error.code);
    }
  });
});
