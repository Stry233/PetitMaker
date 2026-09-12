// End-to-end PetitGlyph image tests cover composition, PNG encoding, raster import, image
// degradation, annotations, and generation metadata across the codec corpus.
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

/** Place a code band inside a synthetic full-image composition. */
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
  it('restores annotations from the visible code band', async () => {
    const { state } = (await corpusCases()).find((c) => c.name === 'hand-edit-small')!;
    state.annotations = {
      items: [
        { kind: 'zone', id: 'z1', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }], color: '#FF8A7A', tag: 'homes', num: 1, size: 'm' },
        { kind: 'chip', id: 't1', x: 5.5, y: 6, tag: 'plaza', size: 'l', color: '#FFB347' },
        { kind: 'route', id: 'r1', points: [{ x: 1, y: 1 }, { x: 4.5, y: 2 }], color: '#2FBF9B', dashed: true },
      ],
      visible: false,
      locked: true,
    };
    const code = await buildShareCode(state, null, META, 1600);
    expect(code).not.toBeNull();
    const result = await importFromRaster(code!.rgba, code!.width, code!.height);
    expect(result.ok, result.ok ? '' : `${result.error.code}: ${result.error.message}`).toBe(true);
    if (!result.ok) return;
    expect(result.state.annotations).toEqual(state.annotations);
  }, TIMEOUT);

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

  describe('degraded composition loop for coarse profiles', () => {
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
    // Stress the Reed-Solomon margin beyond the documented q60, 0.75-scale envelope.
    const { state } = (await corpusCases()).find((c) => c.name === 'generated-hexia')!;
    const code = await buildShareCode(state, null, META, 1600);
    expect(code).not.toBeNull();
    const comp = inComposition(code!);
    let rgba = chromaSubsample420(comp.rgba, comp.width, comp.height);
    rgba = jpegLike(rgba, comp.width, comp.height, 30);
    rgba = downUp(rgba, comp.width, comp.height, 0.5);
    const result = await importFromRaster(rgba, comp.width, comp.height);
    expect(result.ok, result.ok ? '' : `${result.error.code}: ${result.error.message}`).toBe(true);
    if (!result.ok) return;
    expect(canonicalBytes(canonicalize(result.state))).toEqual(canonicalBytes(canonicalize(state)));
  }, TIMEOUT);

  it('re-exporting an imported map retains its compact generation note', async () => {
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
    expect(result.state.generation).toBeDefined();

    const reCode = await buildShareCode(result.state, null, META, 1600);
    expect(reCode).not.toBeNull();
    const delta = Math.abs(reCode!.payloadLen - code!.payloadLen) / code!.payloadLen;
    expect(delta).toBeLessThanOrEqual(0.1);
  }, TIMEOUT);
});
