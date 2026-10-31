/**
 * The small-box treatment (`tools/generation/stencil/stencil-small.ts`) on pictures whose right answer
 * is arithmetic: the gate (full up to `SMALL_BOX_FULL`, blended to nothing at `SMALL_BOX_OFF`, and off
 * above it, where large-scale output is frozen by fingerprint), hue spent on tone, area and region
 * reading, borrowed colour, and the outline's own tier.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { TerrainType, type GridState } from '../../../../core/model/types';
import { type Stencil } from '../../../../tools/generation/recipe';
import { makeState, makeExecutor } from '../../../_support/map-state';
import {
  bedCells, hueReach, hueToneOffsets, planBorrow, planColorFill, settleWaterBodies, smallBoxWeight, type FillGate,
} from '../../../../tools/generation/stencil/stencil-small';
import {
  allocateEntries, areaSalience, AREA_MIN, cellDepths, coherentAreas, figureRim, fuseAreas, mergeToTarget, regionFlatness,
  regionTarget, type Area, type AreaReading,
} from '../../../../tools/generation/stencil/stencil-areas';
import { HUE_CHROMA_MIN, blendColor, hueMatched, hueOf, luma, nearestEntry, signedTurn } from '../../../../tools/generation/stencil/color';
import { FEATURE_MAX_SHARE } from '../../../../tools/generation/stencil/stencil-feature';
import { layStencilColor } from '../../../../tools/generation/stencil/stencil-generator';
import { paletteToneRange, terrainPalette } from '../../../../tools/generation/stencil/stencil';
import { declaredColorPalette } from '../../../../tools/generation/stencil/stencil-palette';
import { getCatalogItem } from '../../../../state/catalog';
import { ELEVATION_COLORS } from '../../../../core/model/palette';
import { hexStringToNumber } from '../../../../core/base/color';
import { ItemCategory } from '../../../../config/catalog/categories';

const square = (side: number) => ({ width: side, height: side });
/** The last side treated in full, and the first side left alone. */
const SIDES = Array.from({ length: 128 }, (_, side) => side);
const SMALL_BOX_FULL = SIDES.filter((side) => smallBoxWeight(square(side)) === 1).at(-1)!;
const SMALL_BOX_OFF = SIDES.find((side) => smallBoxWeight(square(side)) === 0)!;

const exec = (state: GridState): CommandExecutor =>
  makeExecutor(state);

/**
 * A fully covered stencil whose colour each cell takes from `at`, read as a drawing: a photographic
 * reading would dither a flat synthetic half, and a tier count would mostly measure the dither.
 */
function paint(side: number, at: (x: number, y: number) => number): Stencil {
  const color = new Uint32Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) color[y * side + x] = at(x, y);
  return {
    width: side, height: side, nature: 'flat',
    coverage: new Uint8Array(side * side).fill(255), color,
  };
}

/** A colour along `dir` scaled to `luma` tone `tone`, so two hues can share one lightness. */
function hueAtTone(dir: readonly [number, number, number], tone: number): number {
  const weight = 0.299 * dir[0] + 0.587 * dir[1] + 0.114 * dir[2];
  const k = Math.min(255, tone / weight);
  const at = (i: 0 | 1 | 2): number => Math.max(0, Math.min(255, Math.round(k * dir[i])));
  return ((at(0) << 16) | (at(1) << 8) | at(2)) >>> 0;
}

/** The terrain ramp's own tonal span, and the hue reach a full-weight small box takes out of it. */
const RAMP = paletteToneRange(terrainPalette(8, false));
const FULL_REACH = hueReach(1, RAMP);

// Unsaturated enough that no channel clips on the way to a tone: a clipped channel changes lightness.
const RED = [1, 0.45, 0.45] as const;
const GREEN = [0.45, 1, 0.45] as const;
const BLUE = [0.5, 0.5, 1] as const;

/** Every cell's built terrain over the stencil's box: the tier, or 0 for ground and -1 for water. */
function tiers(side: number, run: (state: GridState) => void): number[] {
  const state = makeState(side + 8, side + 8);
  run(state);
  const out: number[] = [];
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const terrain = state.cells[4 + y]?.[4 + x]?.terrain;
      out.push(!terrain ? 0 : terrain.type === TerrainType.Water ? -1 : terrain.elevation);
    }
  }
  return out;
}

/** A picture built in terrain at one box size, as tiers. */
function build(stencil: Stencil): number[] {
  return tiers(stencil.width, (state) => {
    const e = exec(state);
    const whole = e.beginStroke();
    layStencilColor(state, { origin: { x: 4, y: 4 }, stencil }, (c) => e.execute(c), { maxElevation: 8 });
    expect(whole.commit()).toEqual([]);
  });
}

describe('the small-box gate', () => {
  it('is full in a small box, blended between, and off in a large one', () => {
    expect(smallBoxWeight({ width: 16, height: 16 })).toBe(1);
    expect(SMALL_BOX_FULL).toBeGreaterThanOrEqual(16);
    expect(SMALL_BOX_OFF).toBeLessThan(62);
    for (let side = SMALL_BOX_FULL; side <= SMALL_BOX_OFF; side++) {
      expect(smallBoxWeight(square(side))).toBeCloseTo((SMALL_BOX_OFF - side) / (SMALL_BOX_OFF - SMALL_BOX_FULL), 12);
    }
    expect(smallBoxWeight({ width: 62, height: 62 })).toBe(0);
    expect(smallBoxWeight({ width: 120, height: 96 })).toBe(0);
    const between = smallBoxWeight({ width: 28, height: 28 });
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1);
  });

  it('reads the SHORTER side, which is what a picture is fitted to', () => {
    expect(smallBoxWeight({ width: 200, height: 16 })).toBe(1);
    expect(smallBoxWeight({ width: 16, height: 200 })).toBe(1);
  });
});

