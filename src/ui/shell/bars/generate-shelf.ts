/*
 * generate-shelf.ts — what the 生成 bar offers, the ranges behind it, and the few proportions the
 * drawing still fixes.
 *
 * THE BAR LAYS ITSELF OUT. Every control is as wide as its own label at a fixed type size, so the
 * design source's absolute rects (a slot per tab, a drawn width per button, a run of canvas per
 * slider name) are gone: they were room for text to shrink into, and text no longer shrinks. What
 * survives is the proportions of a DRAWING — the candidate card, the slider — which are read
 * through `units.ts:SHELF_SCALE` like every other piece of art in a bottom shelf.
 *
 * THREE BANDS, AND THE THIRD COSTS NOTHING. The names are on the map, the cards stand up out of the
 * plate's top edge, and the settings sit INSIDE the plate under them — the plate runs to the bottom
 * of the window and only the object shelf was using that room, for its scrollbar. The shelf had
 * eleven controls in two of the bands and a settings column bolted beside the cards; what is left
 * after the kinds became the names, the batch became a tile and Clear went to the menu is one row
 * per band.
 *
 * The RANGES come from the engine, never from the drawing: a slider that hardcoded its ceiling
 * would keep showing eight after the grid learned a ninth layer.
 */
import { ELEVATION_MAX } from '../../../core/model/constants';
import type { GenerateAlgorithm, GenerateConfig, MazeGates, StencilPlan } from '../../../core/model/types';
import { EDGE, EDGE_RIGHT, RAIL, SHELF_SCALE, SHELF_TABS } from '../units';
import type { SliderShape } from './BarSlider';
import { DARK_PLATE } from '../../design/tokens';

/**
 * What kind of island a tab makes, which is now the whole of the row of names.
 *
 * They are KINDS OF ISLAND, so they belong in the row that names things: a maze is one of them
 * rather than a second algorithm standing beside a three-way toggle. `earth` is dry land (the
 * generator gives it no water at all), `water` is flat islands in a wide sea, `mixed` is both, and
 * `maze` is walls and corridors.
 */
export type GenerateKind = GenerateConfig['mode'] | 'maze' | 'text' | 'image';

export interface GenerateTab {
  id: GenerateKind;
  labelKey: string;
}

/**
 * The order is the row of names, left to right, and it is a running order rather than a taxonomy:
 * the kinds that make a WHOLE PLACE from one press lead, and the three terrain flavours (which
 * differ from each other only in how much of the island is water) sit together at the end.
 */
export const TABS: readonly GenerateTab[] = [
  { id: 'maze', labelKey: 'generate.algo_maze' },
  { id: 'text', labelKey: 'gen.kind_text' },
  { id: 'image', labelKey: 'gen.kind_image' },
  { id: 'earth', labelKey: 'gen.terrain_earth' },
  { id: 'water', labelKey: 'gen.terrain_water' },
  { id: 'mixed', labelKey: 'gen.terrain_mixed' },
];

/** Which generator a kind runs, and which of its own modes. The engine keeps the two apart — a maze
 *  has no terrain mode of its own — so the split happens here, at the one place a kind is read. */
export function algorithmFor(kind: GenerateKind): GenerateAlgorithm {
  if (kind === 'maze') return 'maze';
  if (kind === 'text' || kind === 'image') return 'stencil';
  return 'random';
}

/** The kinds that build from a PICTURE the shell rasterizes, rather than from a seed alone. */
export function isStencilKind(kind: GenerateKind): boolean {
  return kind === 'text' || kind === 'image';
}

/**
 * The smallest painted region each picture kind will work in, as cells on the shorter side.
 *
 * A stencil is exactly as many cells as the region it fills, so the region IS the resolution: below
 * some size a letter stops being the letter and a photograph stops being the photograph. The two
 * numbers differ because the two modes need different amounts of it — a glyph is one bold shape and
 * survives coarse treatment, a picture is detail everywhere and does not.
 *
 * Provisional, and meant to be moved once there is a feel for the results.
 */
export const STENCIL_MIN_SIDE: Record<'text' | 'image', number> = { text: 16, image: 32 };

/** What a letter is built OUT of. Three materials rather than a shape setting: the choice is what
 *  the island is made of, and only the mountain has a height to argue about. */
