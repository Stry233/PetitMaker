import type { CSSProperties } from 'react';
import { APP_FONT_FAMILY as FONT_FAMILY } from '../../assets/fonts/family';
import { DOM_CURSORS } from '../../assets/cursors/cursor-spec';
import { roleFont } from './text-weight';
import { FOCUS_RING, OVERLAY_DIM, inkTint, rgbaOf } from './tokens';
import { hexChannels } from '../../core/base/color';

/* ── Colours ─────────────────────────────────────────────── */

/** Two 6-digit hex colours blended in sRGB, `share` of the first over the rest of the second. This
 *  is what `color-mix(in srgb, a share, b)` computes, as a plain colour every engine can paint. */
export function mixHex(a: string, b: string, share: number): string {
  const [ar, ag, ab] = hexChannels(a);
  const [br, bg, bb] = hexChannels(b);
  const blend = (x: number, y: number) => Math.round(x * share + y * (1 - share)).toString(16).padStart(2, '0');
  return `#${blend(ar, br)}${blend(ag, bg)}${blend(ab, bb)}`;
}

/* ── Cursors ─────────────────────────────────────────────────
 * The four DOM cursors, as the custom properties `ui/design/cursors/cursor-vars` writes onto <html>;
 * components style a cursor only through these (`cursor-tokens.test.ts`), except the canvas, whose
 * cursor `view/interaction/cursor-controller` writes per pointer move.
 *
 * Each var carries the keyword fallback `cursors.css` uses: an unresolved var without one invalidates
 * the declaration, and the inherited cursor becomes the parent's arrow. Use a token only where
 * `cursors.css` does not cover the element (it gives buttons, links and `[role="button"]` the hand
 * and disabled controls the blocked cursor); an inline cursor on a control that can be disabled
 * outranks the sheet's disabled state. */
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
 * One number, because "this exists and refuses" is one fact: the layer panel's spent size arrows,
 * a slider whose context gives it nothing to set. It is deliberately not a removal — a control that
 * vanished would reflow the row every time the context changed, and a knob you can see not applying
 * is information. Paired with `cursors.blocked`, which is what a pointer over it reports.
 */
export const UNAVAILABLE = 0.35;

/* ── Radii ───────────────────────────────────────────────── */

/* The one corner scale. A literal radius outside `ui/design` snaps to a rung (`foundation-guards.test.ts`). */

export const radii = {
  // A corner rounds against what is behind it, so a surface with nothing behind it rounds nothing.
  // Named rather than written as a bare 0 for the reason every other rung is: it is a decision.
  none: 0,
  /** A hairline mark: a stripe, a caret, a thin bar. */
  hair: 2,
  sm: 4,
  /** A chip, a thumbnail, a small tile. */
  chip: 8,
  md: 12,
  /** A field or a button one size up from a chip. */
  field: 16,
  /** A floating card: a bubble, a toast, a picker tile. */
  card: 20,
  lg: 24,
  panel: 28, // cozy modal/panel corner
  pill: 99,
} as const;

/* ── Spacing ─────────────────────────────────────────────── */

/** The lengths a gap, padding or margin may take, in css px: even steps to 20, then 4s and 8s. A
 *  literal off the scale fails `foundation-guards.test.ts` outside the declared drawing tables. */
export const SPACE = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64] as const;

/*
 * ── The ladder ───────────────────────────────────────────
 *
 * Every layer the interface stacks in, named for what stands there and ordered by what may cover
 * what. A surface takes a rung by name; the one fair offset orders two parts of one component's
 * cluster (a badge over its own block).
 *
 * A rung counts only among siblings: `opacity` under 1, `transform`, `filter` and `zoom` each make a
 * stacking context that scopes every rung inside it. A sheet inside the frame's entrance fade cannot
 * reach over a column outside it, whatever its number. Never fix that with a transform: it becomes
 * the containing block for every `position: fixed` descendant.
 */
