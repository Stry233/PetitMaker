/**
 * The nested-ring growth engine, pinned on live cells.
 *
 * The headline is a PROOF rather than a case: every disc from radius 4 to 8, both step widths and
 * every peak from 1 to 8 is built, painted straight into the cells and handed to the real rule
 * registry. Nothing peels, nothing retries, so a failure here is the shape being wrong and not a
 * repair pass being missing.
 *
 * Rings are painted in ascending tier order. They are cumulative, so the last ring that claims a
 * cell is the highest one, and the painted state is exactly what the caller would commit.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultTerrainCell } from '../../../core/model/grid-model';
import { TerrainType, type GridState, type MacroCoord } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import {
  FLAT_TOP, MIN_CORE, terraceRings, type TerraceRing,
} from '../../../tools/macros/terrace';
import { makeState } from '../../rules/_helpers';

/** Wide enough that a radius-8 disc keeps 3 cells of grass between itself and the grid edge: a
 *  mountain at the border has no 3x3 to stand on and would fail for the map's sake, not the shape's. */
const SIZE = 24;
const CENTRE: MacroCoord = { x: 12, y: 12 };

function disc(at: MacroCoord, radius: number, omit?: (c: MacroCoord) => boolean): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = at.y - radius; y <= at.y + radius; y++) {
    for (let x = at.x - radius; x <= at.x + radius; x++) {
      const dx = x - at.x, dy = y - at.y;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (omit?.({ x, y })) continue;
      cells.push({ x, y });
    }
  }
  return cells;
}

function paint(state: GridState, rings: readonly TerraceRing[]): void {
  for (const ring of rings) {
    for (const c of ring.cells) {
      state.cells[c.y]![c.x]!.terrain = createDefaultTerrainCell(TerrainType.Mountain, ring.tier);
    }
  }
}

function manhattan(a: MacroCoord, b: MacroCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

describe('terraceRings', () => {
  it('a raise is legal by construction', () => {
    const registry = createDefaultRegistry();
    for (let radius = 4; radius <= 8; radius++) {
      // 0 and 1 ride along BECAUSE they are clamped: they are the only cases where the sweep is
      // testing the floor rather than the ring math, and without them a floor lowered back to 1
      // leaves this proof green.
      for (const inset of [0, 1, 2, 4]) {
        for (let peak = 1; peak <= 8; peak++) {
          const state = makeState(SIZE, SIZE);
          const rings = terraceRings({ base: disc(CENTRE, radius), peak, inset, width: SIZE, height: SIZE });
          paint(state, rings);
          const errors = registry.validatePostStroke(state);
          expect(errors, `radius ${radius}, inset ${inset}, peak ${peak}: ${errors.map((e) => e.ruleId).join(',')}`)
            .toEqual([]);
        }
      }
    }
  });

  it('the flat top stops at three', () => {
    const base = disc(CENTRE, 6);
    const rings = terraceRings({ base, peak: 6, inset: 2, width: SIZE, height: SIZE });
    expect(rings.length).toBeGreaterThan(FLAT_TOP);
    for (let tier = 1; tier <= FLAT_TOP; tier++) {
      const ring = rings[tier - 1]!;
      expect(ring.tier).toBe(tier);
      expect(ring.cells).toEqual(base);
    }
    expect(rings[FLAT_TOP]!.cells.length).toBeLessThan(base.length);
    for (const ring of rings.slice(FLAT_TOP)) expect(ring.cells.length).toBeGreaterThanOrEqual(MIN_CORE);
  });

  it('a hole pushes the summit away', () => {
    const inset = 2;
    const hole: MacroCoord[] = [];
    for (let y = 8; y <= 10; y++) for (let x = 8; x <= 10; x++) hole.push({ x, y });
    const isHole = (c: MacroCoord) => hole.some((h) => h.x === c.x && h.y === c.y);
    const rings = terraceRings({ base: disc(CENTRE, 8, isHole), peak: 8, inset, width: SIZE, height: SIZE });
    expect(rings.length).toBeGreaterThan(FLAT_TOP);
    for (const c of rings[rings.length - 1]!.cells) {
      for (const h of hole) expect(manhattan(c, h)).toBeGreaterThanOrEqual(inset);
    }
    const state = makeState(SIZE, SIZE);
    paint(state, rings);
    expect(createDefaultRegistry().validatePostStroke(state)).toEqual([]);
  });

  it('the footprint is the ceiling', () => {
    // Radius 6, not 4: a radius-4 disc at this inset erodes away on its FIRST step above the flat
    // top, so it would stop at FLAT_TOP and prove nothing about where erosion runs out. This one
    // climbs a step, then runs out of core.
    const base = disc(CENTRE, 6);
    const first = terraceRings({ base, peak: 8, inset: 4, width: SIZE, height: SIZE });
    expect(first.length).toBeGreaterThan(FLAT_TOP);
    expect(first.length).toBeLessThan(8);
    const again = terraceRings({ base, peak: 8, inset: 4, width: SIZE, height: SIZE });
    expect(again.length).toBe(first.length);
  });

  it('wide steps top out lower than steep ones', () => {
    const base = disc(CENTRE, 8);
    const steep = terraceRings({ base, peak: 8, inset: 2, width: SIZE, height: SIZE });
    const wide = terraceRings({ base, peak: 8, inset: 4, width: SIZE, height: SIZE });
    expect(wide.length).toBeLessThan(steep.length);
  });

  it('one summit, not two', () => {
    // TWO EQUAL LOBES on a narrow bar. Equal, because with one lobe larger the small one erodes
    // away before the top tier is reached and the fixture passes with no component search at all.
    // At this size both lobes survive to the summit, so keeping every component would answer with
    // two of them.
    const base = [...disc({ x: 7, y: 12 }, 4), ...disc({ x: 16, y: 12 }, 4), { x: 11, y: 12 }, { x: 12, y: 12 }];
    const rings = terraceRings({ base, peak: 8, inset: 2, width: SIZE, height: SIZE });
    expect(rings.length).toBeGreaterThan(FLAT_TOP);
    const top = rings[rings.length - 1]!.cells;
    const seen = new Set(top.map((c) => c.y * SIZE + c.x));
    const queue = [top[0]!.y * SIZE + top[0]!.x];
    const reached = new Set(queue);
    while (queue.length) {
      const i = queue.pop()!;
      for (const d of [1, -1, SIZE, -SIZE]) {
        const n = i + d;
        if (seen.has(n) && !reached.has(n)) { reached.add(n); queue.push(n); }
      }
    }
    expect(reached.size).toBe(top.length);
  });

  it('an inset below two is an inset of two', () => {
    // 0 would stack a vertical wall; 1 encloses only the 4-neighbours, so a diagonal falls off the
    // un-eroded base at the first eroded tier and breaks V-MTN-03 (measured while this landed: 25
    // of 40 radius-by-peak discs, every failure at tier 4). Both clamp to the real floor.
    const base = disc(CENTRE, 8);
    const two = terraceRings({ base, peak: 8, inset: 2, width: SIZE, height: SIZE });
    for (const below of [0, 1]) {
      expect(terraceRings({ base, peak: 8, inset: below, width: SIZE, height: SIZE })).toEqual(two);
    }
  });

  it('the same footprint gives the same rings', () => {
    const base = disc(CENTRE, 7);
    const first = terraceRings({ base, peak: 8, inset: 2, width: SIZE, height: SIZE });
    for (let run = 0; run < 10; run++) {
      expect(terraceRings({ base, peak: 8, inset: 2, width: SIZE, height: SIZE })).toEqual(first);
    }
  });
});
