/** A stencil laid facing another map direction: the whole picture turns, the pieces in it included. */
import { describe, it, expect } from 'vitest';
import type { Command, GridState, ValidationResult } from '../../../../core/model/types';
import type { Rotation } from '../../../../core/model/types';
import { makeState, makeExecutor } from '../../../_support/map-state';
import type { Stencil, StencilPlan } from '../../../../tools/generation/recipe';
import { ELEVATION_MAX } from '../../../../core/game/profile';
import { runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import { stencilFrame } from '../../../../tools/generation/stencil/stencil-turn';
import { pieceSize, pieceTurn } from '../../../../tools/generation/stencil/stencil-piece';
import { strokeTileMask } from '../../../../tools/generation/stencil/stencil-line-tiles';
import { __setCatalogItem } from '../../../../state/catalog';
import { ItemCategory } from '../../../../config/catalog/categories';

const CABIN = 'building-forest-cabin';   // 5 wide, 4 deep, turns
const TREE = 'tree-apple';               // 1 by 1, never turns
// A bench 1 wide and 2 deep that turns.
const BENCH = 'facing-test-bench';
__setCatalogItem({
  id: BENCH, category: ItemCategory.Building, name: { en: 'Facing Test Bench' },
  width: 1, height: 2, loadValue: 1000, rotatable: true, placementMode: 'point', traits: [],
});

function solid(width: number, height: number): Stencil {
  const n = width * height;
  return { width, height, coverage: new Uint8Array(n).fill(255), color: new Uint32Array(n) };
}

function layObjects(state: GridState, stencil: Stencil, catalogId: string, facing?: Rotation) {
  const plan: StencilPlan = { read: 'shape', fill: { kind: 'object', catalogId }, stencil, origin: { x: 2, y: 8 }, ...(facing ? { facing } : {}) };
  const execute = (cmd: Command): ValidationResult => makeExecutor(state).execute(cmd);
  return runStencilPlan(state, plan, ELEVATION_MAX, execute);
}

const placed = (state: GridState, catalogId: string) => [...state.objects.values()].filter((o) => o.catalogId === catalogId);

describe('a stencil laid facing east', () => {
  it('[GEN-23] turns the pieces that turn, tiling the shape by their turned footprint', () => {
    const state = makeState(30, 30);
    layObjects(state, solid(4, 5), CABIN, 90);
    expect(placed(state, CABIN).map((o) => o.rotation)).toEqual([90]);
    const north = makeState(30, 30);
    layObjects(north, solid(4, 5), CABIN);
    expect(placed(north, CABIN)).toHaveLength(0);
  });

  it('[GEN-23] leaves a piece that never turns as it stands', () => {
    const state = makeState(30, 30);
    layObjects(state, solid(2, 2), TREE, 90);
    expect(placed(state, TREE).length).toBeGreaterThan(0);
    expect(placed(state, TREE).every((o) => o.rotation === 0)).toBe(true);
  });
});

describe('stencilFrame', () => {
  it('is the box the stencil is drawn in before it turns: width and height trade places across a quarter turn', () => {
    const box = { origin: { x: 3, y: 4 }, width: 6, height: 20 };
    expect(stencilFrame(box, 0)).toBe(box);
    expect(stencilFrame(box, 180)).toBe(box);
    expect(stencilFrame(box, 90)).toEqual({ origin: { x: 3, y: 4 }, width: 20, height: 6 });
    expect(stencilFrame(box, 270)).toEqual({ origin: { x: 3, y: 4 }, width: 20, height: 6 });
  });

});

describe('a piece of a turned picture', () => {
  it('[GEN-23] turns and covers its turned footprint where it turns, and stands as it is where it never does', () => {
    expect([pieceTurn(90, BENCH), pieceSize(90, BENCH)]).toEqual([90, { w: 2, h: 1 }]);
    expect([pieceTurn(undefined, BENCH), pieceSize(undefined, BENCH)]).toEqual([0, { w: 1, h: 2 }]);
    expect([pieceTurn(270, TREE), pieceSize(270, TREE)]).toEqual([0, { w: 1, h: 1 }]);
  });
});

describe('a print letter turned to face east', () => {
  it('[GEN-23] lays a lone mark, a dot or a full stop, along the turned line rather than across it', () => {
    const lone: Stencil = { width: 1, height: 1, coverage: new Uint8Array([255]), color: new Uint32Array(1), connections: new Uint8Array([0]) };
    const NS = 1 | 4, EW = 2 | 8;
    expect(strokeTileMask(lone, 0)).toBe(EW);
    expect(strokeTileMask(lone, 0, 90)).toBe(NS);
    expect(strokeTileMask(lone, 0, 180)).toBe(EW);
  });
});
