/**
 * The measure verb of the notes tool: inclusive cell extents between two taps or a drag's endpoints.
 * Each end is the whole cell centred on the half-cell lattice point nearest the pointer, so the ends
 * move in half-cell steps. The first press opens a measurement draft; a second press, or a release
 * away from the press, ends it as a note.
 */
import type { MacroCoord } from '../../../core/model/types';
import { generateAnnotationId, noteStepCell, type MeasureNote } from '../../../core/model/annotations';
import type { AnnotateContext } from './channel';
import { layerEditable, measureEnd, NOTE_GHOST_ID } from './note-edits';

/** A measurement's opening draft at `p`: both ends on the one step cell. */
function firstEnd(p: MacroCoord, id: string, ctx: AnnotateContext): MeasureNote {
  const cell = noteStepCell(p);
  return { kind: 'measure', id, points: [cell, { ...cell }], color: ctx.arming.annotationColor };
}

export class MeasureGesture {
  /** The cell the open draft's press landed on, until its release. */
  private press: MacroCoord | null = null;

  down(p: MacroCoord, ctx: AnnotateContext): void {
    if (!layerEditable(ctx)) return;
    const cell = noteStepCell(p);
    const draft = ctx.arming.notes.draft;
    if (draft?.kind === 'measure') {
      this.finish({ ...draft, points: [draft.points[0], measureEnd(draft.points[0], p)] }, ctx);
      return;
    }
    ctx.annotationEdit.select([]);
    ctx.annotationEdit.begin();
    this.press = cell;
    ctx.annotationEdit.setDraft(firstEnd(p, generateAnnotationId(), ctx));
  }

  /** The first end a press at `p` would lay; null once a draft stands, whose far end already
   *  follows the pointer with its line and length. */
  ghost(p: MacroCoord, ctx: AnnotateContext): MeasureNote | null {
    if (ctx.arming.notes.draft?.kind === 'measure') return null;
    return firstEnd(p, NOTE_GHOST_ID, ctx);
  }

  /** Follows the pointer with the draft's far end. */
  move(p: MacroCoord, ctx: AnnotateContext): void {
    const draft = ctx.arming.notes.draft;
    if (draft?.kind !== 'measure' || ctx.state.annotations?.locked || ctx.state.annotations?.visible === false) return;
    const cell = measureEnd(draft.points[0], p);
    if (draft.points[1].x === cell.x && draft.points[1].y === cell.y) return;
    ctx.annotationEdit.setDraft({ ...draft, points: [draft.points[0], cell] });
  }

  /** A release away from the press ends the measurement there; a release on it waits for a second tap. */
  up(p: MacroCoord, ctx: AnnotateContext): void {
    const draft = ctx.arming.notes.draft;
    if (this.press && draft?.kind === 'measure') {
      const end = measureEnd(draft.points[0], p);
      if (end.x !== this.press.x || end.y !== this.press.y) this.finish({ ...draft, points: [draft.points[0], end] }, ctx);
    }
    this.press = null;
  }

  /** Drops the open draft; false when none stands. */
  cancel(ctx: AnnotateContext): boolean {
    if (ctx.arming.notes.draft?.kind !== 'measure') return false;
    this.press = null;
    ctx.annotationEdit.setDraft(null);
    return true;
  }

  /** Delete: takes the open draft back as its own undo step; false when none stands. */
  undoStep(ctx: AnnotateContext): boolean {
    if (ctx.arming.notes.draft?.kind !== 'measure') return false;
    ctx.annotationEdit.begin();
    ctx.annotationEdit.setDraft(null);
    this.press = null;
    return true;
  }

  drop(): void {
    this.press = null;
  }

  private finish(note: MeasureNote, ctx: AnnotateContext): void {
    this.press = null;
    ctx.annotationEdit.setDraft(null);
    if (!layerEditable(ctx)) return;
    ctx.annotationEdit.apply((data) => { data.items.push(note); });
    ctx.annotationEdit.select([note.id]);
  }
}
