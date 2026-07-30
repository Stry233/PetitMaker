/**
 * About modal — a two-view drill-in.
 *
 *  - View A (About): a brand block that anchors the eye (app name + tagline +
 *    one muted version line), the Legal & policies grid as the primary action
 *    area (icon + label + chevron drill-in rows), the configured filing rows,
 *    a compact names-only team line, and a receding fan-project disclaimer +
 *    source/© footer.
 *  - View B (Document): `LegalDocView`, lazily imported so the legal bundle
 *    (registry + every ?raw doc body + markdown parser/emitter) stays out of
 *    the main chunk until a user opens a doc.
 *
 * Motion — a WIDTH-ONLY MORPH. The two views share ONE card that animates its
 * WIDTH between them (the house `springs.stiff`) from View A's width to View
 * B's while the content cross-fades inside, and `overflow:hidden` on the card
 * clips everything so nothing renders outside the boundary during a morph, a
 * crossfade, or the exit. Width is per-view (ABOUT_WIDTH / DOC_WIDTH); HEIGHT
 * IS CONSTANT across both views — the card always sits at View A's measured
 * height (`measureAboutHeight`, capped at ABOUT_MAX_VH), and the doc view
 * simply fills that fixed height, scrolling its own body internally
 * (`LegalDocView`'s pinned header/footer + inner `data-scroll` region). Height
 * is measured only while View A is showing (mount + a `ResizeObserver` on the
 * About surface) — a locale change while on About still resizes the card, but
 * switching to/from the doc view never retargets it, so the two views can
 * never desync on height. `ModalShell` puts width (and this fixed height) on
 * `animate` only (never `initial`), so an open never morphs; each open's first
 * estimate→measured correction is a hard snap (`sizeReady`, RE-ARMED on every
 * close so a stale measurement carried over from a prior open can't spring-
 * morph into place on the next one — see `sizeReady`'s reset effect), and
 * reduced motion snaps all size changes.
 *
 * The whole modal still enters/exits as ONE unit — App keeps this component
 * mounted and drives `open`, so `ModalShell`'s own `AnimatePresence` owns the
 * card enter AND exit. The INNER `AnimatePresence` cross-fades the A↔B view
 * SWITCH (pure opacity; both views are absolutely positioned so they overlap);
 * a close would otherwise propagate exit DOWN and float the current view free of
 * the card, so we gate the inner `exit` on `ModalShell`'s `exiting` signal (the
 * render-prop `(exiting) => …`) — while the shell closes the frozen view rides
 * the card out in lockstep. The card WIDTH is frozen on exit too: the
 * measurement effect is gated on `open`, so a close never retargets the morph
 * mid-exit. Reopening resets to View A. The exiting view also gets
 * `pointerEvents:'none'` so it can't steal a click while it fades.
 */

