/* Placement probes: an object judged where it would stand, with itself taken off the map, and the
 * move and turn plans every object edit lands through. Validates and never executes. */
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { GridState, PlacedObject, PlaceObjectCommand, Rotation, StrokeScope, ValidationError } from '../../core/model/types';
import { mapVersionKey } from '../../core/model/grid-model';
import { surfaceElevationAt } from '../../state/object-geometry';

/** The live map as a placement probe reads it with `objects` taken off: a read-only view sharing
 *  the cells, whose own object map omits them, and the scope that holds them as lifted, so a
 *  destination inside their own footprint is no collision and their load is credited as a move's.
 *  The live map is never written and its versions never move; one view serves every probe until
 *  the map, or the set taken off, changes, so its object index and statistics are built once per
 *  drag. */
export interface ProbeView { view: GridState; scope: StrokeScope }

export function probeWithout(state: GridState, objects: readonly PlacedObject[]): ProbeView {
  const key = `${mapVersionKey(state)}|${state.objects.size}|${objects.map((o) => o.id).join(',')}`;
  const hit = probeViews.get(state);
  if (hit && hit.key === key) return hit.probe;
  const objectsOff = new Map(state.objects);
  const lifted = new Map<string, PlacedObject>();
  for (const obj of objects) {
    // The map's own instance is the one credited, not the caller's copy.
    const standing = state.objects.get(obj.id) ?? obj;
    objectsOff.delete(obj.id);
    lifted.set(obj.id, standing);
  }
  const probe: ProbeView = { view: { ...state, objects: objectsOff, objectsDelta: undefined }, scope: { lifted } };
  probeViews.set(state, { key, probe });
  return probe;
}

/** One probe view per live map: a cache keyed by the map's versions and the objects taken off. */
const probeViews = new WeakMap<GridState, { key: string; probe: ProbeView }>();

/** `obj` as it would be at (newX, newY): elevation tracks the destination's surface, read through
 *  the straddle so a halfStep item's fractional coordinate names real cells (see
 *  `surfaceElevationAt`). A snapping item's trait replaces this when the command resolves. */
export function movedObject(gs: GridState, obj: PlacedObject, newX: number, newY: number): PlacedObject {
  return { ...obj, position: { x: newX, y: newY }, elevation: surfaceElevationAt(gs, newX, newY) };
}

/**
 * Validate the placement of a mutated copy of `original`, excluding `original` so an in-place change
 * is no self-overlap. Never mutates state. Shared by move and rotate, so the object is never removed
 * before its new placement is known legal; the removal is judged first, since V-LOCK-02 refuses a
 * locked object's removal.
 *
 * `preview` is the candidate as it would land (a bridge or ramp snapped onto its span), the geometry
 * the drop lands, for a ghost; it is the candidate itself where nothing resolves it.
 */
export function planObjectPlacement(
  exec: CommandExecutor, gs: GridState, original: PlacedObject, candidate: PlacedObject,
): { cmd: PlaceObjectCommand; errors: ValidationError[]; preview: PlacedObject } {
  const cmd = placeObjectCommand(candidate);
  const rules = exec.getRegistry();
  const removal = rules.validatePreCommand(removeObjectCommand(original), gs);
  if (removal.length > 0) return { cmd, errors: removal, preview: candidate };
  const probe = probeWithout(gs, [original]);
  const landed = rules.resolve(cmd, probe.view);
  return { cmd, errors: rules.validatePreCommand(landed, probe.view, probe.scope), preview: landed.object };
}

/** Plan moving `obj` to (newX, newY): validates the move (self excluded) and returns the
 *  PlaceObject command + errors. Elevation tracks the destination cell's terrain. */
export function planObjectMove(
  exec: CommandExecutor, gs: GridState, obj: PlacedObject, newX: number, newY: number,
): { cmd: PlaceObjectCommand; errors: ValidationError[]; preview: PlacedObject } {
  return planObjectPlacement(exec, gs, obj, movedObject(gs, obj, newX, newY));
}

/** Plan rotating `obj` to `newRotation`: validates the rotated footprint (self excluded)
 *  and returns the PlaceObject command + errors. Position and elevation are unchanged. */
export function planObjectRotation(
  exec: CommandExecutor, gs: GridState, obj: PlacedObject, newRotation: Rotation,
): { cmd: PlaceObjectCommand; errors: ValidationError[]; preview: PlacedObject } {
  return planObjectPlacement(exec, gs, obj, { ...obj, rotation: newRotation });
}
