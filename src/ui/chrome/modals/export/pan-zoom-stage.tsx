/*
 * The parts a `usePanZoom` stage draws over its picture: the hairline outline, painted after the
 * picture so it reads all the way round a panned or zoomed view, and the transient reset hint.
 */
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { exitTransition, font, radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin } from '../../../design/window-skin';

/** A sibling overlay rather than the stage's own box-shadow, which would paint under the picture. */
export const stageOutline: CSSProperties = { position: 'absolute', inset: 0, borderRadius: radii.lg, boxShadow: `inset 0 0 0 1.5px ${skin.line}`, pointerEvents: 'none' };

const hintPill: CSSProperties = { position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', ...roleFont('caption'), color: skin.plateInk, background: skin.plate, borderRadius: radii.pill, padding: '3px 11px', whiteSpace: 'nowrap', pointerEvents: 'none', fontFamily: font.family };

/** Hidden at rest; shown once the view has moved, until a quiet spell or a reset. */
export function PanZoomResetHint({ show }: { show: boolean }) {
  const t = useT();
  return (
    <AnimatePresence>
      {show && (
        <motion.div key="reset-hint" style={hintPill}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: exitTransition }}>
          {t('export.preview_reset_hint')}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
