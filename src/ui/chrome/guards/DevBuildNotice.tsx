/**
 * Dev-build signposting: a notice on arrival and a standing watermark, both shown only when
 * `IS_DEV_BUILD`. That flag comes from the version (a build carries `-dev` unless the publish
 * workflow stamped a release marker), so the dev site, local builds and checkouts all signpost
 * themselves and a published snapshot never does.
 *
 * The notice shows on every page load and its dismissal is not persisted, so a returning visitor is
 * told again. It dismisses itself (`TimedButton`); the countdown holds while the pointer is
 * anywhere on the card, since reading happens over the sentence and the dismiss is at its far end.
 *
 * The watermark stands above everything (`z.unmissable`): it is DOM, so it never reaches an
 * exported image (exports render the Pixi scene), and `pointerEvents: none`, so it never takes a
 * click. A panel that could cover it would hide which build this is.
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { timedHint } from '../timed-hint';
import { APP_VERSION, IS_DEV_BUILD } from '../../../platform/build/build-info';
import { LEGAL } from '../../../legal/config';
import { TimedButton } from '../../primitives/TimedButton';
import { font, z } from '../../design/styles';
import { roleWeight, roleFont } from '../../design/text-weight';
import { NoticeBar, noticeActionStyle } from '../../primitives/NoticeBar';
import { useChromeLayer } from '../../primitives/chrome-layer';
import { MAP_LABEL, FRAME_INK } from '../../design/tokens';
import { ARRIVAL_ROW, TOAST_BAND_ROW, TOAST_BAND_TOP, bandTop } from '../floating/toast-band';

/**
 * How far down the notice hangs: the toast band's third row, below the refusal toasts and the
 * arrival greeting, which appear at the same boot moment top-centre (`floating/toast-band` keeps
 * the three stacked). In chrome-zoom px like the other two tenants, so the ledger's 12px of air
 * between the greeting's foot (187) and this (199) scales with them and never closes.
 */
const NOTICE_TOP = TOAST_BAND_TOP + TOAST_BAND_ROW + ARRIVAL_ROW;

const linkStyle: CSSProperties = {
  color: FRAME_INK,
  fontWeight: roleWeight('small'),
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  whiteSpace: 'nowrap',
};

/** Seconds the notice stands before it dismisses itself when nobody is pointing at it; a reader's
 *  pointer on the card holds the clock. */
const NOTICE_SECONDS = 10;

/*
 * The standing watermark. Its rung means nothing covers it, but the window's bottom is where a
 * full-width `DARK_PLATE` shelf sits, on which dark ink at a third of its strength is invisible.
 * So it wears `MAP_LABEL`'s treatment, pale ink with a dark edge, at the least strength that reads
 * on both map and plate.
 */
const watermarkStyle: CSSProperties = {
  position: 'fixed',
  bottom: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: z.unmissable,
  pointerEvents: 'none',
  userSelect: 'none',
  fontFamily: font.family,
  ...roleFont('small'),
  letterSpacing: '0.12em',
  ...MAP_LABEL,
  opacity: 0.62,
  whiteSpace: 'nowrap',
};

export function DevBuildNotice() {
  const t = useT();
  const layer = useChromeLayer();
  const [dismissed, setDismissed] = useState(false);
  const [reading, setReading] = useState(false);

  if (!IS_DEV_BUILD) return null;

  return (
    <>
      <AnimatePresence>
        {!dismissed && (
          <NoticeBar
            role="status"
            data-testid="dev-notice"
            edge="top"
            offset={bandTop(NOTICE_TOP)}
            stripe
            travel={12}
            onPointerEnter={() => setReading(true)}
            onPointerLeave={() => setReading(false)}
          >
            <span>
              {t('dev.notice')}{' '}
              <a style={linkStyle} href={LEGAL.canonicalOrigin} target="_blank" rel="noopener noreferrer">
                {t('dev.notice_cta')} ↗
              </a>
            </span>
            <TimedButton
              after={NOTICE_SECONDS}
              hint={timedHint(t, NOTICE_SECONDS)}
              paused={reading}
              style={noticeActionStyle}
              onPress={() => setDismissed(true)}
              aria-label={t('dev.notice_dismiss')}
              data-testid="dev-notice-dismiss"
            >
              {t('dev.notice_dismiss')}
            </TimedButton>
          </NoticeBar>
        )}
      </AnimatePresence>
      <div style={{ ...layer, ...watermarkStyle }} data-testid="dev-watermark" aria-hidden>
        {t('dev.watermark')} {APP_VERSION}
      </div>
    </>
  );
}
