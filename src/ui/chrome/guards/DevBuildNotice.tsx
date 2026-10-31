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
import { useReveal } from '../../primitives/use-reveal';
import { useLayoutShape } from '../../design/input-mode';
import type { CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { timedHint } from '../timed-hint';
import { APP_VERSION, IS_DEV_BUILD } from '../../../platform/build/build-info';
import { LEGAL } from '../../../legal/config';
import { TimedButton } from '../../primitives/TimedButton';
import { TouchReach } from '../../primitives/TouchReach';
import { useGlidingChromeScale } from '../../design/scale';
import { font, z } from '../../design/styles';
import { roleWeight, roleFont } from '../../design/text-weight';
import { NoticeBar, noticeActionStyle, useNoticeZoom } from '../../primitives/NoticeBar';
import { useChromeLayer } from '../../primitives/chrome-layer';
import { MAP_LABEL, FRAME_INK } from '../../design/tokens';
import { ARRIVAL_ROW, arrivalRow, arrivalTop, fromChromePx, toastRow, uprightArrivalTop } from '../floating/toast-band';
import { useMorph } from '../../primitives/morph';

/**
 * How far down the notice hangs: the toast band's third row, below the refusal toasts and the
 * arrival greeting, which appear at the same boot moment top-centre (`floating/toast-band` keeps
 * the three stacked). In chrome-zoom px like the other two tenants, so the air under the greeting's
 * foot scales with them and never closes. The greeting's
 * row is the one it measures (`toast-band.ts:arrivalRow`), larger when touch mode lifts its zoom or
 * its answers wrap; `row` stands in until it does. `refusals` is the refusals' row in chrome px.
 */
function noticeTop(row: number, refusals: number): string {
  return `calc(${arrivalTop(refusals)} + ${arrivalRow(row)})`;
}

/** Upright, the greeting stands under the frame's top row, and the notice one row under it. */
function uprightNoticeTop(row: number, refusals: number): string {
  return `calc(${uprightArrivalTop(refusals)} + ${arrivalRow(row)})`;
}

const linkStyle: CSSProperties = {
  position: 'relative',
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
  const watermark = useMorph('dev-watermark');
  const [dismissed, setDismissed] = useState(false);

  if (!IS_DEV_BUILD) return null;

  return (
    <>
      <AnimatePresence>
        {!dismissed && <DevNotice key="notice" onDismiss={() => setDismissed(true)} />}
      </AnimatePresence>
      <div style={{ ...layer, ...watermarkStyle }} data-testid="dev-watermark" {...watermark} aria-hidden>
        {t('dev.watermark')} {APP_VERSION}
      </div>
    </>
  );
}

/** The notice itself, mounted only while it stands, so a dismissed one hears no scale change. */
function DevNotice({ onDismiss }: { onDismiss: () => void }) {
  const t = useT();
  const morph = useMorph('dev-notice');
  const chrome = useGlidingChromeScale();
  // The notice draws at its card's zoom, which touch mode can raise past the chrome's; its place is
  // worked out in chrome px and converted to its own.
  const zoom = useNoticeZoom();
  const ratio = chrome / zoom;
  const row = ARRIVAL_ROW / ratio;
  const refusals = toastRow(ratio);
  const upright = useLayoutShape() === 'portrait';
  // A hold pauses the countdown; the press still lands.
  const { shown: reading, bind: readingBind } = useReveal({ keepsClick: true });

  return (
    <NoticeBar
      role="status"
      data-testid="dev-notice"
      {...morph}
      edge="top"
      offset={fromChromePx(upright ? uprightNoticeTop(row, refusals) : noticeTop(row, refusals), ratio)}
      stripe
      travel={12}
      {...readingBind}
    >
      <span>
        {t('dev.notice')}{' '}
        <a style={linkStyle} href={LEGAL.canonicalOrigin} target="_blank" rel="noopener noreferrer">
          {t('dev.notice_cta')} ↗
          <TouchReach zoom={zoom} />
        </a>
      </span>
      <TimedButton
        after={NOTICE_SECONDS}
        hint={timedHint(t, NOTICE_SECONDS)}
        paused={reading}
        style={noticeActionStyle}
        onPress={onDismiss}
        aria-label={t('dev.notice_dismiss')}
        data-testid="dev-notice-dismiss"
      >
        {t('dev.notice_dismiss')}
        <TouchReach zoom={zoom} />
      </TimedButton>
    </NoticeBar>
  );
}
