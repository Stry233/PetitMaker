import { describe, it, expect } from 'vitest';
import {
  CANONICAL_ROAD_STATES, canonicalToActual, classifyRoadKind, detectRoadConn,
} from '../../core/edge-cut/road-cut-states';
import { validateCut } from '../../core/edge-cut/cut-validator';
import { ObjectCategory, type Corners, type PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

describe('classifyRoadKind', () => {
  it('classifies fan-bearing states as round', () => {
    expect(classifyRoadKind(['square', 'square', 'square', 'fan'])).toBe('round');
    expect(classifyRoadKind(['square', 'fan', 'square', 'fan'])).toBe('round');
  });

  it('classifies triangle-bearing states as direct', () => {
    expect(classifyRoadKind(['tri-SE', 'tri-SE', 'square', 'square'])).toBe('direct');
    expect(classifyRoadKind(['square', 'square', 'tri-NE', 'tri-NE'])).toBe('direct');
  });

  it('classifies square/undefined as null', () => {
    expect(classifyRoadKind(['square', 'square', 'square', 'square'])).toBeNull();
    expect(classifyRoadKind(undefined)).toBeNull();
  });
});

describe('road cut legality — fan/triangle same-direction parity (validateCut)', () => {
  // drawRoadShape's canonical geometry pairs each fan with a same-direction triangle: state 1 (BR fan)
  // and state 4 (diagonal /) both keep the connected edge + the N lateral edge, cutting toward the far
  // bottom; state 2 (TR fan) and state 3 (diagonal \) both keep the connected edge + the S lateral edge,
  // cutting toward the far top. Every canonical state keeps its FULL connected edge (all five shapes in
  // drawRoadShape contain the whole u=0 edge), so wherever the fan of a pair validates, its triangle twin
  // must too — the user-visible bug was triangles being refused where the same-direction fan passed.
  const PAIRS: [number, number][] = [[1, 4], [2, 3]];
  const DIRS: Record<string, [number, number]> = { L: [-1, 0], R: [1, 0], T: [0, -1], B: [0, 1] };

  function addRoad(state: any, x: number, y: number, corners?: Corners): PlacedObject {
    const road: PlacedObject = {
      id: `r-${x}-${y}`, catalogId: 'road-dirt',
      position: { x, y }, rotation: 0, category: ObjectCategory.Facility, elevation: 0,
      ...(corners ? { corners } : {}),
    } as PlacedObject;
    state.objects.set(road.id, road);
    return road;
  }

  function legalStates(state: any, road: PlacedObject): number[] {
    const conn = detectRoadConn(state, road);
    const out: number[] = [];
    for (let s = 1; s < CANONICAL_ROAD_STATES.length; s++) {
      const actual = canonicalToActual([...CANONICAL_ROAD_STATES[s]!], conn);
      if (validateCut(state, road.position.x, road.position.y, 'road', actual)) out.push(s);
    }
    return out;
  }

  it('fan-legal implies same-direction-triangle-legal across all untrimmed neighbour configs', () => {
    const keys = ['L', 'R', 'T', 'B'];
    for (let m = 1; m < 16; m++) {
      const combo = keys.filter((_, i) => m & (1 << i));
      const state = makeState(12, 12);
      const road = addRoad(state, 5, 5);
      for (const d of combo) addRoad(state, 5 + DIRS[d]![0], 5 + DIRS[d]![1]);
      const legal = legalStates(state, road);
      for (const [fan, tri] of PAIRS) {
        if (legal.includes(fan)) {
          expect(legal, `config ${combo.join('+')}: fan ${fan} legal but its triangle ${tri} refused`).toContain(tri);
        }
      }
    }
  });

  it('fan-legal implies triangle-legal beside a pre-trimmed neighbour end-cap (each direction × each state)', () => {
    // The neighbour's STORED corners are CANONICAL (that is what the manual tool / auto-trim / reconcile
    // store); the validator must judge the shared edge from the DRAWN geometry, not the raw tokens.
    for (const d of ['L', 'R', 'T', 'B']) {
      for (let ns = 1; ns < CANONICAL_ROAD_STATES.length; ns++) {
        const state = makeState(12, 12);
        const road = addRoad(state, 5, 5);
        addRoad(state, 5 + DIRS[d]![0], 5 + DIRS[d]![1], [...CANONICAL_ROAD_STATES[ns]!]);
        const legal = legalStates(state, road);
        for (const [fan, tri] of PAIRS) {
          if (legal.includes(fan)) {
            expect(legal, `${d}-neighbour state ${ns}: fan ${fan} legal but triangle ${tri} refused`).toContain(tri);
          }
        }
      }
    }
  });

  it('no deadlock: a road below a state-4-trimmed end-cap still validates raw and keeps a legal cut', () => {
    // Regression: the neighbour's canonical tokens read as actual-frame geometry made its shared edge
    // register as EMPTY, so the road below could validate NO state at all — not even raw/square — and the
    // manual tool's cycle found nothing (the cell read as un-editable).
    const state = makeState(12, 12);
    const road = addRoad(state, 5, 5);
    addRoad(state, 5, 4, [...CANONICAL_ROAD_STATES[4]!]); // end-cap above, trimmed to the / diagonal
    expect(validateCut(state, 5, 5, 'road', ['square', 'square', 'square', 'square']), 'raw must stay legal').toBe(true);
    expect(legalStates(state, road).length, 'at least one cut state cycles').toBeGreaterThan(0);
  });
});
