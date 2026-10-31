/** What the bottom bar slot shows once its bar has failed to render: the shelves' band with the
 *  failure and a retry across it, so the slot keeps its place and the map above it stays usable.
 *  Upright, it is the dark panel the bar raises. */
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { presence } from '../../design/motion';
import { btnReset, cursors, radii } from '../../design/styles';
import { PLATE, PLATE_INK } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { SHELF_TABS, TEXT, UPRIGHT_SPACE } from '../units';
import { BarText } from './bar-atoms';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameZoom } from '../use-frame-zoom';
import { PanelTone, useBarSurface } from './bar-panel';

export function BarFailure({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const zoom = useFrameZoom();
  const { upright, bar, root, tone, band, content } = useBarSurface('dark');
  return (
    <div role="alert" data-testid="bar-failed" {...mapEdgeAttr('bottom')} {...root}>
      <PanelTone tone={tone}>
        {band}
        <motion.div
          {...content.centre}
          {...presence('notice.arrive', { opacity: 0 })}
          style={{
            position: 'relative',
            // Upright, the panel is as tall as its row on the bar's spacing scale.
            ...(upright
              ? { rowGap: UPRIGHT_SPACE.row }
              : { height: bar.height, padding: `0 ${SHELF_TABS.left}px` }),
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', justifyContent: 'center',
            columnGap: SHELF_TABS.gap, ...(upright ? {} : { rowGap: SHELF_TABS.gap }),
          }}
        >
          <BarText size={TEXT.head} onMap>{t('guard.surface_failed')}</BarText>
          <ActionButton
            interaction="action"
            data-testid="bar-retry"
            onClick={onRetry}
            style={{
              ...btnReset, position: 'relative', pointerEvents: 'auto', cursor: cursors.clickable, borderRadius: radii.pill,
              height: SHELF_TABS.field, padding: `0 ${SHELF_TABS.padX}px`, background: PLATE,
            }}
          >
            <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('guard.retry')}</BarText>
            <TouchReach zoom={zoom} />
          </ActionButton>
        </motion.div>
      </PanelTone>
    </div>
  );
}
