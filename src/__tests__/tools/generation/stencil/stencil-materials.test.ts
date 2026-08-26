/**
 * WHAT a picture is built out of, and the decoration laid over it.
 *
 * The material is the palette: the one-cell catalogue less the trees, the flowers alone, the trees
 * alone, or the road surfaces. The decoration is the mixed composition's second half — bounded,
 * rule-checked and absent unless the material asks for one.
 *
 * THE DECORATION IS TWO INSTRUMENTS OVER ONE GATE, and the cases here are about the BACKGROUND one:
 * objects at the picture's anchor points, where it changes most and where its colour is furthest from
 * anything the primary can draw. That is what a box above `SMALL_BOX_OFF` gets, which is why these
 * pictures are larger than the gate — in a small box the decoration is an accent spent on the few
 * features that identify the subject instead, and `stencil-feature.test.ts` is where that is pinned.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { ItemCategory, TerrainType, type EditorEvents, type GridState, type PlacedObject, type StencilPlan } from '../../../../core/model/types';
import { makeState } from '../../../rules/_helpers';
import { getCatalogItem } from '../../../../state/catalog';
import { ELEVATION_COLORS } from '../../../../core/model/constants';
import { hexStringToNumber } from '../../../../core/model/colors';
import type { Stencil } from '../../../../tools/generation/stencil/stencil';
import { declaredColorPalette, materialDeclaresColors, paletteItems } from '../../../../tools/generation/stencil/stencil-palette';
import { DECOR_MAX_SHARE, layStencilDecor, runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import { terrainPalette } from '../../../../tools/generation/stencil/stencil';
import { objectPlacementCommand } from '../../../../tools/objects/object-placer';

const exec = (state: GridState) => new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));

/** Whether an item coats the surface rather than standing on it, read from its own traits. */
const isCoating = (catalogId: string): boolean =>
  getCatalogItem(catalogId)?.traits?.some((trait) => trait.type === 'surfaceCoating') ?? false;

/** A stencil of one flat colour, fully covered. */
function flat(side: number, rgb: number): Stencil {
  return {
    width: side, height: side,
    coverage: new Uint8Array(side * side).fill(255),
    color: new Uint32Array(side * side).fill(rgb),
  };
}

