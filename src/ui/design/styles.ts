import type { CSSProperties } from 'react';
import { APP_FONT_FAMILY as FONT_FAMILY } from '../../assets/fonts/family';
import { DOM_CURSORS } from '../../assets/cursors/cursor-spec';
import { roleFont } from './text-weight';
import { FOCUS_RING, OVERLAY_DIM, inkTint, rgbaOf } from './tokens';

/* ── Cursors ─────────────────────────────────────────────────
 * The DOM cursors, as the custom properties `ui/design/cursors/cursor-vars` writes onto <html>;
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
  /** A control whose run is in flight; the DOM shows the ring's first frame, still. */
  busy: `var(${DOM_CURSORS.busy}, progress)`,
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

/* The one corner scale. A radius outside `ui/design` names a rung. */

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

/** The corner of an entry whose highlight sits `inset` px inside a panel corner of radius `outer`,
 *  concentric with it; never tighter than the entry's own `base` corner. */
export function concentricRadius(outer: number, inset: number, base: number): number {
  return Math.max(base, outer - inset);
}

/** The corners of one entry in a list on a rounded panel: the corners facing the panel's outer corners
 *  (the top two of the first entry, the bottom two of the last, all four of a sole entry) are
 *  concentric with it, the rest keep `base`. Separators are not entries. */
export function entryCorners(
  edge: { first: boolean; last: boolean }, outer: number, inset: number, base: number,
): Pick<CSSProperties, 'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomRightRadius' | 'borderBottomLeftRadius'> {
  const rim = concentricRadius(outer, inset, base);
  const top = edge.first ? rim : base;
  const bottom = edge.last ? rim : base;
  return { borderTopLeftRadius: top, borderTopRightRadius: top, borderBottomRightRadius: bottom, borderBottomLeftRadius: bottom };
}

/* ── Spacing ─────────────────────────────────────────────── */

/** The lengths a gap, padding or margin may take, in css px: even steps to 20, then 4s and 8s;
 *  only a drawing zone sets lengths off the scale. */
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
  uprightBar: 125,   // the upright frame's bar, its panel and the clusters veiled with them: over the
                     // right-hand column, which a panel the handle draws tall covers, since that
                     // panel is what is being used.
  opened: 140,       // what a control just opened, and only for as long as it is open: the menu
                     // sheet, the layer stack. Over the column, because the column is what it was
                     // opened from and a press cannot produce a thing its own button covers.
  notice: 190,       // what speaks about the map from over it (the arrival greeting, the menu's speech
                     // bubbles, a toast posted while no window stands): over the standing chrome and
                     // what it opened, under every window, which is what is being used once one is up.
  overlay: 200,      // modal backdrop (cozyOverlay)
  takeover: 250,     // a full-screen surface reached from inside a window (the stylize window, the 3D
                     // preview), so it stands above that window's overlay rather than inside it.
  toast: 300,        // a toast posted while a window stands, about what was done in it: above modals
  popover: 400,      // dropdowns/bubbles anchored to a control, above a modal's own content
  tour: 500,         // first-launch tour scrim/spotlight/bubble, above a popover so an open
                     // dropdown can never paint over the tour that is teaching someone to use it
  contextMenu: 9990, // right-click menu + delete popover, above everything
  helpWindow: 9992,  // contextual Help stays above the surface being explained
  helpPicker: 9994,  // picks controls above dialogs and their portaled menus
  heldName: 9996,    // a held control's name bubble: above every surface that can hold a named
                     // control, Help included. It takes no pointer and stands only while a finger
                     // holds the control, so it can cover nothing a press needs.
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

/** The ladder inside one row or grid of cards, which stacks apart from the page's (a positioned card
 *  slot with a z-index makes its own context): the chosen card stands over the neighbours its plate
 *  bleeds into, and what is drawn over the cards (a card's own control, a selection box) over it. */
export const zCards = { chosen: 1, over: 2 } as const;

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

/* Pointer feedback lives with the rest of motion; re-exported for the controls that style from here. */
export { interactionProfilesFor, pressable, type InteractionProfile, type InteractionProfiles } from './motion/press';

/** Inline style that also carries the `--pw-*` custom properties `animations.css` reads. */
export type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

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
