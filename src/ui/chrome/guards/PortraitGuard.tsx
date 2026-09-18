import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useOverlayLock } from '../../hooks/useOverlayLock';
import { usePortraitGuard } from './portrait-guard';
import { useEditorStore } from '../../../state/store';
import { Icon } from '../../primitives/icons';
import { colors, cozyOverlay, font, springs, exitTransition, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { cozyPanel } from '../../design/window-skin';

/**
 * Full-screen "please rotate" cover for a phone/tablet held in portrait (see `portrait-guard.ts`
 * for why this can never fire on a desktop). NOT a `ModalShell`: that shell wires click-outside and
 * Escape to dismiss, and the only way through here is the `portrait.continue` button.
 *
 * Sits at `z.guard`, above every other layer including the context menu, and `useOverlayLock`
 * suppresses the map's global keyboard shortcuts while it is shown, so the editor underneath is
 * inert to both pointer and keyboard.
 */
const overlay: CSSProperties = {
  ...cozyOverlay,
  zIndex: z.guard,
};

const panel: CSSProperties = {
  ...cozyPanel,
  width: '88vw', maxWidth: 380,
  padding: '32px 28px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 14,
};

const title: CSSProperties = {
  ...font.h1,
  color: colors.frameDark,
};

const body: CSSProperties = {
  ...font.body,
  color: colors.textSecondary,
};

const continueBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: '4px 8px',
  marginTop: 4,
  fontFamily: font.family,
  ...roleFont('caption'),
  color: colors.textSecondary,
  opacity: 0.75,
};

/** The design source's own drawing: one phone caught mid-turn between two arrows. */
const ICON_SIZE = 76;

export function PortraitGuard() {
  const t = useT();
  const { blocked, dismiss } = usePortraitGuard();
  useOverlayLock(blocked);

  // The one writer of the store's mirror: this is the only component holding the live
  // media-query + dismiss state, so anything elsewhere that needs to know (the tour's gate)
  // reads the store instead of running a second, independently-dismissable subscription.
  const setPortraitBlocked = useEditorStore((s) => s.setPortraitBlocked);
  useEffect(() => { setPortraitBlocked(blocked); }, [blocked, setPortraitBlocked]);

  return (
    <AnimatePresence>
      {blocked && (
        <motion.div
          style={overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: exitTransition }}
          transition={springs.stiff}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="portrait-guard-title"
            aria-describedby="portrait-guard-body"
            data-testid="portrait-guard"
            style={panel}
            initial={{ scale: 0.92, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 10, transition: exitTransition }}
            transition={springs.stiff}
          >
            <Icon name="portrait-rotate" size={ICON_SIZE} />
            <div id="portrait-guard-title" style={title}>{t('portrait.title')}</div>
            <div id="portrait-guard-body" style={body}>{t('portrait.body')}</div>
            <button type="button" style={continueBtn} onClick={dismiss}>
              {t('portrait.continue')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