import { useState, useRef, useEffect, useLayoutEffect, Suspense, lazy, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { font, colors, radii, springs, shadows, exitTransition, modalRow, buttonMotion, primaryButton, btnReset, cursors } from '../styles';
import { APP_NAME, APP_VERSION, BUILD_NUMBER, BUILD_SHA, BUILD_DATE } from '../../version';
import { ModalShell } from './ModalShell';
import { useChromeScale } from '../menu/scale';
import { LoadingDots } from '../menu/LoadingDots';
import { DOCS, docIdForPath, teamInReadingOrder, type DocId } from '../../legal/registry';
import { DocIcon } from '../../legal/doc-icons';
import { LEGAL } from '../../legal/config';
import { teamAvatarUrl } from '../../legal/team-avatars';

const LegalDocView = lazy(() => import('../../legal/LegalDocView'));

export interface AboutModalProps {
  /** Drives the shared `ModalShell` open/close choreography. Defaults to `true`
   *  so tests can mount the modal directly; App passes `open={showAbout}` and
   *  keeps the component mounted so the card exit animates as one unit. */
  open?: boolean;
  onClose: () => void;
}

type View = { kind: 'about' } | { kind: 'doc'; id: DocId };

// WIDTH-ONLY MORPH. View A (About) and View B (doc) each want their own
// width: the composed About surface reads best in a narrower column, the doc
// reader in a wider one. Rather than freeze ONE width (which flattened the
// proportions) or SNAP between two (an unanimated jump that desynced from the
// content crossfade), the card MORPHS its width between the two views while
// the content cross-fades inside, everything clipped to the card
// (`overflow:hidden`). HEIGHT DOES NOT MORPH — it stays constant at View A's
// measured height (capped at ABOUT_MAX_VH via `ModalShell`'s maxVh
// mechanics); the doc view fills that fixed height and scrolls internally.
const ABOUT_WIDTH = 440;
const DOC_WIDTH = 640;
const ABOUT_MAX_VH = 88;

// Definite height fed for the very first paint, before View A's real height
// has been measured (see `cardHeight` below) — the modal always opens on
// View A, so this only ever backstops About's own first frame.
const ESTIMATE_HEIGHT = 480;

// The morph spring for the width (and, incidentally, the shared card height
// value — but height never actually changes across an A↔B switch, so in
// practice this only ever animates width). `springs.stiff` is the house
// snappy spring the card entrance already uses — a resize should feel as
// crisp as the open, not floaty.
const MORPH_SPRING = springs.stiff;

// Measure View A's natural (content) height so the card can size to it. The
// About view IS its own scroll container (`data-scroll` on itself, `height:
// auto`), so its natural height is simply its full scrollHeight — independent
// of whatever height the card currently has. Clamped to the same cap
// ModalShell enforces in CSS, so a long About view settles exactly at the cap
// (no invisible spring overshoot). This is the ONLY height ever measured —
// the doc view (View B) always reuses this value; see the file-header note.
function measureAboutHeight(view: HTMLElement, capPx: number): number {
  return Math.min(view.scrollHeight, capPx);
}

// The drill-in doc rows, in reading order. The `about` doc is deliberately
// omitted — View A itself IS the About surface (brand + team + filing).
const GRID_DOCS: DocId[] = [
  'privacy',
  'terms',
  'license',
  'third-party',
  'asset-licenses',
  'security',
  'contact',
  'changelog',
];

// The card is the morphing box: `position:relative` anchors the two absolutely-
// positioned views, `overflow:hidden` clips them (and the rounded corners) so
// nothing can render outside the card during a morph/crossfade/exit.
const cardStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  padding: 0,
};

// Both views are absolutely positioned so they OVERLAP for the crossfade and so
// neither one's height feeds back into the card (the card height is the measured
// value we morph to, not the sum of two stacked views). Each view fills the
// card HEIGHT (top:0 + height:100%) and carries its OWN fixed WIDTH — the width
// is fixed (not 100%) so the content doesn't reflow while the card width morphs
// (reflow would change the measured height and make the morph chase itself); the
// wider view is simply clipped by the card until the width catches up.
const viewBase: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  // border-box so the fixed width INCLUDES the scroll padding (there is no
  // global box-sizing reset) — otherwise the padded About view is `width +
  // padding` wide and overflows the equally-wide card.
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

/* The doc view fills the card; LegalDocView pins its own header/footer and
 * scrolls its body internally. */
const docView: CSSProperties = {
  ...viewBase,
  width: DOC_WIDTH,
};

// The About view IS its own scroll container (`data-scroll`). Unlike the doc
// (which fills the card so its pinned header/footer can bound an internal
// scroll), the About surface is `height:auto` — so its measured height is the
// NATURAL content height, INDEPENDENT of the card's current height. (With
// height:100% it would just report back whatever height the card already has,
// which is exactly the value it's supposed to be producing.) A `maxHeight`
// cap (applied inline with the live chrome scale) lets a tall About scroll.
// Breathing room: SettingsModal's 28px gutter with a roomier vertical rhythm so
// the brand block, the grid, and the footer read as distinct, unhurried zones.
const aboutScroll: CSSProperties = {
  ...viewBase,
  height: 'auto',
  width: ABOUT_WIDTH,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '32px 28px 28px',
  gap: 26,
};

/* ── Brand block (the anchor) ─────────────────────────────── */

const brandBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 5,
};

const brandLogo: CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: radii.lg,
  objectFit: 'contain',
  marginBottom: 2,
};

