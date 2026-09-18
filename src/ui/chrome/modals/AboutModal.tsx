import { IS_LITE, SUPPORTS_CLIPBOARD, SUPPORTS_EXTERNAL_LINKS } from '../../../core/runtime/edition';
import { viewportSize } from '../../../core/runtime/viewport-space';
/**
 * Two-view About and legal-document modal. The legal reader is lazy-loaded. Both views share the
 * About view's measured, capped height; only width morphs while content cross-fades. Initial sizing
 * and reduced motion snap. Closing freezes the inner view and card dimensions so the shell exits as
 * one unit, and reopening returns to About.
 */

import { useState, useRef, useEffect, useLayoutEffect, Suspense, lazy, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { font, colors, radii, springs, shadows, exitTransition, modalRow, buttonMotion, btnReset, cursors } from '../../design/styles';
import { skin, windowCard } from '../../design/window-skin';
import { roleFont } from '../../design/text-weight';
import { APP_NAME, APP_VERSION, BUILD_NUMBER, BUILD_SHA, BUILD_DATE } from '../../../version';
import { ChunkBoundary } from '../../primitives/ChunkBoundary';
import { ModalShell } from '../../primitives/ModalShell';
import { useScrollFade } from '../../primitives/scroll-fade';
import { BrandLockup } from '../BrandLockup';
import { useChromeScale, useViewportSize } from '../../design/scale';
import { LoadingDots } from '../../primitives/LoadingDots';
import { DOCS, docIdForPath, qqChannelPageUrl, teamInReadingOrder, type DocId } from '../../../legal/registry';
import { DocIcon } from '../../../legal/doc-icons';
import { LEGAL } from '../../../legal/config';
import { teamAvatarUrl } from '../../../legal/team-avatars';

const LegalDocView = lazy(() => import('../../../legal/LegalDocView'));

export interface AboutModalProps {
  /** Drives the shared `ModalShell` open/close choreography. Defaults to `true`
   *  so tests can mount the modal directly; App passes `open={showAbout}` and
   *  keeps the component mounted so the card exit animates as one unit. */
  open?: boolean;
  onClose: () => void;
}

type View = { kind: 'about' } | { kind: 'doc'; id: DocId };

// The two widths the header's width-only morph runs between: the composed
// About surface reads best in a narrower column, the doc reader in a wider
// one. Freezing ONE width flattens the proportions; snapping between two is an
// unanimated jump that desyncs from the content crossfade.
const ABOUT_WIDTH = 440;
// The desktop About layout: a brand band over two panes, spending width instead of height.
const ABOUT_WIDE_WIDTH = 800;
// Window px the wide card must leave free beside itself; below that the About view stacks into one column.
const WIDE_MARGIN = 32;
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
const GRID_DOCS: DocId[] = IS_LITE ? ['license', 'third-party', 'asset-licenses'] : [
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
  ...windowCard,
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

// The wide layout keeps the same scroll container and gutters; only the content arranges itself in bands.
const aboutWide: CSSProperties = {
  ...aboutScroll,
  width: ABOUT_WIDE_WIDTH,
  padding: '30px 32px 26px',
};

// Brand at the left, version and source link at the right.
const brandBand: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 18,
};

const bandRight: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  minWidth: 0,
};

const hairline: CSSProperties = { height: 1, background: skin.line };

// Two equal panes: people on the left, documents and support on the right.
const panes: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 30,
  alignItems: 'start',
};

const pane: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 22,
  minWidth: 0,
};

const paneDivider: CSSProperties = {
  ...pane,
  borderLeft: `1px solid ${skin.line}`,
  paddingLeft: 30,
};

/* ── Brand block (the anchor) ─────────────────────────────── */

const brandBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 5,
};

// One muted line, no card — the version recedes below the brand. `colors.brownText` over
// `colors.textSecondary`: the latter fails WCAG AA at this size (see the a11y contrast describe block).
const versionLine: CSSProperties = {
  fontFamily: font.family,
  ...roleFont('caption'),
  color: colors.brownText,
  textAlign: 'center',
  marginTop: 3,
  opacity: 0.85,
  letterSpacing: '0.01em',
};

