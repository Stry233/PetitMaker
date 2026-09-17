// gen-eval's scorers, pinned on synthetic states with known properties: a hand-built mirrored
// region must read symmetric, a 1-wide road must fail the ledger and a 3-wide one pass it, a
// terraced slope must score monotone, and a missing facility must be named.
import { describe, it, expect } from 'vitest';
import { makeState } from '../../../../rules/_helpers';
import { PLAZA_ID } from '../../../../../core/model/constants';
import { TerrainType, type GridState, type PlacedObject } from '../../../../../core/model/types';
import {
  anchorCatalogIds, climbReading, compositionVariety, districtLegibility, evaluateMap,
  openingWidths, rampDiscipline, readGrid, runWidths, sampleComposition, segmentRegions,
  streetStraightness, ABOVE_MID_LEVEL, FORM_MASS_LEVEL, FORM_SIGHT_REACH, TURN_SHARE_REFERENCE,
  type CompositionSample,
} from '../../../../../tools/generation/designer/eval';
import { colorFamily, hueFamily } from '../../../../../tools/generation/designer/dressing/color-family';

let nextId = 0;

function place(state: GridState, catalogId: string, x: number, y: number, extra: Partial<PlacedObject> = {}): void {
  const id = `o${nextId++}`;
  state.objects.set(id, { id, catalogId, position: { x, y }, rotation: 0, elevation: 0, ...extra });
}

/** A locked plaza-like object: what the road ledger measures reachability from. */
function plaza(state: GridState, x: number, y: number, w: number, h: number): void {
  state.objects.set(PLAZA_ID, {
    id: PLAZA_ID, catalogId: PLAZA_ID, position: { x, y }, width: w, height: h,
    rotation: 0, elevation: 0, locked: true,
  });
}

function paintRow(state: GridState, y: number, elevation: number): void {
  for (const cell of state.cells[y] ?? []) cell.terrain = elevation > 0 ? { type: TerrainType.Mountain, elevation } : null;
}

describe('colour family', () => {
  it('names hues and reads a plant off its model', () => {
    expect(hueFamily('#ff0000')).toBe('red');
    expect(hueFamily('#2255dd')).toBe('blue');
    expect(hueFamily('#f8f8f8')).toBe('white');
    expect(colorFamily('flower-agapanthus-blue')).toBe('blue');
    expect(colorFamily('flower-sunflower')).toBe('yellow');
    expect(colorFamily('nonexistent-item')).toBe('unknown');
  });
});

describe('road width measures', () => {
  it('reads a 1-wide line as 1 and a 3-wide band as 3 by both measures', () => {
    const W = 20, H = 20;
    const line = new Uint8Array(W * H);
    for (let x = 2; x < 18; x++) line[5 * W + x] = 1;
    expect(Math.max(...runWidths(line, W, H))).toBe(1);
    expect(Math.max(...openingWidths(line, W, H))).toBe(1);
    const band = new Uint8Array(W * H);
    for (let y = 4; y <= 6; y++) for (let x = 2; x < 18; x++) band[y * W + x] = 1;
    const open = openingWidths(band, W, H);
    for (let y = 4; y <= 6; y++) for (let x = 2; x < 18; x++) expect(open[y * W + x]).toBe(3);
  });

  it('reads a paved square at its extent and a diagonal staircase as 1-wide', () => {
    const W = 20, H = 20;
    const square = new Uint8Array(W * H);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) square[y * W + x] = 1;
    expect(openingWidths(square, W, H)[7 * W + 7]).toBe(8);
    expect(runWidths(square, W, H)[7 * W + 7]).toBe(8);
    const stair = new Uint8Array(W * H);
    for (let k = 0; k < 8; k++) { stair[(2 + k) * W + (2 + k)] = 1; stair[(2 + k) * W + (3 + k)] = 1; }
    expect(runWidths(stair, W, H)[3 * W + 3]).toBe(2);   // two cells across in each axis
    expect(openingWidths(stair, W, H)[3 * W + 3]).toBe(1); // but it draws as a 1-wide path
  });
});

