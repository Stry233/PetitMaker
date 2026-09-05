import type { CSSProperties } from 'react';
import { DOM_CURSORS } from '../../core/runtime/cursor-spec';
import { INK, CREAM, ERROR_RED } from '../../core/runtime/brand-palette';
import { roleFont } from './text-weight';

/* The espresso ink the hairline borders + shadows tint (rgb 67,65,62). Same ink as INK above,
 * expressed as RGB components for the rgba() alpha blends below. */
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
  statusError: ERROR_RED,
  statusSuccess: '#6BCB77',

  /* Cozy palette measured 1:1 from the design source. */
  // frameDark and inkText are the same dark ink; kept as semantic aliases (frame, text).
  // Do not let their values diverge.
  frameDark: INK,         // dark rounded outer frame / ink
  panelCream: CREAM,      // cream panel fill
  tileYellow: '#FFDA7E',  // tile column 0
  sliderYellow: '#FFD774', // slider fill + knob (Settings UI-scale) — one hex digit
                           // from tileYellow, kept distinct on purpose (measured from the PSD)
  dangerBg: '#F6E3E0',     // destructive-action surface (Settings "Local data" confirm)
  dangerText: '#B03A2E',   // destructive-action label
  dangerDeep: '#7A2A21',   // destructive-action emphasis copy
  tileGreen: '#CED779',   // tile column 1
  tilePaleYellow: '#FFE196', // tile column 2
  tileDeepGreen: '#C7CF68',  // tile column 3
  // Generate's three mode tiles, chosen against each other. Random's fill is `sliderYellow` above.
  tileModeOrange: '#FFD595', // Generate's Maze mode
  tileModeGreen: '#BFE39B',  // Generate's AI Agent mode
  utilTaupe: '#CFC7B7',   // the assistant's paused dock and its setup rows
  paperThink: '#E8E1D2',  // surfaceSecondary nudged toward tileGreen: thinking, no tool has run yet
  stopTaupe: '#C3B7A3',   // an abort is not a wait, so it sits a step below utilTaupe
  revertAmber: '#B97F24', // outcome ink: the rules took the work back
  inkText: INK,           // body ink on a cream surface
  brownText: '#826042',   // file-row labels
  inkBorder: `rgba(${INK_RGB},0.12)`,  // hairline ink tint (matches the shadow ink)
  trackOff: '#D8D2C4',    // inactive segmented-control / switch / dropdown track
  white: '#FFFFFF',
} as const;

/** An ink-tinted rgba at arbitrary alpha (rgb 67,65,62) — the hairline/shadow ink family. Use
 *  instead of hand-typing `rgba(67,65,62,α)` so the tint lives in one place. `colors.inkBorder`
 *  is the α=0.12 shortcut. */
export const inkTint = (alpha: number): string => `rgba(${INK_RGB},${alpha})`;

/** A 6-digit hex colour with an alpha channel appended, as a `#rrggbbaa` string. The byte is always
 *  TWO hex digits: an unpadded `toString(16)` drops the leading zero below 0x10 (alpha under ~0.063),
 *  which emits a 7-character string neither a 6- nor an 8-digit colour parses as. */