describe('hue is spent on tone where the palette has only tone', () => {
  it('turns a colour difference at one tone into a tier difference', () => {
    // Red and green at one lightness: without the hue lift the green ramp gives both one tier.
    const side = 16, mid = side / 2;
    const tone = 120;
    const stencil = paint(side, (x) => (x < mid ? hueAtTone(RED, tone) : hueAtTone(GREEN, tone)));
    expect(luma(hueAtTone(RED, tone))).toBeCloseTo(luma(hueAtTone(GREEN, tone)), 0);
    const built = build(stencil);
    const left = new Set<number>(), right = new Set<number>();
    for (let y = 2; y < side - 2; y++) {
      for (let x = 2; x < side - 2; x++) (x < mid ? left : right).add(built[y * side + x]!);
    }
    expect(left.size).toBe(1);
    expect(right.size).toBe(1);
    expect([...left][0]).not.toBe([...right][0]);
  });

  it('declines a picture whose colours are all one family', () => {
    // With one family, each cell's turn from the dominant hue is small noise, and moving cells by it
    // would scramble the shading that carries the subject.
    expect(hueToneOffsets(paint(16, () => hueAtTone(RED, 120)), () => true, FULL_REACH)).toBeNull();
    const shaded = paint(16, (x, y) => hueAtTone(RED, 90 + ((x + y) % 4) * 12));
    expect(hueToneOffsets(shaded, () => true, FULL_REACH)).toBeNull();
  });

  it('offers nothing to spend on a grey picture, and says so', () => {
    const stencil = paint(16, (x, y) => ((x + y) % 2 === 0 ? 0x808080 : 0x606060));
    expect(hueToneOffsets(stencil, () => true, FULL_REACH)).toBeNull();
  });

  it('measures every cell from the picture\'s own dominant hue', () => {
    // Mostly red with a green corner: the red keeps its tone and the green moves, either way.
    const side = 12;
    const stencil = paint(side, (x, y) => (x < 5 && y < 5 ? hueAtTone(GREEN, 120) : hueAtTone(RED, 120)));
    const offsets = hueToneOffsets(stencil, () => true, FULL_REACH)!;
    expect(offsets).not.toBeNull();
    expect(Math.abs(offsets[side * 6 + 6]!)).toBeLessThan(0.5);     // the dominant area, unmoved
    expect(Math.abs(offsets[0]!)).toBeGreaterThan(15);              // the odd colour out, a tier off
  });

  it('weighs a cell by its chroma, so a pastel moves less than a saturated colour', () => {
    const side = 8;
    const strong = paint(side, (x) => (x < 4 ? hueAtTone(RED, 120) : hueAtTone(BLUE, 120)));
    // The second half nearly grey: still a different family, but low chroma.
    const pale = paint(side, (x) => (x < 4 ? hueAtTone(RED, 120) : 0x8f9ab4));
    const strongOffsets = hueToneOffsets(strong, () => true, FULL_REACH)!;
    const paleOffsets = hueToneOffsets(pale, () => true, FULL_REACH)!;
    expect(Math.abs(paleOffsets[7]!)).toBeLessThan(Math.abs(strongOffsets[7]!));
  });

  it('scales with the gate and is nothing at all above it', () => {
    const stencil = paint(16, (x) => (x < 8 ? hueAtTone(RED, 120) : hueAtTone(GREEN, 120)));
    const full = hueToneOffsets(stencil, () => true, hueReach(1, RAMP))!;
    const half = hueToneOffsets(stencil, () => true, hueReach(0.5, RAMP))!;
    expect(Math.abs(half[15]!)).toBeCloseTo(Math.abs(full[15]!) / 2, 4);
    expect(hueToneOffsets(stencil, () => true, hueReach(0, RAMP))).toBeNull();
    // The reach is a share of the palette's range.
    expect(hueReach(1, { ...RAMP, hi: (RAMP.lo + RAMP.hi) / 2 })).toBeCloseTo(hueReach(1, RAMP) / 2, 5);
  });

  it('hueToneOffsets is one answer per picture, asked twice', () => {
    const stencil = paint(16, (x, y) => hueAtTone(x + y > 16 ? RED : BLUE, 120 + (x % 3) * 8));
    expect([...hueToneOffsets(stencil, () => true, FULL_REACH)!])
      .toEqual([...hueToneOffsets(stencil, () => true, FULL_REACH)!]);
  });
});

describe('hue, as plain arithmetic', () => {
  it('reads a hue and a chroma, and calls a grey neither', () => {
    expect(hueOf(0xff0000).hue).toBeCloseTo(0, 5);
    expect(hueOf(0x00ff00).hue).toBeCloseTo(120, 5);
    expect(hueOf(0x0000ff).hue).toBeCloseTo(240, 5);
    expect(hueOf(0x808080).chroma).toBe(0);
  });

  it('turns the short way round the circle, signed', () => {
    expect(signedTurn(10, 40)).toBeCloseTo(30, 5);
    expect(signedTurn(40, 10)).toBeCloseTo(-30, 5);
    expect(signedTurn(350, 10)).toBeCloseTo(20, 5);
    expect(signedTurn(10, 350)).toBeCloseTo(-20, 5);
    expect(Math.abs(signedTurn(0, 180))).toBeCloseTo(180, 5);
  });
});