describe('hard ledger: anchors', () => {
  it('passes with every anchor placed once', () => {
    const state = makeState(60, 60);
    anchorCatalogIds().forEach((id, i) => place(state, id, (i % 5) * 10, Math.floor(i / 5) * 10));
    const { hard } = evaluateMap(state);
    expect(hard.allAnchorsPlaced.pass).toBe(true);
    expect(hard.allAnchorsPlaced.expected).toBeGreaterThanOrEqual(12);
  });

  it('names a missing facility and a repeated building', () => {
    const state = makeState(60, 60);
    const ids = anchorCatalogIds();
    expect(ids).toContain('facility-shop');
    ids.filter((id) => id !== 'facility-shop')
      .forEach((id, i) => place(state, id, (i % 5) * 10, Math.floor(i / 5) * 10));
    place(state, 'building-stall', 55, 55);
    const { hard } = evaluateMap(state);
    expect(hard.allAnchorsPlaced.pass).toBe(false);
    expect(hard.allAnchorsPlaced.missing).toEqual(['facility-shop']);
    expect(hard.allAnchorsPlaced.repeated).toEqual([{ id: 'building-stall', count: 2 }]);
  });
});

describe('hard ledger: roads', () => {
  function roadMap(rows: number[]): GridState {
    const state = makeState(30, 30);
    plaza(state, 0, 3, 2, 5);
    for (const y of rows) for (let x = 2; x < 20; x++) place(state, 'path-overgrown-dirt', x, y);
    return state;
  }

  it('fails a 1-wide road', () => {
    const { hard } = evaluateMap(roadMap([5]));
    expect(hard.noOneWideRoads.pass).toBe(false);
    expect(hard.noOneWideRoads.oneWideShare).toBe(1);
  });

  it('passes a 3-wide road that reaches the plaza with no dead end', () => {
    const { hard } = evaluateMap(roadMap([4, 5, 6]));
    expect(hard.noOneWideRoads.pass).toBe(true);
    expect(hard.roadsConnected.pass).toBe(true);
    expect(hard.roadsConnected.reachableShare).toBe(1);
    expect(hard.roadsConnected.deadEnds).toBe(0);
  });

  it('fails pavement the plaza cannot reach', () => {
    const state = makeState(30, 30);
    plaza(state, 0, 3, 2, 5);
    for (let y = 4; y <= 6; y++) for (let x = 20; x < 28; x++) place(state, 'path-overgrown-dirt', x, y);
    const { hard } = evaluateMap(state);
    expect(hard.roadsConnected.pass).toBe(false);
    expect(hard.roadsConnected.reachableShare).toBe(0);
  });
});

