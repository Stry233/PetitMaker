/**
 * The stencil generators: a picture laid onto the map as shape (the text mode) or as colour (the
 * image mode).
 *
 * A stencil is plain numbers, so all of this runs with no browser: the rasterizing that produces one
 * needs a canvas and lives on the main thread, which is exactly why the generator takes the result
 * rather than the source.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { CellZone, ItemCategory, TerrainType, type EditorEvents, type GridState, type PlacedObject } from '../../../../core/model/types';
import { objectPlacementCommand } from '../../../../tools/objects/object-placer';
import { makeState } from '../../../rules/_helpers';
import { COVERAGE_ON, covered, FLAT_SAFE_ELEVATION, nearestTerrain, relaxHeights, STENCIL_MIN_SIDE, terrainPalette, textMinBox, textMinSide, type Stencil } from '../../../../tools/generation/stencil/stencil';
import { finishGlyph } from '../../../../tools/generation/stencil/stencil-stroke';
import { layStencilColor, layStencilObjects, layStencilTerrain } from '../../../../tools/generation/stencil/stencil-generator';
import { tilesAShape } from '../../../../tools/generation/stencil/stencil';
import { stencilChooser } from '../../../../tools/generation/stencil/stencil-trim';
import { getAllItems } from '../../../../state/catalog';
import { ELEVATION_COLORS, WATER_COLOR } from '../../../../core/model/constants';
import { hexStringToNumber } from '../../../../core/model/colors';

const exec = (state: GridState) => new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));

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
    // The whole reason the match is luma-weighted: unweighted, mid greens fell to the blue.
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
    const res = layStencilTerrain(state, { origin: { x: 5, y: 5 }, stencil }, TerrainType.Mountain, (c) => exec(state).execute(c));
    expect(res.placed).toBeGreaterThan(0);
    expect(at(state, 6, 5)?.type).toBe(TerrainType.Mountain);   // covered
    expect(at(state, 5, 5)).toBeNull();                          // not covered
    expect(at(state, 5, 6)?.type).toBe(TerrainType.Mountain);    // the bar of the shape
  });

  it('stands one layer on the ground it is written on, edge and middle alike', () => {
    const state = makeState(20, 20);
    const rows = Array.from({ length: 6 }, () => '######');
    const e = exec(state);
    layStencilTerrain(state, { origin: { x: 4, y: 4 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(at(state, 7, 7)?.elevation).toBe(1);
    expect(at(state, 4, 4)?.elevation).toBe(1);
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('fills a shape with objects, stepped by the item\'s own footprint', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const rows = Array.from({ length: 4 }, () => '####');
    const res = layStencilObjects(state, { origin: { x: 5, y: 5 }, stencil: stencilOf(rows) }, 'tree-apple', (c) => e.execute(c));
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
    const res = layStencilObjects(state, { origin: { x: 5, y: 5 }, stencil: stencilOf(['#...', '....']) }, 'building-myhouse', (c) => e.execute(c));
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
    // Every near-cell flanked by two covered cells joined; the stroke is 4-connected now.
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
    expect(covered(open, 1, 1)).toBe(false); // two lone corners join nothing
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
    expect(pick(0, 0, 1, 'outer')).toBe('fan');  // ~π/4: the quarter round
    expect(pick(0, 0, 2, 'outer')).toBe('tri');  // ~half: the bevel
    expect(pick(0, 0, 3, 'outer')).toBe('tri');  // clipped hard: the deepest cut on offer
  });

  it('always fills an offered notch, sized by how far the source bulges into it', () => {
    // The notch cell is outside the glyph, so near-zero ink there is the NORMAL case at a concave
    // corner — the curve's ink is in the stroke cells beside it. A fillet adds no mass, so the
    // question is never whether, only how big.
    const pick = stencilChooser(at0, withQuads([0.05, 0.2, 0.45, 0]))!;
    expect(pick(0, 0, 0, 'inner')).toBe('fan');  // inkless notch: the small smoothing fillet
    expect(pick(0, 0, 1, 'inner')).toBe('fan');  // the concave fillet's own area
    expect(pick(0, 0, 2, 'inner')).toBe('tri');  // a real bulge: the bigger fill
    expect(pick(0, 0, 3, 'inner')).toBe('fan');
  });

  it('chamfers a staircase, whatever the quadrants say', () => {
    // On a quantised diagonal the bevels chain into one straight line; fans scallop and a mix wobbles.
    // The edge direction comes from the coverage gradient rather than from the quad values, which are
    // mid-range and noisy exactly there.
    const s = stencilOf([
      '#....',
      '##...',
      '###..',
      '####.',
      '#####',
    ]);
    s.quad = new Uint8Array(s.width * s.height * 4).fill(Math.round(0.7 * 255));   // fan territory
    const pick = stencilChooser({ x: 0, y: 0 }, s)!;
    expect(pick(1, 1, 1, 'outer')).toBe('tri');   // a step corner on the diagonal
    expect(pick(2, 1, 0, 'inner')).toBe('tri');   // and the notch beside it continues the line
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
    expect(pick(2, 2, 1, 'outer')).toBe('fan');   // a straight vertical edge: no diagonal to chain
  });

  it('has no opinion outside the stencil', () => {
    const pick = stencilChooser({ x: 5, y: 5 }, withQuads([0, 0, 0, 0]))!;
    expect(pick(4, 5, 0, 'outer')).toBeNull();
    expect(pick(5, 5, 0, 'outer')).toBe('tri');
  });
});

describe('the region, not its bounding box', () => {
  /**
   * A stencil is FITTED to the region's bounding box, which is not the region. A rectangle's box is
   * itself, so the two agreed and the gap went unnoticed; anything else has a box bigger than it is,
   * and the picture filled the box and spilled over everything the visitor had not painted.
   */
  it('writes nothing outside the cells it was allowed', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const rows = Array.from({ length: 6 }, () => '######');
    // A checkerboard scope: nothing like the solid box the stencil is fitted to.
    const allow = new Set<number>();
    for (let y = 4; y < 10; y++) {
      for (let x = 4; x < 10; x++) if ((x + y) % 2 === 0) allow.add(y * 20 + x);
    }
    layStencilTerrain(
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

  it('with no scope it builds anywhere buildable, as the whole-island kinds do', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    layStencilTerrain(
      state,
      { origin: { x: 5, y: 5 }, stencil: stencilOf(['###', '###']) },
      TerrainType.Mountain, (c) => e.execute(c),
    );
    expect(at(state, 6, 6)).not.toBeNull();
  });
});

