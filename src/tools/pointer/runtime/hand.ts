import { ToolType } from '../../../state/editing/vocabulary';
import type { Tool } from './types';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { PLACEMENT_GRID } from '../../../core/game/profile';

/** The manager's initial tool: it edits nothing. A left drag in its mode moves the map, and the
 *  pointer machine applies that pan for both views (`view/interaction/press/press-plan.ts`). */
export class HandTool implements Tool<typeof PLACEMENT_GRID> {
  readonly id = ToolType.Hand;
  grid(): typeof PLACEMENT_GRID { return PLACEMENT_GRID; }
  // The four arrows: this tool moves the view, and holds that reading whether or not a drag is
  // live. The hands mean grabbing an object, which is a different gesture in the same mode.
  cursor(): CursorId { return 'move'; }
  selectMode(): boolean { return true; }

  onPointerDown(): void {}
  onPointerMove(): void {}
  onPointerUp(): void {}
  onActivate(): void {}
  onDeactivate(): void {}
}