describe('the areas a small box spends its palette on', () => {
  const all = (): boolean => true;
  const colourOf = (s: Stencil) => (i: number): number => s.color[i] ?? 0;

  it('coherentAreas finds one area per coherent colour, 4-connected', () => {
    const side = 8;
    const s = paint(side, (x) => (x < 4 ? 0x203040 : 0xc0d0e0));
    const areas = coherentAreas(s, all, colourOf(s));
    expect(areas).toHaveLength(2);
    expect(areas[0]!.cells).toHaveLength((side * side) / 2);
    expect(areas.reduce((sum, a) => sum + a.cells.length, 0)).toBe(side * side);
  });

  it('coherentAreas counts two blocks touching only at a corner as two areas, the way the map does', () => {
    // Both areas are big enough that the speck fold leaves them alone.
    const side = 8;
    const block = (x: number, y: number): boolean =>
      (x >= 1 && x < 3 && y >= 1 && y < 3) || (x >= 3 && x < 5 && y >= 3 && y < 5);
    const s = paint(side, (x, y) => (block(x, y) ? 0x102030 : 0xf0f0f0));
    expect(coherentAreas(s, all, colourOf(s)).filter((a) => a.cells.length === 4)).toHaveLength(2);
  });

  it('folds a speck of nearly its neighbour\'s colour into it', () => {
    const side = 8;
    const s = paint(side, (x, y) => (x === 4 && y === 4 ? 0xd2d2d2 : x < 4 ? 0x202020 : 0xe0e0e0));
    const areas = coherentAreas(s, all, colourOf(s));
    expect(areas).toHaveLength(2);
    const holding = areas.find((a) => a.cells.includes(4 * side + 4))!;
    expect(luma(holding.rgb)).toBeGreaterThan(128);        // it joined the light half, not the dark one
    for (const area of areas) expect(area.cells.length).toBeGreaterThanOrEqual(AREA_MIN);
  });

  it('keeps a speck that is nothing like its neighbour, which is what saves an outline', () => {
    // Under 4-connectivity a one-cell rim breaks into tiny pieces, which a size-only fold would
    // swallow into the body.
    const side = 7;
    const rim = (x: number, y: number): boolean => x === 0 || y === 0 || x === side - 1 || y === side - 1;
    const s = paint(side, (x, y) => (rim(x, y) ? 0x101010 : 0xf0f0f0));
    const areas = coherentAreas(s, all, colourOf(s));
    const dark = areas.filter((a) => luma(a.rgb) < 64);
    expect(dark.length).toBeGreaterThan(0);
    expect(dark.reduce((sum, a) => sum + a.cells.length, 0)).toBe(side * side - (side - 2) ** 2);
  });

  it('coherentAreas keeps a lone cell with no neighbour to join', () => {
    const side = 5;
    const coverage = new Uint8Array(side * side);
    coverage[2 * side + 2] = 255;
    const s: Stencil = {
      width: side, height: side, nature: 'flat', coverage,
      color: new Uint32Array(side * side).fill(0x334455),
    };
    const areas = coherentAreas(s, all, colourOf(s));
    expect(areas).toHaveLength(1);
    expect(areas[0]!.cells).toEqual([2 * side + 2]);
  });

  it('coherentAreas reads only the cells a run may write', () => {
    const side = 6;
    const s = paint(side, () => 0x445566);
    const areas = coherentAreas(s, (i) => i % side < 3, colourOf(s));
    expect(areas.reduce((sum, a) => sum + a.cells.length, 0)).toBe(side * 3);
  });

  it('measures how deep inside the figure each cell sits', () => {
    const side = 7;
    const s = paint(side, () => 0x445566);
    const depth = cellDepths(s, () => true);
    expect(depth[0]).toBe(1);                       // a corner is rim
    expect(depth[3 * side + 3]).toBe(4);            // the middle of a 7-cell square
    expect(depth[side + 1]).toBe(2);
  });

  it('coherentAreas is one answer per picture, asked twice', () => {
    const side = 10;
    const s = paint(side, (x, y) => ((x * 3 + y * 5) % 7 < 3 ? 0x203040 : 0xa0b0c0));
    const once = coherentAreas(s, all, colourOf(s)).map((a) => a.cells.join(','));
    expect(once).toEqual(coherentAreas(s, all, colourOf(s)).map((a) => a.cells.join(',')));
  });
});

