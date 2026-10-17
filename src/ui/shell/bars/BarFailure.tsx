/** What the bottom bar slot shows once its bar has failed to render: the shelves' band with the
 *  failure and a retry across it, so the slot keeps its place and the map above it stays usable. */
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { presence } from '../../design/motion';
import { btnReset, cursors, radii, z } from '../../design/styles';
import { PLATE, PLATE_INK } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { PLATE_BAND, SHELF_TABS, TEXT } from '../units';
import { BarText } from './bar-atoms';
import { ShelfBand } from './ShelfBand';

export function BarFailure({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div
      role="alert"
      data-testid="bar-failed"
      {...mapEdgeAttr('bottom')}
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: z.panel, pointerEvents: 'none' }}
    >
      <ShelfBand />
      <motion.div
        {...presence('notice.arrive', { opacity: 0 })}
        style={{
          position: 'relative', height: PLATE_BAND.top,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', justifyContent: 'center',
          gap: SHELF_TABS.gap, padding: `0 ${SHELF_TABS.left}px`,
        }}
      >
        <BarText size={TEXT.head} onMap>{t('guard.surface_failed')}</BarText>
        <ActionButton
          interaction="action"
          data-testid="bar-retry"
          onClick={onRetry}
          style={{
            ...btnReset, pointerEvents: 'auto', cursor: cursors.clickable, borderRadius: radii.pill,
            height: SHELF_TABS.field, padding: `0 ${SHELF_TABS.padX}px`, background: PLATE,
          }}
        >
          <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('guard.retry')}</BarText>
        </ActionButton>
      </motion.div>
    </div>
  );
}
