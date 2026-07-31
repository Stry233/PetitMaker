import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import { useOverlayLock } from '../hooks/useOverlayLock';
import { usePortraitGuard } from './portrait-guard';
import { useEditorStore } from '../../state/store';
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

// The panel's own ink. `accentPrimary` reaches 1.7:1 on this cream and the icon read as a smudge.
const iconWrap: CSSProperties = {
  color: colors.frameDark,
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

/**
 * The turn itself: the phone you are holding, faded, an arrow, and the phone you want. A single
 * landscape phone cannot say "rotate" — it shows the destination and leaves the instruction to the
 * text. Stroke icon in `currentColor`, matching `glyph-icons.tsx`.
 */
function RotateIcon() {
  return (
    <svg width={84} height={50} viewBox="0 0 40 24" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g opacity={0.38}>
        <rect x="3" y="2.5" width="11" height="19" rx="2.4" />
        <path d="M6.8 5.6h3.4" />
      </g>
      <path d="M16.6 8.4A7.4 7.4 0 0 1 23.4 4.2" />
      <path d="M23.4 4.2 20.7 2.7M23.4 4.2 22 7" />
      <rect x="24" y="7.5" width="13" height="9.6" rx="2.4" />
      <path d="M27.1 10.6v3.4" />
    </svg>
  );
}

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