describe('which entry each area is told in', () => {
  const all = (): boolean => true;
  /** Eight entries a tone apart, shaped like the terrain ramp: index 0 the darkest. */
  const TONES = [79, 94, 109, 124, 139, 154, 169, 184];

  it('spends the room it has on the areas: the darkest on the darkest entry, the lightest on the lightest', () => {
    // Spread across the entries rather than each taking its nearest: the nearest is often taken by a
    // darker area, leaving one step of contrast.
    const side = 8;
    const s = paint(side, (x) => (x < 4 ? 0x4a4a4a : 0xa0a0a0));
    const areas = coherentAreas(s, all, (i) => s.color[i] ?? 0);
    const slots = allocateEntries(areas, areaSalience(s, areas), TONES);
    const dark = areas.map((_, id) => id).filter((id) => luma(areas[id]!.rgb) < 128);
    const light = areas.map((_, id) => id).filter((id) => luma(areas[id]!.rgb) >= 128);
    for (const id of dark) expect(slots[id]!).toBe(0);
    for (const id of light) expect(slots[id]!).toBe(TONES.length - 1);
  });

  it('keeps the picture\'s own light and dark in order', () => {
    const side = 9;
    const s = paint(side, (x) => (x < 3 ? 0x303030 : x < 6 ? 0x808080 : 0xd0d0d0));
    const areas = coherentAreas(s, all, (i) => s.color[i] ?? 0);
    const slots = allocateEntries(areas, areaSalience(s, areas), TONES);
    const order = areas.map((_, id) => id).sort((a, b) => areas[a]!.tone - areas[b]!.tone);
    for (let k = 1; k < order.length; k++) {
      expect(slots[order[k]!]!).toBeGreaterThanOrEqual(slots[order[k - 1]!]!);
    }
  });

  it('never gives an area an entry darker than its own cells can stand at', () => {
    // The rim's cells are shallow, so the darkest entries are refused it; the lighter body must rise
    // with it rather than end darker than its outline.
    const side = 9;
    const rim = (x: number, y: number): boolean => x === 0 || y === 0 || x === side - 1 || y === side - 1;
    const s = paint(side, (x, y) => (rim(x, y) ? 0x101010 : 0xe0e0e0));
    const areas = coherentAreas(s, all, (i) => s.color[i] ?? 0);
    const read = areaSalience(s, areas);
    const minTone = read.depth.map((depth) => (depth <= 1 ? TONES[3]! : -Infinity));
    const slots = allocateEntries(areas, read, TONES, minTone);
    const dark = areas.map((_, id) => id).filter((id) => luma(areas[id]!.rgb) < 64);
    const light = areas.map((_, id) => id).filter((id) => luma(areas[id]!.rgb) >= 64);
    for (const id of dark) expect(slots[id]!).toBeGreaterThanOrEqual(3);
    for (const id of light) {
      for (const other of dark) expect(slots[id]!).toBeGreaterThanOrEqual(slots[other]!);
    }
  });

  it('blends a colour toward another, and at the ends is each one exactly', () => {
    expect(blendColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(blendColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(blendColor(0x000000, 0x646464, 0.5)).toBe(0x323232);
  });
});

describe('a pond wants a body', () => {
  /** A flat grey host for the water pass; each case supplies tones through `tone`. */
  const host = (side: number): Stencil => paint(side, () => 0x808080);

  it('returns a one-cell pond to land when there is nothing to grow into', () => {
    const side = 6;
    const s = host(side);
    const isWater = new Uint8Array(side * side);
    isWater[2 * side + 2] = 1;
    // Every neighbour is far below the water cut.
    const moved = settleWaterBodies(s, isWater, 1, { tone: () => 10, cut: 200, step: 15 }, () => true);
    expect(moved).toBe(1);
    expect([...isWater].filter(Boolean)).toHaveLength(0);
  });

  it('grows a speck to the minimum out of the lightest cells beside it', () => {
    const side = 6;
    const s = host(side);
    const isWater = new Uint8Array(side * side);
    isWater[2 * side + 2] = 1;
    const tone = (i: number): number => (i === 2 * side + 3 ? 199 : i === 3 * side + 2 ? 198 : 100);
    settleWaterBodies(s, isWater, 1, { tone: tone, cut: 200, step: 15 }, () => true);
    const body = [...isWater].filter(Boolean).length;
    expect(body).toBe(3);                         // the least body water keeps
    expect(isWater[2 * side + 3]).toBe(1);          // the brightest neighbour went first
    expect(isWater[3 * side + 2]).toBe(1);
  });

  it('leaves a body that is already big enough exactly as it is', () => {
    const side = 6;
    const s = host(side);
    const isWater = new Uint8Array(side * side);
    for (const i of [2 * side + 2, 2 * side + 3, 3 * side + 2]) isWater[i] = 1;
    expect(settleWaterBodies(s, isWater, 1, { tone: () => 210, cut: 200, step: 15 }, () => true)).toBe(0);
    expect([...isWater].filter(Boolean)).toHaveLength(3);
  });

  it('will not take a cell the caller keeps closed, which is what leaves a pond its bank', () => {
    const side = 6;
    const s = host(side);
    const isWater = new Uint8Array(side * side);
    isWater[2 * side + 2] = 1;
    const closed = new Set([2 * side + 3, 3 * side + 2, 2 * side + 1, side + 2]);
    settleWaterBodies(s, isWater, 1, { tone: () => 210, cut: 200, step: 15 }, (i) => !closed.has(i));
    expect([...isWater].filter(Boolean)).toHaveLength(0);   // nowhere legal to grow, so back to land
  });

  it('does nothing at all above the gate', () => {
    const side = 6;
    const s = host(side);
    const isWater = new Uint8Array(side * side);
    isWater[2 * side + 2] = 1;
    expect(settleWaterBodies(s, isWater, 0, { tone: () => 10, cut: 200, step: 15 }, () => true)).toBe(0);
    expect(isWater[2 * side + 2]).toBe(1);
  });
});

/**
 * The picture as a few spatial regions rather than a quantisation of every cell: the merge keeps a
 * small high-contrast feature, the outline becomes one region, and a gradient keeps its shading.
 */
describe('a small box composes the picture in regions', () => {
  const all = (): boolean => true;
  const colourOf = (s: Stencil) => (i: number): number => s.color[i] ?? 0;

  it('asks for three to six regions, by the box\'s own side', () => {
    const none: Area[] = [];
    expect(regionTarget({ width: 12, height: 12 }, none, 1)).toBe(3);
    expect(regionTarget({ width: 4, height: 4 }, none, 1)).toBe(3);
    expect(regionTarget({ width: 16, height: 16 }, none, 1)).toBe(4);
    expect(regionTarget({ width: 20, height: 20 }, none, 1)).toBe(5);
    expect(regionTarget({ width: 24, height: 24 }, none, 1)).toBe(6);
    expect(regionTarget({ width: 48, height: 48 }, none, 1)).toBe(6);
    expect(regionTarget({ width: 96, height: 96 }, none, 1)).toBe(6);
  });

  it('blends back toward the picture\'s own areas as the gate closes', () => {
    const side = 20;
    const s = paint(side, (x, y) => ((x + y) % 3) * 0x303030 + 0x202020);
    const areas = coherentAreas(s, all, colourOf(s));
    expect(areas.length).toBeGreaterThan(6);                   // more than the most regions any box asks for
    const half = regionTarget(s, areas, 0.5);
    expect(half).toBeGreaterThan(regionTarget(s, areas, 1));
    expect(half).toBeLessThan(regionTarget(s, areas, 0));
    expect(regionTarget(s, areas, 0)).toBe(areas.length);
  });

  it('merges the near-identical neighbours and keeps the small feature that is nothing like them', () => {
    // Four near-identical shades and a 3-cell dark eye: two regions are the shades and the eye.
    const side = 10;
    const shades = [0xb0b4b0, 0xb2b6b2, 0xb4b8b4, 0xb6bab6];
    const eye = new Set([4 * side + 4, 4 * side + 5, 5 * side + 4]);
    const s = paint(side, (x, y) => (eye.has(y * side + x) ? 0x101010 : shades[(x / 3) | 0]!));
    const areas = coherentAreas(s, all, colourOf(s));
    expect(areas.length).toBeGreaterThan(2);
    const merged = mergeToTarget(s, areas, 2);
    expect(merged.areas).toHaveLength(2);
    const kept = merged.areas.find((a) => a.cells.length === eye.size)!;
    expect(new Set(kept.cells)).toEqual(eye);
    expect(luma(kept.rgb)).toBeLessThan(64);
  });

  it('never consumes the region it is told to protect', () => {
    const side = 8;
    const s = paint(side, (x) => (x < 2 ? 0x203040 : x < 5 ? 0x506070 : 0x8090a0));
    const areas = coherentAreas(s, all, colourOf(s));
    expect(areas).toHaveLength(3);
    const merged = mergeToTarget(s, areas, 1, 1);
    expect(merged.protect).toBeGreaterThanOrEqual(0);
    expect(merged.areas[merged.protect]!.cells).toEqual(areas[1]!.cells);
  });

  it('mergeToTarget is one answer per picture, asked twice', () => {
    const side = 12;
    const s = paint(side, (x, y) => (((x * 5 + y * 3) % 11) << 16) | (((x * 7) % 13) << 8) | ((y * 5) % 17));
    const areas = coherentAreas(s, all, colourOf(s));
    const once = mergeToTarget(s, areas, 4).areas.map((a) => a.cells.join(','));
    const twice = mergeToTarget(s, areas, 4).areas.map((a) => a.cells.join(','));
    expect(once).toEqual(twice);
  });

  it('reads a drawing\'s outline as ONE region, which is what it never is on its own', () => {
    // Under 4-connectivity a diagonal line breaks into pieces touching only at corners, so the
    // outline has to be fused.
    const side = 21, mid = 10, r = 9;
    const inside = (x: number, y: number): boolean => Math.abs(x - mid) + Math.abs(y - mid) <= r;
    const rim = (x: number, y: number): boolean => Math.abs(x - mid) + Math.abs(y - mid) === r;
    const coverage = new Uint8Array(side * side);
    const color = new Uint32Array(side * side);
    let ring = 0;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        if (!inside(x, y)) continue;
        coverage[y * side + x] = 255;
        const dark = rim(x, y);
        color[y * side + x] = dark ? 0x201818 : 0xd8d0c8;
        if (dark) ring++;
      }
    }
    const s: Stencil = { width: side, height: side, nature: 'flat', coverage, color };
    const areas = coherentAreas(s, all, colourOf(s));
    const ids = figureRim(s, areas);
    expect(ids.length).toBeGreaterThan(1);                 // the line arrives in pieces
    const fused = fuseAreas(areas, ids);
    expect(fused.at).toBeGreaterThanOrEqual(0);
    const outline = fused.areas[fused.at]!;
    expect(outline.cells).toHaveLength(ring);
    expect(luma(outline.rgb)).toBeLessThan(64);
  });

  it('reads no outline on a picture that has none', () => {
    const side = 10;
    const s = paint(side, (x) => (x < 5 ? 0x304050 : 0xc0d0e0));
    expect(figureRim(s, coherentAreas(s, all, colourOf(s)))).toEqual([]);
  });

  it('will not call the subject an outline, however dark its edge', () => {
    // A dark mass touching the edge is the subject, not a line round it.
    const side = 8;
    const s = paint(side, (x, y) => (x === 0 || y === 0 ? 0xf0f0f0 : 0x201818));
    expect(figureRim(s, coherentAreas(s, all, colourOf(s)))).toEqual([]);
  });

  it('tells a flat region in one entry and leaves a true gradient its own shading', () => {
    const side = 12;
    const step = 15;
    const flatArea = paint(side, () => 0x808080);
    expect(regionFlatness(flatArea, coherentAreas(flatArea, all, colourOf(flatArea)), colourOf(flatArea), step))
      .toEqual([1]);
    // Every bucket boundary cuts a gradient, so only the merge makes it one region.
    const ramp = paint(side, (x) => { const v = 0x50 + x * 8; return (v << 16) | (v << 8) | v; });
    const one = mergeToTarget(ramp, coherentAreas(ramp, all, colourOf(ramp)), 1).areas;
    expect(one).toHaveLength(1);
    expect(regionFlatness(ramp, one, colourOf(ramp), step)[0]!).toBeLessThan(1);
  });
});

