/*
 * group-rotate-action.ts — the ONE call path a group rotation runs through, shared by the
 * SelectionHandles rotate button and the `,`/`.` keyboard shortcut (ui/keybindings/commands.ts).
 * `rotateGroup` (group-actions.ts) deliberately never touches a view or the window bridge — it only
 * calls the hook a caller supplies — so this module IS that caller: it drives the same arc animation
 * the button always has, and surfaces a refusal through `validation-failed`, the same register a
 * single object's rotate uses. Two entry points that each built this wiring would drift the moment
 * one of them changed: this file is what keeps them identical.
 */
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents, GridState } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { getActiveView } from '../../canvas/active-view';
import { paintGroupRotationArc } from '../../canvas/interaction/usePointerInteraction';
import { rotateGroup, type QuarterTurn } from './group-actions';

// Set only for the synchronous duration of this module's own `rotateGroup` call (never across the
// arc animation that follows, which is async). `SelectionHandles` reads this to tell "the members'
// own geometry moved because they turned" apart from every other reason `objects-changed` fires, so
// its control-row anchor can hold still across a turn while still following a genuine group move.
let rotationInFlight = false;

export function isGroupRotationInFlight(): boolean {
  return rotationInFlight;
}

/**
 * Turn the selection's members as one rigid body: runs `rotateGroup`, hands its hook the same
 * per-tick arc paint the button drives (reading state live each tick, not a closed-over snapshot, so
 * a concurrent edit can't paint a stale frame), and emits `validation-failed` on a refusal (a locked
 * member, a non-square span, an illegal destination) so it surfaces identically whether the caller
 * was a click or a keypress. `quarterTurns` lets a caller turn either way; the button only ever spins
 * clockwise (+1).
 */
export function rotateGroupAction(
  executor: CommandExecutor,
  state: GridState,
  eventBus: EventBus<EditorEvents>,
  ids: readonly string[],
  quarterTurns: QuarterTurn,
): void {
  if (ids.length < 2) return;
  rotationInFlight = true;
  let res;
  try {
    res = rotateGroup(executor, state, ids, quarterTurns, (turn) => {
      const view = getActiveView();
      view?.animateGroupRotation?.(turn, (eased) => {
        const liveGs = useEditorStore.getState().gridState;
        if (view && liveGs) paintGroupRotationArc(view.overlay, liveGs, turn, eased, useEditorStore.getState().showLayerNumbers);
      });
    });
  } finally {
    rotationInFlight = false;
  }
  if (res.refusal) eventBus.emit('validation-failed', res.refusal);
}