// The one outbound link in the brand block reads as a link: heavier than the version line, underlined.
const repositoryLink: CSSProperties = {
  ...versionLine,
  ...roleFont('small'),
  marginTop: 0,
  opacity: 1,
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};


const versionButton: CSSProperties = {
  ...btnReset,
  ...versionLine,
  display: 'inline-block',
};

// The build-copy confirmation is anchored to the version row.
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
  background: skin.plate,
  color: skin.ink,
  border: `1px solid ${skin.line}`,
  borderRadius: radii.md,
  padding: '5px 11px',
  fontFamily: font.family,
  ...roleFont('caption'),
  whiteSpace: 'nowrap',
  boxShadow: shadows.float,
  pointerEvents: 'none',
};

// A tiny caret tail pointing down at the row — a bordered square rotated 45°. A static child,
// never Framer-animated, so its CSS `transform` has no motion value to fight over.
const copiedBubbleTail: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: -5,
  marginLeft: -5,
  width: 10,
  height: 10,
  background: skin.plate,
  border: `1px solid ${skin.line}`,
  borderTop: 'none',
  borderLeft: 'none',
  transform: 'rotate(45deg)',
};

/* ── Quiet section label (aids scanning without competing with the brand) ── */
// Small, sentence-case, muted — deliberately NOT a bold uppercase header.
const sectionLabel: CSSProperties = {
  ...roleFont('caption'),
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
  boxSizing: 'border-box',
  justifyContent: 'flex-start',
  gap: 8,
  padding: '11px 11px',
  borderRadius: radii.md,
  background: skin.inset,
  border: 'none',
  cursor: cursors.clickable,
  textDecoration: 'none',
  textAlign: 'left',
  width: '100%',
  minWidth: 0,
  color: skin.ink,
};

const gridIcon: CSSProperties = {
  color: colors.brownText,
  display: 'flex',
  flexShrink: 0,
};

// A document's name WRAPS rather than ellipsizing. Half the eight names are longer than a column at
// this width in Russian and Thai, and a row reading "Политика конфи…" names nothing; the card is
// measured from its own content (see `measureAboutHeight`), so a second line grows the window
// instead. The grid stretches both columns of a row to the taller one, so the pair stays even.
const gridLabel: CSSProperties = {
  flex: 1,
  ...roleFont('chip'),
  lineHeight: 1.3,
  color: skin.ink,
  fontFamily: font.family,
  minWidth: 0,
};

const chevron: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: skin.muted,
  flexShrink: 0,
};

/* ── Team (avatar cards) ──────────────────────────────────── */

