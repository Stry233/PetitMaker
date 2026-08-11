/*
 * eraser-shape-glyph.tsx — what one eraser gesture takes back, drawn and named.
 *
 * The eraser's shape is a SETTING on the tool rather than a tool of its own: the dab and the two
 * drag figures are one eraser answering a press differently, so they cycle inside its cell the way
 * auto-trim does inside a build cell. The three facts a control needs — what comes next, what each
 * state takes, and the key that names it — are data, so they sit here where a test can read them
 * without mounting the chip.
 *
 * The name keys are a TABLE, not `'eraser.' + shape`: a key assembled at runtime is one no search
 * finds and no missing-string check can enumerate.
 */
import type { EraserShape } from '../../../core/model/types';

/** The dab first, since it is the eraser as it has always been, then the two batch figures. */
export const ES_NEXT: Record<EraserShape, EraserShape> = { dot: 'rect', rect: 'circle', circle: 'dot' };

/** What each state is called. */
export const ES_STATE_KEY: Record<EraserShape, string> = {
  dot: 'eraser.dot',
  rect: 'eraser.rect',
  circle: 'eraser.circle',
};

/**
 * The footprint each state takes: the brush's own dab, a dragged rectangle, a dragged circle.
 *
 * The dab is drawn SOLID and the two drag figures hollow, which is the same reading auto-trim's
 * glyphs give: a solid mark is the thing itself, an outline is the region a drag will enclose.
 */
export function eraserShapeGlyph(shape: EraserShape, size: number, color: string) {
  const common = { width: size, height: size, viewBox: '0 0 24 24' };
  if (shape === 'rect') {
    return <svg {...common}><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" fill="none" stroke={color} strokeWidth="2.5" /></svg>;
  }
  if (shape === 'circle') {
    return <svg {...common}><circle cx="12" cy="12" r="8.25" fill="none" stroke={color} strokeWidth="2.5" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="4.5" fill={color} /></svg>;
}