describe('methodology scores', () => {
  // NEAR-LOW-FAR-HIGH IS READ FROM THE PLAZA, so the same terrain scores differently depending on
  // where the map is stood in. These three states hold one slope and move only the plaza.
  it('scores a slope rising away from the plaza monotone, and a flat map not', () => {
    const slope = makeState(40, 40);
    for (let y = 0; y < 40; y++) paintRow(slope, y, [8, 5, 2, 0][Math.floor(y / 10)]!);
    plaza(slope, 18, 36, 4, 3);
    const scored = evaluateMap(slope);
    expect(scored.scores.heightMonotonicity).toBeGreaterThan(0.9);
    expect(scored.metrics.elevation.profileAxis).toBe('north-south');

    const flat = makeState(40, 40);
    plaza(flat, 18, 36, 4, 3);
    expect(evaluateMap(flat).scores.heightMonotonicity).toBe(0);
  });

  it('scores a wall on the wrong side of the plaza at nothing', () => {
    // The same slope, read from its high end: the ground now FALLS away from the plaza, which is the
    // opposite of what the methodology asks for and must not score like the map above.
    const backwards = makeState(40, 40);
    for (let y = 0; y < 40; y++) paintRow(backwards, y, [8, 5, 2, 0][Math.floor(y / 10)]!);
    plaza(backwards, 18, 1, 4, 3);
    expect(evaluateMap(backwards).scores.heightMonotonicity).toBe(0);
  });

  it('scores a mirrored single-species region symmetric and unified', () => {
    const state = makeState(24, 24);
    for (let k = 0; k < 6; k++) {
      place(state, 'flower-sunflower', 8 - k, 4 + k);
      place(state, 'flower-sunflower', 14 + k, 4 + k);
    }
    const { scores, metrics } = evaluateMap(state);
    expect(metrics.regions.tested).toBe(1);
    expect(scores.symmetryShare).toBe(1);
    expect(scores.unityShare).toBe(1);
  });

  it('scores a scattered multi-family region neither symmetric nor unified', () => {
    const state = makeState(24, 24);
    const spots: [string, number, number][] = [
      ['flower-sunflower', 1, 1], ['flower-sunflower', 4, 2],
      ['flower-agapanthus-blue', 9, 3], ['flower-agapanthus-blue', 2, 7],
      ['flower-dahlia-cyan', 13, 5], ['flower-dahlia-cyan', 6, 12],
      ['flower-portulaca-white', 17, 9], ['flower-portulaca-white', 11, 15],
      ['tree-peach', 20, 3], ['tree-peach', 15, 20],
    ];
    for (const [id, x, y] of spots) place(state, id, x, y);
    const { scores } = evaluateMap(state);
    expect(scores.symmetryShare).toBe(0);
    expect(scores.unityShare).toBe(0);
  });

  it('cuts regions at a terrace step, not just at pavement', () => {
    const state = makeState(24, 24);
    for (let y = 12; y < 24; y++) paintRow(state, y, 2);
    const regions = segmentRegions(readGrid(state));
    expect(regions.length).toBe(2);
    expect(regions.every((r) => r.cells.length === 12 * 24)).toBe(true);
  });

  it('scores decoration density against the calibration band', () => {
    const state = makeState(40, 40);
    for (let k = 0; k < 128; k++) place(state, 'flower-sunflower', k % 40, Math.floor(k / 40) * 3);
    const { scores, metrics } = evaluateMap(state);
    expect(metrics.objects.decorDensity).toBeCloseTo(128 / 1600, 4);
    expect(scores.decorDensity).toBe(1);
  });
});

describe('ramp discipline', () => {
  // A 2x4 ramp. Its footprint is read by cell centres, so a whole-grid ramp covers exactly its own
  // width and height in cells.
  const RAMP = 'ramp-green-steps';

  it('fails a ramp standing on the pavement', () => {
    const state = makeState(30, 30);
    for (let y = 4; y <= 6; y++) for (let x = 2; x < 20; x++) place(state, 'path-overgrown-dirt', x, y);
    place(state, RAMP, 8, 4);
    // One ramp, and it is the one on the street: the share is 1, well over the reference's margin.
    const read = rampDiscipline(state);
    expect(read.ramps).toBe(1);
    expect(read.onPavement).toBe(1);
    expect(read.overlapCells).toBeGreaterThan(0);
    expect(read.placementPass).toBe(false);
    expect(read.pass).toBe(false);
  });

  it('passes a ramp that meets the street at its end', () => {
    const state = makeState(30, 30);
    for (let y = 4; y <= 6; y++) for (let x = 2; x < 20; x++) place(state, 'path-overgrown-dirt', x, y);
    place(state, RAMP, 8, 7);
    const read = rampDiscipline(state);
    expect(read.onPavement).toBe(0);
    expect(read.overlapCells).toBe(0);
    expect(read.pass).toBe(true);
  });

  it('keeps passing where a single ramp of many clips the pavement, as the reference does', () => {
    const state = makeState(60, 60);
    for (let y = 4; y <= 6; y++) for (let x = 2; x < 40; x++) place(state, 'path-overgrown-dirt', x, y);
    for (let k = 0; k < 24; k++) place(state, RAMP, 2 + k * 2, 20);
    place(state, RAMP, 8, 4);
    const read = rampDiscipline(state);
    expect(read.ramps).toBe(25);
    expect(read.onPavement).toBe(1);
    expect(read.pass).toBe(true);
  });

  it('fails a map that uses more ramps than the reference does', () => {
    const state = makeState(120, 120);
    for (let k = 0; k < 60; k++) place(state, RAMP, (k % 12) * 4, Math.floor(k / 12) * 6);
    const read = rampDiscipline(state);
    expect(read.ramps).toBe(60);
    expect(read.placementPass).toBe(true);
    expect(read.countPass).toBe(false);
    expect(read.pass).toBe(false);
  });
});

