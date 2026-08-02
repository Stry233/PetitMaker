import { ToolType } from '../core/model/types';
import type { MacroCoord, MicroCoord } from '../core/model/types';
import type { Tool, ToolContext } from './types';
import type { CursorId } from '../core/runtime/cursor-spec';

export class HandTool implements Tool {
  readonly id = ToolType.Hand;
  // The four arrows: this tool MOVES the view, and holds that reading whether or not a drag is
  // live. The hands mean grabbing an object, which is a different gesture in the same mode.
  readonly cursor: CursorId = 'move';
  // The CLOSED hand is not ours to track: the pointer machine reports the pan through
  // setCursorDrag, which is also what closes it for space-drag and middle/right-drag.

  private panning = false;

  onPointerDown(_coord: MacroCoord, _micro: MicroCoord, _ctx: ToolContext): void {
    this.panning = true;
  }

  onPointerMove(_coord: MacroCoord, _micro: MicroCoord, _ctx: ToolContext): void {
    // Raw mouse movement is handled via handleRawMouseMove
  }

  onPointerUp(_coord: MacroCoord, _micro: MicroCoord, _ctx: ToolContext): void {
    this.panning = false;
  }

  onActivate(_ctx: ToolContext): void {
    this.panning = false;
  }

  onDeactivate(_ctx: ToolContext): void {
    this.panning = false;
  }

  handleRawMouseMove(dx: number, dy: number, ctx: ToolContext): void {
    if (this.panning) {
      ctx.viewport.pan(-dx, -dy);
    }
  }

  getIsPanning(): boolean {
    return this.panning;
  }
}
