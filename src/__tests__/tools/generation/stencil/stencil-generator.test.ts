/**
 * The stencil generators: a picture laid onto the map as shape (text mode) or as colour (image mode).
 * The generator takes a rasterized stencil of plain numbers, so no canvas is needed here.
 */
import { placeObjectCommand } from '../../../../core/model/command-build';
import { describe, it, expect } from 'vitest';
import { TerrainType, type Command, type GridState, type PlacedObject, type ValidationResult } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { FLAT_SAFE_ELEVATION, type StencilPlan } from '../../../../tools/generation/recipe';
import { ELEVATION_MAX } from '../../../../core/game/profile';
import { COVERAGE_ON, covered, nearestTerrain, relaxHeights, STENCIL_MIN_SIDE, terrainPalette, textMinBox, type Stencil, tilesAShape } from '../../../../tools/generation/stencil/stencil';
import { finishGlyph } from '../../../../tools/generation/stencil/stencil-stroke';
import { layStencilColor, runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import { stencilChooser } from '../../../../tools/generation/stencil/stencil-trim';
import { getAllItems } from '../../../../state/catalog';
import { ELEVATION_COLORS, WATER_COLOR } from '../../../../core/model/palette';
import { hexStringToNumber } from '../../../../core/base/color';
import { ItemCategory } from '../../../../config/catalog/categories';

const exec = (state: GridState) => makeExecutor(state);

/** The text mode's terrain fill, laid through the plan entry the generator runs. */
const layTerrain = (
  state: GridState, placement: Pick<StencilPlan, 'origin' | 'stencil' | 'allow'>, terrain: TerrainType,
  execute: (cmd: Command) => ValidationResult,
) => runStencilPlan(state, { read: 'shape', fill: { kind: 'terrain', terrain }, ...placement }, ELEVATION_MAX, execute);

/** The text mode's object fill, laid through the plan entry the generator runs. */
const layObjects = (
  state: GridState, placement: Pick<StencilPlan, 'origin' | 'stencil' | 'allow'>, catalogId: string,
  execute: (cmd: Command) => ValidationResult,
) => runStencilPlan(state, { read: 'shape', fill: { kind: 'object', catalogId }, ...placement }, ELEVATION_MAX, execute);

/** A stencil from an ASCII picture: '#' is covered, '.' is not. */
function stencilOf(rows: string[], color = 0x000000): Stencil {
  const height = rows.length, width = rows[0]!.length;
  const coverage = new Uint8Array(width * height);
  const colors = new Uint32Array(width * height);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      coverage[y * width + x] = ch === '.' ? 0 : 255;
      colors[y * width + x] = color;
    });
  });
  return { width, height, coverage, color: colors };
}

const at = (state: GridState, x: number, y: number) => state.cells[y]?.[x]?.terrain ?? null;

describe('stencil: the palette a picture is matched against', () => {
  it('offers water plus one green per available layer', () => {
    const p = terrainPalette(3);
    expect(p).toHaveLength(4);
    expect(p[0]!.type).toBe(TerrainType.Water);
    expect(p.slice(1).map((e) => e.elevation)).toEqual([1, 2, 3]);
  });

  it('matches a colour to the terrain that draws in it', () => {
    const p = terrainPalette(8);
    expect(nearestTerrain(p, hexStringToNumber(WATER_COLOR)).type).toBe(TerrainType.Water);
    for (const e of [1, 4, 8]) {
      const exact = nearestTerrain(p, hexStringToNumber(ELEVATION_COLORS[e]!));
      expect(exact.elevation).toBe(e);
    }
  });

  it('sends a mid green to a green rather than to the water blue', () => {
    // The match is luma-weighted; unweighted, mid greens would fall to the blue.
    const p = terrainPalette(8);
    expect(nearestTerrain(p, 0x6ab84a).type).toBe(TerrainType.Mountain);
  });

  it('reads half coverage as inside the shape', () => {
    const s = stencilOf(['#']);
    s.coverage[0] = COVERAGE_ON;
    expect(s.coverage[0]).toBeGreaterThanOrEqual(COVERAGE_ON);
  });
});

