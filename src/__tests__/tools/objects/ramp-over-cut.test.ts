/**
 * A ramp landing on a cliff lip that already carries an edge cut: the cut STAYS, and the map stays
 * legal. Reported as a defect ("placing a ramp over a cut does not update the cut"), it is the
 * policy — pinned here through the whole commit path, which `ramp-robustness.test.ts` does not
 * reach: that file asks the rule whether the placement is legal, this one asks what the finished
 * stroke left behind.
 *
 * A cut is SILHOUETTE-ONLY. It adds and removes no block, so a cell's real support
 * (`realSurface`/`structuralTop`) is invariant across any cut, which is exactly why the edge-cut
 * tool commits with `{ reconcile: false }` and why the ramp's own support sweep cannot see a trim
 * at all. Squaring corners under a deck would be a second, contrary rule — and the shipped
 * generator would break under it, since it auto-trims the whole map (`edgeCutGeneratedTerrain`)
 * and then places every ramp onto the trimmed lips it just made.
 *
 * The one asymmetry worth keeping straight: a Γ FILLET (`patchOnly`) is not a trim of a real
 * block, it is cosmetic mass with no support under it, and a ramp on one is refused. That case is
 * `ramp-robustness.test.ts`'s own.
 */
import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType, type Corners, type GridState, type PlaceObjectCommand } from '../../../core/model/types';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { computeLockedCorners } from '../../../core/edge-cut/trim-lock';
import { makeState, setTerrain } from '../../rules/_helpers';

/** THE ANCHOR CELL ITSELF, so the cut sits inside the reconcile's own reach: `getAffectedCells`
 *  for a placement returns the anchor, and the repair pass walks the ring around it. A cut placed
 *  further along the deck would survive for the uninteresting reason that nothing looked at it. */
const CUT_AT = { x: 8, y: 14 };

/** A mountain plateau at elev 1 (x 5..10, y 5..14) with the lip cell WEST of the anchor knocked
 *  out, which is what leaves the anchor a free convex corner to carry a real cut. The notch is
 *  outside the deck's own perpendicular span (x 8..10), so the ramp is unaffected by it. */
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
    type: CommandType.PlaceObject, timestamp: 0,
    object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0, elevation: 0 },
    loadValue: 80,
  };
}

describe('a ramp placed onto an already-trimmed cliff lip', () => {
  it('lands, and leaves the trim exactly as it found it', () => {
    const { state, corners } = trimmedPlateau();
    const executor = new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));

    // The drop path's own shape: execute, then commit the stroke — which is where the
    // neighbourhood cut reconcile runs, if anything is going to touch a corner.
    const start = executor.getUndoStackSize();
    const cmd = placeRamp(8, 14);
    expect(executor.execute(cmd).success, 'the ramp is accepted on a trimmed lip').toBe(true);
    const violations = executor.commitStroke(start);

    expect(violations, 'the finished map is legal').toHaveLength(0);
    expect(state.objects.get('r1'), 'the ramp stands').toBeTruthy();
    expect(state.cells[CUT_AT.y]![CUT_AT.x]!.terrain!.corners, 'the trim under the deck is untouched').toEqual(corners);
  });

  it('does square an ILLEGAL cut under the deck — the repair the placement really owes', () => {
    // A solid plateau: every corner of the lip cell is covered by a same-type edge neighbour, so
    // none of them is cuttable. A cut written there anyway is not a trim the tool could have made,
    // and the placement's own stroke repairs it — which is the whole of "placing a ramp updates
    // the cut". What it does not do is undo a LEGAL one.
    const state = makeState(20, 20);
    for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    state.cells[14]![8]!.terrain!.corners = ['fan', 'fan', 'fan', 'fan'];
    const executor = new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));

    const start = executor.getUndoStackSize();
    executor.execute(placeRamp(8, 14));
    executor.commitStroke(start);

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
