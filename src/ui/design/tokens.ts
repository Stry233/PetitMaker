/*
 * The interface palette, reduced from what the design source draws.
 *
 * The document has no gradient, no pattern, no layer effect and not one stroke, so every token here
 * is a flat colour. Near-neighbours in the observation table (`#5B4833`, `#5C4934`, `#644933` beside
 * `#574935`) are drift from copied layers rather than a system, and collapse into these.
 *
 * Nothing in this frame casts a shadow. The treatments at the foot of the file are how a thing meets
 * the map — an outline on its own silhouette, never an offset or a blur.
 */
import type { CSSProperties } from 'react';
import type { CommandCategory } from '../../state/keymap/registry';
import { ZONE_COLORS } from '../../core/model/palette';
import { CellZone } from '../../core/game/zones';
import { BROWN_TEXT, ERROR_RED, FRAME_INK, MAP_EDGE_ALPHA, MAP_INK, MAP_TEXT, PLATE, SURFACE_SECONDARY, TEXT_PRIMARY, TEXT_SECONDARY, rgbaOf } from '../../assets/brand-palette';

/** Glyph ink: the dark brown every icon and unplated label is drawn in. */
export const INK = MAP_INK;
/** Label ink on a plate, a shade darker than `INK` so text reads at small sizes. */
export const PLATE_INK = '#544833';
/** Ink on a dark or saturated fill. */
export const ON_DARK = '#FFFFFF';
/** Marks the chosen thing: selected mode, pressed button, active tab. The tile yellow rather than
 *  the design source's `#FFE65F`, so the shell and the chrome answer "this is the chosen one" in
 *  One yellow. */
export const ACTIVE = '#FFDA7E';
/*
 * The house colours beside the design source's: chrome text and surfaces, states and the picker tiles.
 */
export { FRAME_INK, PLATE, SURFACE_SECONDARY, TEXT_PRIMARY, TEXT_SECONDARY, rgbaOf };
/** The sea a planet picture stands on: the map's own void zone, so a preview's margin reads as the
 *  water around the planet. */
export const SEA = ZONE_COLORS[CellZone.Void]!;
/** Text that is secondary or deliberately receding: a note, a legend, a version line. */
export const MUTED = BROWN_TEXT;
/** The warm accent: a warning stripe, a countdown ring, the tour spotlight. */
export const ACCENT = '#FFB347';
export const ERROR = ERROR_RED;
export const SUCCESS = '#6BCB77';
/** The dim behind a window, and the deeper one behind a window at work (it stands in for the blur). */
export const OVERLAY_DIM = 'rgba(74, 59, 50, 0.4)';
export const OVERLAY_DIM_WORKING = 'rgba(74, 59, 50, 0.5)';
/** The destructive surface, its label and its emphasis copy. */
export const DANGER_SURFACE = '#F6E3E0';
export const DANGER_INK = '#B03A2E';
export const DANGER_DEEP = '#7A2A21';
/** The Settings UI-scale slider fill, a step off `ACTIVE` as the design source measures it. */
export const SLIDER_YELLOW = '#FFD774';
/** The map ground green a backdrop stands on before the map draws. */
export const CANVAS_GREEN = '#8CC9A1';
/** The assistant's paper tones: a paused dock, thinking before any tool has run, an abort. */
export const PAUSED_TAUPE = '#CFC7B7';
export const THINKING_PAPER = '#E8E1D2';
export const STOPPED_TAUPE = '#C3B7A3';
/** The outcome ink for work the rules took back. */
export const REVERT_AMBER = '#B97F24';
/** The frame ink at any alpha: the hairline and shadow ink family. */
export const inkTint = (alpha: number): string => rgbaOf(FRAME_INK, alpha);
/** A 6-digit hex or `rgb()`/`rgba()` colour at no alpha, so a fade to or from it never passes through black. */
export function clearOf(colour: string): string {
  if (colour.startsWith('#')) return rgbaOf(colour, 0);
  const channels = /rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(colour);
  return channels ? `rgba(${channels[1]!.trim()}, ${channels[2]!.trim()}, ${channels[3]!.trim()}, 0)` : colour;
}
/** The hairline the older borders use. */
export const HAIRLINE = inkTint(0.12);

/** The other tile fills a picker's columns take beside `ACTIVE`. */
export const TILE_GREEN = '#CED779';
export const TILE_PALE_YELLOW = '#FFE196';
export const TILE_DEEP_GREEN = '#C7CF68';
/** Generate's AI Agent mode tile (its Random tile is `SLIDER_YELLOW`). */
export const TILE_MODE_GREEN = '#BFE39B';