const appNameStyle: CSSProperties = {
  fontFamily: font.family,
  fontWeight: 900,
  fontSize: 30,
  color: colors.frameDark,
  textAlign: 'center',
  lineHeight: 1.05,
};

// `colors.textSecondary` fails WCAG AA (~3.9:1) against `panelCream` at this size —
// `colors.brownText` is the darkest muted/taupe token and passes (~5.4:1).
// See src/__tests__/legal/a11y.test.tsx's contrast describe block.
const taglineStyle: CSSProperties = {
  fontFamily: font.family,
  fontWeight: 600,
  fontSize: 13,
  color: colors.brownText,
  textAlign: 'center',
};

// One muted line, no card — the version recedes below the brand. (AA swap as above.)
const versionLine: CSSProperties = {
  fontFamily: font.family,
  fontSize: 11.5,
  fontWeight: 600,
  color: colors.brownText,
  textAlign: 'center',
  marginTop: 3,
  opacity: 0.85,
  letterSpacing: '0.01em',
};

// The version line as a click target — `btnReset` strips native button chrome
// so the visual stays IDENTICAL to the plain text it replaces; hover/press
// nudge opacity a step brighter/dimmer (buttonMotion's scale would jitter a
// full-width text line's layout, so this uses the "subtle opacity step"
// alternative the row's siblings already lean on elsewhere in the app).
const versionButton: CSSProperties = {
  ...btnReset,
  ...versionLine,
  marginTop: 3,
  display: 'inline-block',
};

// Wraps the button so the confirmation bubble has a positioning root without
// disturbing the button's own centered layout in `brandBlock`.
const versionButtonWrap: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

// The floating "Copied" bubble — cream surface + ink text + a hairline ring,
// espresso-tinted shadow (house tokens, same family as the floating cozy
// buttons). Positioned via layout (left 50% + bottom 100%); centering is done
// by Framer's `x: '-50%'` (kept constant across initial/animate/exit — see
// Slider.tsx for the same pattern), never a CSS `transform`, per the
// button-jump rule. `pointerEvents: none` so it never steals a click/hover
// from the row underneath.
const copiedBubble: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '100%',
  marginBottom: 8,
  background: colors.panelCream,
  color: colors.frameDark,
  border: `1px solid ${colors.inkBorder}`,
  borderRadius: radii.md,
  padding: '5px 11px',
  fontFamily: font.family,
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  boxShadow: shadows.float,
  pointerEvents: 'none',
};

// A tiny caret tail pointing down at the row — a bordered square rotated 45°
// (CSS `transform` is fine here: it's a static child, never Framer-animated).
const copiedBubbleTail: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: -5,
  marginLeft: -5,
  width: 10,
  height: 10,
  background: colors.panelCream,
  border: `1px solid ${colors.inkBorder}`,
  borderTop: 'none',
  borderLeft: 'none',
  transform: 'rotate(45deg)',
};

/* ── Quiet section label (aids scanning without competing with the brand) ── */
// Small, sentence-case, muted — deliberately NOT a bold uppercase header.
const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: colors.brownText,
  fontFamily: font.family,
  letterSpacing: '0.04em',
  marginBottom: 10,
  opacity: 0.9,
};

/* ── Legal & policies grid (the primary action area) ──────── */

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 9,
};

const gridRow: CSSProperties = {
  ...modalRow,
  justifyContent: 'flex-start',
  gap: 8,
  padding: '11px 11px',
  borderRadius: radii.md,
  background: colors.surfaceSecondary,
  border: 'none',
  cursor: cursors.clickable,
  textDecoration: 'none',
  textAlign: 'left',
  width: '100%',
  minWidth: 0,
  color: colors.frameDark,
};

const gridIcon: CSSProperties = {
  color: colors.brownText,
  display: 'flex',
  flexShrink: 0,
};

const gridLabel: CSSProperties = {
  flex: 1,
  fontSize: 13,
  fontWeight: 700,
  color: colors.frameDark,
  fontFamily: font.family,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const chevron: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: colors.textSecondary,
  flexShrink: 0,
};

/* ── Team (avatar cards) ──────────────────────────────────── */