export function withAlpha(color: string, alpha: number): string {
  return `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

/* ── Cursors ─────────────────────────────────────────────────
 * The four cursors the DOM shows, as the custom properties `ui/design/cursors/cursor-vars` writes onto
 * <html>. Every component styles a cursor through one of these, not a bare CSS keyword;
 * `__tests__/ui/design/cursor-tokens.test.ts` enforces it. The canvas is the one exception: it goes
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
  /** The what's-this pick mode. Resolves to the OS help arrow until the painted set gains a
   *  question-mark drawing of its own. */
  help: `var(${DOM_CURSORS.help}, help)`,
} as const;

/**
 * How far a control fades where it is present but does not apply.
 *
 * ONE NUMBER, because "this exists and refuses" is one fact: the layer panel's spent size arrows,
 * a slider whose context gives it nothing to set. It is deliberately not a removal — a control that
 * vanished would reflow the row every time the context changed, and a knob you can see not applying
 * is information. Paired with `cursors.blocked`, which is what a pointer over it reports.
 */
export const UNAVAILABLE = 0.35;

/* ── Radii ───────────────────────────────────────────────── */

export const radii = {
  // A CORNER ROUNDS AGAINST WHAT IS BEHIND IT, so a surface with nothing behind it rounds nothing.
  // Named rather than written as a bare 0 for the reason every other rung is: it is a decision.
  none: 0,
  sm: 4,
  md: 12,
  lg: 24,
  panel: 28, // cozy modal/panel corner
  pill: 99,
} as const;

/*
 * ── The ladder ───────────────────────────────────────────
 *
 * Every layer the interface stacks in, named for WHAT STANDS THERE and ordered by what may cover
 * what. A surface takes a rung BY NAME. A rung plus an offset (`z.panel + 2`) is how a surface
 * claims a layer nobody can find: the number says nothing about what it is meant to be over.
 *
 * ONE OFFSET IS FAIR, and it is the only one: ordering two parts of ONE cluster against each
 * other, where both are drawn by the same component and neither is a surface of its own (a badge
 * over its own block). A surface that must stand over ANOTHER SURFACE takes a rung.
 *
 * A RUNG IS ONLY WORTH ITS NUMBER AMONG ITS OWN SIBLINGS. An `opacity` under 1, a `transform`, a
 * `filter` and a `zoom` each make an element a STACKING CONTEXT, and every rung inside one is then
 * scoped to the rung that element itself stands on. The frame's entrance fade is exactly this: it
 * wraps the standing chrome, so a sheet inside it at `opened` cannot reach over a column standing
 * outside it at `column` however high the sheet's own number is — the sheet has to be a sibling of
 * the column to use a rung above it. And the fix for that is never a transform: a transform on an
 * ancestor becomes the containing block for every `position: fixed` descendant and pulls the whole
 * frame off the window's corners.
 */
export const z = {
  ground: 1,         // THE BOTTOM OF THE LADDER: the desk the paper is lying on. The assistant's
                     // panel while it is DOCKED stands here, and the one live character with it
                     // while she is seated at it — the whole interface, the map included, is a sheet
                     // on top of that desk and slides aside to reveal it.
  paper: 3,          // the map: the bottom of the sheet everything else in the interface is drawn
                     // on. It is a rung rather than paint order because the desk below it has one,
                     // and the gap is for the character SEATED at that desk, who rides `ground + 1`
                     // — the same step she takes over the standing chrome.
  canvasControls: 50, // controls anchored to something ON the canvas (the selection's rotate/delete/
                      // count row): above the canvas, BELOW the app's own chrome — a panel the user
                      // opened must never be covered by a control that follows the camera.
  panel: 100,        // the standing chrome: the bottom bars, the mode row, the corner cluster, the
                     // assistant's panel. What is simply THERE while the map is being built.
  column: 120,       // the right-hand column. It is the way out of whatever a bar is showing, and a
                     // bar is as wide as the window, so it stands over one.
  opened: 140,       // what a control just opened, and only for as long as it is open: the menu
                     // sheet, the layer stack. Over the column, because the column is what it was
                     // opened from and a press cannot produce a thing its own button covers.
  overlay: 200,      // modal backdrop (cozyOverlay)
  stylizeWindow: 250, // the stylize window: a full-screen takeover reached from inside the export
                      // modal's own overlay, so it stands ABOVE that overlay rather than inside it
                      // (the same standing Preview3D takes, reached from the same modal).
  toast: 300,        // toasts, above modals
  popover: 400,      // dropdowns/bubbles anchored to a control, above a modal's own content
  tour: 500,         // first-launch tour scrim/spotlight/bubble, above a popover so an open
                     // dropdown can never paint over the tour that is teaching someone to use it
  contextMenu: 9990, // right-click menu + delete popover, above everything
  guard: 10000,      // the portrait-lock blocker, above every other layer including contextMenu
  splash: 10005,     // the boot splash: the app is not ready to be used, so it stands over every
                     // surface a user could reach, under only the unmissable build mark
  unmissable: 10010, // the top of the ladder: a mark that must be readable whatever is open, and
                     // that must never take a pointer event. Today that is the dev-build watermark
                     // — a panel that could cover it would be a panel that hides which build this
                     // is. Anything standing here is `pointer-events: none` by rule, since a layer
                     // nothing can cover is a layer everything is blocked by if it is not. Being on
                     // top is not the whole job: whatever stands here has to READ over the light
                     // map and over a dark shelf both, or a panel hides it without covering it.
} as const;

/* ── Shadows (espresso-tinted, no pure black) ────────────── */

export const shadows = {
  s1: '0px 2px 0px rgba(74, 59, 50, 0.1)',
  s2: '0px 8px 24px rgba(74, 59, 50, 0.08), 0px 2px 8px rgba(74, 59, 50, 0.04)',
  hover: '0px 12px 32px rgba(74, 59, 50, 0.12)',
  float: '0 4px 12px rgba(67,65,62,0.18), 0 1px 3px rgba(67,65,62,0.12)', // floating cozy buttons (zoom/history)
  // The ONE shadow a floating choice list casts (`ui/primitives/FloatMenu`). A menu opens over the
  // surface that carries its trigger and the two creams are barely a step apart, so the halo is
  // what separates them; the drop underneath is what says the card is off the page rather than on
  // it. Every other surface in this frame meets the map with an outline instead.
  menu: '0 0 0 2px rgba(74, 59, 50, 0.08), 0 10px 28px rgba(74, 59, 50, 0.16), 0 2px 8px rgba(74, 59, 50, 0.08)',
} as const;

/* ── Typography ──────────────────────────────────────────── */

/* The one font stack — every face below references it so the family lives in a single place. */
const FONT_FAMILY = "'Alibaba PuHuiTi 3', 'PW Rounded Sans', 'Varela Round', system-ui, sans-serif";

export const font = {
  family: FONT_FAMILY,

  h1: {
    ...roleFont('lead'),
    lineHeight: '140%',
    fontFamily: FONT_FAMILY,
  } satisfies CSSProperties,

  h2: {
    ...roleFont('head'),
    lineHeight: '140%',
    fontFamily: FONT_FAMILY,
  } satisfies CSSProperties,

  body: {
    ...roleFont('body'),
    lineHeight: '150%',
    fontFamily: FONT_FAMILY,
  } satisfies CSSProperties,

  caption: {
    ...roleFont('caption'),
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
  /** Still gaining speed when it goes: for something LEAVING, which has no mark to settle on. */
  accel: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Comes to rest at both ends, for the last segment of a motion whose overshoot is already in its
   *  keyframes (a second deceleration over the top of one reads as a second bounce). */
  settle: 'cubic-bezier(0.3, 0, 0.55, 1)',
} as const;

/** The same four control points as an `easing` entry, for a Framer keyframe `ease` array. Derived
 *  from the CSS spelling rather than restated, so the two cannot drift. */
export function bezierOf(id: keyof typeof easing): [number, number, number, number] {
  const parts = easing[id].slice('cubic-bezier('.length, -1).split(',').map((n) => Number(n));
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

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

/* The PRESS half of `pressable` on its own, for a control that answers the hover on a different
 * element than the one taking the press. The rail's round buttons are the case: the box the pointer
 * is judged against has to stand still, so the button element keeps its square and its DRAWN plate
 * carries the growth (`Rail.tsx`). The press stays here, on the button, because that is what a
 * keyboard activates. Derived from `pressable` rather than restated, so the press cannot come out
 * different on the buttons that take this one. */
export const pressOnly = {
  whileTap: pressable.whileTap,
  transition: pressable.transition,
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

/* ── Helpers ─────────────────────────────────────────────── */

/* The dimmed backdrop a modal card sits on, shared by every overlay surface.
 * The card itself is `cozyPanel` in `ui/design/window-skin.ts`, which is where it can name the
 * interface's own panel edge without this module reaching back up for it. */
export const cozyOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: colors.surfaceOverlay,
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // A DIM THAT COVERS EVERYTHING, OVER A CARD THAT STANDS ON THE WORK. While the assistant's panel
  // is docked it owns a strip at one side of the window: the backdrop still reaches it, because a
  // modal takes the whole app over and the overlay lock has to reach the panel too, while the padding
  // is what keeps the CARD centred over the interface rather than half over the panel. Both edges are
  // named because the dock stands at either, and at most one of the pair is ever non-zero. In REAL css
  // px, since this element is the one that does not carry the chrome's `zoom` — the card inside does.
  paddingLeft: 'var(--pin-dock-left-px, 0px)',
  paddingRight: 'var(--pin-dock-right-px, 0px)',
  zIndex: z.overlay,
};


/* Bare icon/transparent button reset — the panels render their own art, so
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
  ...roleFont('title'),
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
  ...roleFont('action'),
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
  ...roleFont('action'),
};
export const footerGhost: CSSProperties = {
  background: colors.surfaceSecondary,
  color: colors.frameDark,
  border: 'none',
  borderRadius: radii.md,
  padding: '12px 20px',
  fontFamily: font.family,
  ...roleFont('action'),
};
