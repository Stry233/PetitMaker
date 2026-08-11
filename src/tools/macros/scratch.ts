/**
 * Designed machinery over a copy of the map, and the copy's work put back on the real one.
 *
 * A macro is a small generation: it wants to try a design, ask the rules what they make of it, and
 * keep it only if the answer is yes. Doing that on the live map means painting and unpainting it
 * under the user, which works right up until something interrupts the sequence (a crash, a reload,
 * a post-stroke revert that stops early), and what is left then is a half-built hill nobody asked
 * for. So a macro runs against a detached clone with its own executor and the LIVE rule dispatcher,
 * and what comes back is the commands that clone ACCEPTED, ready to be replayed through the real
 * executor inside the caller's stroke group.
 *
 * This is `kit/operations/generate.ts:generateCandidate` in the small, and it inherits both of the
 * things that path learned the hard way — the two of them share `mapFingerprint` and
 * `detachCommand` rather than each carrying a copy.
 *
 * THE CLONE IS THE WHOLE MAP, not the macro's neighbourhood. A clone cut to the macro's own radius
 * would re-decide every rule at its own rim, since V-MTN-03 reads a 3x3 and an edge cut reads the
 * eight cells around one, and it would buy nothing measurable: cloning the largest built-in map with
 * three thousand objects standing on it costs about 1 ms, while the run itself costs tens, because
 * every terrain macro asks the post-stroke rules about the WHOLE grid each time it wants to know
 * whether the step it has just built is legal.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { cloneGridState } from '../../core/model/grid-model';
import { CommandType } from '../../core/model/types';
import type {
  Command, Corners, EditorEvents, GridState, PlacedObject, ValidationResult,
} from '../../core/model/types';
import { roadLookup } from '../../state/object-index';
import type { MacroContext } from './context';

/** A run that has already happened somewhere else. */
export interface ScratchRun {
  /** The commands the copy's executor accepted, oldest first, each as the builder made it. */
  commands: Command[];
  /** `mapFingerprint` of the map they were built on. */
  base: string;
}

/**
 * An executor that keeps a detached pre-image of every command it accepts.
 *
 * A COMMAND IS RECORDED AS THE BUILDER MADE IT, not as the executor left it. Validation SNAPS a
 * bridge or a ramp onto the map by writing position, rotation, span and elevation back onto the
 * command, so replaying the post-snap command snaps it a second time from an anchor that has
 * already moved: a four-cell bridge came back a six-cell bridge somewhere else, and six later
 * placements were refused around it.
 *
 * A macro that rolls a step back has decided not to build it, so the recording follows the undo
 * stack down. Nothing here collapses the stack — `commitStrokeGroup` runs on the LIVE executor,
 * after the replay — so tracking the stack's size is enough to know what is still standing.
 */
class RecordingExecutor extends CommandExecutor {
  readonly recorded: Command[] = [];
  private readonly marks: number[] = [];

  override execute(cmd: Command): ValidationResult {
    const pristine = detachCommand(cmd);
    const result = super.execute(cmd);
    if (result.success) {
      this.recorded.push(pristine);
      this.marks.push(this.getUndoStackSize());
    }
    return result;
  }

  override undo(): boolean {
    const undone = super.undo();
    this.forgetUndone();
    return undone;
  }

  override rollbackTo(watermark: number): void {
    super.rollbackTo(watermark);
    this.forgetUndone();
  }

  private forgetUndone(): void {
    const size = this.getUndoStackSize();
    while (this.marks.length > 0 && this.marks[this.marks.length - 1]! > size) {
      this.marks.pop();
      this.recorded.pop();
    }
  }
}

/** Runs `build` against a copy of the live map and hands back what it built. The live map is not
 *  touched, and neither is its undo stack, its event bus or its provenance ledger. */