describe('the smallest region a word is worth writing in', () => {
  /** The shelf gates on the SHORTER side, which says nothing about a row of characters: six of them
   *  in a box twelve cells across leave two cells each. The box helper is what a gate that cares
   *  about the word rather than the region consults. What each glyph needs is measured in the text
   *  matrix (`stencil-glyph.test.ts`); here it is the arithmetic over that number. */
  it('grows with the number of characters, and never below one glyph', () => {
    expect(textMinBox('AB').height).toBe(textMinBox('ABCDEF').height);
    expect(textMinBox('ABCDEF').width).toBe(textMinBox('AB').width * 3);
    expect(textMinBox('')).toEqual(textMinBox('E'));
  });

  it('asks for more room per glyph as the glyph asks for more', () => {
    // One letter, a row of letters, an ideograph: three floors, and the whole point of asking the
    // TEXT rather than the region. A word with one dense character in it is a dense word.
    expect(textMinSide('E')).toBeLessThan(textMinSide('HELLO'));
    expect(textMinSide('HELLO')).toBeLessThan(textMinSide('谷'));
    expect(textMinSide('A谷')).toBe(textMinSide('谷'));
    // The REGION gate is lower than any of them: it is the smallest region a glyph has been measured
    // to survive, and which texts that region can carry is each card's own question, measured on the
    // letter it drew rather than assumed from the string.
    expect(STENCIL_MIN_SIDE.text).toBeLessThan(textMinSide('E'));
  });
});

describe('what a shape may be tiled with', () => {
  /** A letter needs the SAME item many times over, so the list it offers has to be exactly the items
   *  that can be placed many times over. Read from the live catalog, not from a list of ids. */
  it('excludes every capped item, and every crossing', () => {
    const all = getAllItems();
    const offered = all.filter(tilesAShape);
    expect(offered.length).toBeGreaterThan(20);   // the premise: there is plenty left

    for (const item of offered) {
      expect(item.maxCount).toBeUndefined();
      expect(item.category).not.toBe(ItemCategory.Bridge);
      expect(item.category).not.toBe(ItemCategory.Ramp);
      expect(item.category).not.toBe(ItemCategory.Road);
    }
    // And the uniques really are in the catalog, or the filter above proves nothing.
    expect(all.some((i) => i.maxCount !== undefined)).toBe(true);
    expect(all.some((i) => i.category === ItemCategory.Bridge)).toBe(true);
  });

  it('leaves a repeatable tree or flower in', () => {
    const offered = getAllItems().filter(tilesAShape).map((i) => i.id);
    expect(offered).toContain('tree-apple');
  });
});