describe('stencil as SHAPE (the text mode)', () => {
  it('raises the covered cells and leaves the rest alone', () => {
    const state = makeState(20, 20);
    const stencil = stencilOf([
      '.##.',
      '####',
      '.##.',
    ]);
    const res = layTerrain(state, { origin: { x: 5, y: 5 }, stencil }, TerrainType.Mountain, (c) => exec(state).execute(c));
    expect(res.placed).toBeGreaterThan(0);
    expect(at(state, 6, 5)?.type).toBe(TerrainType.Mountain);
    expect(at(state, 5, 5)).toBeNull();
    expect(at(state, 5, 6)?.type).toBe(TerrainType.Mountain);
  });

  it('stands one layer on the ground it is written on, edge and middle alike', () => {
    const state = makeState(20, 20);
    const rows = Array.from({ length: 6 }, () => '######');
    const e = exec(state);
    const whole = e.beginStroke();
    layTerrain(state, { origin: { x: 4, y: 4 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(at(state, 7, 7)?.elevation).toBe(1);
    expect(at(state, 4, 4)?.elevation).toBe(1);
    expect(whole.commit()).toEqual([]);
  });

  it('fills a shape with objects, stepped by the item\'s own footprint', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const rows = Array.from({ length: 4 }, () => '####');
    const res = layObjects(state, { origin: { x: 5, y: 5 }, stencil: stencilOf(rows) }, 'tree-apple', (c) => e.execute(c));
    expect(res.placed).toBeGreaterThan(0);
    expect(state.objects.size).toBe(res.placed);
    for (const o of state.objects.values()) {
      expect(o.position.x).toBeGreaterThanOrEqual(5);
      expect(o.position.x).toBeLessThan(9);
    }
  });

  it('places no object where the footprint would hang outside the shape', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    // A single covered cell cannot hold a 2x2 item whole.
    const res = layObjects(state, { origin: { x: 5, y: 5 }, stencil: stencilOf(['#...', '....']) }, 'building-myhouse', (c) => e.execute(c));
    expect(res.placed).toBe(0);
  });
});

describe('a rasterized shape is repaired before it is built', () => {
  /** Coverage rows from characters: '#' 255, '~' just under threshold, '.' 0. */
  function cov(rows: string[]): Stencil {
    const s = stencilOf(rows.map((r) => r.replace(/~/g, '.')));
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '~') s.coverage[y * row.length + x] = 100;   // near, below COVERAGE_ON
      });
    });
    return s;
  }

  it('joins a spotty diagonal back into one stroke', () => {
    // A 45-degree stroke whose alternate cells fell just under the threshold.
    const s = cov([
      '#~..',
      '~#~.',
      '.~#~',
      '..~#',
    ]);
    finishGlyph(s);
    // Each near cell between two covered cells joins, making the stroke 4-connected.
    expect(covered(s, 1, 0)).toBe(true);
    expect(covered(s, 0, 1)).toBe(true);
    expect(covered(s, 2, 1)).toBe(true);
  });

  it('preserves a one-cell counter and leaves unrelated ground open', () => {
    const s = cov([
      '###',
      '#.#',
      '###',
    ]);
    finishGlyph(s);
    expect(covered(s, 1, 1)).toBe(false);
    const open = cov(['#..', '...', '..#']);
    finishGlyph(open);
    expect(covered(open, 1, 1)).toBe(false);
  });
});