export function runOnScratch(ctx: MacroContext, build: (scratch: MacroContext) => void): ScratchRun {
  const base = mapFingerprint(ctx.state);
  const state = cloneGridState(ctx.state);
  const executor = new RecordingExecutor(state, new EventBus<EditorEvents>(), ctx.registry, roadLookup(state));
  build({ state, executor, registry: ctx.registry });
  return { commands: executor.recorded, base };
}

/**
 * Puts a scratch run on the live map, inside whatever stroke group the caller has open.
 *
 * Every command is validated again here; nothing is trusted about them beyond the map they were
 * built on still being the map they are landing on. Returns false when it is not, which is the
 * caller's cue to build again rather than to land a result that was never promised.
 */
export function replayOnLive(ctx: MacroContext, run: ScratchRun): boolean {
  if (mapFingerprint(ctx.state) !== run.base) return false;
  for (const cmd of run.commands) ctx.executor.execute(detachCommand(cmd));
  return true;
}

/** A copy of `cmd` sharing nothing mutable with the map it was built on. A placement command carries
 *  the object itself and a corner edit carries arrays that are assigned straight into a cell, so
 *  replaying either as it stands would leave two maps holding one object. */
export function detachCommand(cmd: Command): Command {
  switch (cmd.type) {
    case CommandType.PlaceObject:
      return { ...cmd, object: cloneObject(cmd.object) };
    case CommandType.RemoveObject:
      return { ...cmd, removedObject: cloneObject(cmd.removedObject) };
    case CommandType.TrimCorners:
      return {
        ...cmd,
        ...(cmd.beforeCorners ? { beforeCorners: [...cmd.beforeCorners] as Corners } : {}),
        afterCorners: [...cmd.afterCorners] as Corners,
      };
    default:
      return cmd;
  }
}

function cloneObject(obj: PlacedObject): PlacedObject {
  return {
    ...obj,
    position: { ...obj.position },
    ...(obj.corners ? { corners: [...obj.corners] as Corners } : {}),
  };
}

/**
 * The map as one short string: its cells, its objects and its locked layers.
 *
 * Everything a rule can read goes in, since what this answers is whether a command validated
 * against one map is still that command against another. It compares by CONTENT rather than by a
 * mutation counter, so a paint the user undid leaves the map eligible again, which is the honest
 * answer: that map is the map the run was built on.
 */
export function mapFingerprint(state: GridState): string {
  let h = 0x811c9dc5;
  let g = 0x2545f491;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v >>> 0), 0x01000193);
    g = Math.imul(g ^ (v >>> 0), 0x85ebca6b) + 0x6b43a9b5;
  };
  const mixText = (s: string): void => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  const mixCorners = (corners: Corners | undefined): void => {
    if (!corners) { mix(0); return; }
    mix(1);
    for (const c of corners) mixText(c);
  };

  mix(state.template.width);
  mix(state.template.height);
  for (const row of state.cells) {
    for (const cell of row) {
      mix(cell.zone);
      const t = cell.terrain;
      if (!t) { mix(0); continue; }
      mix(1);
      mix(t.type);
      mix(t.elevation);
      mix(t.patchOnly ? 1 : 0);
      mix((t.patchBase ?? -1) + 1);
      mixCorners(t.corners);
    }
  }
  // Insertion order counts. Two maps that reached the same objects by different routes read as
  // different maps here, which costs a rebuild and never a wrong result.
  for (const obj of state.objects.values()) {
    mixText(obj.id);
    mixText(obj.catalogId);
    mixText(`${obj.position.x},${obj.position.y},${obj.rotation},${obj.elevation}`);
    mixText(`${obj.spanLength ?? ''},${obj.width ?? ''},${obj.height ?? ''},${obj.color ?? ''}`);
    mix(obj.locked ? 1 : 0);
    mix(obj.patchOnly ? 1 : 0);
    mixCorners(obj.corners);
  }
  for (const layer of [...state.lockedLayers].sort((a, b) => a - b)) mix(layer);
  return `${h >>> 0}.${g >>> 0}`;
}