export type StencilFillKind = 'mountain' | 'water' | 'object';
/**
 * What each kind may be built OUT of — the same three choices, meaning what each kind can mean by
 * them. A LETTER is a shape: raised as mountain, sunk as water, or tiled with a PICKED item. A
 * PICTURE is colour: `mountain` is the green ramp alone, `water` lets the blue join the palette so a
 * blue-ish area becomes a real pond, and `object` matches every cell against the catalogue's own
 * colours — automatically, since the picture picks its items itself.
 */
export const FILL_KINDS: readonly StencilFillKind[] = ['mountain', 'water', 'object'];

/** What each material is called. A table, not a key assembled at runtime: an assembled key is one no
 *  search finds and no missing-string check can enumerate. */
export const FILL_KEY: Record<StencilFillKind, string> = {
  mountain: 'gen.fill_mountain',
  water: 'gen.fill_water',
  object: 'gen.fill_object',
};



/** Only a mountain letter has a height, so only it lets the layer knob do anything. A picture's
 *  lower slot carries its contrast instead, so the question does not arise there. */
export function fillTakesElevation(kind: GenerateKind, fill: StencilFillKind): boolean {
  return kind !== 'text' || fill === 'mountain';
}

/** The picture's contrast knob, as the slider reads it: percent, 100 leaving the image alone. */
export const CONTRAST = { min: 50, max: 250, def: 130 } as const;

/**
 * The most characters a letter island is built from.
 *
 * Counted in CODE POINTS, so one emoji is one of them. The cap is about the EXTREME case rather than
 * about taste: a stencil is fitted to the region's shorter side, so every character added makes each
 * one narrower, and a long word in a modest region arrives as a row of unreadable smudges that still
 * costs a full generation to find out about. Six is enough for a name and short enough that the
 * thinnest stroke is still a cell or two wide at the region floor.
 */
export const TEXT_MAX_CHARS = 6;

/**
 * Whether the space a kind was given is big enough to approximate in.
 *
 * A picture kind needs no REGION: with none painted the whole island is the space, exactly as it is
 * for every other kind, and a visitor who wants a letter across the middle of their map should not
 * have to draw a box around it first. A region is how you say "smaller than that", and the only thing
 * checked is whether what it names has the room.
 */
export function regionFitsStencil(kind: GenerateKind, box: { width: number; height: number } | null): boolean {
  if (!isStencilKind(kind)) return true;
  if (!box) return true;    // no region painted: the whole island, which is always big enough
  return Math.min(box.width, box.height) >= STENCIL_MIN_SIDE[kind as 'text' | 'image'];
}

export function modeFor(kind: GenerateKind): GenerateConfig['mode'] {
  return kind === 'maze' || kind === 'text' || kind === 'image' ? 'earth' : kind;
}

/**
 * How many candidates are drawn FOR the visitor. The row shows one more than this: the last card is
 * the one they type themselves.
 *
 * FIVE, BECAUSE THE COUNT DOES NOT PAY FOR THE PICTURE. The card is capped by `CARD_H`, which is
 * the shelf's FLOOR less what stands under it, and its width follows from that height because its
 * shape is the drawing's. So the row is measured out by the floor, not shared out by the width: the
 * cards only shrink together on a window too narrow for six of them at that height, which is
 * narrower than the frame is drawn for. Dropping to three was tried on the belief that the width
 * was the constraint and bought nothing at all — the same card at the same size, with two fewer
 * islands to choose between. The cost is real and it is elsewhere: a batch is this many
 * generations.
 */
export const CANDIDATES = 5;

/** One candidate card, as the drawing proportions it: the picture's rect and the recipe line's are
 *  fractions of the plate, so the card keeps its shape at whatever width the row can spare it. */
export const CARD = {
  w: 660,
  h: 450,
  pic: { x: 45, y: 35, w: 568, h: 333, r: 50 },
  label: { y: 382, h: 57 },
  /** How far the selected marker stands out past the plate on every side. */
  ring: 10,
  /** The card plate's own drawn corner, read off its path: the arc runs 629 to 659 across a 660
   *  wide shape. The marker behind it is this plus `ring`, which is what keeps the two concentric.
   *  It was 40, so the yellow turned a corner the grey under it did not. */
  radius: 30,
} as const;

