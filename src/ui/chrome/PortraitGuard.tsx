import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import { useOverlayLock } from '../hooks/useOverlayLock';
import { usePortraitGuard } from './portrait-guard';
import { colors, cozyOverlay, cozyPanel, font, springs, exitTransition, z } from '../styles';

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
  width: 'min(88vw, 380px)',
  padding: '32px 28px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 14,
};

const iconWrap: CSSProperties = {
  color: colors.accentPrimary,
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
  fontSize: 12.5,
  fontWeight: 600,
  color: colors.textSecondary,
  opacity: 0.75,
};

/** A phone rotating into landscape — stroke icon in `currentColor`, matching `glyph-icons.tsx`. */
function RotateIcon() {
  return (
    <svg width={56} height={56} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="13" height="9" rx="1.6" />
      <path d="M18 4a5 5 0 0 1 3 4.2" />
      <path d="M21 8.2h-3.4V5" />
    </svg>
  );
}

export function PortraitGuard() {
  const t = useT();
  const { blocked, dismiss } = usePortraitGuard();
  useOverlayLock(blocked);

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
            <div style={iconWrap}><RotateIcon /></div>
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