/**
 * The green ramp cannot say a warm region, so the mixed material paves it in a road surface, a coating
 * that keeps the terrain beneath. Bounded by two promises: the map stays legal, and the mountain and
 * water materials lay no road.
 */
describe('a small box borrows a hue its own palette has none of', () => {
  const roads = declaredColorPalette('roads');
  const ramp = terrainPalette(8, false);
  const region = (cells: number[], rgb: number): Area => ({ cells, rgb, tone: luma(rgb) });
  const own = (area: Area): number => area.rgb;

  it('borrows for a region the ramp cannot say, and not for one it can', () => {
    const warm = region([0, 1, 2, 3, 4], 0xc06030);
    const green = region([10, 11, 12, 13, 14], hexStringToNumber(ELEVATION_COLORS[3]!));
    const plan = planBorrow({ regions: [warm, green], rim: -1 }, own, ramp, roads, 'free');
    expect(plan.has(0)).toBe(true);
    expect(plan.has(1)).toBe(false);
    const took = roads.find((entry) => entry.catalogId === plan.get(0))!;
    expect(hueOf(took.rgb).hue).toBeLessThan(60);
    expect(hueOf(took.rgb).chroma).toBeGreaterThan(HUE_CHROMA_MIN);
  });

  it('never borrows for the outline, whose job is the boundary', () => {
    const rim = region([0, 1, 2, 3, 4, 5], 0x40201a);
    const body = region([10, 11, 12, 13, 14], 0xc06030);
    const plan = planBorrow({ regions: [rim, body], rim: 0 }, own, ramp, roads, 'free');
    expect(plan.has(0)).toBe(false);
    expect(plan.has(1)).toBe(true);
  });

  it('bounds an ACCENT to a third of the figure, and lets MIXED spend the lot', () => {
    // No material uses `accent` (`stencil-generator.ts:borrowPolicy`); this pins the bound it names.
    const big = region([...Array(60).keys()], 0xc06030);
    const mid = region([...Array(20).keys()].map((i) => 100 + i), 0xa04828);
    const small = region([...Array(10).keys()].map((i) => 200 + i), 0xd08050);
    const regions = [big, mid, small];
    const cells = (plan: Map<number, string>): number =>
      [...plan.keys()].reduce((sum, id) => sum + regions[id]!.cells.length, 0);
    const accent = planBorrow({ regions, rim: -1 }, own, ramp, roads, 'accent');
    expect(accent.has(0)).toBe(false);                       // the subject's own mass stays in the ramp
    expect(cells(accent)).toBeLessThanOrEqual(90 / 3);
    expect(cells(planBorrow({ regions, rim: -1 }, own, ramp, roads, 'free'))).toBe(90);
    expect(planBorrow({ regions, rim: -1 }, own, ramp, roads, 'none').size).toBe(0);
  });

  it('borrows NOTHING for a mountain or a water picture, whatever the colours are', () => {
    // Warm regions and a rim, the case that would pave most, under the `none` policy those materials use.
    const regions = [
      region([...Array(6).keys()], 0x40201a),
      region([...Array(60).keys()].map((i) => 100 + i), 0xc06030),
      region([...Array(20).keys()].map((i) => 200 + i), 0xa04828),
    ];
    expect(planBorrow({ regions, rim: 0 }, own, ramp, roads, 'none').size).toBe(0);
    expect(planColorFill({ regions, rim: 0 }, own, ramp, roads, {
      bodyShare: FEATURE_MAX_SHARE, paved: new Set<number>(), ground: () => 99, policy: 'none', coated: 0,
    })).toEqual([]);
  });

  it('planBorrow is one answer per picture, asked twice', () => {
    const regions = [region([0, 1, 2], 0xc06030), region([10, 11, 12], 0x6080c0), region([20, 21, 22], 0x909090)];
    const once = [...planBorrow({ regions, rim: -1 }, own, ramp, roads, 'free')];
    expect(once).toEqual([...planBorrow({ regions, rim: -1 }, own, ramp, roads, 'free')]);
  });

  it('lays the borrowed paving on the map, legally, and leaves the terrain under it', () => {
    const side = 16;
    const stencil = paint(side, (x) => (x < side / 2 ? 0xc85a2a : hexStringToNumber(ELEVATION_COLORS[2]!)));
    const state = makeState(side + 8, side + 8);
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layStencilColor(state, { origin: { x: 4, y: 4 }, stencil }, (c) => e.execute(c), { maxElevation: 8, water: 'palette' });
    expect(whole.commit()).toEqual([]);                   // the map is legal, coatings and all
    expect(res.coated).toBeGreaterThan(0);
    const paved = [...state.objects.values()];
    expect(paved.length).toBe(res.coated);
    for (const object of paved) {
      expect(getCatalogItem(object.catalogId)?.category).toBe(ItemCategory.Road);
      expect(object.position.x).toBeLessThan(4 + side / 2);
    }
  });

  it('lays no coating at all in the mountain or the water material, on the same picture', () => {
    // The warm half the mixed material paves above arrives as terrain alone.
    const side = 16;
    const stencil = paint(side, (x) => (x < side / 2 ? 0xc85a2a : hexStringToNumber(ELEVATION_COLORS[2]!)));
    for (const water of ['none', 'primary'] as const) {
      const state = makeState(side + 8, side + 8);
      const e = exec(state);
      const whole = e.beginStroke();
      const res = layStencilColor(state, { origin: { x: 4, y: 4 }, stencil }, (c) => e.execute(c), { maxElevation: 8, water });
      expect(whole.commit()).toEqual([]);
      expect(res.coated).toBeUndefined();
      expect(state.objects.size).toBe(0);
      expect(res.placed).toBeGreaterThan(0);                 // the picture itself is still built
    }
  });

  it('paves nothing at all above the gate, which is what keeps large-scale output frozen', () => {
    const side = SMALL_BOX_OFF;
    const stencil = paint(side, (x) => (x < side / 2 ? 0xc85a2a : hexStringToNumber(ELEVATION_COLORS[2]!)));
    const state = makeState(side + 8, side + 8);
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layStencilColor(state, { origin: { x: 4, y: 4 }, stencil }, (c) => e.execute(c), { maxElevation: 8, water: 'palette' });
    expect(whole.commit()).toEqual([]);
    expect(res.coated).toBeUndefined();
    expect(state.objects.size).toBe(0);
  });
});