/**
 * The yellow a chosen card stands on, as SHARES of the card's own box.
 *
 * A BAND BETWEEN TWO ROUNDED RECTANGLES IS ONLY EVEN IF THE OUTER RADIUS IS THE INNER PLUS THE GAP.
 * Grow a rect by `d` and its corner has to grow by `d` too; leave the radius short and the band
 * measures `sqrt(2)*d` at the corner, leave it long and the band PINCHES there. That is the whole
 * arithmetic, and the corner has been reported wrong three times because the two numbers were
 * written separately and drifted apart.
 *
 * AND BOTH ARE SHARES, NOT PIXELS, because the card is not drawn at the shelf's nominal scale. Its
 * height is capped by the shelf's floor (`CARD_H`) and its width follows from that, so the plate's
 * SVG lands at whatever fraction of 660 the row could spare — while a radius taken through `px()`
 * would be 30 design px at `SHELF_SCALE` regardless. On any window short enough to cap the card, the
 * ring was rounder than the plate under it and the yellow thinned at the corners. A percentage
 * resolves against the box it is on, so both terms follow the drawing by construction.
 *
 * The 2 is the plate art's own inset: `candidates/roundrect-1.svg` draws its path from 2 rather than
 * from 0, so the visible shape starts there and the band is measured from the shape, not the box.
 */
const PLATE_INSET = 2;
const RING_OUT = CARD.ring - PLATE_INSET;
export const CHOSEN = {
  /** How far the marker stands outside the card's box, per axis, as a share of that axis. */
  insetX: RING_OUT / CARD.w,
  insetY: RING_OUT / CARD.h,
  /** Its corner, per axis, as a share of the MARKER's own box: the plate's radius plus the band. */
  radiusX: (CARD.radius + CARD.ring) / (CARD.w + 2 * RING_OUT),
  radiusY: (CARD.radius + CARD.ring) / (CARD.h + 2 * RING_OUT),
} as const;

/**
 * The batch tile at the end of the cards: how wide it is as a share of the row's own height, the
 * mark on it, and its corner in design px.
 *
 * IT IS WHERE THE EYE ALREADY IS. A tile after the last card is the next thing along the row;
 * standing anywhere else — the other end of the shelf, say — rejecting all six would mean looking
 * away from the pictures to ask for six more.
 *
 * IT IS NOT A CARD. It has no picture and no recipe number, and drawn to a card's shape it would
 * read as a candidate that had failed to photograph itself. Drawn to a SQUARE it reads as the
 * loudest thing on the shelf, which is a cream plate the size of a candidate. So it is a tall slim
 * plate: as findable as the cards, and plainly a control rather than one of them.
 */
export const BATCH = { wide: 0.62, glyph: 30, radius: CARD.radius } as const;

/**
 * The strip inside the plate: the scope chip at its left, the two knobs at its right.
 *
 * Its height is the pill's, which is also what the sliders' art comes to at this shelf's scale, so
 * the band is as deep as the taller of the two things standing in it and no deeper. `gap` is the
 * room between the cards' feet and it, inside the dark.
 *
 * A SLIDER IN THIS INTERFACE STANDS AT THE RIGHT, on the edge the view kit's column stands on
 * (`units.ts:EDGE_RIGHT`) — the terrain bar's brush slider is there and these are the same control.
 * So the strip reaches past the shelf's own `PAD.right` to that edge: the rail's clusters stop at
 * `units.ts:RAIL_FLOOR`, well above the band, so nothing down here has to step aside for them. The
 * CARDS still do, which is why this is the strip's own number rather than the shelf's.
 */
/** The strip's one control height, the air between it and the cards, and its word padding. `h` is
 *  every control's box — the scope chip, the fill segments, each slider's slot — so the row reads as
 *  one line of same-sized things; the card row above pays for `gap` (`CARD_H` derives from both). */
export const STRIP = { h: 26, gap: 10, padX: 15, right: EDGE_RIGHT } as const;