describe('street straightness', () => {
  /** One 3-wide street per span, laid along the row or column it names. */
  function pave(state: GridState, spans: readonly [number, number, number, 'h' | 'v'][]): void {
    for (const [at, from, to, dir] of spans) {
      for (let t = from; t <= to; t++) {
        for (let w = 0; w < 3; w++) {
          if (dir === 'h') place(state, 'path-overgrown-dirt', t, at + w);
          else place(state, 'path-overgrown-dirt', at + w, t);
        }
      }
    }
  }

  it('reads an L as straighter than a zigzag of the same length', () => {
    const bend = makeState(60, 60);
    pave(bend, [[10, 5, 50, 'h'], [10, 13, 50, 'v']]);
    const zig = makeState(60, 60);
    const spans: [number, number, number, 'h' | 'v'][] = [];
    for (let k = 0; k < 8; k++) {
      spans.push([10 + k * 5, 5 + k * 5, 12 + k * 5, 'h']);
      spans.push([10 + k * 5, 10 + k * 5, 17 + k * 5, 'v']);
    }
    pave(zig, spans);
    const straight = streetStraightness(bend), wandering = streetStraightness(zig);
    expect(straight.turnShare).toBeLessThan(wandering.turnShare);
    expect(straight.meanRunLength).toBeGreaterThan(wandering.meanRunLength);
  });

  it('scores a grid of long streets inside the references\' own band', () => {
    const grid = makeState(80, 80);
    const spans: [number, number, number, 'h' | 'v'][] = [];
    for (const at of [10, 30, 50]) {
      spans.push([at, 5, 70, 'h']);
      spans.push([at, 5, 70, 'v']);
    }
    pave(grid, spans);
    const read = streetStraightness(grid);
    expect(read.turnShare).toBeGreaterThan(0);
    expect(read.turnShare).toBeLessThan(TURN_SHARE_REFERENCE[1] + 0.1);
  });

  it('reads nothing off a map with no pavement', () => {
    const read = streetStraightness(makeState(20, 20));
    expect(read.paved).toBe(0);
    expect(read.turnShare).toBe(0);
    expect(read.score).toBe(0);
  });
});

describe('district legibility', () => {
  it('reads the pieces a street grid cuts a map into', () => {
    const state = makeState(60, 60);
    for (const at of [20, 40]) {
      for (let t = 0; t < 60; t++) for (let w = 0; w < 3; w++) {
        place(state, 'path-overgrown-dirt', t, at + w);
        place(state, 'path-overgrown-dirt', at + w, t);
      }
    }
    const read = districtLegibility(state);
    expect(read.count).toBe(9);
    // Rectangular blocks fill their own bounding boxes.
    expect(read.rectangularity).toBeGreaterThan(0.95);
  });
});