export const z = {
  ground: 1,         // The bottom of the ladder: the desk the paper is lying on. The assistant's
                     // panel while it is docked stands here, and the one live character with it
                     // while she is seated at it — the whole interface, the map included, is a sheet
                     // on top of that desk and slides aside to reveal it.
  paper: 3,          // the map: the bottom of the sheet everything else in the interface is drawn
                     // on. It is a rung rather than paint order because the desk below it has one,
                     // and the gap is for the character seated at that desk, who rides `ground + 1`
                     // — the same step she takes over the standing chrome.
  canvasControls: 50, // controls anchored to something on the canvas (the selection's rotate/delete/
                      // count row): above the canvas, below the app's own chrome — a panel the user
                      // opened must never be covered by a control that follows the camera.
  filing: 90,        // the main map's filing links: above the canvas and its controls, under every
                     // piece of real chrome, which they never compete with.
  panel: 100,        // the standing chrome: the bottom bars, the mode row, the corner cluster, the
                     // assistant's panel. What is simply there while the map is being built.
  column: 120,       // the right-hand column. It is the way out of whatever a bar is showing, and a
                     // bar is as wide as the window, so it stands over one.
  opened: 140,       // what a control just opened, and only for as long as it is open: the menu
                     // sheet, the layer stack. Over the column, because the column is what it was
                     // opened from and a press cannot produce a thing its own button covers.
  overlay: 200,      // modal backdrop (cozyOverlay)
  takeover: 250,     // a full-screen surface reached from inside a window (the stylize window, the 3D
                     // preview), so it stands above that window's overlay rather than inside it.
  toast: 300,        // toasts, above modals
  popover: 400,      // dropdowns/bubbles anchored to a control, above a modal's own content
  tour: 500,         // first-launch tour scrim/spotlight/bubble, above a popover so an open
                     // dropdown can never paint over the tour that is teaching someone to use it
  contextMenu: 9990, // right-click menu + delete popover, above everything
  helpWindow: 9992,  // contextual Help stays above the surface being explained
  helpPicker: 9994,  // picks controls above dialogs and their portaled menus
  guard: 10000,      // the portrait-lock blocker, above every other layer including contextMenu
  splash: 10005,     // the boot splash: the app is not ready to be used, so it stands over every
                     // surface a user could reach, under only the unmissable build mark
  unmissable: 10010, // the top of the ladder: a mark that must be readable whatever is open, and
                     // that must never take a pointer event. Today that is the dev-build watermark
                     // — a panel that could cover it would be a panel that hides which build this
                     // is. Anything standing here is `pointer-events: none` by rule, since a layer
                     // nothing can cover is a layer everything is blocked by if it is not. Being on
                     // top is not the whole job: whatever stands here has to read over the light
                     // map and over a dark shelf both, or a panel hides it without covering it.
} as const;

/* ── Shadows (espresso-tinted, no pure black) ────────────── */

export const shadows = {
  s1: '0px 2px 0px rgba(74, 59, 50, 0.1)',
  s2: '0px 8px 24px rgba(74, 59, 50, 0.08), 0px 2px 8px rgba(74, 59, 50, 0.04)',
  float: '0 4px 12px rgba(67,65,62,0.18), 0 1px 3px rgba(67,65,62,0.12)', // floating cozy buttons (zoom/history)
  /** The lift under a switch's knob, which is what says it slides over its track. */
  knob: '0 1px 3px rgba(67,65,62,0.35)',
  // The one shadow a floating choice list casts (`ui/primitives/FloatMenu`). A menu opens over the
  // surface that carries its trigger and the two creams are barely a step apart, so the halo is
  // what separates them; the drop underneath is what says the card is off the page rather than on
  // it. Every other surface in this frame meets the map with an outline instead.
  menu: '0 0 0 2px rgba(74, 59, 50, 0.08), 0 10px 28px rgba(74, 59, 50, 0.16), 0 2px 8px rgba(74, 59, 50, 0.08)',
  /** The what's-this picker's halo around the control under the pointer. */
  halo: `0 0 0 6px ${rgbaOf(FOCUS_RING, 0.18)}`,
  /** A framed box with everything around it dimmed: the 3D shot frame. */
  spotlight: '0 0 0 4000px rgba(22,20,18,0.42)',
  /** The drop under a round planet thumbnail, a `filter` value. */
  thumbDrop: `drop-shadow(0 2px 4px ${inkTint(0.2)})`,
} as const;

/* ── Typography ──────────────────────────────────────────── */

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
  /** Still gaining speed when it goes: for something leaving, which has no mark to settle on. */
  accel: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Comes to rest at both ends, for the last segment of a motion whose overshoot is already in its
   *  keyframes (a second deceleration over the top of one reads as a second bounce). */
  settle: 'cubic-bezier(0.3, 0, 0.55, 1)',
  expand: 'cubic-bezier(0.65, 0, 0.35, 1)',
  breathing: 'cubic-bezier(0.45, 0, 0.55, 1)',
  roll: 'cubic-bezier(0.16, 1, 0.3, 1)',
  fade: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/** The same four control points as an `easing` entry, for a Framer keyframe `ease` array. Derived
 *  from the CSS spelling rather than restated, so the two cannot drift. */
