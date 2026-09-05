// MODEL_VARIANTS indices are persisted in payload frames and remain append-only.
import { describe, it, expect } from 'vitest';
import { MODEL_VARIANTS, decodeMap, encodeMap, modelCanRepresent } from '../../../../io/share/codec/map-coder';
import { RangeDecoder, RangeEncoder } from '../../../../io/share/codec/bitio';
import { tokenOf, type CellFields } from '../../../../io/share/codec/grid-io';
import { SHARE_CATALOG_ORDER } from '../../../../io/share/codec/catalog-order';
import { getMapTemplate } from '../../../../config/maps';
import { CellZone } from '../../../../core/model/types';
import type { SaveObject } from '../../../../io/save-format';
import { frozenTemplateMask } from '../../../../io/share/codec/template-mask';

const WIRE_PREFIX = [
  { parity: false, half: false },
  { parity: true, half: false },
  { parity: false, half: true },
  { parity: true, half: true },
];

const MASKED_SUFFIX = [
  { parity: false, half: false, templateMask: 1 },
  { parity: true, half: false, templateMask: 1 },
  { parity: false, half: true, templateMask: 1 },
  { parity: true, half: true, templateMask: 1 },
];

describe('share codec model-shape wire order', () => {
  it('keeps the wire prefix at its fixed indices', () => {
    expect(MODEL_VARIANTS.slice(0, WIRE_PREFIX.length)).toEqual(WIRE_PREFIX);
  });

  it('lists each shape once', () => {
    expect(MODEL_VARIANTS.slice(WIRE_PREFIX.length)).toEqual(MASKED_SUFFIX);
    const keys = MODEL_VARIANTS.map((v) => `${v.parity}-${v.half}-${!!v.templateMask}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays inside the byte the frame writes it as', () => {
    expect(MODEL_VARIANTS.length).toBeLessThanOrEqual(256);
  });
});

describe('template-mask model shapes', () => {
  const template = getMapTemplate('hexia');
  const count = template.width * template.height;
  const inMask = (index: number) => template.zones[Math.floor(index / template.width)]?.[index % template.width] === CellZone.Grass;
  const terrain = (): CellFields => ({ type: 1, elevation: 2, corners: null, patchOnly: false, patchBase: null });

  it('pins revision 1 coordinates for both built-in templates', () => {
    for (const [id, expectedCount] of [['hexia', 15_846], ['tafa', 15_914]] as const) {
      const current = getMapTemplate(id);
      const mask = frozenTemplateMask(current, 1)!;
      expect(mask.reduce((sum, value) => sum + value, 0), id).toBe(expectedCount);
      for (let index = 0; index < mask.length; index++) {
        const x = index % current.width;
        const y = Math.floor(index / current.width);
        expect(mask[index] === 1, `${id} ${x},${y}`).toBe(current.zones[y]?.[x] === CellZone.Grass);
      }
    }
  });

  it('rejects unknown revisions, templates, and dimensions', () => {
    expect(frozenTemplateMask(template, 2)).toBeNull();
    expect(frozenTemplateMask({ id: 'unknown', width: template.width, height: template.height }, 1)).toBeNull();
    expect(frozenTemplateMask({ id: template.id, width: template.width - 1, height: template.height }, 1)).toBeNull();
  });

  it('round-trips exactly while coding fewer template-excluded coordinates', () => {
    const cells: (CellFields | null)[] = new Array(count).fill(null);
    for (let index = 0; index < count; index++) {
      if (inMask(index) && index % 3 === 0) cells[index] = terrain();
    }
    const anchors = cells.flatMap((cell, index) => cell && index % 997 === 0 ? [index] : []).slice(0, 4);
    const objects: SaveObject[] = anchors.map((index, objectIndex) => ({
      id: `o${objectIndex}`,
      catalogId: SHARE_CATALOG_ORDER[objectIndex]!,
      x: index % template.width,
      y: Math.floor(index / template.width),
      rotation: 0,
    }));

    const bytesFor = (variant: number) => {
      const encoder = new RangeEncoder();
      encodeMap(encoder, template, cells, objects, MODEL_VARIANTS[variant]!);
      return encoder.finish();
    };
    const plain = bytesFor(0);
    const masked = bytesFor(4);
    const decoded = decodeMap(new RangeDecoder(masked), template, MODEL_VARIANTS[4]!);

    expect(decoded.cells.map(tokenOf)).toEqual(cells.map(tokenOf));
    expect(decoded.objects.map(({ catalogId, x, y }) => ({ catalogId, x, y })))
      .toEqual(objects.map(({ catalogId, x, y }) => ({ catalogId, x, y })));
    expect(masked.length).toBeLessThan(plain.length);
  });

  it('refuses to omit terrain or objects outside the frozen mask', () => {
    const outside = Array.from({ length: count }, (_, index) => index).find((index) => !inMask(index))!;
    const cells: (CellFields | null)[] = new Array(count).fill(null);
    cells[outside] = terrain();
    const opts = MODEL_VARIANTS[4]!;
    expect(modelCanRepresent(template, cells, [], opts)).toBe(false);
    expect(() => encodeMap(new RangeEncoder(), template, cells, [], opts)).toThrow(/omit map data/);

    cells[outside] = null;
    const object: SaveObject = {
      id: 'o0', catalogId: SHARE_CATALOG_ORDER[0]!,
      x: outside % template.width, y: Math.floor(outside / template.width), rotation: 0,
    };
    expect(modelCanRepresent(template, cells, [object], opts)).toBe(false);
    expect(() => encodeMap(new RangeEncoder(), template, cells, [object], opts)).toThrow(/omit map data/);
  });
});
