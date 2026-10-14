/**
 * The chip verb of the notes tool: a press on open ground drops a plate wearing the armed tag, size
 * and colour; a press on a plate, or any press while multi-select is held, is a selection, which the
 * tool's own select path handles.
 */
import type { MacroCoord } from '../../../core/model/types';
import { chipTextSize, generateAnnotationId, type ChipNote, type MapAnnotation } from '../../../core/model/annotations';
import type { AnnotateContext } from './channel';
import { chipAt } from './note-hits';
import { layerEditable } from './note-edits';

export class ChipGesture {
  constructor(private readonly select: (p: MacroCoord, ctx: AnnotateContext, hit: MapAnnotation | null) => void) {}

  down(p: MacroCoord, ctx: AnnotateContext): void {
    const hit = ctx.state.annotations?.visible ? chipAt(p, ctx) : null;
    if (hit || ctx.modifiers.multiSelect) { this.select(p, ctx, hit); return; }
    if (!layerEditable(ctx) || !ctx.arming.annotationTag) return;
    const chip: ChipNote = {
      kind: 'chip', id: generateAnnotationId(), x: p.x, y: p.y,
      tag: ctx.arming.annotationTag, size: chipTextSize(ctx.arming.annotationSize), color: ctx.arming.annotationColor,
    };
    ctx.annotationEdit.add(chip);
    ctx.annotationEdit.select([chip.id]);
  }
}