/**
 * The keyboard-focus ring, and it is two tones by necessity: it stands on cream plates, on `ACTIVE`
 * yellow, and on bare ground running to a layer-8 mountain at `#1b7511`. No single colour clears
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
/** The run a field has selected, where the field paints its own text instead of the browser. */
export const FIELD_SELECTION = ACTIVE;
/** The ring's corner around a control whose shape is a drawing (a mode block, the top-right
 *  cluster): an illustration has no border-radius for an outline to follow. Everything else is a
 *  pill, disc or plate and carries its own. */
export const FOCUS_SHAPE_RADIUS = 14;

/**
 * The screen's vignette, on one edge: the map darkens toward the bottom of the window and nowhere
 * else, because the bottom is where a full-width shelf meets the map and the only edge with a seam
 * to soften. Tuned against both a pale empty sea and a dark generated map.
 *
 * A gradient rather than a shadow: a shadow cannot be given to one edge (an inset one casts from the
 * whole box, and four per-edge ones are four values to keep in step).
 */
const VIGNETTE_INK = 'rgba(52, 43, 31, 0.42)';
/** How deep the shading reaches, in css px — and so how far a pane must hang past the fold to carry
 *  it off screen entirely. */
export const VIGNETTE_DEPTH = 220;
export const EDGE_VIGNETTE = `linear-gradient(to top, ${VIGNETTE_INK}, transparent ${VIGNETTE_DEPTH}px)`;
/** The same ink as a wash from a picture's top-left corner, behind a map label laid over the picture
 *  (a planet preview's name), so the light words hold against pale sand. Size the box it fills. */
export const CORNER_VIGNETTE = `radial-gradient(farthest-side at top left, ${VIGNETTE_INK}, transparent)`;

/** Ink for text that is not yet real: the search field's placeholder. */
export const MUTED_INK = '#747474';

/*
 * The cream ramp — how deep a surface sits. `PLATE` is the top; the three below are its own colour
 * walked down at the same hue and channel offsets (R = G+2, B = G-27), so a deeper level is the same
 * cream in shade rather than a greyer one.
 *
 * The steps are 1.18, 1.12 and 1.09 in contrast ratio and have to be that big: `PLATE` sits at 0.95
 * relative luminance with nothing above it, so the ramp runs downward and there is no room for a
 * fourth cream between any two. A surface standing on an inset returns to `PLATE` rather than
 * continuing down, which keeps a nested control bright.
 */
/** A surface sitting on a plate: a button, a field, a well, a floating menu. */
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
/** A section washed one step off the plate without hiding what lies under it: a Settings group, the Help index. */
export const WASH = rgbaOf(INSET, 0.42);
/** The plate laid over a picture that is being rebuilt, so the picture still shows through. */
export const VEIL = rgbaOf(PLATE, 0.82);
/** A file size that grew, and one that shrank. */
export const SIZE_GROWS = '#5FA046';
export const SIZE_SHRINKS = '#CE9145';
/** The keyboard window's keycap tint per command category. */
export const KEY_CATEGORY_COLORS: Record<CommandCategory, string> = {
  surface: TILE_GREEN,
  tool: ACTIVE,
  brush: TILE_PALE_YELLOW,
  layer: '#A9D8E8',
  selection: '#FFB39A',
  camera: '#C9BEF0',
  view: '#8ED9C0',
  history: '#D8D2C4',
  app: '#F7C68C',
  overlay: '#9FD9F0',
};

/** The ink of a warning that does not stop the work (a share code too dense to scan easily). */
export const CAUTION_INK = '#B5701F';
/** The stylize window's own papers: a picked direction, the custom direction's sample, the words
 *  over a direction that needs a key, and the veil behind them. */
export const STYLIZE_PAPER = { picked: '#FFF7DD', custom: '#F7F4E9', onVeil: '#F5EEDA', veil: '#1E1A14' } as const;

/** The load ring's fill and the figure inside it — the one saturated colour in the document. */
export const LOAD_FILL = '#80FA00';
/** A mask's two channels: what it keeps and what it cuts away. */
export const MASK_KEEP = '#FFFFFF';
export const MASK_CUT = '#000000';
/** Plain black, for the shade a drawn line casts in a pictured control. */
export const SHADE = '#000000';
/** The object shelf scrollbar's thumb, as the design source draws it. */
export const SHELF_THUMB = '#8B877C';

/**
 * The construction-tape stripe: a 45-degree repeating diagonal of the house `ACTIVE` yellow and the
 * house `INK`. `stripeSize` is the tile the gradient repeats at (CSS `background-size`) — an 8px band
 * measured along the 45-degree axis is `8 * Math.SQRT2` px on each screen axis.
 */
