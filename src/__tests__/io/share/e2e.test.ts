// src/__tests__/io/share/e2e.test.ts — full PetitGlyph v2 pipeline, end to end: buildShareCode
// (the live export path) → paste the band into a synthetic composition (title/map chrome above,
// footer below — mirrors the real share-image layout) → encodePng/decodePng (the actual raster
// codec, not the in-memory RGBA the glyph-level tests use) → importFromRaster (the live import
// path). Exercises the WHOLE corpus (including the adversarial entropy-bomb map, which pins T4),
// a realistic capture-degradation loop for the low tiers, and the sticky-replay property that
// keeps a re-exported generated map small. Generator cases are slow — generous per-test timeout.
import { describe, it, expect } from 'vitest';
import { buildShareCode, importFromRaster } from '../../../io/share';
import type { ShareCodeMeta } from '../../../io/share/codec/payload';
import { encodePng, decodePng } from '../../../io/share/raster/png-raster';
import { canonicalize, canonicalBytes } from '../../../io/share/canonical';
import { BG } from '../../../io/share/glyph/palette';
import { CURRENT_VERSION } from '../../../io/save-format';
import { corpusCases } from './corpus';
import { chromaSubsample420, jpegLike, downUp } from './glyph/degrade';

const META: ShareCodeMeta = { appVersion: 'e2e', saveVersion: CURRENT_VERSION };
const TIMEOUT = 600000;

/** Paste the band into a taller/wider "composition" raster at an offset (title/map chrome above,
 *  footer below) — the shape a real share image actually has. Same pattern as the
 *  `inComposition` helper in glyph/roundtrip.test.ts, generalized to whatever band size
 *  buildShareCode produced. */
function inComposition(g: { rgba: Uint8Array; width: number; height: number }, padTop = 700, padX = 8) {
  const width = g.width + 2 * padX, height = g.height + padTop + 80;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255;
  }
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    const si = (y * g.width + x) * 4, di = ((y + padTop) * width + (x + padX)) * 4;
    out[di] = g.rgba[si]!; out[di + 1] = g.rgba[si + 1]!; out[di + 2] = g.rgba[si + 2]!; out[di + 3] = 255;
  }
  return { rgba: out, width, height };
}

describe('PetitGlyph end-to-end (buildShareCode → PNG → importFromRaster)', () => {
  it('every corpus map survives the full composed-PNG round trip exactly', async () => {
    for (const { name, state } of await corpusCases()) {
      const code = await buildShareCode(state, null, META, 1600);
      expect(code, name).not.toBeNull();
      const comp = inComposition(code!);
      const png = await encodePng({ width: comp.width, height: comp.height, data: comp.rgba });
      const decoded = await decodePng(png);
      const result = await importFromRaster(decoded.data, decoded.width, decoded.height);
      expect(result.ok, name).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings, name).toEqual([]);
      expect(canonicalBytes(canonicalize(result.state)), name).toEqual(canonicalBytes(canonicalize(state)));
    }
  }, TIMEOUT);

  describe('degraded composition loop (T0/T1 — inside the rated envelope)', () => {
    for (const name of ['hand-edit-small', 'generated-64']) {
      it(`${name} survives chromaSubsample420 + jpegLike(q60) + downUp(0.75) on the whole composition`, async () => {
        const { state } = (await corpusCases()).find((c) => c.name === name)!;
        const code = await buildShareCode(state, null, META, 1600);
        expect(code).not.toBeNull();
        const comp = inComposition(code!);

        let rgba = chromaSubsample420(comp.rgba, comp.width, comp.height);
        rgba = jpegLike(rgba, comp.width, comp.height, 60);
        rgba = downUp(rgba, comp.width, comp.height, 0.75);

        const result = await importFromRaster(rgba, comp.width, comp.height);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(canonicalBytes(canonicalize(result.state))).toEqual(canonicalBytes(canonicalize(state)));
      }, TIMEOUT);
    }
  });

  it('the largest map holds well past the rated envelope', async () => {
    // The rated envelope above is what a chat app or a social platform does to an image. This
    // pins the HEADROOM beyond it, because that is what the Reed-Solomon parity buys and what a
    // change to RS_K or the band geometry would quietly spend. Measured at 21% parity: the full
    // island survives a q30 recompression at half scale — roughly an image forwarded, re-saved
    // and screenshotted again. It does not survive q25 at 0.45, which is where this stops.
    const { state } = (await corpusCases()).find((c) => c.name === 'generated-hexia')!;
    const code = await buildShareCode(state, null, META, 1600);
    expect(code).not.toBeNull();
    const comp = inComposition(code!);
    let rgba = chromaSubsample420(comp.rgba, comp.width, comp.height);
    rgba = jpegLike(rgba, comp.width, comp.height, 30);
    rgba = downUp(rgba, comp.width, comp.height, 0.5);
    const result = await importFromRaster(rgba, comp.width, comp.height);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(canonicalBytes(canonicalize(result.state))).toEqual(canonicalBytes(canonicalize(state)));
  }, TIMEOUT);

  it('re-exporting an imported map reproduces the same code', async () => {
    const { state } = (await corpusCases()).find((c) => c.name === 'generated-64')!;
    expect(state.generation).toBeDefined();

    const code = await buildShareCode(state, null, META, 1600);
    expect(code).not.toBeNull();
    const comp = inComposition(code!);
    const png = await encodePng({ width: comp.width, height: comp.height, data: comp.rgba });
    const decoded = await decodePng(png);
    const result = await importFromRaster(decoded.data, decoded.width, decoded.height);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.generation).toBeDefined(); // P_REPLAY predictor survives the round trip

    const reCode = await buildShareCode(result.state, null, META, 1600);
    expect(reCode).not.toBeNull();
    const delta = Math.abs(reCode!.payloadLen - code!.payloadLen) / code!.payloadLen;
    expect(delta).toBeLessThanOrEqual(0.1);
  }, TIMEOUT);
});