describe('the climb and the form a walker sees', () => {
  /** A paved row at `y`, on ground at `elevation`, from x=2 inward. */
  function pavedRow(state: GridState, y: number, elevation: number, from = 2, to = 30): void {
    for (let x = from; x <= to; x++) {
      const cell = state.cells[y]?.[x];
      if (cell) cell.terrain = elevation > 0 ? { type: TerrainType.Mountain, elevation } : null;
      place(state, 'path-overgrown-dirt', x, y);
    }
  }

  it('reads a single-storey walk as one level and no entropy', () => {
    const state = makeState(40, 40);
    pavedRow(state, 5, 0);
    pavedRow(state, 6, 0);
    const climb = climbReading(state);
    expect(climb.levels).toBe(1);
    expect(climb.entropy).toBe(0);
    expect(climb.topLevelShare).toBe(1);
    expect(climb.aboveMid).toBe(0);
  });

  it('reads four equal storeys as two bits, and the share standing above mid-height', () => {
    const state = makeState(40, 40);
    // Four rows of equal length at four levels: entropy is log2(4) exactly, and half of the pavement
    // stands at level 4 or above.
    pavedRow(state, 5, 1);
    pavedRow(state, 9, 3);
    pavedRow(state, 13, ABOVE_MID_LEVEL);
    pavedRow(state, 17, ABOVE_MID_LEVEL + 2);
    const climb = climbReading(state);
    expect(climb.levels).toBe(4);
    expect(climb.entropy).toBeCloseTo(2, 5);
    expect(climb.topLevelShare).toBeCloseTo(0.25, 5);
    expect(climb.aboveMid).toBeCloseTo(0.5, 5);
  });

  it('counts a level change per ramp and per bridge, over a hundred pavement cells', () => {
    const state = makeState(60, 40);
    pavedRow(state, 5, 0, 2, 51);   // fifty cells
    place(state, 'ramp-park-steps', 6, 6);
    place(state, 'bridge-plank', 10, 6);
    const climb = climbReading(state);
    expect(climb.paved).toBe(50);
    expect(climb.eventsPer100).toBeCloseTo(4, 5);
  });

  it('sees the mass from a walk beside it, and not through a building or a taller ridge', () => {
    const mass = (state: GridState, x0: number, x1: number, y0: number, y1: number): void => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const cell = state.cells[y]?.[x];
          if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: FORM_MASS_LEVEL + 1 };
        }
      }
    };
    // The walk at ground level with the mass ten cells east of it: every cell of it sees the mass.
    const open = makeState(40, 40);
    pavedRow(open, 5, 0, 2, 8);
    mass(open, 18, 24, 2, 12);
    expect(climbReading(open).seesMass).toBe(1);

    // The same mass behind a RIDGE that stands above the walk and below the mass: the ridge closes
    // the view and is not itself the form the reading is looking for.
    const walled = makeState(40, 40);
    pavedRow(walled, 5, 0, 2, 8);
    mass(walled, 18, 24, 2, 12);
    for (let y = 0; y < 40; y++) {
      const cell = walled.cells[y]?.[12];
      if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: FORM_MASS_LEVEL - 2 };
    }
    expect(climbReading(walled).seesMass).toBe(0);

    // And out of reach: the same mass, cast further than a view is read.
    const far = makeState(40 + FORM_SIGHT_REACH, 40);
    pavedRow(far, 5, 0, 2, 8);
    mass(far, 8 + FORM_SIGHT_REACH + 2, 8 + FORM_SIGHT_REACH + 6, 2, 12);
    expect(climbReading(far).seesMass).toBe(0);
  });
});

