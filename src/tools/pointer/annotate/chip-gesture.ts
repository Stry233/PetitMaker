/**
 * The chip verb of the notes tool: a press on open ground drops a plate wearing the armed tag, size
 * and colour; a press on a plate, or any press while multi-select is held, is a selection, which the
 * tool's own select path handles.
 */
import type { MacroCoord } from '../../../core/model/types';
import { chipTextSize, generateAnnotationId, type ChipNote, type MapAnnotation } from '../../../core/model/annotations';
import type { AnnotateContext } from './channel';
import { chipAt } from './note-hits';
import { layerEditable, NOTE_GHOST_ID } from './note-edits';

export class ChipGesture {
  constructor(private readonly select: (p: MacroCoord, ctx: AnnotateContext, hit: MapAnnotation | null) => void) {}

  down(p: MacroCoord, ctx: AnnotateContext): void {
    const hit = ctx.state.annotations?.visible ? chipAt(p, ctx) : null;
    if (hit || ctx.modifiers.multiSelect) { this.select(p, ctx, hit); return; }
    if (!layerEditable(ctx)) return;
    const chip = plate(p, generateAnnotationId(), ctx);
    if (!chip) return;
    ctx.annotationEdit.add(chip);
    ctx.annotationEdit.select([chip.id]);
  }

  /** The plate a press at `p` would drop; null where the press would select instead, or with no
   *  tag armed. */
  ghost(p: MacroCoord, ctx: AnnotateContext): ChipNote | null {
    if (ctx.modifiers.multiSelect || chipAt(p, ctx)) return null;
    return plate(p, NOTE_GHOST_ID, ctx);
  }
}

/** A plate at `p` wearing the armed tag, size and colour; null with no tag armed. */
function plate(p: MacroCoord, id: string, ctx: AnnotateContext): ChipNote | null {
  const tag = ctx.arming.annotationTag;
  if (!tag) return null;
  return { kind: 'chip', id, x: p.x, y: p.y, tag, size: chipTextSize(ctx.arming.annotationSize), color: ctx.arming.annotationColor };
}
