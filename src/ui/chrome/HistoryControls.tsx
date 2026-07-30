import { motion } from 'framer-motion';
import { pressable, cursors } from '../styles';
import { useT } from '../../i18n/context';
import { usePressRepeat } from '../usePressRepeat';
import { FloatingCluster, floatingBtn } from './FloatingCluster';
import { IconUndo, IconRedo } from './glyph-icons';

export interface HistoryControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function HistoryControls({ canUndo, canRedo, onUndo, onRedo }: HistoryControlsProps) {
  const t = useT();
  // Hold-to-repeat: undo/redo step through history while the button is held.
  // canRepeat gates each tick so we stop the moment there's nothing left.
  const undoPress = usePressRepeat({ action: onUndo, canRepeat: () => canUndo, intervalMs: 110 });
  const redoPress = usePressRepeat({ action: onRedo, canRepeat: () => canRedo, intervalMs: 110 });
  return (
    <FloatingCluster corner="bottom-left" direction="row">
      <motion.button
        style={{ ...floatingBtn, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? cursors.clickable : cursors.blocked }}
        disabled={!canUndo}
        aria-label={t('a11y.undo')}
        title={`${t('a11y.undo')} (Ctrl+Z)`}
        {...(canUndo ? pressable : {})}
        {...undoPress}
      >
        <IconUndo />
      </motion.button>
      <motion.button
        style={{ ...floatingBtn, opacity: canRedo ? 1 : 0.4, cursor: canRedo ? cursors.clickable : cursors.blocked }}
        disabled={!canRedo}
        aria-label={t('a11y.redo')}
        title={`${t('a11y.redo')} (Ctrl+Shift+Z)`}
        {...(canRedo ? pressable : {})}
        {...redoPress}
      >
        <IconRedo />
      </motion.button>
    </FloatingCluster>
  );
}
