// DO THE STREETS END AT PLACES, pinned on boards whose answer is known by construction.
//
// The reading has to separate three things a finished map presents: a street that STOPS at a set
// piece, a court whose own paved border is the end of a branch, and a street that runs straight
// PAST one. The first two are arrivals and the third is not, and the second is the one `spurTips`
// could never see — a two-cell border presents no terminus face at all.
import { describe, it, expect } from 'vitest';
import { createGrid, createPlazaObject } from '../../../../../core/model/grid-model';
import {
  CellZone, TerrainType, type GridState, type MapTemplate, type PlacedObject,
} from '../../../../../core/model/types';
import { bridgeAlignment, placeArrivals } from '../../../../../tools/generation/designer/eval';

/** An all-buildable board with a plaza at one end: every claim below is about the pavement and the
 *  water drawn on it, so the ground underneath is deliberately featureless. */
const W = 90, H = 40;
const BOARD: MapTemplate = {
  id: 'arrivals-board', name: { en: 'board' }, width: W, height: H,
  zones: Array.from({ length: H }, () => new Array<CellZone>(W).fill(CellZone.Grass)),
  plaza: { x: 3, y: 16, width: 6, height: 6, elevation: 0 },
};
const HUB = BOARD.plaza;
/** The court's centre: clear of the plaza, with room for its border and the run in from the hub. */
const SITE = { x: 50, y: 19 };

function board(): GridState {
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(BOARD);
  if (plaza) objects.set(plaza.id, plaza);
  return { template: BOARD, cells: createGrid(BOARD), objects, lockedLayers: new Set() };
}

let nextId = 0;
function pave(state: GridState, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const id = `road-${nextId++}`;
      state.objects.set(id, {
        id, catalogId: 'path-garden-stone', position: { x, y }, rotation: 0, elevation: 0,
      } as PlacedObject);
    }
  }
}

/** A square of water with a dry islet in it: the shape `isCourt` reads as a formal court. */
function court(state: GridState, cx: number, cy: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue;
      if (dx === 0 && dy === 0) continue;
      const cell = state.cells[cy + dy]?.[cx + dx];
      if (cell) cell.terrain = { type: TerrainType.Water, elevation: 0 };
    }
  }
}

describe('the set pieces a walk finishes at', () => {
  it('counts a court whose own border is the end of a branch', () => {
    const state = board();
    const { x: cx, y: cy } = SITE;
    court(state, cx, cy, 4);
    // The border round the water, and a two-wide branch from the plaza out to it.
    pave(state, cx - 6, cy - 6, 13, 2);
    pave(state, cx - 6, cy + 5, 13, 2);
    pave(state, cx - 6, cy - 4, 2, 9);
    pave(state, cx + 5, cy - 4, 2, 9);
    pave(state, HUB.x + HUB.width, cy - 1, cx - 6 - HUB.x - HUB.width, 2);
    const read = placeArrivals(state);
    expect(read.places, 'one court on the board').toBe(1);
    expect(read.arrivedAt, 'the branch ends at it').toBe(1);
    expect(read.byLeaf, 'and it ends there as a leaf, not as a terminus').toBe(1);
  });

  it('does not count a court a street runs straight past', () => {
    const state = board();
    const { x: cx, y: cy } = SITE;
    court(state, cx, cy, 4);
    // One street from the plaza, through the court's own reach, and on to the far coast.
    pave(state, HUB.x + HUB.width, cy - 1, W - HUB.x - HUB.width - 4, 2);
    const read = placeArrivals(state);
    expect(read.places).toBe(1);
    expect(read.arrivedAt, 'the walk passes it rather than finishing at it').toBe(0);
  });

  it('counts a street END facing a set piece', () => {
    const state = board();
    const { x: cx, y: cy } = SITE;
    court(state, cx, cy, 4);
    // A branch that stops three cells short of the water: a face with street behind it and nothing
    // paved ahead, which is what `eachTerminus` reads as an end.
    pave(state, HUB.x + HUB.width, cy - 1, cx - 7 - HUB.x - HUB.width, 2);
    const read = placeArrivals(state);
    expect(read.places).toBe(1);
    expect(read.byTerminus, 'the end faces the court').toBe(1);
    expect(read.arrivedAt).toBe(1);
  });
});

describe('does a deck continue the street it crosses for', () => {
  /** A deck of `w` x `h` macro cells at (x, y), as the engine stores a resolved span. */
  function deck(state: GridState, x: number, y: number, w: number, h: number): void {
    const id = `deck-${x}-${y}`;
    state.objects.set(id, {
      id, catalogId: 'bridge-park-arch', position: { x, y }, rotation: w >= h ? 0 : 90,
      elevation: 0, spanLength: Math.max(w, h), width: w, height: h,
    } as PlacedObject);
  }

  it('reads a deck that carries a street on across a gap as aligned', () => {
    const state = board();
    const y = 20;
    pave(state, HUB.x + HUB.width, y, 20, 2);
    deck(state, HUB.x + HUB.width + 20, y, 4, 2);
    pave(state, HUB.x + HUB.width + 24, y, 20, 2);
    const read = bridgeAlignment(state);
    expect(read.bridges).toBe(1);
    expect(read.aligned, 'the street carries on at both ends').toBe(1);
    expect(read.crossways).toBe(0);
  });

  it('reads a deck laid at right angles into the side of a street as crossways', () => {
    const state = board();
    // One street running north-south, and a deck laid east-west into its flank.
    pave(state, 40, 10, 2, 25);
    deck(state, 43, 20, 4, 2);
    const read = bridgeAlignment(state);
    expect(read.bridges).toBe(1);
    expect(read.aligned).toBe(0);
    expect(read.crossways, 'the only pavement it meets lies across it').toBe(1);
  });
});
