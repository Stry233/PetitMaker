/** The delete target the unfold control stands as while a card or stack is carried: a drop there
 *  deletes what is carried (`use-blueprint-carry.ts`). It is no control, only where a carry can end. */
import type { CSSProperties, ReactNode } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { cssMotion } from '../../../design/motion';
import { ERROR, ON_DARK, PLATE, plateShapeEdge, rgbaOf } from '../../../design/tokens';
import { Away } from '../../../primitives/away';
import { TrashIcon } from '../../../primitives/line-glyphs';
import { ACTION_GROWS } from './BlueprintCard';
import { BLUEPRINT_BIN_ATTR } from './use-blueprint-carry';

/** How much red the cream plate takes at rest, so the target reads as a pale red plate with a red glyph. */
const REST_RED = 0.3;

/** The delete target on the shelf's plate: pale red with a red glyph at rest; with something carried
 *  over it, the red plate itself with a white glyph, grown as a hovered action grows. */
export function BinSquare({ over, width, height, radius, glyph, piece, style }: {
  over: boolean; width: number; height: number; radius: number; glyph: number;
  piece?: Record<string, string>; style?: CSSProperties;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  return (
    <div {...piece} {...{ [BLUEPRINT_BIN_ATTR]: '' }} data-testid="shell-blueprint-bin" role="img" aria-label={t('blueprint.delete')}
      style={{
        position: 'absolute', left: 0, top: 0, width, height, boxSizing: 'border-box', borderRadius: radius, pointerEvents: 'auto',
        background: over ? ERROR : PLATE, boxShadow: plateShapeEdge(), color: over ? ON_DARK : ERROR,
        transform: over ? `scale(${ACTION_GROWS})` : 'none', transition: cssMotion('control.drop', ['background-color', 'color', 'transform'], reduced),
        display: 'flex', alignItems: 'center', justifyContent: 'center', ...style,
      }}>
      <span aria-hidden style={{
        position: 'absolute', inset: 0, borderRadius: radius, background: rgbaOf(ERROR, REST_RED), opacity: over ? 0 : 1,
        transition: cssMotion('control.drop', ['opacity'], reduced),
      }} />
      <span style={{ position: 'relative', display: 'flex' }}><TrashIcon size={glyph} /></span>
    </div>
  );
}

/** One of two faces standing in one place, which crossfade where they stand as a carry starts and
 *  ends (the unfold square and the delete target, upright New folder and search and the delete
 *  target): shown, or faded out and then hidden, and put away from the fade's first frame, so nothing
 *  presses, focuses or reads it as it goes. `style` places it. */
export function SwapFace({ shown, style, children }: { shown: boolean; style?: CSSProperties; children: ReactNode }) {
  const reduced = useReducedMotionConfig();
  return (
    <Away away={!shown} style={{
      ...style, opacity: shown ? 1 : 0, visibility: shown ? undefined : 'hidden',
      transition: cssMotion('control.fade', ['opacity', 'visibility'], reduced),
    }}>
      {children}
    </Away>
  );
}