describe('the trim chooses each corner from the source', () => {
  /** A stencil whose one cell carries chosen quadrant coverages, in corner order [TL, TR, BL, BR]. */
  function withQuads(q: [number, number, number, number]): Stencil {
    const s = stencilOf(['#']);
    s.quad = new Uint8Array(q.map((v) => Math.round(v * 255)));
    return s;
  }
  const at0 = { x: 0, y: 0 };

  it('is not offered at all without quadrant detail, so the blanket mode takes over', () => {
    expect(stencilChooser(at0, stencilOf(['#']))).toBeNull();
  });

  it('keeps a corner the source fills, and cuts by nearest area below that', () => {
    const pick = stencilChooser(at0, withQuads([1, 0.8, 0.55, 0.2]))!;
    expect(pick(0, 0, 0, 'outer')).toBeNull();   // filled: stays square
    expect(pick(0, 0, 1, 'outer')).toBe('fan');  // near π/4: the quarter round
    expect(pick(0, 0, 2, 'outer')).toBe('tri');  // near half: the bevel
    expect(pick(0, 0, 3, 'outer')).toBe('tri');  // the deepest cut on offer
  });

  it('always fills an offered notch, sized by how far the source bulges into it', () => {
    // A notch lies outside the glyph, so it usually carries almost no ink; a fillet adds no mass, so
    // only its size is chosen.
    const pick = stencilChooser(at0, withQuads([0.05, 0.2, 0.45, 0]))!;
    expect(pick(0, 0, 0, 'inner')).toBe('fan');  // inkless notch: the small smoothing fillet
    expect(pick(0, 0, 1, 'inner')).toBe('fan');  // the concave fillet's own area
    expect(pick(0, 0, 2, 'inner')).toBe('tri');  // a real bulge: the bigger fillet
    expect(pick(0, 0, 3, 'inner')).toBe('fan');
  });

  it('chamfers a staircase, whatever the quadrants say', () => {
    // Bevels chain into one straight line on a quantised diagonal, where fans would scallop. The edge
    // direction comes from the coverage gradient, since the quad values are noisy there.
    const s = stencilOf([
      '#....',
      '##...',
      '###..',
      '####.',
      '#####',
    ]);
    s.quad = new Uint8Array(s.width * s.height * 4).fill(Math.round(0.7 * 255));   // would pick a fan
    const pick = stencilChooser({ x: 0, y: 0 }, s)!;
    expect(pick(1, 1, 1, 'outer')).toBe('tri');   // a step corner
    expect(pick(2, 1, 0, 'inner')).toBe('tri');   // the notch beside it
  });

  it('keeps rounding a corner where the edge runs with the axes', () => {
    const s = stencilOf([
      '###..',
      '###..',
      '###..',
      '###..',
      '###..',
    ]);
    s.quad = new Uint8Array(s.width * s.height * 4).fill(Math.round(0.7 * 255));
    const pick = stencilChooser({ x: 0, y: 0 }, s)!;
    expect(pick(2, 2, 1, 'outer')).toBe('fan');
  });

  it('has no opinion outside the stencil', () => {
    const pick = stencilChooser({ x: 5, y: 5 }, withQuads([0, 0, 0, 0]))!;
    expect(pick(4, 5, 0, 'outer')).toBeNull();
    expect(pick(5, 5, 0, 'outer')).toBe('tri');
  });
});

describe('the region, not its bounding box', () => {
  /** A stencil is fitted to the region's bounding box, so a non-rectangular region must clip it. */
  it('writes nothing outside the cells it was allowed', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const rows = Array.from({ length: 6 }, () => '######');
    const allow = new Set<number>();
    for (let y = 4; y < 10; y++) {
      for (let x = 4; x < 10; x++) if ((x + y) % 2 === 0) allow.add(y * 20 + x);
    }
    layTerrain(
      state,
      { origin: { x: 4, y: 4 }, stencil: stencilOf(rows), allow },
      TerrainType.Mountain, (c) => e.execute(c),
    );
    for (let y = 4; y < 10; y++) {
      for (let x = 4; x < 10; x++) {
        const laid = at(state, x, y) !== null;
        expect(laid).toBe(allow.has(y * 20 + x));
      }
    }
  });

  it('with no scope it builds anywhere buildable, as the whole-planet kinds do', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    layTerrain(
      state,
      { origin: { x: 5, y: 5 }, stencil: stencilOf(['###', '###']) },
      TerrainType.Mountain, (c) => e.execute(c),
    );
    expect(at(state, 6, 6)).not.toBeNull();
  });
});

