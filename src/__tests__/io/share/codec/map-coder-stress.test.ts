// Edge and hostile cases for the map coder. The corpus proves it handles maps the app produces;
// this proves it handles the extremes of what the model can represent, and refuses what it cannot.
import { describe, it, expect } from 'vitest';
import { RangeEncoder, RangeDecoder } from '../../../../io/share/codec/bitio';
import { encodeMap, decodeMap, MODEL_VARIANTS } from '../../../../io/share/codec/map-coder';
import { tokenOf, type CellFields } from '../../../../io/share/codec/grid-io';
import { getMapTemplate } from '../../../../config/maps';
import { SHARE_CATALOG_ORDER } from '../../../../io/share/codec/catalog-order';
import { ELEVATION_MAX } from '../../../../core/model/constants';
import { CellZone } from '../../../../core/model/types';
import type { SaveObject } from '../../../../io/save-format';
import type { MapTemplate } from '../../../../core/model/types';

const CORNERS = [...'SF1234E'];
const template = getMapTemplate('hexia');
const N = template.width * template.height;
const blank = (): (CellFields | null)[] => new Array(N).fill(null);
const objKey = (o: SaveObject) =>
  `${o.catalogId}@${o.x},${o.y}/${o.rotation}/${o.elevation}/${o.spanLength}/${o.corners}/${o.patchOnly}`;

function trip(cells: (CellFields | null)[], objects: SaveObject[], variant = 0, t: MapTemplate = template) {
  const enc = new RangeEncoder();
  encodeMap(enc, t, cells, objects, MODEL_VARIANTS[variant]!);
  const bytes = enc.finish();
  const got = decodeMap(new RangeDecoder(bytes), t, MODEL_VARIANTS[variant]!);
  expect(got.cells.map(tokenOf)).toEqual(cells.map(tokenOf));
  expect(got.objects.map(objKey).sort()).toEqual(objects.map(objKey).sort());
  return bytes;
}