export const TAPE = {
  /** The unfilled groove, the house one. */
  track: TRACK,
  stripeLight: ACTIVE,
  stripeDark: INK,
  /** px, `8 * Math.SQRT2`. */
  stripeSize: 11.3137,
} as const;

/** Text standing on the map, and how much ink an edge on the map carries. A word and a drawing
 *  stand in the same row, so they wear one treatment; the map showing through the edge at that
 *  alpha is what makes it the shape's own shading rather than a line drawn around it. */
export { MAP_TEXT, MAP_EDGE_ALPHA };

const LABEL_EDGE = `${INK}${Math.round(MAP_EDGE_ALPHA * 255).toString(16).padStart(2, '0')}`;

/**
 * The treatment every word on the map wears, and what makes plates unnecessary: one dark pixel
 * between the letter and whatever is under it, exactly as the game does it.
 *
 * `paintOrder` puts the stroke under the fill, so the glyph's drawn weight is untouched and a
 * centred stroke cannot eat into a CJK counter. In `em`, so one value serves a 13 px caption and a
 * 28 px shelf name. Drawn heavier it becomes a keyline around the word, which is the one thing a
 * hand-drawn interface must not look like.
 */
export const MAP_LABEL: CSSProperties = {
  color: MAP_TEXT,
  paintOrder: 'stroke fill',
  WebkitTextStroke: `0.075em ${LABEL_EDGE}`,
};

/**
 * `MAP_LABEL` for a drawing rather than a word.
 *
 * It is one dilation, not a stack of offset copies. At this width each offset copy lands 0.29 of a
 * device pixel out — a partial-coverage smear, not a crisp copy — and eight of them accumulate
 * differently depending on where an edge falls on the pixel grid, so a curve thickens and thins as
 * it turns. Growing the alpha instead (blur, then threshold back to solid) is isotropic by
 * construction and has no such quantisation.
 *
 * Goes on a parent of the masked element: a filter applies before a mask on the same box, so an
 * outline written there is drawn around the untouched rectangle and then cut away with it.
 */
export const SHAPE_EDGE_ID = 'shell-shape-edge';
/** The blur's sigma and the ramp's steepness, calibrated as a pair: alpha reaches 1/slope about 0.5
 *  css px out, the bottom of a `HAIRLINE`'s span since a drawing is a bigger silhouette than a
 *  letter, so moving one alone moves where the edge sits. Thinning is the blur's job and
 *  lightening is `MAP_EDGE_ALPHA`'s — a shallower slope leaves a gradient, which is the shadow this
 *  filter exists to avoid. */
export const SHAPE_EDGE_FILTER = { blur: 0.362, slope: 12 } as const;

export const MAP_SHAPE_EDGE = `url(#${SHAPE_EDGE_ID})`;

/**
 * The same hairline for a plate whose silhouette is its border-radius box, as a spread-only ring:
 * still an outline, but rasterised at device resolution by every engine, where WebKit draws the
 * filter about twice as wide and soft (an arbitrary silhouette goes through `shape-edge.tsx`).
 * Half a px is one crisp device row on a dense display, but WebKit drops a half-px ring on a 1x
 * screen, so there it is a full px at half the ink. Read per call, so a window moved between screens
 * follows on its next render.
 */
export function plateShapeEdge(): string {
  const dense = (typeof window === 'undefined' ? 2 : window.devicePixelRatio) >= 1.5;
  return dense
    ? `0 0 0 0.5px ${LABEL_EDGE}`
    : `0 0 0 1px ${INK}${Math.round((MAP_EDGE_ALPHA / 2) * 255).toString(16).padStart(2, '0')}`;
}

/**
 * The edge a panel wears: the same family, drawn the way a rectangle can be. A border rather than
 * the dilation, since a rounded rectangle has a radius for a border to follow and running a whole
 * card through an SVG filter to draw a line CSS already draws is cost for nothing.
 *
 * One px, where the dilation reaches half. A half-pixel border rasterizes to one row of half
 * coverage, so its apparent ink is 31% and the panel reads lighter than every word beside it. 1 px
 * is the thinnest a border carries this ink at the family's strength.
 */
export const PANEL_EDGE_WIDTH = 1;
export const PANEL_EDGE = `${PANEL_EDGE_WIDTH}px solid ${LABEL_EDGE}`;

/**
 * The fill a top-right control's drawing carries. The design source drew these white because they
 * were the only pale thing on that canvas; beside a column of cream plates, white reads as a control
 * from a different set. So the art is a shape: the file supplies the silhouette, the frame the
 * colour — which also lets the pair take the edge above with no second drawing.
 */
export function mapShape(src: string): CSSProperties {
  // Quoted: an inlined `data:` URI carries the drawing's own attribute quotes, and an unquoted css
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