// The ordering note above the cards. Same muted treatment as the footer
// disclaimer, which is `colors.brownText` because `textSecondary` fails AA at
// this size (see the a11y contrast describe block) — kept as its own token
// because it sits under a section label rather than centred in the footer.
const teamNote: CSSProperties = {
  fontFamily: font.family,
  fontSize: 11,
  fontWeight: 500,
  color: colors.brownText,
  lineHeight: 1.4,
  marginTop: -4,
  marginBottom: 9,
};

// One row of four cards. At the fixed ABOUT_WIDTH (440px) card, four equal
// columns leave roughly 95px each — enough for a ~52px circular avatar with the
// name beneath. The names (镜喵MirrorCat is the longest) wrap to two lines rather
// than crowd the row, so this stays a clean single row without shrinking.
const teamGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 8,
};

// The whole card is the link. buttonMotion (the modal hover/press scale) is
// spread on the motion.a so it reacts like the sibling interactive rows.
const memberCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 7,
  padding: '10px 4px 8px',
  borderRadius: radii.md,
  textDecoration: 'none',
  color: colors.frameDark,
  minWidth: 0,
};

// Circular frame with a hairline ink ring + positioning context for the corner
// link badge. The img clips ITSELF to the circle (border-radius on the img)
// rather than an overflow:hidden wrapper, so the badge can sit on the rim
// without being clipped.
const avatarRing: CSSProperties = {
  position: 'relative',
  width: 52,
  height: 52,
  borderRadius: '50%',
  border: `1px solid ${colors.inkBorder}`,
  background: colors.surfaceSecondary,
  flexShrink: 0,
};

const avatarImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
  borderRadius: '50%',
};

