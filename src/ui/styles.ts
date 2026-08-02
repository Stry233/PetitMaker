import type { CSSProperties } from 'react';
import { DOM_CURSORS } from '../core/runtime/cursor-spec';

/* The one dark ink (#43413F) behind frame / load-pill / text — a single base so the three
 * semantic aliases below can never diverge. */
const INK = '#43413F';
/* The espresso ink the hairline borders + shadows tint (rgb 67,65,62). */
const INK_RGB = '67,65,62';

/* ── Colours ─────────────────────────────────────────────── */

export const colors = {
  bgCanvas: '#8CC9A1',
  surfacePrimary: '#FDFBF7',
  surfaceSecondary: '#F3EEE8',
  surfaceOverlay: 'rgba(74, 59, 50, 0.4)',
  textPrimary: '#4A3B32',
  textSecondary: '#8A7B72',
  textInverse: '#FFFFFF',
  accentPrimary: '#FFB347',
  accentHover: '#FFC470',
  statusError: '#FF6B6B',
  statusSuccess: '#6BCB77',

  /* Cozy palette measured 1:1 from the design source. */
  // frameDark / loadDark / inkText are the same dark ink (#43413F); kept as
  // semantic aliases (frame, load-pill, text). Do not let their values diverge.
  frameDark: INK,         // dark rounded outer frame / ink
  panelCream: '#FFFBE1',  // main-menu cream panel
  loadDark: INK,          // dark load pill background
  loadTrack: '#B6B6B6',   // gray track
  loadFill: '#FF3030',    // red fill (the design's high-load state)
  tileYellow: '#FFDA7E',  // tile column 0
  sliderYellow: '#FFD774', // slider fill + knob (GeneratePanel / Settings UI-scale) — one hex digit
                           // from tileYellow, kept distinct on purpose (measured from the PSD)
  dangerBg: '#F6E3E0',     // destructive-action surface (Settings "Local data" confirm)
  dangerText: '#B03A2E',   // destructive-action label
  dangerDeep: '#7A2A21',   // destructive-action emphasis copy
  importAccent: '#8E7BD6', // ImportModal drop-zone drag highlight
  tileGreen: '#CED779',   // tile column 1
  tilePaleYellow: '#FFE196', // tile column 2
  tileDeepGreen: '#C7CF68',  // tile column 3
  // Generate's three mode tiles, chosen against each other. Random's fill is `sliderYellow` above.
  tileModeOrange: '#FFD595', // Generate's Maze mode
  tileModeGreen: '#BFE39B',  // Generate's AI Agent mode
  utilTaupe: '#CFC7B7',   // gear / help buttons
  inkText: INK,           // build/placement labels
  brownText: '#826042',   // file-row labels
  inkBorder: `rgba(${INK_RGB},0.12)`,  // hairline ink tint (matches the shadow ink)
  trackOff: '#D8D2C4',    // inactive segmented-control / switch / dropdown track
  white: '#FFFFFF',
} as const;

/** An ink-tinted rgba at arbitrary alpha (rgb 67,65,62) — the hairline/shadow ink family. Use
 *  instead of hand-typing `rgba(67,65,62,α)` so the tint lives in one place. `colors.inkBorder`
 *  is the α=0.12 shortcut. */
export const inkTint = (alpha: number): string => `rgba(${INK_RGB},${alpha})`;

/* ── Cursors ─────────────────────────────────────────────────
 * The four cursors the DOM shows, as the custom properties `ui/cursors/cursor-vars` writes onto
 * <html>. Every component styles a cursor through one of these, not a bare CSS keyword;
 * `__tests__/ui/cursor-tokens.test.ts` enforces it. The canvas is the one exception: it goes
 * through `canvas/interaction/cursor-controller`, which writes style.cursor per pointer move.
 *
 * Each var carries the same keyword fallback the rules in `cursors.css` carry, and it is load
 * bearing: an unresolved var with no fallback makes the whole declaration invalid at computed-
 * value time, and because `cursor` is INHERITED the element would then take its parent's cursor
 * (the page arrow) rather than the control cursor it asked for.
 *
 * Reach for a token only where the element is not already covered by `cursors.css` — that sheet
 * gives every button, link and `[role="button"]` the clickable hand and every disabled control
 * the blocked one. An inline cursor on a control that can be disabled is a BUG: it outranks the
 * sheet, so the disabled state can never take effect. */
export const cursors = {
  /** Nothing here to act on. Also the page-wide default, set on <html> in cursors.css. */
  default: `var(${DOM_CURSORS.default}, default)`,
  /** A press here does something. */
  clickable: `var(${DOM_CURSORS.clickable}, pointer)`,
  /** Disabled: the control exists but refuses. */
  blocked: `var(${DOM_CURSORS.blocked}, not-allowed)`,
  /** A text field or any other caret target. */
  text: `var(${DOM_CURSORS.text}, text)`,
} as const;

/* ── Radii ───────────────────────────────────────────────── */