/**
 * The shelf's plate: its fill. Where it sits and how its corner is turned is `units.ts:PLATE_BAND`,
 * which both bottom bars share — the drawing gives them the same shape.
 *
 * The extracted art (`shelf-generate/roundrect-1.svg`) is one filled roundrect and is DRAWN rather
 * than placed: it has to be as wide as the viewport, and an SVG keeps its own aspect ratio, so an
 * `<img>` there letterboxes instead of stretching. The fill is that shape's.
 */
export const BAR = { fill: DARK_PLATE } as const;

/**
 * Room between things, in CSS px. A judgement call at real size rather than a measurement of the
 * drawing: the design source's runs were slots sized for text that shrank to fit them.
 */
export const GAP = {
  /**
   * The row of names to the block under it, and the LAST thing the height budget serves.
   *
   * The floor is fixed and the strip inside the plate takes its own depth out of it, so what is
   * left over is the card's — this gap is the only term that can give the picture anything back,
   * and it is the cheapest of them: it is bare map between a heading and the cards it heads. Still
   * wide enough that the two read as the shelf's heading and the shelf's contents rather than as
   * one block.
   */
  row: 12,
  /** Card to card, and the last card to the batch tile. */
  card: 13,
  /** Control to control inside the strip: the chip, then each knob. */
  strip: 22,
  /** A slider's name, its track and its reading. */
  sliderPart: 10,
} as const;

/**
 * The room between the two tiles at the end of the row, in CSS px.
 *
 * WIDER THAN CARD TO CARD, and that is the whole of the safeguard. The two wear the same plate at
 * the same size, one is pressed often and the other takes a generation back, so a hand running
 * along the row has to feel two targets rather than one strip. Size and style cannot do the
 * separating — they are the same on purpose, so the pair reads as two things you do to a batch —
 * and a confirmation is not warranted either: Clear is one stroke group, so a mis-press costs one
 * undo, and it cannot reach anything placed by hand inside the region.
 */
export const PAIR_GAP = GAP.card * 2;

/**
 * What the rows keep clear, in CSS px. `side` is `units.ts:SHELF_TABS.left`, the edge both shelves
 * hang their row of names from, so switching modes leaves the names where they were. `right` is the
 * rail: three clusters of round buttons stand against that edge, and a row reaching under them
 * would put a label behind a control. The PLATE still runs the full width; only its contents step
 * aside.
 */
export const PAD = {
  top: 14, bottom: 12, side: SHELF_TABS.left, right: EDGE_RIGHT + RAIL.button + EDGE,
} as const;

/**
 * The candidate card's height in css px: the drawing's own 450, which is what makes the cards stand
 * up out of the backing band rather than sit inside a box.
 *
 * It is a CEILING. What a card is actually given is the room the row of names leaves once the strip
 * under it has been served, so on a window where the drawn size would leave the map less than half
 * the screen the card keeps its shape and takes what the shorter floor leaves.
 */
export const CARD_MAX_H = CARD.h * SHELF_SCALE;

/** What a card is actually given: the floor, less the shelf's own bottom padding, less the strip
 *  and its gap, less the room over the block — never more than the drawing's own. */
export const CARD_H = Math.min(
  CARD_MAX_H,
  SHELF_TABS.floor - PAD.bottom - STRIP.h - STRIP.gap - GAP.row,
);

/** The block under the row of names: the cards, the strip, and the room between them. DECLARED from
 *  its parts rather than measured, because it is what keeps the names still through a change of
 *  algorithm, of language and of report. */
export const BODY_H = CARD_H + STRIP.gap + STRIP.h;

/** Two rects, one per slider the design drew. `y` is the row it was drawn in, which the tick and
 *  knob centring is measured against; the shelf no longer places anything by it. */
const sliderAt = (y: number): SliderShape => ({
  track: { x: 3038, y, w: 454, h: 79 },
  first: 3089,
  last: 3441,
  centreY: y + 39.5,
  tick: 22,
  knob: 96,
  pip: 31,
});

export const SLIDERS = {
  /** Naturalness on the island kinds, corridor width on the maze: one drawn track, and only one of
   *  the two knobs applies to the kind that is running. */
  upper: sliderAt(1511),
  maxLayer: sliderAt(1612),
} as const;

/** Naturalness is 0..1 in the engine and a percentage on the slider, which is the only place the
 *  two forms meet. */
export const NATURALNESS = { min: 0, max: 100 } as const;