describe('composition variety', () => {
  it('reads a wall on one side as that side, and a flat map as flat', () => {
    const walled = makeState(60, 60);
    for (let y = 0; y < 12; y++) paintRow(walled, y, 6);
    const read = sampleComposition(walled);
    expect(read.direction).toBe('north');
    expect(read.magnitude).toBeGreaterThan(10);
    expect(sampleComposition(makeState(60, 60)).direction).toBe('flat');
  });

  it('fails a batch that walls one side every time and passes a varied one', () => {
    const same: CompositionSample[] = Array.from({ length: 6 }, () => ({ direction: 'north' as const }));
    expect(compositionVariety(same).pass).toBe(false);
    const varied: CompositionSample[] = [
      { direction: 'north' }, { direction: 'east' }, { direction: 'west' },
      { direction: 'south' }, { direction: 'flat' }, { direction: 'east' },
    ];
    expect(compositionVariety(varied).pass).toBe(true);
  });

  it('holds its verdict until the batch is big enough to mean it', () => {
    const four: CompositionSample[] = Array.from({ length: 4 }, () => ({ direction: 'north' as const }));
    // Four sides drawn at random land on one 1.6% of the time at n=4, so a 4-batch is reported only.
    expect(compositionVariety(four).applicable).toBe(false);
    expect(compositionVariety(four).pass).toBe(true);
    const five: CompositionSample[] = Array.from({ length: 5 }, () => ({ direction: 'north' as const }));
    expect(compositionVariety(five).pass).toBe(false);
  });

  it('reads a four-of-five lean as chance and a thirteen-of-twenty lean as a favourite', () => {
    const others = ['east', 'west', 'south'] as const;
    const lean = (n: number, north: number): CompositionSample[] => [
      ...Array.from({ length: north }, () => ({ direction: 'north' as const })),
      ...Array.from({ length: n - north }, (_, k) => ({ direction: others[k % others.length]! })),
    ];
    expect(compositionVariety(lean(5, 4)).pass).toBe(true);
    expect(compositionVariety(lean(20, 12)).pass).toBe(true);
    expect(compositionVariety(lean(20, 13)).pass).toBe(false);
  });

  it('says nothing about a batch of flat maps', () => {
    const flat: CompositionSample[] = Array.from({ length: 6 }, () => ({ direction: 'flat' as const }));
    const read = compositionVariety(flat);
    expect(read.applicable).toBe(false);
    expect(read.pass).toBe(true);
  });

  it('fails a batch that plans one archetype however its mass lands', () => {
    const dirs = ['north', 'east', 'west', 'south', 'east', 'west'] as const;
    const batch: CompositionSample[] = dirs.map((direction) => ({ archetype: 'north-wall', direction }));
    const read = compositionVariety(batch);
    expect(read.directions).toBe(4);
    expect(read.archetypes).toBe(1);
    expect(read.pass).toBe(false);
  });
});

describe('composition axis', () => {
  it('scores the planned axis, not the best one the map offers', () => {
    // Ground rising to the WEST of a plaza standing at the map's east edge.
    const state = makeState(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const e = [8, 5, 2, 0][Math.floor(x / 10)]!;
        state.cells[y]![x]!.terrain = e > 0 ? { type: TerrainType.Mountain, elevation: e } : null;
      }
    }
    plaza(state, 36, 18, 3, 4);
    expect(evaluateMap(state, { compositionAxis: 'west' }).scores.heightMonotonicity).toBeGreaterThan(0.9);
    expect(evaluateMap(state, { compositionAxis: 'east' }).scores.heightMonotonicity).toBe(0);
    expect(evaluateMap(state, { compositionAxis: 'north' }).scores.heightMonotonicity).toBe(0);
    // Unnamed, the score takes the best reading it can find over the four axes.
    expect(evaluateMap(state).scores.heightMonotonicity).toBeGreaterThan(0.9);
  });
});

describe('determinism', () => {
  it('reads the same state to the same numbers', () => {
    const state = makeState(40, 40);
    plaza(state, 0, 3, 2, 5);
    anchorCatalogIds().forEach((id, i) => place(state, id, (i % 4) * 9, 20 + Math.floor(i / 4) * 6));
    for (let y = 4; y <= 6; y++) for (let x = 2; x < 20; x++) place(state, 'path-overgrown-dirt', x, y);
    for (let y = 0; y < 40; y++) paintRow(state, y, [8, 5, 2, 0][Math.floor(y / 10)]!);
    expect(JSON.stringify(evaluateMap(state))).toBe(JSON.stringify(evaluateMap(state)));
  });
});
