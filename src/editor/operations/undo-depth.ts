/* The map's undo depth: reading it as edits land, and rewinding to a recorded watermark. */
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { EventBus } from '../../core/commands/event-bus';
import { onMapEdited } from '../../core/commands/map-edits';
import { coalesceToFrame } from '../../platform/async/after-paint';
import type { EditorEvents } from '../../state/editing/events';

/**
 * Undoes down to `undoIndex`, later manual edits included; one executor undo may consume several
 * entries while it restores post-stroke validity. Returns how many undos ran.
 */
export function rewindTo(executor: CommandExecutor, undoIndex: number): number {
  let steps = 0;
  while (executor.historyDepth() > undoIndex && executor.undo()) steps++;
  return steps;
}

/**
 * Calls `onDepth` with the undo depth after every edit, at most once per frame with `frame`.
 * Returns the unsubscribe.
 */
export function watchUndoDepth(
  bus: EventBus<EditorEvents>, executor: CommandExecutor, onDepth: (depth: number) => void,
  opts: { frame?: boolean } = {},
): () => void {
  const notify = () => onDepth(executor.historyDepth());
  if (!opts.frame) return onMapEdited(bus, notify);
  const coalesced = coalesceToFrame(notify);
  const off = onMapEdited(bus, coalesced.run);
  return () => { coalesced.cancel(); off(); };
}
