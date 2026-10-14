/**
 * Drag-to-move's pointer side: a press on a selected object arms it, the drag clears the
 * threshold, and every move and the release hand the map point under the pointer to the
 * `tools/pointer/objects` drag session, which previews and commits the move.
 */
import type { MacroCoord } from '../../../core/model/types';
import { useEditorStore } from '../../../state/store';
import { getActiveView } from '../../active-view';
import { ObjectDragSession } from '../../../tools/pointer/objects';
import { DRAG_THRESHOLD } from '../camera-gestures';
import { reportRefusal } from '../../../core/commands/refusal';
import { setCursorDrag } from '../cursor-controller';

export class ObjectDrag {
  /** True once the armed press has travelled past the drag threshold. */
  dragging = false;
  private startX = 0;
  private startY = 0;
  private readonly session = new ObjectDragSession({
    state: () => useEditorStore.getState().gridState,
    executor: () => useEditorStore.getState().commandExecutor,
    selection: () => useEditorStore.getState().selection,
    setSelection: (blocks) => useEditorStore.getState().setSelection(blocks),
    report: (refusal) => reportRefusal(useEditorStore.getState().eventBus, refusal),
  });

  /** The object the press armed, until the release or a cancel. */
  get objectId(): string | null { return this.session.objectId; }

  /** Arms a move of the selection anchored on `anchorId`, pressed at (x, y); `fallback` is the
   *  pressed cell, the anchor when no view can read the pointer. */
  arm(anchorId: string, x: number, y: number, fallback: MacroCoord): void {
    const grab = getActiveView()?.projection.screenToPoint(x, y) ?? null;
    if (!this.session.begin(anchorId, grab, fallback)) return;
    // Reported like a pan or an orbit is: the drag is a first-class cursor state, so the press has
    // feedback whichever tool armed it.
    setCursorDrag('object');
    this.startX = x;
    this.startY = y;
  }

  /** Drops the armed drag without committing anything. */
  cancel(): void {
    this.dragging = false;
    this.session.cancel();
  }

  /** Arm past the threshold, then preview the drop. Returns whether the drag owns this move. */
  move(x: number, y: number): boolean {
    if (this.session.objectId && !this.dragging
      && (Math.abs(x - this.startX) > DRAG_THRESHOLD || Math.abs(y - this.startY) > DRAG_THRESHOLD)) {
      this.dragging = true;
    }
    const view = getActiveView();
    if (!this.dragging || !view) return false;
    this.session.preview(view, view.projection.screenToPoint(x, y));
    return true;
  }

  /** Commits the drag released at (x, y). */
  drop(x: number, y: number): void {
    this.dragging = false;
    // The release returns before the machine's shared button-0 cleanup, so the drag state it
    // published has to be retired here or the cursor stays on `move` after the drop.
    setCursorDrag('none');
    const view = getActiveView();
    view?.overlay.clearGhost();
    if (!view) { this.session.cancel(); return; }
    this.session.commit(view, view.projection.screenToPoint(x, y));
  }
}