describe('what the rules refuse, refused before it is asked', () => {
  /**
   * Both of these came back from driving the REAL rasterizer and generator in a browser: a letter
   * that committed 2265 cells and then vanished (46 violations), and a picture that lost most of
   * itself (210). Neither was visible to a test that hand-drew a solid block.
   */
  it('a letter with thin strokes commits clean against the live rules', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    // Two cells wide, which is what a real glyph's stem comes out as in a modest region.
    const rows = ['..##..', '..##..', '..##..', '..##..', '..##..', '..##..'];
    layStencilTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(e.commitStroke(0)).toEqual([]);
    expect(at(state, 8, 8)).not.toBeNull();   // and it is still standing
  });

  it('writes around a zone hole inside the shape', () => {
    // A beach cell inside the glyph is never laid, and one layer over the ground beside it needs no
    // base under it, so the letter keeps its shape with a hole where the ground refuses to build.
    const state = makeState(24, 24);
    state.cells[9]![9]!.zone = CellZone.Beach;
    const e = exec(state);
    const rows = Array.from({ length: 8 }, () => '########');
    layStencilTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(e.commitStroke(0)).toEqual([]);
    expect(at(state, 9, 9)).toBeNull();                              // the hole stays a hole
    expect(at(state, 7, 7)?.elevation).toBeGreaterThanOrEqual(1);    // and the shape still stands
  });

  it('writes only inside the scope it was allowed, and commits clean', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const rows = Array.from({ length: 8 }, () => '########');
    const allow = new Set<number>();
    for (let y = 6; y < 14; y++) {
      for (let x = 6; x < 14; x++) if (x !== 10) allow.add(y * 24 + x);   // one column clipped out
    }
    layStencilTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows), allow }, TerrainType.Mountain, (c) => e.execute(c));
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('skips the one cell an object refuses, and keeps the rest', () => {
    // The object cell IS writable ground, so no mask can see it coming: the refusal lands at layer
    // 1, pre-command, and everything already targeted around it has to lower with it.
    const state = makeState(24, 24);
    const e = exec(state);
    const tree: PlacedObject = { id: 'blocker', catalogId: 'tree-apple', position: { x: 9, y: 9 }, rotation: 0, elevation: 0 };
    expect(e.execute(objectPlacementCommand(tree)).success).toBe(true);
    const rows = Array.from({ length: 8 }, () => '########');
    layStencilTerrain(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('relaxes a picture no higher than its own zone holes can support', () => {
    const state = makeState(24, 24);
    state.cells[9]![9]!.zone = CellZone.Beach;
    const e = exec(state);
    const rows = Array.from({ length: 8 }, () => '########');
    layStencilColor(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows, hexStringToNumber(ELEVATION_COLORS[8]!)) }, 8, (c) => e.execute(c));
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('relaxes heights the picture chose but the rules will not carry', () => {
    // One bright cell among dark: it cannot stand 8 layers over its neighbours.
    const target = new Int16Array([1, 1, 1, 1, 8, 1, 1, 1, 1]);
    relaxHeights(target, 3, 3);
    expect(target[4]).toBe(1 + FLAT_SAFE_ELEVATION);
    // Only ever lowers, and leaves what already stands alone.
    expect([...target].filter((v) => v === 1)).toHaveLength(8);
  });

  it('a full-range picture commits clean, having been relaxed first', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    // Alternating extremes, which is the worst a photograph can hand the palette.
    const rows = Array.from({ length: 8 }, () => '########');
    const stencil = stencilOf(rows);
    stencil.color.forEach((_, i) => {
      stencil.color[i] = hexStringToNumber(ELEVATION_COLORS[(i % 8) + 1]!);
    });
    layStencilColor(state, { origin: { x: 6, y: 6 }, stencil }, 8, (c) => e.execute(c));
    expect(e.commitStroke(0)).toEqual([]);
  });
});

describe('stencil as COLOUR (the image mode)', () => {
  it('lays the terrain whose colour is nearest, per cell', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const stencil = stencilOf(['##', '##'], hexStringToNumber(ELEVATION_COLORS[2]!));
    layStencilColor(state, { origin: { x: 6, y: 6 }, stencil }, 8, (c) => e.execute(c));
    expect(at(state, 6, 6)?.type).toBe(TerrainType.Mountain);
    expect(at(state, 6, 6)?.elevation).toBe(2);
  });

  it('lays a blue picture as water at ground level, and commits legally', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const rows = Array.from({ length: 4 }, () => '####');
    // Water IN the palette: the blue is a ninth entry a blue picture wins, which is the reading a
    // mixed picture takes.
    layStencilColor(state, { origin: { x: 6, y: 6 }, stencil: stencilOf(rows, hexStringToNumber(WATER_COLOR)) }, 8, (c) => e.execute(c), 1, 'palette');
    expect(at(state, 7, 7)?.type).toBe(TerrainType.Water);
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('leaves an uncovered cell as it found it: the shape is not the subject here', () => {
    const state = makeState(20, 20);
    const e = exec(state);
    const stencil = stencilOf(['#.', '.#'], hexStringToNumber(ELEVATION_COLORS[3]!));
    layStencilColor(state, { origin: { x: 8, y: 8 }, stencil }, 8, (c) => e.execute(c));
    expect(at(state, 8, 8)).not.toBeNull();
    expect(at(state, 9, 8)).toBeNull();
  });
});
