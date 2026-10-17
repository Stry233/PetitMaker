/**
 * The Ctrl rubber band. A Ctrl-held press arms it regardless of what is under the pointer (an
 * object still toggles on press, but Ctrl never arms a move); it activates once the drag clears
 * DRAG_THRESHOLD, and releasing Ctrl mid-drag does not cancel it: nothing re-reads the modifier
 * once armed. Only the drawn rect updates per move; membership is resolved once, on release.
 */
import type { MacroCoord } from '../../../core/model/types';
import { useEditorStore } from '../../../state/store';
import { getActiveToolManager, getActiveView } from '../../active-view';
import { cellUnder } from '../../../core/grid/pointer';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { DRAG_THRESHOLD, travelledPast } from '../press/travel';
import { macroRect, objectsInBand } from '../marquee';

export class BandSelect {
  armed = false;
  private active = false;
  private startMacro: MacroCoord | null = null;
  private startX = 0;
  private startY = 0;

  /** Arms a band from cell `from`, pressed at screen (x, y). */
  arm(from: MacroCoord, x: number, y: number): void {
    this.armed = true;
    this.startMacro = from;
    this.startX = x;
    this.startY = y;
  }

  /** Grows the drawn rect. Swallows the move unconditionally once armed: a band-armed press must
   *  never fall through to pan or a tool stroke. */
  move(x: number, y: number): boolean {
    if (!this.armed) return false;
    if (!this.active
      && travelledPast(x - this.startX, y - this.startY, DRAG_THRESHOLD)) {
      this.active = true;
    }
    const bandView = getActiveView();
    if (this.active && bandView && this.startMacro) {
      bandView.overlay.showBand(macroRect(this.startMacro, cellUnder(bandView.projection, x, y, PLACEMENT_GRID)));
    }
    return true;
  }

  /** Released at (x, y): adds what the band covers to the selection. */
  release(x: number, y: number): void {
    const bandView = getActiveView();
    if (this.active && bandView && this.startMacro) {
      const rect = macroRect(this.startMacro, cellUnder(bandView.projection, x, y, PLACEMENT_GRID));
      bandView.overlay.clearBand();
      const store = useEditorStore.getState();
      const tools = getActiveToolManager();
      const tool = tools?.getActiveTool();
      if (tools && tool?.bandSelect) {
        tool.bandSelect(rect, tools.getContext());
      } else {
        const gs = store.gridState;
        const covered = gs ? objectsInBand(gs, rect) : [];
        if (covered.length > 0 && gs) {
          const existing = store.selection;
          const additions = covered
            .filter((id) => !existing.some((r) => r.kind === 'object' && r.id === id))
            .map((id) => ({ kind: 'object', id } as const));
          if (additions.length > 0) store.setSelection([...existing, ...additions]);
        }
      }
    }
    this.reset();
  }

  /** Drops the band without selecting. */
  cancel(): void {
    if (!this.armed) return;
    this.reset();
    getActiveView()?.overlay.clearBand();
  }

  private reset(): void {
    this.armed = false;
    this.active = false;
    this.startMacro = null;
  }
}