// Subtle "opens externally" affordance — a small ↗ chip on the avatar's
// bottom-right, kept off the name so a long name (镜喵MirrorCat) can wrap
// cleanly without orphaning the arrow on its own line.
const avatarBadge: CSSProperties = {
  position: 'absolute',
  right: -1,
  bottom: -1,
  width: 17,
  height: 17,
  borderRadius: '50%',
  background: colors.panelCream,
  border: `1px solid ${colors.inkBorder}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
  color: colors.brownText,
};

const memberName: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: colors.frameDark,
  fontFamily: font.family,
  textAlign: 'center',
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
  maxWidth: '100%',
};

/* ── Filing rows ──────────────────────────────────────────── */

const filingRow: CSSProperties = {
  ...modalRow,
  padding: '5px 0',
};

const filingLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: colors.frameDark,
  fontFamily: font.family,
};

// AA swap as above — these render the legally-mandated ICP/PSB filing numbers.
const filingLink: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  color: colors.brownText,
  fontFamily: font.family,
  textDecoration: 'none',
};

/* ── Footer (recedes) ─────────────────────────────────────── */

// `colors.brownText` passes AA at this small size where `textSecondary` would
// not — see the a11y contrast describe block. Do not revert to textSecondary.
const disclaimerStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: colors.brownText,
  fontFamily: font.family,
  lineHeight: 1.5,
  textAlign: 'center',
};

const footerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  fontSize: 11.5,
  fontWeight: 700,
  color: colors.brownText,
  fontFamily: font.family,
  flexWrap: 'wrap',
};

const footerLink: CSSProperties = {
  color: colors.frameDark,
  textDecoration: 'none',
  fontWeight: 700,
};

const suspenseFallback: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function AboutModal({ open = true, onClose }: AboutModalProps) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const chrome = useChromeScale();

  const [view, setView] = useState<View>({ kind: 'about' });
  const [docLang, setDocLang] = useState<'en' | 'zh'>(locale === 'zh' ? 'zh' : 'en');

  const isDoc = view.kind === 'doc';
  const width = isDoc ? DOC_WIDTH : ABOUT_WIDTH;

  // CONSTANT CARD height, shared by both views. About is measured after it
  // mounts (and on any content change while it's showing — locale swap) and
  // the card springs to that height once; `cardHeight` is null until the
  // first measurement, so we feed an estimate for the very first paint (the
  // views need a definite height to fill via height:100%), and `sizeReady`
  // keeps that first correction a hard snap. Switching to/from the doc view
  // never touches `cardHeight` — it just renders at whatever height About
  // last measured.
  // The About view is found by data-attribute rather than a ref: framer-motion
  // reads `children.props.ref` off every AnimatePresence child and React 18
  // warns when one is present, so we keep the motion children ref-free and
  // query the live DOM node instead.
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [sizeReady, setSizeReady] = useState(false);

  // The same cap ModalShell enforces as CSS (`maxHeight: (maxVh/chrome)vh`),
  // expressed in the card's own layout px so the measured height clamps to it.
  const capPx = (ABOUT_MAX_VH / chrome / 100) * (typeof window === 'undefined' ? 900 : window.innerHeight);

  // Measure View A before paint, and keep measuring it while its content
  // settles (font/image reflow, a locale change re-flowing the brand/grid/team
  // text while About is showing). Only runs while About is the active view —
  // the doc view (View B) never feeds a measurement back, so it can't retarget
  // the card's height; it simply renders at the last value About produced.
  // Frozen while closing (`!open`) so a mid-exit content change can't retarget
  // the morph out from under the card as it leaves.
  useLayoutEffect(() => {
    if (!open || isDoc) return;
    const el = document.querySelector<HTMLElement>('[data-about-view]');
    if (!el) return;
    const remeasure = () => setCardHeight(measureAboutHeight(el, capPx));
    remeasure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, isDoc, locale, capPx]);

  // Flip morphing on only AFTER the first measured height has painted, so the
  // estimate→measured correction on open is an instant snap, not a visible morph.
  // Gated on `open`: without it, this would immediately flip `sizeReady` back to
  // true the moment the re-arm effect below sets it false on close — `cardHeight`
  // is still non-null (the stale value from the session that just ended), so the
  // bare `cardHeight != null` check alone can't tell "freshly measured" apart
  // from "stale leftover from before."
  useEffect(() => {
    if (open && cardHeight != null && !sizeReady) setSizeReady(true);
  }, [open, cardHeight, sizeReady]);

  // Re-arm the instant snap for the NEXT open. `sizeReady` otherwise stays true
  // forever after the first open (the component never unmounts between opens —
  // see the props doc comment), so a SECOND open would already be "ready" and
  // let the real morph spring animate any correction. That's invisible when the
  // remeasured height happens to match the stale one, but if content changed
  // while the modal was closed (a locale toggle, a window resize changing
  // `capPx`, …) the remeasured height WOULD differ, and — unlike the very first
  // open, where there's no prior card to animate FROM — this is a genuinely
  // already-mounted value change, so the real spring plays out over several
  // frames instead of landing before paint: a visible pop-then-resize, breaking
  // parity with Settings' plain scale/y entrance. Resetting here makes every
  // open's first correction a hard snap again, exactly like the very first one.
  useEffect(() => {
    if (!open) setSizeReady(false);
  }, [open]);

  // Per-row button refs (keyed by DocId) so Back can restore focus to the exact
  // row that opened the doc — the row is a FRESH DOM node after the grid
  // re-mounts on return, so we refocus by identity, not a stale element ref.
  const rowRefs = useRef<Partial<Record<DocId, HTMLButtonElement | null>>>({});
  const refocusId = useRef<DocId | null>(null);

  // Copy-build-info feedback: a floating bubble renders a localized "Copied"
  // confirmation for ~1.2s, then auto-dismisses. Timeout ref so a fast
  // re-click restarts the window instead of stacking timeouts, and so unmount
  // (e.g. modal closed mid-timer) can clear it.
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  const copyBuildInfo = async () => {
    const line = `${APP_NAME} ${APP_VERSION} (build ${BUILD_NUMBER}, ${BUILD_SHA}, ${BUILD_DATE})`;
    try {
      await navigator.clipboard.writeText(line);
    } catch {
      // Clipboard API unavailable/denied (e.g. insecure context) — silent no-op.
      return;
    }
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
  };

  const openDoc = (id: DocId) => setView({ kind: 'doc', id });
  // In-modal cross-doc link: switch docs in place instead of full-page
  // navigating out of the SPA. Unknown paths fall through to a normal link
  // (the handler is only wired for known docs).
  const openDocByPath = (slugPath: string) => {
    const id = docIdForPath(slugPath);
    if (id) openDoc(id);
  };
  const back = () => {
    if (view.kind === 'doc') refocusId.current = view.id;
    setView({ kind: 'about' });
  };

  useEffect(() => {
    if (view.kind === 'about' && refocusId.current) {
      const id = refocusId.current;
      refocusId.current = null;
      rowRefs.current[id]?.focus();
    }
  }, [view]);

  // Fresh start each time the modal opens (the component stays mounted between
  // opens now, so reset the drill-in view here rather than relying on unmount).
  useEffect(() => {
    if (open) setView({ kind: 'about' });
  }, [open]);

  const hasIcp = !!(LEGAL.icpNumber && LEGAL.icpUrl);
  const hasPsb = !!(LEGAL.psbNumber && LEGAL.psbUrl);

  // Feed a definite height every frame (the views fill it via height:100%):
  // the measured value once known, an estimate before the first measurement
  // lands. The estimate only ever backstops View A (the modal always resets
  // to `{ kind: 'about' }` on open, so isDoc is never true before the first
  // measurement fires).
  const motionSize = { width, height: cardHeight ?? ESTIMATE_HEIGHT };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      maxVh={ABOUT_MAX_VH}
      motionSize={motionSize}
      sizeInstant={!sizeReady}
      sizeSpring={MORPH_SPRING}
      cardStyle={cardStyle}
      ariaLabel={isDoc ? t(DOCS[view.id].titleKey) : t('modal.about_title')}
    >
      {/* `exiting` = the whole shell is closing. While it is, the inner A↔B
          drill-in must NOT run its own exit (opacity) — the frozen current view
          rides the card out as one unit. When the shell is OPEN (exiting=false)
          the drill-in exits cross-fade normally. The card SIZE is frozen too:
          the measurement effect is gated on `open`, so a close never retargets
          the morph mid-exit. The A↔B switch is a pure OPACITY crossfade (no
          slide) so it reads as one motion with the width/height morph around it;
          both views are absolutely positioned (see viewBase) so they overlap
          during the fade. */}
      {(exiting: boolean) => (
      <AnimatePresence mode="sync" initial={false}>
        {isDoc ? (
          <motion.div
            key="doc"
            data-doc-view
            style={docView}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // `pointerEvents:'none'` on exit stops the outgoing view stealing a
            // click while it fades (a fast double-click could otherwise land on
            // stale content mid-fade).
            exit={exiting ? undefined : { opacity: 0, pointerEvents: 'none', transition: exitTransition }}
            transition={MORPH_SPRING}
          >
            <Suspense
              fallback={
                <div style={suspenseFallback}>
                  <LoadingDots color={colors.textSecondary} />
                </div>
              }
            >
              <LegalDocView
                id={view.id}
                lang={docLang}
                onLang={setDocLang}
                onBack={back}
                onInternalLink={openDocByPath}
              />
            </Suspense>
          </motion.div>
        ) : (
          <motion.div
            key="about"
            data-about-view
            data-scroll
            style={{ ...aboutScroll, maxHeight: capPx }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // See the "doc" view's exit prop above — same pointer-events gate.
            exit={exiting ? undefined : { opacity: 0, pointerEvents: 'none', transition: exitTransition }}
            transition={MORPH_SPRING}
          >
            {/* Brand block — the anchor: name, tagline, one muted version line. */}
            <div style={brandBlock}>
              {/* Served from public/ through BASE_URL rather than imported, so one copy of the
                  logo backs both the favicon and this, and it still resolves under the dev
                  site's /Apollonius/ prefix where a root-absolute path would 404. */}
              <img src={`${import.meta.env.BASE_URL}logo-256.png`} alt={t('app.name')} style={brandLogo} />
              <div style={appNameStyle}>{t('app.name')}</div>
              <div style={taglineStyle}>{t('app.tagline')}</div>
              <div style={versionButtonWrap}>
                <motion.button
                  type="button"
                  style={versionButton}
                  onClick={copyBuildInfo}
                  aria-label={t('about.copy_build')}
                  whileHover={{ opacity: 1 }}
                  whileTap={{ opacity: 0.7 }}
                  transition={springs.stiff}
                >
                  {[
                    `${t('about.version')} ${APP_VERSION}`,
                    `${t('about.build')} ${BUILD_NUMBER}`,
                    BUILD_SHA,
                    BUILD_DATE,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </motion.button>
                {/* Confirmation bubble — the row's own text never changes; this
                    floats above it and auto-dismisses (see copyBuildInfo). */}
                <AnimatePresence>
                  {copied && (
                    <motion.div
                      key="copied-bubble"
                      role="status"
                      aria-live="polite"
                      style={copiedBubble}
                      initial={{ opacity: 0, y: 6, scale: 0.9, x: '-50%' }}
                      animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
                      exit={{ opacity: 0, y: 6, scale: 0.9, x: '-50%', transition: exitTransition }}
                      transition={springs.stiff}
                    >
                      {t('about.copied')}
                      <span style={copiedBubbleTail} aria-hidden />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Legal & policies grid — the primary action area. */}
            <div>
              <div style={sectionLabel}>{t('legal.section_title')}</div>
              <div style={gridStyle} data-testid="legal-grid">
                {GRID_DOCS.map((id) => (
                  <motion.button
                    key={id}
                    type="button"
                    data-testid={`legal-row-${id}`}
                    ref={(el) => {
                      rowRefs.current[id] = el;
                    }}
                    style={gridRow}
                    onClick={() => openDoc(id)}
                    {...buttonMotion}
                  >
                    <span style={gridIcon}>
                      <DocIcon id={id} size={16} />
                    </span>
                    <span style={gridLabel}>{t(DOCS[id].titleKey)}</span>
                    <span style={chevron} aria-hidden>
                      ›
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Filing rows — only a complete number+URL pair renders. */}
            {(hasIcp || hasPsb) && (
              <div>
                {hasIcp && (
                  <div style={filingRow} data-testid="filing-icp">
                    <span style={filingLabel}>{t('about.filing_icp')}</span>
                    <a style={filingLink} href={LEGAL.icpUrl!} target="_blank" rel="noopener noreferrer">
                      {LEGAL.icpNumber} ↗
                    </a>
                  </div>
                )}
                {hasPsb && (
                  <div style={filingRow} data-testid="filing-psb">
                    <span style={filingLabel}>{t('about.filing_psb')}</span>
                    <a style={filingLink} href={LEGAL.psbUrl!} target="_blank" rel="noopener noreferrer">
                      {LEGAL.psbNumber} ↗
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Team — avatar cards; the whole card is the (external) link. Alphabetical
                by the same helper the About doc's table uses, with the order
                disclaimed, so the grid never reads as a ranking. */}
            <div>
              <div style={sectionLabel}>{t('about.team_title')}</div>
              <div style={teamNote}>{t('about.team_order')}</div>
              <div style={teamGrid} data-testid="team-grid">
                {teamInReadingOrder(LEGAL.team).map((m) => {
                  const avatar = teamAvatarUrl(m.avatar);
                  return (
                    <motion.a
                      key={m.url}
                      data-testid="team-member"
                      style={memberCard}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('about.team_link', { name: m.name })}
                      {...buttonMotion}
                    >
                      <span style={avatarRing}>
                        {avatar && <img src={avatar} alt={m.name} style={avatarImg} />}
                        <span style={avatarBadge} aria-hidden>
                          ↗
                        </span>
                      </span>
                      <span style={memberName}>{m.name}</span>
                    </motion.a>
                  );
                })}
              </div>
            </div>

            {/* Footer — disclaimer + source + ©, receding. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={disclaimerStyle}>{t('about.disclaimer')}</div>
              <div style={footerRow}>
                <a style={footerLink} href={LEGAL.repoUrl} target="_blank" rel="noopener noreferrer">
                  GitHub ↗
                </a>
                <span aria-hidden>·</span>
                <span>{`© 2026 ${LEGAL.productName} contributors`}</span>
              </div>
            </div>

            <motion.button style={{ ...primaryButton, marginTop: 2 }} onClick={onClose} {...buttonMotion}>
              {t('modal.settings_ok')}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      )}
    </ModalShell>
  );
}