/**
 * A body whose hue no green approximates, on ground too broken to pave, would arrive all green: the
 * borrow declines it and the accent (`stencil-feature.ts`) refuses the subject's mass. A bed is one
 * bounded block of a road surface matching its hue, laid inside it.
 */
describe('a body no other instrument can say gets a bed of borrowed colour', () => {
  const roads = declaredColorPalette('roads');
  const ramp = terrainPalette(8, false);
  const region = (cells: number[], rgb: number): Area => ({ cells, rgb, tone: luma(rgb) });
  const own = (area: Area): number => area.rgb;
  /** A body of `n` cells laid as a block, so a bed inside it has somewhere to grow. */
  const body = (n: number, rgb: number, from = 0): Area =>
    region([...Array(n).keys()].map((i) => from + i), rgb);
  const gate = (over: Partial<FillGate> = {}): FillGate =>
    ({ bodyShare: FEATURE_MAX_SHARE, paved: new Set<number>(), ground: () => 99, policy: 'free', coated: 0, ...over });

  it('fills a body the ramp is silent about, and not one it approximates', () => {
    const warm = body(60, 0xc0481b);
    const green = body(60, hexStringToNumber(ELEVATION_COLORS[4]!), 1000);
    expect(planColorFill({ regions: [warm], rim: -1 }, own, ramp, roads, gate()).map((f) => f.region)).toEqual([0]);
    expect(planColorFill({ regions: [green], rim: -1 }, own, ramp, roads, gate())).toEqual([]);
    const took = roads.find((entry) => entry.catalogId === planColorFill({ regions: [warm], rim: -1 }, own, ramp, roads, gate())[0]!.catalogId)!;
    expect(Math.abs(signedTurn(hueOf(0xc0481b).hue, hueOf(took.rgb).hue))).toBeLessThanOrEqual(40);
  });

  it('says nothing for a body with no hue to say, however far off the ramp it is', () => {
    // Far off the ramp, but a grey or near-black has no hue a bed could say.
    const grey = body(60, 0xcecece);
    const black = body(60, 0x1a1017);
    expect(nearestEntry(ramp, 0xcecece).off).toBeGreaterThan(0);
    expect(planColorFill({ regions: [grey], rim: -1 }, own, ramp, roads, gate())).toEqual([]);
    expect(planColorFill({ regions: [black], rim: -1 }, own, ramp, roads, gate())).toEqual([]);
  });

  it('leaves the outline, the features and an already-paved region alone', () => {
    const rim = body(20, 0x40201a);
    const mass = body(60, 0xc0481b, 1000);
    const speck = body(4, 0xc0481b, 2000);              // under an eighth of the figure: the accent's
    const regions = [rim, mass, speck];
    expect(planColorFill({ regions, rim: 0 }, own, ramp, roads, gate()).map((f) => f.region)).toEqual([1]);
    expect(planColorFill({ regions, rim: 0 }, own, ramp, roads, gate({ paved: new Set([1]) }))).toEqual([]);
  });

  it('spends a sixteenth of the figure over at most two bodies, and never a stray tile', () => {
    const regions = [body(60, 0xc0481b), body(50, 0x2a3f8f, 1000), body(40, 0xb08a2a, 2000)];
    const figure = 150;
    const plan = planColorFill({ regions, rim: -1 }, own, ramp, roads, gate());
    expect(plan.length).toBe(2);
    expect(plan.reduce((sum, fill) => sum + fill.want, 0)).toBeLessThanOrEqual(Math.round(figure / 16));
    // The ground bounds a bed too, and a one-cell bed is none.
    expect(planColorFill({ regions, rim: -1 }, own, ramp, roads, gate({ ground: () => 3 }))
      .every((fill) => fill.want === 3)).toBe(true);
    expect(planColorFill({ regions, rim: -1 }, own, ramp, roads, gate({ ground: () => 1 }))).toEqual([]);
  });

  it('reads the material through the SAME policy the paving does, and spends only what is left', () => {
    // A third of this 60-cell figure is 20 cells: 17 already paved leaves 3, and 19 leaves too few.
    const regions = [body(60, 0xc0481b)];
    expect(planColorFill({ regions, rim: -1 }, own, ramp, roads, gate({ policy: 'none' }))).toEqual([]);
    expect(planColorFill({ regions, rim: -1 }, own, ramp, roads, gate({ policy: 'accent', coated: 17 }))[0]!.want).toBe(3);
    expect(planColorFill({ regions, rim: -1 }, own, ramp, roads, gate({ policy: 'accent', coated: 19 }))).toEqual([]);
  });

  it('planColorFill is one answer per picture, asked twice', () => {
    const regions = [body(60, 0xc0481b), body(50, 0x2a3f8f, 1000)];
    const once = planColorFill({ regions, rim: -1 }, own, ramp, roads, gate());
    expect(once).toEqual(planColorFill({ regions, rim: -1 }, own, ramp, roads, gate()));
  });

  it('gathers a bed around ONE seed out of the cells the ground holds', () => {
    // A 6x6 body whose ground holds a 2x2 patch and one loose cell away from it.
    const side = 8;
    const stencil = paint(side, () => 0xc0481b);
    const cells: number[] = [];
    for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) cells.push(y * side + x);
    const patch = new Set([2 * side + 2, 2 * side + 3, 3 * side + 2, 3 * side + 3]);
    const loose = 5 * side + 6;
    const open = (i: number): boolean => patch.has(i) || i === loose;
    const bed = bedCells(stencil, region(cells, 0xc0481b), open, 3);
    expect(bed.length).toBe(3);
    expect(bed.every((i) => patch.has(i))).toBe(true);        // the patch, never the loose cell first
    const whole = bedCells(stencil, region(cells, 0xc0481b), open, 9);
    expect(whole.length).toBe(5);
    expect(whole.slice(0, 3)).toEqual(bed);
    expect(bedCells(stencil, region(cells, 0xc0481b), () => false, 3)).toEqual([]);
  });

  it('matches a hue or answers nothing', () => {
    const greys = [{ rgb: 0x808080 }, { rgb: 0xd0d0d0 }];
    expect(hueMatched(greys, 0xc0481b, 40)).toBeNull();
    for (const turn of [10, 40]) {
      const match = hueMatched(roads, 0xc0481b, turn);
      if (!match) continue;
      expect(Math.abs(signedTurn(hueOf(0xc0481b).hue, hueOf(roads[match.at]!.rgb).hue))).toBeLessThanOrEqual(turn);
      expect(hueOf(roads[match.at]!.rgb).chroma).toBeGreaterThanOrEqual(HUE_CHROMA_MIN);
    }
    expect(hueMatched(roads, 0xc0481b, 40)).not.toBeNull();
  });

  it('lays a bed on the map legally, inside the body, and none above the gate', () => {
    // Light cells scattered through the warm body become water, leaving most of it against a step
    // where the borrow cannot pave.
    const side = 16;
    const warm = 0xc85a2a;
    const at = (x: number, y: number): number =>
      (x < side / 2 ? ((x + y) % 5 === 0 ? 0xf6f2e8 : warm) : hexStringToNumber(ELEVATION_COLORS[2]!));
    const state = makeState(side + 8, side + 8);
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layStencilColor(state, { origin: { x: 4, y: 4 }, stencil: paint(side, at) }, (c) => e.execute(c), { maxElevation: 8, water: 'palette' });
    expect(whole.commit()).toEqual([]);                   // legal, bed and all
    expect(res.coated).toBeGreaterThan(0);
    const byMaterial = new Map<string, number>();
    for (const object of state.objects.values()) {
      expect(getCatalogItem(object.catalogId)?.category).toBe(ItemCategory.Road);
      expect(object.position.x).toBeLessThan(4 + side / 2);   // on the warm body, not the green half
      byMaterial.set(object.catalogId, (byMaterial.get(object.catalogId) ?? 0) + 1);
    }
    // The bed shows as a second material within the fill's budget.
    expect(byMaterial.size).toBeGreaterThan(1);
    expect(Math.min(...byMaterial.values())).toBeLessThanOrEqual(Math.round((side * side) / 16));
    const big = SMALL_BOX_OFF;
    const above = makeState(big + 8, big + 8);
    const eAbove = exec(above);
    const res2 = layStencilColor(above, { origin: { x: 4, y: 4 }, stencil: paint(big, (x, y) => at(Math.floor((x * side) / big), Math.floor((y * side) / big))) }, (c) => eAbove.execute(c), { maxElevation: 8, water: 'palette' });
    expect(res2.coated).toBeUndefined();
    expect(above.objects.size).toBe(0);
  });
});

