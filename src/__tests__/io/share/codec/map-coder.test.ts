// The map coder is the ONE encoding of a map. What matters is that it is exact — every field
// comes back as it went in — and that the fields it does NOT send are the ones the reader can
// work out for itself.
import { describe, it, expect } from 'vitest';
import { RangeEncoder, RangeDecoder } from '../../../../io/share/codec/bitio';
import { encodeMap, decodeMap, MODEL_VARIANTS } from '../../../../io/share/codec/map-coder';
import { tokensOf, parseToken, tokenOf, type CellFields } from '../../../../io/share/codec/grid-io';
import { canonicalize } from '../../../../io/share/canonical';
import { getMapTemplate } from '../../../../config/maps';
import { corpusCases } from '../corpus';
import type { SaveObject } from '../../../../io/save-format';
import type { MapTemplate } from '../../../../core/model/types';

const roundTrip = (
  template: MapTemplate, cells: (CellFields | null)[], objects: SaveObject[], variant = 0,
) => {
  const enc = new RangeEncoder();
  encodeMap(enc, template, cells, objects, MODEL_VARIANTS[variant]!);
  const bytes = enc.finish();
  return { bytes, got: decodeMap(new RangeDecoder(bytes), template, MODEL_VARIANTS[variant]!) };
};
const objKey = (o: SaveObject) =>
  `${o.catalogId}@${o.x},${o.y}/${o.rotation}/${o.elevation}/${o.spanLength}/${o.corners}/${o.patchOnly}`;

describe('map coder', () => {
  it('returns every corpus map exactly, cell for cell and object for object', async () => {
    for (const { name, state } of await corpusCases()) {
      const c = canonicalize(state);
      const cells = tokensOf(c.cells).map(parseToken);
      const { got } = roundTrip(state.template, cells, c.objects);
      // Compare through the token form, which is what the payload rebuilds the save from.
      expect(got.cells.map(tokenOf), `${name}: cells`).toEqual(cells.map(tokenOf));
      expect(got.objects.map(objKey).sort(), `${name}: objects`).toEqual(c.objects.map(objKey).sort());
    }
  }, 120_000);

  it('returns the same map under every model shape', async () => {
    // The shapes differ only in what the coder is told to expect, never in what it carries.
    const { state } = (await corpusCases()).find((c) => c.name === 'maze-64')!;
    const c = canonicalize(state);
    const cells = tokensOf(c.cells).map(parseToken);
    for (let v = 0; v < MODEL_VARIANTS.length; v++) {
      const { got } = roundTrip(state.template, cells, c.objects, v);
      expect(got.cells.map(tokenOf), `variant ${v}`).toEqual(cells.map(tokenOf));
    }
  }, 60_000);

  it('picks up a lattice the plain shape misses', async () => {
    // A maze is decided by the parity of its cells; the shape that knows about parity must beat
    // the one that does not, or the variant is not earning the byte that names it. The margin is
    // narrow — the neighbourhood context already accounts for most of a lattice on its own — so
    // this asserts the ordering holds, not a particular size of win.
    const { state } = (await corpusCases()).find((c) => c.name === 'maze-64')!;
    const c = canonicalize(state);
    const cells = tokensOf(c.cells).map(parseToken);
    const plain = roundTrip(state.template, cells, c.objects, 0).bytes.length;
    const lattice = roundTrip(state.template, cells, c.objects, 1).bytes.length;
    expect(lattice).toBeLessThan(plain);
  }, 60_000);

  it('spells out a cut the silhouette cannot explain', async () => {
    // Most corner slots are locked square by the geometry and cost nothing. A cut in one of those
    // slots is a state the derivation does not produce, so it has to survive as an exception.
    const template = getMapTemplate('hexia');
    const cells: (CellFields | null)[] = new Array(template.width * template.height).fill(null);
    const at = (x: number, y: number) => y * template.width + x;
    for (let y = 40; y < 44; y++) for (let x = 40; x < 44; x++) {
      cells[at(x, y)] = { type: 1, elevation: 2, corners: null, patchOnly: false, patchBase: null };
    }
    // An interior cell: every one of its corners is pinned by same-height neighbours.
    cells[at(42, 42)] = { type: 1, elevation: 2, corners: 'F1S4', patchOnly: false, patchBase: null };
    const { got } = roundTrip(template, cells, []);
    expect(got.cells[at(42, 42)]?.corners).toBe('F1S4');
  });

  it('carries more than one object standing on the same cell', async () => {
    const template = getMapTemplate('hexia');
    const cells: (CellFields | null)[] = new Array(template.width * template.height).fill(null);
    const objects: SaveObject[] = [
      { id: 'o0', catalogId: 'road-stone', x: 10, y: 10, rotation: 0 },
      { id: 'o1', catalogId: 'bridge-plank', x: 10, y: 10, rotation: 90, spanLength: 4 },
    ];
    const { got } = roundTrip(template, cells, objects);
    expect(got.objects.map(objKey).sort()).toEqual(objects.map(objKey).sort());
  });

  it('refuses an item the wire order does not name', () => {
    const template = getMapTemplate('hexia');
    const cells: (CellFields | null)[] = new Array(template.width * template.height).fill(null);
    expect(() => roundTrip(template, cells, [
      { id: 'o0', catalogId: 'not-a-real-item', x: 1, y: 1, rotation: 0 },
    ])).toThrow(/unknown catalogId/);
  });

  it('costs less when the map is one the rules explain', async () => {
    // The derivation has to be worth its complexity: a generated island, whose corners the
    // silhouette accounts for, must code far smaller than the same cell count of noise.
    const cases = await corpusCases();
    const island = cases.find((c) => c.name === 'generated-hexia')!;
    const noise = cases.find((c) => c.name === 'adversarial')!;
    const size = (s: typeof island) => {
      const c = canonicalize(s.state);
      return roundTrip(s.state.template, tokensOf(c.cells).map(parseToken), c.objects).bytes.length;
    };
    expect(size(island)).toBeLessThan(size(noise) / 1.5);
  }, 120_000);
});