export function bezierOf(id: keyof typeof easing): [number, number, number, number] {
  const parts = easing[id].slice('cubic-bezier('.length, -1).split(',').map((n) => Number(n));
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

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
 * The defaults are tuned for values measured in pixels — a spring is finished once it is within
 * `restDelta` (0.01) of its target, at which point framer writes the target exactly. On a scale,
 * 0.01 is a whole percent of the element: an underdamped entrance is declared done while still
 * ~0.0017 away and snaps, which on a 300px card is half a pixel appearing in one frame at the very
 * end of the animation. Measured on the tour's welcome card, where the hard edges of the logo make
 * it plainly visible. These thresholds are a hundredth of that, so the final approach is continuous
 * and the last movement is well under a tenth of a pixel.
 */
export const scaleRest = { restDelta: 0.0002, restSpeed: 0.02 } as const;

/* Shared button press feedback (Framer Motion props) so every interactive
 * control reacts the same way. Spread onto a motion element: <motion.button
 * {...pressable} />. Important: the element must be positioned by layout
 * (flex / left+top), not a CSS `transform` — Framer Motion owns `transform`
 * for the scale and would clobber a centering translate (button-jump bug). */
export const interactionProfiles = {
  tile: { whileHover: { scale: 1.08 }, whileTap: { scale: 0.9 }, transition: springs.stiff },
  action: { whileHover: { scale: 1.03 }, whileTap: { scale: 0.95 }, transition: springs.stiff },
  choice: { whileHover: { scale: 1.05 }, whileTap: { scale: 0.95 }, transition: springs.stiff },
  toggle: { whileHover: { scale: 1.03 }, whileTap: { scale: 0.97 }, transition: springs.stiff },
  pill: { whileHover: { scale: 1.03 }, whileTap: { scale: 0.96 }, transition: springs.stiff },
  row: { whileHover: { scale: 1.01 }, whileTap: { scale: 0.985 }, transition: springs.stiff },
  tap: { whileTap: { scale: 0.9 }, transition: springs.stiff },
  actionTap: { whileTap: { scale: 0.95 }, transition: springs.stiff },
  pillTap: { whileTap: { scale: 0.96 }, transition: springs.stiff },
  toggleTap: { whileTap: { scale: 0.97 }, transition: springs.stiff },
  curveVertex: { whileHover: { scale: 1.12 }, transition: springs.stiff },
  keyboardKey: { whileHover: { y: -2 }, whileTap: { scale: 0.93 }, transition: springs.stiff },
  thumbnailAdd: { whileTap: { scale: 0.94 }, transition: springs.gentle },
  quietLink: { whileHover: { opacity: 1 }, whileTap: { opacity: 0.7 }, transition: springs.stiff },
  curveHandle: { whileHover: { scale: 1.15 }, transition: springs.stiff },
  /** A small badge that carries its control's action, such as a tag's removal cross. */
  badge: { whileHover: { scale: 1.18 }, whileTap: { scale: 0.9 }, transition: springs.stiff },
  /** A control whose feedback is drawn by a part of it (a removal badge) rather than by its own scale. */
  still: { transition: springs.stiff },
} as const;

export type InteractionProfile = keyof typeof interactionProfiles;

/** Inline style that also carries the `--pw-*` custom properties `animations.css` reads. */
export type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;
export const pressable = interactionProfiles.tile;
export const buttonMotion = interactionProfiles.action;

/* ── Helpers ─────────────────────────────────────────────── */

/* The dimmed backdrop a modal card sits on, shared by every overlay surface.
 * The card itself is `cozyPanel` in `ui/design/window-skin.ts`, which is where it can name the
 * interface's own panel edge without this module reaching back up for it. */
export const cozyOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: OVERLAY_DIM,
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // A dim that covers everything, over a card that stands on the work. While the assistant's panel
  // is docked it owns a strip at one side of the window: the backdrop still reaches it, because a
  // modal takes the whole app over and the overlay lock has to reach the panel too, while the padding
  // is what keeps the card centred over the interface rather than half over the panel. Both edges are
  // named because the dock stands at either, and at most one of the pair is ever non-zero. In real css
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

/** In the accessibility tree and the tab order, but not drawn: `display: none` or `visibility:
 *  hidden` would remove the node from both. */
export const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/* Shared modal label-row layout (space-between label/value pairs). Modals spread this and
 * add their own padding/border/etc. as needed — those extras differ per modal, so they stay
 * local to each file. */
export const modalRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