describe('the materials a picture may be built from', () => {
  it('offers only single-cell items, so nothing overlaps its neighbour', () => {
    for (const material of ['mixed', 'flora', 'trees', 'roads'] as const) {
      const items = paletteItems(material);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.width).toBe(1);
        expect(item.height).toBe(1);
        expect(item.maxCount).toBeUndefined();
      }
    }
  });

  it('confines each split to its own category, and keeps the trees out of the mixed one', () => {
    const flora = paletteItems('flora');
    const trees = paletteItems('trees');
    expect(flora.every((i) => i.category === ItemCategory.Flora)).toBe(true);
    expect(trees.every((i) => i.category === ItemCategory.Tree)).toBe(true);
    const mixed = new Set(paletteItems('mixed').map((i) => i.id));
    // Everything but the trees: a tree stands far taller than a bloom, so a picture marked with both
    // reads as a mess in game. A picture that wants trees asks for trees.
    for (const item of flora) expect(mixed.has(item.id)).toBe(true);
    for (const item of trees) expect(mixed.has(item.id)).toBe(false);
    expect(paletteItems('mixed').every((i) => i.category !== ItemCategory.Tree)).toBe(true);
    expect(mixed.size).toBeGreaterThan(flora.length);
  });

  it('takes the road surfaces from the catalog, colour and all, with no canvas anywhere', () => {
    expect(materialDeclaresColors('roads')).toBe(true);
    const palette = declaredColorPalette('roads');
    expect(palette.length).toBeGreaterThanOrEqual(20);
    for (const entry of palette) {
      expect(getCatalogItem(entry.catalogId)?.category).toBe(ItemCategory.Road);
      expect(entry.rgb).toBeGreaterThanOrEqual(0);
      expect(entry.rgb).toBeLessThanOrEqual(0xffffff);
    }
    // The colours really differ, or matching a picture against them says nothing.
    expect(new Set(palette.map((e) => e.rgb)).size).toBeGreaterThan(5);
  });

  it('knows every material\'s colours from the catalog, with no canvas anywhere', () => {
    // A sprite's colour is DERIVED DATA in the catalog (`iconColor`, written by the project's
    // extraction tooling and guarded by its own drift check), which is what lets the engine answer
    // "what colour is this flower" in a worker and in the offline benchmark — a colour sampled from a
    // canvas would leave anywhere without a page (both of those) with no palette at all.
    for (const material of ['mixed', 'flora', 'trees', 'roads'] as const) {
      expect(materialDeclaresColors(material)).toBe(true);
      const palette = declaredColorPalette(material);
      expect(palette).toHaveLength(paletteItems(material).length);
      for (const entry of palette) {
        expect(entry.rgb).toBeGreaterThanOrEqual(0);
        expect(entry.rgb).toBeLessThanOrEqual(0xffffff);
      }
      // A palette of one colour cannot match a picture: the derived colours really differ.
      expect(new Set(palette.map((e) => e.rgb)).size).toBeGreaterThan(Math.min(5, palette.length - 1));
    }
  });

  it('reads a sprite item\'s own derived colour, and lets a painted one win', () => {
    for (const item of paletteItems('mixed')) {
      expect(item.iconColor).toMatch(/^#[0-9a-f]{6}$/);
      const entry = declaredColorPalette('mixed').find((e) => e.catalogId === item.id);
      expect(entry?.rgb).toBe(hexStringToNumber(item.color ?? item.iconColor!));
    }
    // A road paints a colour instead of drawing a sprite, and that is the colour the map shows.
    for (const item of paletteItems('roads')) {
      expect(item.color).toMatch(/^#[0-9a-f]{6}$/);
      const entry = declaredColorPalette('roads').find((e) => e.catalogId === item.id);
      expect(entry?.rgb).toBe(hexStringToNumber(item.color!));
    }
  });

  it('answers the same palette every time it is asked', () => {
    for (const material of ['mixed', 'flora', 'trees', 'roads'] as const) {
      expect(declaredColorPalette(material)).toEqual(declaredColorPalette(material));
    }
  });

  it('paves a picture with roads when that is the material', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const palette = declaredColorPalette('roads');
    const plan: StencilPlan = {
      read: 'color', stencil: flat(6, 0xc4a882), origin: { x: 6, y: 6 }, objectPalette: palette,
    };
    const res = runStencilPlan(state, plan, 8, (c) => e.execute(c));
    expect(res.placed).toBeGreaterThan(0);
    for (const obj of state.objects.values()) {
      expect(getCatalogItem(obj.catalogId)?.category).toBe(ItemCategory.Road);
    }
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('leaves the mixed palette as the default a caller gets for asking nothing', () => {
    expect(paletteItems('mixed').length).toBeGreaterThan(paletteItems('roads').length);
  });
});

describe('the decoration layer', () => {
  /** A picture with one hard edge down its middle: the detail is exactly there. */
  function edged(side: number): Stencil {
    const s = flat(side, 0x202020);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) if (x >= side / 2) s.color[y * side + x] = 0xf0f0f0;
    }
    return s;
  }

  const PALETTE = [{ catalogId: 'flower-dahlia', rgb: 0xffffff }];

  it('is off unless asked for', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const plan: StencilPlan = {
      read: 'color', stencil: flat(8, hexStringToNumber(ELEVATION_COLORS[3]!)), origin: { x: 6, y: 6 },
    };
    runStencilPlan(state, plan, 8, (c) => e.execute(c));
    expect(state.objects.size).toBe(0);
  });

  it('marks the cells where the picture changes most', () => {
    const state = makeState(56, 56);
    const e = exec(state);
    const side = 40;
    layStencilDecor(state, { origin: { x: 6, y: 6 }, stencil: edged(side) }, { palette: PALETTE, density: 0.1 }, (c) => e.execute(c));
    expect(state.objects.size).toBeGreaterThan(0);
    // Every one of them sits on the seam, a cell either side of it.
    for (const obj of state.objects.values()) {
      const x = obj.position.x - 6;
      expect(Math.abs(x - (side / 2 - 0.5))).toBeLessThanOrEqual(1.5);
    }
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('is bounded however much is asked for, and never crowds', () => {
    const state = makeState(56, 56);
    const e = exec(state);
    const side = 40;
    const res = layStencilDecor(
      state, { origin: { x: 6, y: 6 }, stencil: noisy(side) },
      { palette: PALETTE, density: 5 }, (c) => e.execute(c),
    );
    expect(res.placed).toBeLessThanOrEqual(Math.floor(side * side * DECOR_MAX_SHARE));
    const at = new Set([...state.objects.values()].map((o) => `${o.position.x},${o.position.y}`));
    for (const obj of state.objects.values()) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        expect(at.has(`${obj.position.x + dx!},${obj.position.y + dy!}`)).toBe(false);
      }
    }
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('places nothing at all on a picture with no detail in it', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const res = layStencilDecor(state, { origin: { x: 6, y: 6 }, stencil: flat(8, 0x808080) }, { palette: PALETTE }, (c) => e.execute(c));
    expect(res.placed).toBe(0);
  });

  it('is deterministic: the same picture decorates the same places', () => {
    const run = (): string[] => {
      const state = makeState(24, 24);
      const e = exec(state);
      layStencilDecor(state, { origin: { x: 6, y: 6 }, stencil: noisy(10) }, { palette: PALETTE, density: 0.1 }, (c) => e.execute(c));
      return [...state.objects.values()].map((o) => `${o.position.x},${o.position.y}`).sort();
    };
    expect(run()).toEqual(run());
  });

  it('takes the cells the primary tiled, which is what a second element is for', () => {
    // A picture paved in paths, decorated with one flower: the marked cell was a road a moment ago,
    // and nothing may stand on a road (V-PLACE-COATED), so the mark has to take the cell rather than
    // stand on it.
    const state = makeState(52, 52);
    const e = exec(state);
    const plan: StencilPlan = {
      read: 'color', stencil: edged(34), origin: { x: 6, y: 6 },
      objectPalette: declaredColorPalette('roads'),
      decor: { palette: PALETTE, density: 0.1 },
    };
    const res = runStencilPlan(state, plan, 8, (c) => e.execute(c));
    expect(res.decorated).toBeGreaterThan(0);
    expect(res.placed).toBeGreaterThan(res.decorated!);
    const flowers = [...state.objects.values()].filter((o) => o.catalogId === PALETTE[0]!.catalogId);
    expect(flowers).toHaveLength(res.decorated!);
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('leaves an object it did not place standing, and goes without', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const side = 10;
    const stencil = edged(side);
    // Somebody else's tree, right on the seam where the decoration would most like to be.
    const tree: PlacedObject = { id: 'theirs', catalogId: 'tree-apple', position: { x: 6 + side / 2, y: 8 }, rotation: 0, elevation: 0 };
    expect(e.execute(objectPlacementCommand(tree)).success).toBe(true);
    layStencilDecor(state, { origin: { x: 6, y: 6 }, stencil }, { palette: PALETTE, density: 0.15 }, (c) => e.execute(c));
    expect(state.objects.get('theirs')).toBeDefined();
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('marks the colours the primary cannot say, not only the edges', () => {
    // Two halves with the SAME light and dark in them, so the gradient says they are equally
    // detailed; the left is drawn in the ramp's own greens and the right in a red of the same tone.
    // What separates them is only how far the primary palette can reach, which is the half of
    // salience an edge detector cannot see — a red bow on a green picture is a flat area.
    const side = 34, mid = Math.floor(side / 2);
    const s = flat(side, 0);
    for (let y = 0; y < side; y++) {
      const green = hexStringToNumber(ELEVATION_COLORS[y % 2 === 0 ? 3 : 5]!);
      const red = redOfTone(lumaOf(green));
      for (let x = 0; x < side; x++) s.color[y * side + x] = x < mid ? green : red;
    }
    const state = makeState(48, 48);
    const e = exec(state);
    const palette = [{ catalogId: 'flower-dahlia', rgb: 0xd44a5a }, { catalogId: 'flower-agapanthus', rgb: 0x93cf7e }];
    layStencilDecor(
      state, { origin: { x: 6, y: 6 }, stencil: s }, { palette, density: 0.08 },
      (c) => e.execute(c), undefined, terrainPalette(8, false),
    );
    const marks = [...state.objects.values()];
    expect(marks.length).toBeGreaterThan(4);
    // Most of them stand on the red half, and at least one well inside it rather than on the seam.
    const onRed = marks.filter((o) => o.position.x - 6 >= mid);
    expect(onRed.length).toBeGreaterThan(marks.length / 2);
    expect(onRed.some((o) => o.position.x - 6 > mid + 2)).toBe(true);
    // And each one is the palette entry whose colour is the picture's there.
    for (const mark of onRed) expect(mark.catalogId).toBe('flower-dahlia');
    expect(e.commitStroke(0)).toEqual([]);
  });
});

/** A red of a given tone: the same brightness the ramp is drawing in, so only the HUE is out of
 *  reach. `luma`'s own weights, solved for the scale of a fixed red direction. */
function redOfTone(tone: number): number {
  const dir = [1, 0.35, 0.35] as const;
  const k = Math.min(255, tone / (0.299 * dir[0] + 0.587 * dir[1] + 0.114 * dir[2]));
  const at = (i: 0 | 1 | 2): number => Math.round(k * dir[i]);
  return ((at(0) << 16) | (at(1) << 8) | at(2)) >>> 0;
}

const lumaOf = (rgb: number): number =>
  0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff);

describe('the mixed material is a composition, not a palette', () => {
  it('tells the ground in terrain and stands objects at the anchor points', () => {
    const state = makeState(30, 30);
    const e = exec(state);
    const side = 16;
    const s = flat(side, hexStringToNumber(ELEVATION_COLORS[4]!));
    // One bright mark the ramp cannot say, which is what a decoration is for.
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) s.color[y * side + x] = 0xe0407a;
    const decor = paletteItems('mixed').slice(0, 12).map((item, i) => ({ catalogId: item.id, rgb: 0xe0407a + i }));
    const plan: StencilPlan = {
      read: 'color', stencil: s, origin: { x: 6, y: 6 }, water: 'palette',
      decor: { palette: decor, density: 0.1 },
    };
    const res = runStencilPlan(state, plan, 8, (c) => e.execute(c));
    expect(res.decorated).toBeGreaterThan(0);
    // The ground under the picture is terrain, not a tiling of objects. The objects standing on it are
    // this material's two: the decoration, and the paving a small box borrows for a region the ramp has
    // no hue for (`stencil-small.ts:planBorrow` — this picture's bright mark is one, and the mixed
    // material borrows freely).
    expect(state.cells[6 + 1]![6 + 1]!.terrain?.type).toBe(TerrainType.Mountain);
    expect(res.coated).toBeGreaterThan(0);
    const kinds = new Set(decor.map((entry) => entry.catalogId));
    for (const object of state.objects.values()) {
      expect(kinds.has(object.catalogId) || isCoating(object.catalogId)).toBe(true);
    }
    // AN UPPER BOUND rather than a sum, because the bright mark is a FEATURE here: in a box this small
    // the accent is spent on it, and a mark takes its cell from the paving the region borrowed
    // (`layStencilDecor` — a feature is the more specific statement of the two). So the count standing is
    // what both laid, less the coatings the marks took.
    expect(state.objects.size).toBeLessThanOrEqual(res.decorated! + res.coated!);
    expect(state.objects.size).toBeGreaterThan(res.coated! - res.decorated!);
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('never plants a tree, whatever the picture asks for', () => {
    // The catalogue less the trees IS the material, so this holds by the palette rather than by a
    // filter at the placement — which is what keeps it true for every picture at once.
    const decor = paletteItems('mixed').map((item, i) => ({ catalogId: item.id, rgb: (i * 0x0a1b2c) & 0xffffff }));
    expect(decor.length).toBeGreaterThan(10);
    const state = makeState(30, 30);
    const e = exec(state);
    const plan: StencilPlan = {
      // Two flat halves: a picture with ground a mark can stand on, which a cell-by-cell relief is
      // not (nothing is flat beside a step, and the rules refuse a bloom there).
      read: 'color', stencil: twoTone(16), origin: { x: 6, y: 6 }, water: 'palette',
      decor: { palette: decor, density: 0.15 },
    };
    runStencilPlan(state, plan, 8, (c) => e.execute(c));
    expect(state.objects.size).toBeGreaterThan(0);
    for (const obj of state.objects.values()) {
      expect(getCatalogItem(obj.catalogId)?.category).not.toBe(ItemCategory.Tree);
    }
    expect(e.commitStroke(0)).toEqual([]);
  });
});

describe('the image mode takes a height', () => {
  it('tells the picture in as many layers as it was given, and no more', () => {
    const tallest = (state: GridState): number => Math.max(
      0, ...state.cells.flatMap((row) => row.map((c) => (c.terrain?.type === TerrainType.Mountain ? c.terrain.elevation : 0))),
    );
    const run = (maxElevation: number): number => {
      const state = makeState(24, 24);
      const e = exec(state);
      // The brightest green on the ramp: matched against a deep palette it stands tall, against a
      // shallow one it can only reach the top of what it was offered.
      const plan: StencilPlan = {
        read: 'color', stencil: flat(8, hexStringToNumber(ELEVATION_COLORS[8]!)), origin: { x: 6, y: 6 },
      };
      runStencilPlan(state, plan, maxElevation, (c) => e.execute(c));
      expect(e.commitStroke(0)).toEqual([]);
      return tallest(state);
    };
    expect(run(2)).toBe(2);
    expect(run(5)).toBe(5);
    expect(run(8)).toBeGreaterThan(5);
  });
});

/** Two flat halves, one green and one pink: real ground either side of one real edge. */
function twoTone(side: number): Stencil {
  const s = flat(side, hexStringToNumber(ELEVATION_COLORS[3]!));
  for (let y = 0; y < side; y++) {
    for (let x = side / 2; x < side; x++) s.color[y * side + x] = 0xe0407a;
  }
  return s;
}

/** A picture of alternating cells: detail everywhere, which is what the decoration must be bounded
 *  on. */
function noisy(side: number): Stencil {
  const s = flat(side, 0);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) s.color[y * side + x] = (x + y) % 2 === 0 ? 0x101010 : 0xf0f0f0;
  }
  return s;
}