// The ordering note above the cards. Same muted treatment as the footer
// disclaimer, which is `colors.brownText` because `textSecondary` fails AA at
// this size (see the a11y contrast describe block) — kept as its own token
// because it sits under a section label rather than centred in the footer.
const teamNote: CSSProperties = {
  fontFamily: font.family,
  ...roleFont('caption'),
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
  color: skin.ink,
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
  border: `1px solid ${skin.line}`,
  background: skin.inset,
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
  background: skin.plate,
  border: `1px solid ${skin.line}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...roleFont('caption'),
  lineHeight: 1,
  color: colors.brownText,
};

const memberName: CSSProperties = {
  ...roleFont('caption'),
  color: skin.ink,
  fontFamily: font.family,
  textAlign: 'center',
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
  maxWidth: '100%',
};

// The wide layout's cards: four equal columns in both rows so team and acknowledgement cards share one width.
const wideCard: CSSProperties = { ...memberCard, padding: '8px 0 6px' };
const wideGrid: CSSProperties = { ...teamGrid, gap: 4 };

/* ── Filing rows ──────────────────────────────────────────── */

const filingRow: CSSProperties = {
  ...modalRow,
  padding: '5px 0',
};

const filingLabel: CSSProperties = {
  ...roleFont('caption'),
  color: skin.ink,
  fontFamily: font.family,
};

// `colors.brownText` over `colors.textSecondary` (see the a11y contrast describe block) — these
// render the legally-mandated ICP/PSB filing numbers.
const filingLink: CSSProperties = {
  ...roleFont('caption'),
  color: colors.brownText,
  fontFamily: font.family,
  textDecoration: 'none',
};

/* ── Footer (recedes) ─────────────────────────────────────── */

// `colors.brownText` passes AA at this small size where `textSecondary` would
// not — see the a11y contrast describe block. Do not revert to textSecondary.
const disclaimerStyle: CSSProperties = {
  ...roleFont('caption'),
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
  ...roleFont('caption'),
  color: colors.brownText,
  fontFamily: font.family,
  flexWrap: 'wrap',
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
  // The card renders at `width × chrome` window px (ModalShell applies the chrome scale as css zoom).
  const viewport = useViewportSize();
  const wide = ABOUT_WIDE_WIDTH * chrome + WIDE_MARGIN <= viewport.w;
  const width = isDoc ? DOC_WIDTH : wide ? ABOUT_WIDE_WIDTH : ABOUT_WIDTH;

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
  const capPx = (ABOUT_MAX_VH / chrome / 100) * (typeof window === 'undefined' ? 900 : viewportSize().height);

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
  }, [open, isDoc, locale, capPx, wide]);

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

  // Repeated copies restart the confirmation timer.
  const [copied, setCopied] = useState<'build' | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  const copyText = async (text: string, target: 'build') => {
    if (!SUPPORTS_CLIPBOARD) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable/denied (e.g. insecure context) — silent no-op.
      return;
    }
    setCopied(target);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(null), 1200);
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

  // Fresh start each time the modal opens: the component stays mounted between
  // opens, so the drill-in view resets here rather than on unmount.
  useEffect(() => {
    if (!open) return;
    const target = useEditorStore.getState().aboutTarget;
    setView(target && (!IS_LITE || GRID_DOCS.includes(target)) ? { kind: 'doc', id: target } : { kind: 'about' });
    if (target) useEditorStore.getState().setAboutTarget(null);
  }, [open]);

  const hasIcp = !!(LEGAL.icpNumber && LEGAL.icpUrl);
  const hasPsb = !!(LEGAL.psbNumber && LEGAL.psbUrl);

  // Feed a definite height every frame (the views fill it via height:100%):
  // the measured value once known, an estimate before the first measurement
  // lands. The estimate only ever backstops View A (the modal always resets
  // to `{ kind: 'about' }` on open, so isDoc is never true before the first
  // measurement fires).
  const motionSize = { width, height: cardHeight ?? ESTIMATE_HEIGHT };

  // `useScrollFade` reads a mutable ref directly rather than a JSX `ref` prop: the About view below
  // is an AnimatePresence direct child, which must stay ref-free (see its own comment). This feeds
  // the ref the same way the height measurement above locates the node, via `document.querySelector`,
  // every render (declared before the hook call so this effect commits first and the hook never
  // reads a stale `null`).
  const aboutViewRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { aboutViewRef.current = document.querySelector<HTMLElement>('[data-about-view]'); });
  const aboutFade = useScrollFade(aboutViewRef, 'y');

  const copyConfirmation = (target: 'build') => (
    <AnimatePresence>
      {copied === target && (
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
  );

  const versionText = [`${t('about.version')} ${APP_VERSION}`, `${t('about.build')} ${BUILD_NUMBER}`, BUILD_SHA, BUILD_DATE].filter(Boolean).join(', ');
  const versionRow = (
    <>
      <div style={versionButtonWrap}>
        {!SUPPORTS_CLIPBOARD ? <div style={{ ...versionButton, cursor: cursors.text, userSelect: 'text', WebkitUserSelect: 'text', ...(wide ? { textAlign: 'right' } : {}) }}>{versionText}</div> : <motion.button
          type="button"
          style={{ ...versionButton, ...(wide ? { textAlign: 'right' } : {}) }}
          onClick={() => copyText(`${APP_NAME} ${APP_VERSION} (build ${BUILD_NUMBER}, ${BUILD_SHA}, ${BUILD_DATE})\n${navigator.userAgent}`, 'build')}
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
            .join(', ')}
        </motion.button>}
        {SUPPORTS_CLIPBOARD && copyConfirmation('build')}
      </div>
      {SUPPORTS_EXTERNAL_LINKS && <motion.a style={repositoryLink} href={LEGAL.repoUrl} target="_blank" rel="noopener noreferrer" {...buttonMotion}>
        {t('about.repository_link')} <span aria-hidden>↗</span>
      </motion.a>}
    </>
  );

  const brand = wide ? (
    <div style={brandBand} data-testid="about-band">
      <BrandLockup size={60} tagline />
      <div style={bandRight}>{versionRow}</div>
    </div>
  ) : (
    <div style={brandBlock}>
      <BrandLockup size={72} tagline />
      {versionRow}
    </div>
  );

  const roster = (members: typeof LEGAL.team, gridTestId: string, cardTestId: string) => (
    <div style={wide ? wideGrid : teamGrid} data-testid={gridTestId}>
      {teamInReadingOrder(members).map((m) => {
        const avatar = teamAvatarUrl(m.avatar);
        const Member = SUPPORTS_EXTERNAL_LINKS ? motion.a : motion.div;
        return (
          <Member
            key={m.url}
            data-testid={cardTestId}
            style={{ ...(wide ? wideCard : memberCard), ...(!SUPPORTS_EXTERNAL_LINKS ? { cursor: cursors.default } : {}) }}
            {...(!SUPPORTS_EXTERNAL_LINKS ? {} : { href: m.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('about.team_link', { name: m.name }), ...buttonMotion })}
          >
            <span style={avatarRing}>
              {avatar && <img src={avatar} alt={m.name} style={avatarImg} />}
              {SUPPORTS_EXTERNAL_LINKS && <span style={avatarBadge} aria-hidden>
                ↗
              </span>}
            </span>
            <span style={memberName}>{m.name}</span>
          </Member>
        );
      })}
    </div>
  );

  const legalGrid = (
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
  );

  const feedback = !SUPPORTS_EXTERNAL_LINKS ? (
    <div data-testid="feedback-links">
      <div style={sectionLabel}>{t('about.feedback_title')}</div>
      <div style={{ ...gridRow, cursor: cursors.text, userSelect: 'text', WebkitUserSelect: 'text' }}>
        <span style={{ ...gridLabel, overflowWrap: 'break-word' }}>{LEGAL.privacyContactEmail}</span>
      </div>
    </div>
  ) : (
    <div data-testid="feedback-links">
      <div style={sectionLabel}>{t('about.feedback_title')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <motion.a
          href={qqChannelPageUrl(LEGAL.qqFeedbackChannel)}
          target="_blank"
          rel="noopener noreferrer"
          style={gridRow}
          data-testid="qq-feedback-channel"
          {...buttonMotion}
        >
          <span style={{ ...gridLabel, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>{t('about.qq_channel_name')}</span>
            <span style={{ ...teamNote, margin: 0 }}>{t('about.qq_channel_number', { number: LEGAL.qqFeedbackChannel })}</span>
          </span>
          <span style={chevron} aria-hidden>↗</span>
        </motion.a>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }} data-testid="report-links">
          <motion.a href={`${LEGAL.repoUrl}/issues`} target="_blank" rel="noopener noreferrer" style={gridRow} {...buttonMotion}>
            <span style={gridLabel}>{t('about.github_issues')}</span>
            <span style={chevron} aria-hidden>↗</span>
          </motion.a>
          <motion.a href={`mailto:${LEGAL.privacyContactEmail}`} style={gridRow} {...buttonMotion}>
            <span style={gridLabel}>{t('about.email_feedback')}</span>
            <span style={chevron} aria-hidden>↗</span>
          </motion.a>
        </div>
      </div>
    </div>
  );

  const support = SUPPORTS_EXTERNAL_LINKS && (
    <div>
      <div style={sectionLabel}>{t('about.sponsorship_title')}</div>
      <div style={gridStyle} data-testid="sponsorship-links">
        {[
          { href: LEGAL.sponsorship.patreon, key: 'about.patreon' },
          { href: LEGAL.sponsorship.afdian, key: 'about.afdian' },
        ].map(({ href, key }) => (
          <motion.a key={key} href={href} target="_blank" rel="noopener noreferrer" style={gridRow} {...buttonMotion}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 20 4.5 12.5a5 5 0 0 1 7.5-6.6 5 5 0 0 1 7.5 6.6L12 20Z" />
            </svg>
            <span style={gridLabel}>{t(key)}</span>
            <span style={chevron} aria-hidden>↗</span>
          </motion.a>
        ))}
      </div>
    </div>
  );

  // Only a complete number+URL pair renders.
  const filing = SUPPORTS_EXTERNAL_LINKS && (hasIcp || hasPsb) && (
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
  );

  const footer = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={disclaimerStyle}>{t('about.disclaimer')}</div>
      <div style={footerRow}>
        <span>{t('about.copyright', { year: 2026 })}</span>
      </div>
    </div>
  );

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
            <ChunkBoundary resetKey={view.id}>
              <Suspense
                fallback={
                  <div style={suspenseFallback}>
                    <LoadingDots color={skin.muted} />
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
            </ChunkBoundary>
          </motion.div>
        ) : (
          <motion.div
            key="about"
            data-about-view
            data-scroll
            data-about-layout={wide ? 'wide' : 'stack'}
            style={{ ...(wide ? aboutWide : aboutScroll), maxHeight: capPx, ...aboutFade }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // See the "doc" view's exit prop above — same pointer-events gate.
            exit={exiting ? undefined : { opacity: 0, pointerEvents: 'none', transition: exitTransition }}
            transition={MORPH_SPRING}
          >
            {wide ? (
              <>
                {brand}
                <div style={hairline} />
                <div style={panes}>
                  <div style={{ ...pane, gap: 12 }} data-testid="about-people">
                    <div>
                      <div style={sectionLabel}>{t('about.team_title')}</div>
                      {roster(LEGAL.team, 'team-grid', 'team-member')}
                    </div>
                    <div>
                      <div style={sectionLabel}>{t('about.acknowledgements_title')}</div>
                      {roster(LEGAL.acknowledgements, 'acknowledgements-grid', 'acknowledged-member')}
                    </div>
                    <div style={{ ...teamNote, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
                      {!IS_LITE && <span>{t('about.team_order')}</span>}
                      <span>{t('about.acknowledgements_note')}</span>
                    </div>
                  </div>
                  <div style={paneDivider} data-testid="about-documents">
                    {legalGrid}
                    {filing}
                    {feedback}
                    {support}
                  </div>
                </div>
                {footer}
              </>
            ) : (
              <>
                {brand}
                <div>
                  <div style={sectionLabel}>{t('about.team_title')}</div>
                  {!IS_LITE && <div style={teamNote}>{t('about.team_order')}</div>}
                  {roster(LEGAL.team, 'team-grid', 'team-member')}
                </div>
                <div>
                  <div style={sectionLabel}>{t('about.acknowledgements_title')}</div>
                  <div style={teamNote}>{t('about.acknowledgements_note')}</div>
                  {roster(LEGAL.acknowledgements, 'acknowledgements-grid', 'acknowledged-member')}
                </div>
                {legalGrid}
                {filing}
                {feedback}
                {support}
                {footer}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      )}
    </ModalShell>
  );
}