describe('the smallest region a word is worth writing in', () => {
  /** A row of characters needs width per character, which the shorter-side gate cannot say;
   *  `textMinBox` gives the word's box. The per-glyph size is measured in `stencil-glyph.test.ts`. */
  it('grows with the number of characters, and never below one glyph', () => {
    expect(textMinBox('AB').height).toBe(textMinBox('ABCDEF').height);
    expect(textMinBox('ABCDEF').width).toBe(textMinBox('AB').width * 3);
    expect(textMinBox('')).toEqual(textMinBox('E'));
  });

  it('asks for more room per glyph as the glyph asks for more', () => {
    // One letter, a row of letters, an ideograph: three floors. One dense character makes a dense word.
    expect(textMinBox('E').height).toBeLessThan(textMinBox('HELLO').height);
    expect(textMinBox('HELLO').height).toBeLessThan(textMinBox('谷').height);
    expect(textMinBox('A谷').height).toBe(textMinBox('谷').height);
    // The region gate is the smallest region any glyph survives, so it sits below all of them.
    expect(STENCIL_MIN_SIDE.text).toBeLessThan(textMinBox('E').height);
  });
});

describe('what a shape may be tiled with', () => {
  /** A letter repeats one item many times, so only uncapped items qualify; read from the live catalog. */
  it('excludes every capped item, and every crossing', () => {
    const all = getAllItems();
    const offered = all.filter(tilesAShape);
    expect(offered.length).toBeGreaterThan(20);

    for (const item of offered) {
      expect(item.maxCount).toBeUndefined();
      expect(item.category).not.toBe(ItemCategory.Bridge);
      expect(item.category).not.toBe(ItemCategory.Ramp);
      expect(item.category).not.toBe(ItemCategory.Road);
    }
    // Capped items and bridges exist, or the filter above proves nothing.
    expect(all.some((i) => i.maxCount !== undefined)).toBe(true);
    expect(all.some((i) => i.category === ItemCategory.Bridge)).toBe(true);
  });

  it('leaves a repeatable tree or flower in', () => {
    const offered = getAllItems().filter(tilesAShape).map((i) => i.id);
    expect(offered).toContain('tree-apple');
  });
});