/** Deterministic PRNG — a fuzz case that fails must be reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

describe('map coder — extremes of the representable', () => {
  it('carries an empty map', () => { trip(blank(), []); });

  it('carries a single cell in each grid corner', () => {
    for (const [x, y] of [[0, 0], [template.width - 1, 0], [0, template.height - 1],
      [template.width - 1, template.height - 1]] as const) {
      const cells = blank();
      cells[y * template.width + x] = { type: 1, elevation: 1, corners: null, patchOnly: false, patchBase: null };
      trip(cells, []);
    }
  });

  it('carries a wholly filled map at the maximum elevation', () => {
    const cells = blank();
    for (let i = 0; i < N; i++) {
      cells[i] = { type: 1, elevation: ELEVATION_MAX, corners: null, patchOnly: false, patchBase: null };
    }
    trip(cells, []);
  });

  it('carries every corner code in every slot', () => {
    const cells = blank();
    let i = 0;
    for (let a = 0; a < CORNERS.length; a++) for (let b = 0; b < CORNERS.length; b++) {
      cells[i++] = {
        type: 1, elevation: 3, patchOnly: false, patchBase: null,
        corners: `${CORNERS[a]}${CORNERS[b]}${CORNERS[b]}${CORNERS[a]}`,
      };
    }
    trip(cells, []);
  });

  it('carries a patch at every base tier, including the from-empty one', () => {
    const cells = blank();
    for (let e = 0; e <= ELEVATION_MAX; e++) {
      cells[e * template.width + 5] = { type: 1, elevation: Math.max(1, e), corners: 'FFFF', patchOnly: true, patchBase: e };
    }
    cells[20 * template.width + 5] = { type: 1, elevation: 2, corners: 'FSSS', patchOnly: true, patchBase: null };
    trip(cells, []);
  });

  it('carries objects at the grid edges, every rotation, and an elevation off the surface', () => {
    const cells = blank();
    cells[0] = { type: 1, elevation: 4, corners: null, patchOnly: false, patchBase: null };
    const objects: SaveObject[] = [
      { id: 'a', catalogId: SHARE_CATALOG_ORDER[0]!, x: 0, y: 0, rotation: 0, elevation: ELEVATION_MAX },
      { id: 'b', catalogId: SHARE_CATALOG_ORDER[1]!, x: template.width - 1, y: 0, rotation: 90 },
      { id: 'c', catalogId: SHARE_CATALOG_ORDER[2]!, x: 0, y: template.height - 1, rotation: 180, elevation: 0 },
      { id: 'd', catalogId: SHARE_CATALOG_ORDER[3]!, x: template.width - 1, y: template.height - 1, rotation: 270,
        spanLength: 6, corners: 'S1E4', patchOnly: true },
    ];
    trip(cells, objects);
  });

  it('carries a crowd on one cell up to the cap', () => {
    const objects: SaveObject[] = Array.from({ length: 8 }, (_, k) => (
      { id: `o${k}`, catalogId: SHARE_CATALOG_ORDER[k % SHARE_CATALOG_ORDER.length]!, x: 3, y: 3, rotation: 0 }));
    trip(blank(), objects);
  });

  it('carries an object on every cell of the map', () => {
    const objects: SaveObject[] = [];
    for (let i = 0; i < N; i++) {
      objects.push({ id: `o${i}`, catalogId: SHARE_CATALOG_ORDER[i % SHARE_CATALOG_ORDER.length]!,
        x: i % template.width, y: Math.floor(i / template.width), rotation: 0 });
    }
    trip(blank(), objects);
  }, 60_000);

  it('carries fuzzed maps under every model shape', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed);
      const cells = blank();
      const objects: SaveObject[] = [];
      for (let i = 0; i < N; i++) {
        if (r() < 0.35) {
          const corners = r() < 0.4
            ? Array.from({ length: 4 }, () => CORNERS[Math.floor(r() * CORNERS.length)]).join('')
            : null;
          const patchOnly = r() < 0.1;
          cells[i] = {
            type: r() < 0.5 ? 1 : 2,
            elevation: 1 + Math.floor(r() * ELEVATION_MAX),
            corners: corners === 'SSSS' ? null : corners,
            patchOnly,
            patchBase: patchOnly && r() < 0.7 ? Math.floor(r() * ELEVATION_MAX) : null,
          };
        }
        if (r() < 0.05) {
          objects.push({
            id: `o${objects.length}`,
            catalogId: SHARE_CATALOG_ORDER[Math.floor(r() * SHARE_CATALOG_ORDER.length)]!,
            x: i % template.width, y: Math.floor(i / template.width),
            rotation: [0, 90, 180, 270][Math.floor(r() * 4)]!,
            ...(r() < 0.8 ? { elevation: Math.floor(r() * ELEVATION_MAX) } : {}),
          });
        }
      }
      for (let v = 0; v < MODEL_VARIANTS.length; v++) {
        const model = MODEL_VARIANTS[v]!;
        if (!model.templateMask) {
          trip(cells, objects, v);
          continue;
        }
        const maskedCells = cells.map((cell, index) => {
          const x = index % template.width;
          const y = Math.floor(index / template.width);
          return template.zones[y]?.[x] === CellZone.Grass ? cell : null;
        });
        const maskedObjects = objects.filter((object) => (
          template.zones[Math.floor(object.y)]?.[Math.floor(object.x)] === CellZone.Grass
        ));
        trip(maskedCells, maskedObjects, v);
      }
    }
  }, 120_000);
});

describe('map coder — what it refuses', () => {
  it('refuses an item with no wire index rather than coding a wrong one', () => {
    expect(() => trip(blank(), [{ id: 'o', catalogId: 'nope', x: 1, y: 1, rotation: 0 }]))
      .toThrow(/unknown catalogId/);
  });

  it('stops rather than piling objects on one cell without bound', () => {
    // A crafted stream can keep answering "another one here"; the decoder must not follow it
    // forever. Every byte 0xff drives the models toward 1, which is that answer.
    const hostile = new Uint8Array(4096).fill(0xff);
    expect(() => decodeMap(new RangeDecoder(hostile), template, MODEL_VARIANTS[0]!))
      .toThrow(/implausible|out of range/);
  });

  it('does not hang or throw out of a truncated stream', () => {
    const enc = new RangeEncoder();
    const cells = blank();
    for (let i = 0; i < 500; i++) cells[i] = { type: 1, elevation: 2, corners: null, patchOnly: false, patchBase: null };
    encodeMap(enc, template, cells, [], MODEL_VARIANTS[0]!);
    const full = enc.finish();
    for (const cut of [0, 1, 2, 8, Math.floor(full.length / 2), full.length - 1]) {
      // Truncation yields a different map or a named refusal — never a hang, never a crash the
      // payload layer cannot describe. The content hash above this is what rejects the result.
      expect(() => {
        try { decodeMap(new RangeDecoder(full.slice(0, cut)), template, MODEL_VARIANTS[0]!); }
        catch (e) { if (e instanceof RangeError) throw e; }
      }).not.toThrow();
    }
  });
});
