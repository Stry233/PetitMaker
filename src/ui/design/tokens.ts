/*
 * tokens.ts — the interface palette, reduced from what the design source draws.
 *
 * The document has no gradient, no pattern, no layer effect and not one stroke, so every token here
 * is a flat colour. Near-neighbours in the observation table (`#5B4833`, `#5C4934`, `#644933` beside
 * `#574935`) are drift from copied layers rather than a system, and collapse into these.
 *
 * NOTHING IN THIS FRAME CASTS A SHADOW. The treatments at the foot of the file are how a thing meets
 * the MAP — an outline on its own silhouette, never an offset or a blur.
 */
import type { CSSProperties } from 'react';
import { colors } from './styles';

/** Glyph ink: the dark brown every icon and unplated label is drawn in. */
export const INK = '#574935';
/** The light plate a control sits on. */
export const PLATE = '#FDFBE0';
/** Label ink ON a plate, a shade darker than `INK` so text reads at small sizes. */
export const PLATE_INK = '#544833';
/** Ink on a dark or saturated fill. */
export const ON_DARK = '#FFFFFF';
/** Marks the chosen thing: selected mode, pressed button, active tab. Aliases `colors.tileYellow`
 *  rather than the design source's `#FFE65F`, so the shell and the chrome answer "this is the
 *  chosen one" in ONE yellow. */
export const ACTIVE = colors.tileYellow;

/**
 * The keyboard-focus ring, and it is TWO TONES by necessity: it stands on cream plates, on `ACTIVE`
 * yellow, and on bare island running to a layer-8 mountain at `#1b7511`. No single colour clears
 * both ends. The rust carries the pale surfaces (4.8 on plate, 3.7 on yellow, 3.4 on sea) and
 * `FOCUS_HALO` the dark ones (5.6 on a layer-8 mountain); where a background defeats both, rust on
 * cream is still 4.8 against the halo itself.
 *
 * `Shell` publishes both as `--focus-ring` / `--focus-halo`, since `animations.css` draws them and a
 * stylesheet cannot read this module.
 */
export const FOCUS_RING = '#B3541E';
/** The pale outer ring — the plate's own cream, so on a plated control it reads as the plate
 *  reaching out rather than a second colour arriving. A hard band: no offset, blur or spread. */
export const FOCUS_HALO = PLATE;
/** Text fields show focus with their caret instead. A colour rather than a missing rule, so the
 *  stylesheet's own `var()` fallback stays reachable. */
export const FOCUS_RING_FIELD = 'transparent';
/** The ring's corner around a control whose shape is a DRAWING (a mode block, the top-right
 *  cluster): an illustration has no border-radius for an outline to follow. Everything else is a
 *  pill, disc or plate and carries its own. */
export const FOCUS_SHAPE_RADIUS = 14;

/**
 * The screen's vignette, on ONE EDGE: the map darkens toward the bottom of the window and nowhere
 * else, because the bottom is where a full-width shelf meets the map and the only edge with a seam
 * to soften. Tuned against both a pale empty sea and a dark generated island.
 *
 * A gradient rather than a shadow: a shadow cannot be given to one edge (an inset one casts from the
 * whole box, and four per-edge ones are four values to keep in step).
 */
const VIGNETTE_INK = 'rgba(52, 43, 31, 0.42)';
/** How deep the shading reaches, in css px — and so how far a pane must hang past the fold to carry
 *  it off screen entirely. */
export const VIGNETTE_DEPTH = 220;
export const EDGE_VIGNETTE = `linear-gradient(to top, ${VIGNETTE_INK}, transparent ${VIGNETTE_DEPTH}px)`;

/** Ink for text that is not yet real: the search field's placeholder. */
export const MUTED_INK = '#747474';

/*
 * The cream RAMP — how deep a surface sits. `PLATE` is the top; the three below are its own colour
 * walked down at the same hue and channel offsets (R = G+2, B = G-27), so a deeper level is the same
 * cream in shade rather than a greyer one.
 *
 * The steps are 1.18, 1.12 and 1.09 in contrast ratio and have to be that big: `PLATE` sits at 0.95
 * relative luminance with nothing above it, so the ramp runs downward and there is no room for a
 * fourth cream between any two. A surface standing ON an inset returns to `PLATE` rather than
 * continuing down, which keeps a nested control bright.
 */
/** A surface sitting ON a plate: a button, a field, a well, a floating menu. */
export const INSET = '#EAE8CD';
/** The one dividing rule (the menu sheet's separator) and the outline a field wears. Deep enough to
 *  still divide an `INSET`, not only a `PLATE`. */