export const radii = {
  sm: 4,
  md: 12,
  lg: 24,
  panel: 28, // cozy modal/panel corner
  pill: 99,
} as const;

/* ── Z-index scale ───────────────────────────────────────────
 * The one ladder for GLOBAL floating layers, so every screen-anchored surface stacks predictably
 * instead of each file guessing a literal. (Intra-component stacking — a chip above its own card —
 * stays local; this is only for layers that must order against EACH OTHER across the app.) */
export const z = {
  canvasControls: 50, // controls anchored to something ON the canvas (the selection's rotate/delete/
                      // count row): above the canvas, BELOW the app's own chrome — a panel or spoke
                      // the user opened must never be covered by a control that follows the camera.
  panel: 100,        // floating menu panels + corner control clusters
  regionPanel: 150,  // region-select panel (above the panels)
  overlay: 200,      // modal backdrop (cozyOverlay)
  toast: 300,        // toasts, above modals
  popover: 400,      // dropdowns/bubbles anchored to a control, above a modal's own content
  tour: 500,         // first-launch tour scrim/spotlight/bubble, above a popover so an open
                     // dropdown can never paint over the tour that is teaching someone to use it
  contextMenu: 9990, // right-click menu + delete popover, above everything
  guard: 10000,      // the portrait-lock blocker, above every other layer including contextMenu
} as const;

/* ── Shadows (espresso-tinted, no pure black) ────────────── */

export const shadows = {
  s1: '0px 2px 0px rgba(74, 59, 50, 0.1)',
  s2: '0px 8px 24px rgba(74, 59, 50, 0.08), 0px 2px 8px rgba(74, 59, 50, 0.04)',
  hover: '0px 12px 32px rgba(74, 59, 50, 0.12)',
  float: '0 4px 12px rgba(67,65,62,0.18), 0 1px 3px rgba(67,65,62,0.12)', // floating cozy buttons (zoom/history)
} as const;

/* ── Typography ──────────────────────────────────────────── */

/* The one font stack — every face below references it so the family lives in a single place. */
const FONT_FAMILY = "'Alibaba PuHuiTi 3', 'PW Rounded Sans', 'Varela Round', system-ui, sans-serif";

export const font = {
  family: FONT_FAMILY,

  h1: {
    fontSize: '20px',
    fontWeight: 700,
    lineHeight: '140%',
    fontFamily: FONT_FAMILY,
  } satisfies CSSProperties,

  h2: {
    fontSize: '16px',
    fontWeight: 700,
    lineHeight: '140%',
    fontFamily: FONT_FAMILY,
  } satisfies CSSProperties,

  body: {
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '150%',
    fontFamily: FONT_FAMILY,
  } satisfies CSSProperties,

  caption: {
    fontSize: '12px',
    fontWeight: 700,
    lineHeight: '120%',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
    fontFamily: FONT_FAMILY,
  } satisfies CSSProperties,
} as const;

/* ── Easing Tokens (Spring Physics) ──────────────────────── */