/** Corridor width, the maze's own knob. The generator clamps to this range itself. */
export const CORRIDOR = { min: 1, max: 3 } as const;

/**
 * A maze wall is at most `CORRIDOR.max` cells wide, and V-MTN-03 wants a 3x3 base under anything
 * above layer 3, so a taller maze would have most of its walls refused. The island has no such
 * limit and reaches the grid's own ceiling.
 */
export const MAZE_MAX_ELEVATION = 3;

/** Water mode holds the land at ground level and spends the map on sea instead, so the tallest
 *  layer it can reach is the first one. */
const WATER_MAX_ELEVATION = 1;

export function maxElevationFor(kind: GenerateKind): number {
  if (kind === 'maze') return MAZE_MAX_ELEVATION;
  return kind === 'water' ? WATER_MAX_ELEVATION : ELEVATION_MAX;
}

/**
 * The FLOOR of the same knob, which is the ground for an island and the first layer for a maze.
 *
 * An island with no tallest layer is a legitimate recipe and the generator has always taken it:
 * `shaping.ts` floors the tier at 0 on purpose, and the run comes back a flat grass island with its
 * trees and buildings on it. A MAZE is walls, and a wall at ground level is not one — painting
 * mountain at elevation 0 clears the cell — so the one kind whose height IS its subject keeps a
 * floor of 1.
 */
export function minElevationFor(kind: GenerateKind): number {
  // A picture kind lays its shape AT this height, so zero would clear the cells it just claimed.
  return kind === 'maze' || isStencilKind(kind) ? 1 : 0;
}

/**
 * What the generator will take as a recipe number, exclusive.
 *
 * A SEED IS A UINT32, which is `core/model/rng.ts:makeRng`'s own contract (`seed >>> 0`) and what
 * every derived stream assumes when it XORs a 32-bit constant into it. The field is bounded by that
 * and by nothing smaller: a number a person can type has to be a number the engine can use, and one
 * that silently refuses its sixth digit teaches that the app is broken.
 */
export const SEED_MAX = 0x1_0000_0000;

/** How wide the field lets a recipe number get, in digits. `SEED_MAX - 1` is ten of them. */
export const SEED_DIGITS = String(SEED_MAX - 1).length;

/**
 * The range the shelf DRAWS from, which is not the range it accepts.
 *
 * A card carries its number as a caption and a person reads it, writes it down and types it back,
 * so the ones this shelf chooses are five digits. That is a drawing decision about the batch and
 * says nothing about what may be typed into the last card.
 */
const DRAWN_SEED_MAX = 100000;

export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * DRAWN_SEED_MAX);
}

/** The seeds a batch draws, from the one the batch is named by. Consecutive rather than
 *  independently random: a recipe number written down brings back the whole batch it was chosen
 *  from. */
export function batchSeeds(base: number): number[] {
  return Array.from({ length: CANDIDATES }, (_, i) => (base + i) % DRAWN_SEED_MAX);
}

export interface ShelfSettings {
  kind: GenerateKind;
  seed: number;
  /** 0..100, as the slider reads it. */
  naturalness: number;
  maxElevation: number;
  corridorWidth: number;
  gates: MazeGates | null;
  /** text/image only: the rasterized picture and how to read it. Absent until there is one, which
   *  is what the shelf shows an empty field for. */
  stencilPlan?: StencilPlan | null;
}

/**
 * What a candidate and its picture are both generated from.
 *
 * `region` stays null here: the scope is an argument to the run rather than part of the recipe, and
 * it is the shelf that holds it — the same recipe under two scopes is one recipe.
 */
export function shelfConfig(s: ShelfSettings): GenerateConfig {
  return {
    algorithm: algorithmFor(s.kind),
    mode: modeFor(s.kind),
    corridorWidth: s.corridorWidth,
    maxElevation: Math.min(s.maxElevation, maxElevationFor(s.kind)),
    seed: s.seed,
    region: null,
    naturalness: s.naturalness / NATURALNESS.max,
    ...(s.kind === 'maze' && s.gates ? { mazeGates: s.gates } : {}),
    ...(isStencilKind(s.kind) && s.stencilPlan ? { stencilPlan: s.stencilPlan } : {}),
  };
}