export const LINE = '#DEDCC1';
/** A groove something runs in: a switch or segmented track, a progress bar's unfilled part. */
export const TRACK = '#D5D3B8';
/** The dark surface: the bottom shelves' bar and the layer control's plate. Ink on it is `ON_DARK`. */
export const DARK_PLATE = '#43413D';
/** A groove cut into that surface: the object shelf's scrollbar track, the generate shelf's sliders. */
export const DARK_GROOVE = '#363432';
/** The load ring's fill and the figure inside it — the one saturated colour in the document. */
export const LOAD_FILL = '#80FA00';

/** Text standing on the map: a warm off-white sampled off the game itself. Not `#FFFFFF`, which
 *  reads as a system overlay dropped on the island rather than part of it. */
export const MAP_TEXT = '#FFFEE3';

/**
 * How much ink an edge on the map carries, for a WORD and a DRAWING alike — they stand in the same
 * row, so they are one treatment or they are two. The map showing through at this alpha is what
 * makes an edge the shape's own shading rather than a line drawn around it.
 */
export const MAP_EDGE_ALPHA = 0.62;

const LABEL_EDGE = `${INK}${Math.round(MAP_EDGE_ALPHA * 255).toString(16).padStart(2, '0')}`;

/**
 * The treatment every word on the map wears, and what makes plates unnecessary: one dark pixel
 * between the letter and whatever is under it, exactly as the game does it.
 *
 * `paintOrder` puts the stroke UNDER the fill, so the glyph's drawn weight is untouched and a
 * centred stroke cannot eat into a CJK counter. In `em`, so one value serves a 13 px caption and a
 * 28 px shelf name. Drawn heavier it becomes a keyline around the word, which is the one thing a
 * hand-drawn interface must not look like.
 */
export const MAP_LABEL: CSSProperties = {
  color: MAP_TEXT,
  paintOrder: 'stroke fill',
  WebkitTextStroke: `0.075em ${LABEL_EDGE}`,
};

/** How far a drawing's edge reaches, in css px. A HAIRLINE, measured against the words beside it: a
 *  drawing is a bigger silhouette than a letter, so it sits at the bottom of their span. Applied via
 *  `SHAPE_EDGE_FILTER`, never directly. */
export const SHAPE_EDGE = 0.5;

/**
 * `MAP_LABEL` for a drawing rather than a word.
 *
 * IT IS ONE DILATION, NOT A STACK OF OFFSET COPIES. At this width each offset copy lands 0.29 of a
 * device pixel out — a partial-coverage smear, not a crisp copy — and eight of them accumulate
 * differently depending on where an edge falls on the pixel grid, so a curve thickens and thins as
 * it turns. Growing the alpha instead (blur, then threshold back to solid) is isotropic by
 * construction and has no such quantisation.
 *
 * Goes on a PARENT of the masked element: a filter applies before a mask on the same box, so an
 * outline written there is drawn around the untouched rectangle and then cut away with it.
 */
export const SHAPE_EDGE_ID = 'shell-shape-edge';
/** The blur's sigma and the ramp's steepness, calibrated as a PAIR: alpha reaches 1/slope at about
 *  `SHAPE_EDGE` out, so moving one alone moves where the edge sits. Thinning is the blur's job and
 *  lightening is `MAP_EDGE_ALPHA`'s — a shallower slope leaves a gradient, which is the shadow this
 *  filter exists to avoid. */
export const SHAPE_EDGE_FILTER = { blur: 0.362, slope: 12 } as const;

export const MAP_SHAPE_EDGE = `url(#${SHAPE_EDGE_ID})`;

/**
 * The edge a PANEL wears: the same family, drawn the way a rectangle can be. A border rather than
 * the dilation, since a rounded rectangle has a radius for a border to follow and running a whole
 * card through an SVG filter to draw a line CSS already draws is cost for nothing.
 *
 * ONE PX, WHERE THE DILATION REACHES HALF. A half-pixel border rasterizes to one row of half
 * coverage, so its apparent ink is 31% and the panel reads lighter than every word beside it. 1 px
 * is the thinnest a border carries this ink at the family's strength.
 */
export const PANEL_EDGE_WIDTH = 1;
export const PANEL_EDGE = `${PANEL_EDGE_WIDTH}px solid ${LABEL_EDGE}`;

/**
 * The fill a top-right control's drawing carries. The design source drew these white because they
 * were the only pale thing on that canvas; beside a column of cream plates, white reads as a control
 * from a different set. So the art is a SHAPE: the file supplies the silhouette, the frame the
 * colour — which also lets the pair take the edge above with no second drawing.
 */
export function mapShape(src: string): CSSProperties {
  // QUOTED: an inlined `data:` URI carries the drawing's own attribute quotes, and an unquoted css
  // url() token may not hold one — the declaration is dropped and the mask silently does nothing,
  // which shows as the drawing's box filled solid.
  const url = `url("${src}")`;
  return {
    background: PLATE,
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
  };
}