export const easing = {
  springBouncy: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  springStiff: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  punchy: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/* A move that SNAPS to its mark, as a Framer transition: easeOutExpo's standard bezier, which
 * spends most of the distance in its first frames and settles the last of it late. At 0.16s that is
 * about ten frames at 60Hz with three quarters of the travel inside the first three, so the thing
 * moving reads as arriving rather than sliding.
 *
 * Both control points sit at y <= 1, so it is MONOTONIC: it cannot pass its target and come back.
 * That is the whole reason it is here rather than a spring — it carries a HIGHLIGHT, and a
 * highlight that overshoots uncovers the control it is highlighting, which reads as a miss. */
export const snapTween = { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const };

/* ── Framer Motion spring configs ───────────────────────── */

export const springs = {
  bouncy: { type: 'spring' as const, stiffness: 400, damping: 15, mass: 0.8 },
  stiff: { type: 'spring' as const, stiffness: 600, damping: 30, mass: 0.5 },
  gentle: { type: 'spring' as const, stiffness: 200, damping: 20, mass: 1 },
} as const;

/**
 * Rest thresholds for a spring driving `scale`. Spread over a spring alongside it:
 * `transition={{ ...springs.bouncy, ...scaleRest }}`.
 *
 * The defaults are tuned for values measured in PIXELS — a spring is finished once it is within
 * `restDelta` (0.01) of its target, at which point framer writes the target exactly. On a scale,
 * 0.01 is a whole percent of the element: an underdamped entrance is declared done while still
 * ~0.0017 away and SNAPS, which on a 300px card is half a pixel appearing in one frame at the very
 * end of the animation. Measured on the tour's welcome card, where the hard edges of the logo make
 * it plainly visible. These thresholds are a hundredth of that, so the final approach is continuous
 * and the last movement is well under a tenth of a pixel.
 */
export const scaleRest = { restDelta: 0.0002, restSpeed: 0.02 } as const;

/* Closing a panel/popover should settle, not overshoot — a quick ease-out with
 * NO bounce. Put on a motion element's `exit` (e.g. exit={{ scale, opacity,
 * transition: exitTransition }}) so the entrance can stay springy while the
 * close reads as the surface being put away. */
export const exitTransition = { duration: 0.16, ease: [0.4, 0, 0.2, 1] as const };

/* Shared button press feedback (Framer Motion props) so every interactive
 * control reacts the same way. Spread onto a motion element: <motion.button
 * {...pressable} />. IMPORTANT: the element must be positioned by layout
 * (flex / left+top), NOT a CSS `transform` — Framer Motion owns `transform`
 * for the scale and would clobber a centering translate (button-jump bug). */
export const pressable = {
  whileHover: { scale: 1.08 },
  whileTap: { scale: 0.9 },
  transition: springs.stiff,
} as const;

/* Consistent hover+press feedback for MODAL ACTION BUTTONS (confirm / cancel / export / OK).
 * Gentler than `pressable` (which is for icon tiles). Spread onto a motion.button so every modal
 * reacts identically: <motion.button {...buttonMotion} />. Same layout caveat as `pressable`
 * (the button must be positioned by flex/left+top, not a CSS transform). */
export const buttonMotion = {
  whileHover: { scale: 1.03 },
  whileTap: { scale: 0.95 },
  transition: springs.stiff,
} as const;

/* A crisp ROUNDED text outline, built from N radial `text-shadow` copies. The
 * union of the offset copies is the glyph dilated by a disk → rounded corners,
 * unlike `-webkit-text-stroke` whose miter joins look sharp/rectangular.
 * radiusPx = outline width in px. Use on the (dark-fill) text span's textShadow. */
export function outlineShadow(radiusPx: number, color: string, segments = 24): string {
  const parts: string[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    parts.push(`${(Math.cos(a) * radiusPx).toFixed(2)}px ${(Math.sin(a) * radiusPx).toFixed(2)}px 0 ${color}`);
  }
  return parts.join(', ');
}

/* ── Helpers ─────────────────────────────────────────────── */

/* Cozy v2 surfaces — cream card + dimmed overlay, reused by the modals,
 * toast and inspector so the editor chrome matches the redesigned menu. */
export const cozyOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: colors.surfaceOverlay,
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: z.overlay,
};

export const cozyPanel: CSSProperties = {
  background: colors.panelCream,
  borderRadius: radii.panel,
  boxShadow: '0 18px 50px rgba(67,65,62,0.30), 0 4px 14px rgba(67,65,62,0.16)',
  color: colors.frameDark,
  fontFamily: font.family,
};

/* Bare icon/transparent button reset — the v2 panels render their own art, so
 * buttons drop all native chrome (spread onto a motion.button/button).
 *
 * No `cursor` here or in any primitive below: `cursors.css` already styles native buttons, and an
 * inline cursor outranks it, pinning the enabled hand onto a disabled control. */
export const btnReset: CSSProperties = {
  background: 'none',
  border: 'none',
  appearance: 'none',
  padding: 0,
};

/* Shared modal title (24px/900, centered ink). Each modal spreads this and adds
 * its own marginBottom as needed. */
export const modalTitle: CSSProperties = {
  fontSize: 24,
  fontWeight: 900,
  color: colors.frameDark,
  textAlign: 'center',
  fontFamily: font.family,
};

/* Shared modal label-row layout (space-between label/value pairs). Modals spread this and
 * add their own padding/border/etc. as needed — those extras differ per modal, so they stay
 * local to each file. */
export const modalRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

export const btnBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: colors.surfaceSecondary,
  border: 'none',
  borderRadius: radii.md,
  color: colors.textPrimary,
  fontFamily: font.family,
  boxShadow: shadows.s1,
  transition: `all 250ms ${easing.springStiff}`,
};

/* The dark cream-on-ink primary action button (modal "OK" / confirm). Centered,
 * self-sized — modals spread it onto a motion.button and add pressable props. */
export const primaryButton: CSSProperties = {
  background: colors.frameDark,
  color: colors.panelCream,
  border: 'none',
  borderRadius: 14,
  padding: '11px 30px',
  fontSize: 15,
  fontWeight: 800,
  fontFamily: font.family,
  alignSelf: 'center',
};

/* The export modals' footer action pair: a full-width dark primary (Export) next
 * to a ghost (Cancel), sharing one row. Distinct from `primaryButton` (which is
 * self-centered and wider-padded) — these flex-fill their footer row. */
export const footerPrimary: CSSProperties = {
  flex: 1,
  background: colors.frameDark,
  color: colors.panelCream,
  border: 'none',
  borderRadius: radii.md,
  padding: '12px 20px',
  fontFamily: font.family,
  fontSize: 15,
  fontWeight: 800,
};
export const footerGhost: CSSProperties = {
  background: colors.surfaceSecondary,
  color: colors.frameDark,
  border: 'none',
  borderRadius: radii.md,
  padding: '12px 20px',
  fontFamily: font.family,
  fontSize: 15,
  fontWeight: 800,
};