/**
 * A thin dark line at a figure's edge stands at most three layers high, which caps the whole picture
 * while it is kept in one tonal order. Spent apart, the interior gets the ramp at the cost of inverting
 * light and dark across that boundary, so only a line is spent apart.
 */
describe('the outline is spent apart where it is a line', () => {
  const tones = terrainPalette(8, false).map((entry) => luma(entry.rgb));
  const darkest = Math.min(...tones), lightest = Math.max(...tones);
  /** The tone floor for a cell of this depth, three layers per step inward, as `layStencilColor`
   *  computes it. */
  const floorAt = (depth: number): number => {
    const cap = Math.max(1, Math.min(8, 3 * Math.max(1, depth)));
    return Math.min(...terrainPalette(8, false).filter((e) => e.elevation <= cap).map((e) => luma(e.rgb)));
  };
  const reading = (sizes: number[], depths: number[]): { areas: Area[]; read: AreaReading } => ({
    areas: sizes.map((n, id) => {
      const cells = [...Array(n).keys()].map((i) => id * 1000 + i);
      const tone = darkest + ((lightest - darkest) * id) / Math.max(1, sizes.length - 1);
      const v = Math.round(tone);
      return { cells, rgb: (v << 16) | (v << 8) | v, tone };
    }),
    read: { salience: sizes.map(() => 1), depth: depths, touches: sizes.map(() => []) },
  });

  it('gives the interior room the outline would otherwise have held it to', () => {
    // An outline at depth 1 (capped at three layers) round two deeper interior regions.
    const { areas, read } = reading([12, 60, 20], [1, 3, 2]);
    const floors = read.depth.map(floorAt);
    const together = allocateEntries(areas, read, tones, floors, -1);
    const apart = allocateEntries(areas, read, tones, floors, 0);
    const span = (slots: number[]): number => Math.max(...slots.slice(1)) - Math.min(...slots.slice(1));
    expect(span(apart)).toBeGreaterThan(span(together));
    // The outline takes the darkest tier it can stand at.
    expect(tones[apart[0]!]).toBeCloseTo(floors[0]!, 5);
  });

  it('keeps a picture in order where the outline is a SHARE of it rather than a line', () => {
    // The dark region is a third of the figure: inverting it costs more order than the range buys.
    const { areas, read } = reading([40, 60, 20], [1, 3, 2]);
    const floors = read.depth.map(floorAt);
    expect(allocateEntries(areas, read, tones, floors, 0))
      .toEqual(allocateEntries(areas, read, tones, floors, -1));
  });
});