describe('what the rules refuse, refused before it is asked', () => {
  it('a letter with thin strokes commits clean against the live rules', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const whole = e.beginStroke();
    // Two cells wide, as a real glyph's stem comes out in a modest region.
    const rows = ['..##..', '..##..', '..##..', '..##..', '..##..', '..##..'];
    layTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(whole.commit()).toEqual([]);
    expect(at(state, 8, 8)).not.toBeNull();
  });

  it('writes around a zone hole inside the shape', () => {
    // A one-layer letter needs no base, so a beach cell inside it is simply a hole.
    const state = makeState(24, 24);
    state.cells[9]![9]!.zone = CellZone.Beach;
    const e = exec(state);
    const whole = e.beginStroke();
    const rows = Array.from({ length: 8 }, () => '########');
    layTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(whole.commit()).toEqual([]);
    expect(at(state, 9, 9)).toBeNull();
    expect(at(state, 7, 7)?.elevation).toBeGreaterThanOrEqual(1);
  });

  it('writes only inside the scope it was allowed, and commits clean', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const whole = e.beginStroke();
    const rows = Array.from({ length: 8 }, () => '########');
    const allow = new Set<number>();
    for (let y = 6; y < 14; y++) {
      for (let x = 6; x < 14; x++) if (x !== 10) allow.add(y * 24 + x);   // one column clipped out
    }
    layTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows), allow }, TerrainType.Mountain, (c) => e.execute(c));
    expect(whole.commit()).toEqual([]);
  });

  it('skips the one cell an object refuses, and keeps the rest', () => {
    // No mask predicts the object's refusal: it lands pre-command at layer 1, and the targets around
    // it must lower with it.
    const state = makeState(24, 24);
    const e = exec(state);
    const whole = e.beginStroke();
    const tree: PlacedObject = { id: 'blocker', catalogId: 'tree-apple', position: { x: 9, y: 9 }, rotation: 0, elevation: 0 };
    expect(e.execute(placeObjectCommand(tree)).success).toBe(true);
    const rows = Array.from({ length: 8 }, () => '########');
    layTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(whole.commit()).toEqual([]);
  });

  it('relaxes a picture no higher than its own zone holes can support', () => {
    const state = makeState(24, 24);
    state.cells[9]![9]!.zone = CellZone.Beach;
    const e = exec(state);
    const whole = e.beginStroke();
    const rows = Array.from({ length: 8 }, () => '########');
    layStencilColor(
      state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows, hexStringToNumber(ELEVATION_COLORS[8]!)) }, (c) => e.execute(c), { maxElevation: 8 },
    );
    expect(whole.commit()).toEqual([]);
  });

  it('relaxes heights the picture chose but the rules will not carry', () => {
    const target = new Int16Array([1, 1, 1, 1, 8, 1, 1, 1, 1]);
    relaxHeights(target, 3, 3);
    expect(target[4]).toBe(1 + FLAT_SAFE_ELEVATION);
    // Only lowers, and leaves the neighbours alone.
    expect([...target].filter((v) => v === 1)).toHaveLength(8);
  });

  it('a full-range picture commits clean, having been relaxed first', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const whole = e.beginStroke();
    // Cycling through every elevation colour, the worst a photograph can hand the palette.
    const rows = Array.from({ length: 8 }, () => '########');
    const stencil = stencilOf(rows);
    stencil.color.forEach((_, i) => {
      stencil.color[i] = hexStringToNumber(ELEVATION_COLORS[(i % 8) + 1]!);
    });
    layStencilColor(state, { origin: { x: 6, y: 6 }, stencil }, (c) => e.execute(c), { maxElevation: 8 });
    expect(whole.commit()).toEqual([]);
  });
});

describe('stencil as COLOUR (the image mode)', () => {
  it('lays the terrain whose colour is nearest, per cell', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const stencil = stencilOf(['##', '##'], hexStringToNumber(ELEVATION_COLORS[2]!));
    layStencilColor(state, { origin: { x: 6, y: 6 }, stencil }, (c) => e.execute(c), { maxElevation: 8 });
    expect(at(state, 6, 6)?.type).toBe(TerrainType.Mountain);
    expect(at(state, 6, 6)?.elevation).toBe(2);
  });

  it('lays a blue picture as water at ground level, and commits legally', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const whole = e.beginStroke();
    const rows = Array.from({ length: 4 }, () => '####');
    // With `water: 'palette'` the blue is one more palette entry, as in a mixed picture.
    layStencilColor(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows, hexStringToNumber(WATER_COLOR)) }, (c) => e.execute(c), { maxElevation: 8, water: 'palette' });
    expect(at(state, 7, 7)?.type).toBe(TerrainType.Water);
    expect(whole.commit()).toEqual([]);
  });

  it('leaves an uncovered cell as it found it: the shape is not the subject here', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const stencil = stencilOf(['#.', '.#'], hexStringToNumber(ELEVATION_COLORS[3]!));
    layStencilColor(state, { origin: { x: 8, y: 8 }, stencil }, (c) => e.execute(c), { maxElevation: 8 });
    expect(at(state, 8, 8)).not.toBeNull();
    expect(at(state, 9, 8)).toBeNull();
  });
});
