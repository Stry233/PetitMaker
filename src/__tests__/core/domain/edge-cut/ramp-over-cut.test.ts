/**
 * A ramp landing on a cliff lip that already carries a legal edge cut leaves the cut in place and the
 * map legal, through the whole commit path (`ramp-robustness.test.ts` asks only the rule). A cut adds
 * or removes no block, so a cell's support is the same either way; the generator relies on this, as it
 * trims the whole map and then places ramps onto the trimmed lips. A fillet (`patchOnly`) has no
 * support under it and is refused; that case lives in `ramp-robustness.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType, type Corners, type GridState, type PlaceObjectCommand } from '../../../../core/model/types';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { computeLockedCorners } from '../../../../core/domain/edge-cut/trim-lock';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';

/** The ramp's anchor cell, so the cut sits inside the reconcile's reach (the anchor and the ring
 *  around it); a cut further along the deck would survive only because nothing looked at it. */
const CUT_AT = { x: 8, y: 14 };

/** A tier-1 plateau (x 5 to 10, y 5 to 14) with the lip cell west of the anchor removed, which gives
 *  the anchor a free convex corner to cut. The notch is outside the deck's span (x 8 to 10). */
function trimmedPlateau(): { state: GridState; corners: Corners } {
  const state = makeState(20, 20);
  for (let y = 5; y <= 14; y++) for (let x = 5; x <= 10; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  state.cells[14]![7]!.terrain = null;
  const locked = computeLockedCorners(state, roadLookup(state), CUT_AT.x, CUT_AT.y, 'terrain');
  const free = locked.indexOf(false);
  if (free < 0) throw new Error('fixture: the lip cell has no cuttable corner');
  const corners: Corners = ['square', 'square', 'square', 'square'];
  corners[free] = 'fan';
  state.cells[CUT_AT.y]![CUT_AT.x]!.terrain!.corners = [...corners];
  return { state, corners };
}

function placeRamp(x: number, y: number): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,     object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0, elevation: 0 },
  };
}

describe('a ramp placed onto an already-trimmed cliff lip', () => {
  it('lands, and leaves the trim exactly as it found it', () => {
    const { state, corners } = trimmedPlateau();
    const executor = makeExecutor(state);

    // As a drop does: execute, then commit the stroke, where the neighbourhood cut reconcile runs.
    const start = executor.beginStroke();
    const cmd = placeRamp(8, 14);
    expect(executor.execute(cmd).success, 'the ramp is accepted on a trimmed lip').toBe(true);
    const violations = start.commit();

    expect(violations, 'the finished map is legal').toHaveLength(0);
    expect(state.objects.get('r1'), 'the ramp stands').toBeTruthy();
    expect(state.cells[CUT_AT.y]![CUT_AT.x]!.terrain!.corners, 'the trim under the deck is untouched').toEqual(corners);
  });

  it('does square an ILLEGAL cut under the deck — the repair the placement really owes', () => {
    // On a solid plateau no corner of the lip cell is cuttable, so a cut written there is illegal and
    // the placement's stroke repairs it.
    const state = makeState(20, 20);
    for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    state.cells[14]![8]!.terrain!.corners = ['fan', 'fan', 'fan', 'fan'];
    const executor = makeExecutor(state);

    const start = executor.beginStroke();
    executor.execute(placeRamp(8, 14));
    start.commit();

    expect(state.cells[14]![8]!.terrain!.corners).toBeUndefined();
  });

  it('is judged the same whether the lip is trimmed or square', () => {
    const { state: trimmed } = trimmedPlateau();
    const { state: square } = trimmedPlateau();
    square.cells[CUT_AT.y]![CUT_AT.x]!.terrain!.corners = undefined;
    const reg = createDefaultRegistry();

    const a = reg.validatePreCommand(placeRamp(8, 14), trimmed);
    const b = reg.validatePreCommand(placeRamp(8, 14), square);

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(0);
  });

  it('snaps to the same footprint either way — a trim moves no block, so it moves no deck', () => {
    const { state: trimmed } = trimmedPlateau();
    const { state: square } = trimmedPlateau();
    square.cells[CUT_AT.y]![CUT_AT.x]!.terrain!.corners = undefined;
    const reg = createDefaultRegistry();

    const onTrim = placeRamp(8, 14);
    const onSquare = placeRamp(8, 14);
    reg.validatePreCommand(onTrim, trimmed);
    reg.validatePreCommand(onSquare, square);

    expect(onTrim.object.position).toEqual(onSquare.object.position);
    expect(onTrim.object.rotation).toBe(onSquare.object.rotation);
    expect(onTrim.object.elevation).toBe(onSquare.object.elevation);
  });
});
