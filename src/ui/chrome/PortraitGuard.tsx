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
 * The turn itself: ONE phone, caught mid-rotation, with an arc sweeping it toward landscape.
 *
 * One device that is visibly turning says "rotate" on its own; two phones and an arrow between them
 * read as a before/after diagram, which needs the caption to explain it. The body is tilted a third
 * of the way through the quarter turn — enough to be unmistakably in motion, not so far that it
 * stops reading as upright. Stroke icon in `currentColor`, matching `glyph-icons.tsx`.
 */
function RotateIcon() {
  return (
    <svg width={76} height={76} viewBox="0 0 48 48" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* The sweep, struck around the phone's own centre so the motion belongs to the device
          rather than floating beside it. Open at the bottom, where the hand is. */}
      <path d="M11.2 31.5A15 15 0 0 1 18.6 9.9" opacity={0.55} />
      <path d="M18.6 9.9 15.1 9.2M18.6 9.9 18.2 13.5" opacity={0.55} />
      <path d="M36.8 16.5a15 15 0 0 1-7.4 21.6" opacity={0.55} />
      <path d="M29.4 38.1l3.5.7M29.4 38.1l.4-3.6" opacity={0.55} />
      {/* The device, a third of the way through the quarter turn. */}
      <g transform="rotate(-30 24 24)">
        <rect x="17.5" y="13" width="13" height="22" rx="3" />
        <path d="M21.8 16.4h4.4" />
        <path d="M22.6 31.3h2.8" opacity={0.5} />
      </g>
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
