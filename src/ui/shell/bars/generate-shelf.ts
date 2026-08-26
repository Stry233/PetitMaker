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
import { STENCIL_MIN_SIDE, textMinBox, type StencilMaterial } from '../../../tools/generation/stencil';
import { glyphSurvives } from './stencil-raster';
import type { StencilOutcome } from '../../../kit/operations/outcome';
import type { GenerateAlgorithm, GenerateConfig, MazeGates, StencilPlan, StencilWaterRole } from '../../../core/model/types';
import { EDGE, EDGE_RIGHT, RAIL, SHELF_SCALE, SHELF_TABS } from '../units';
import type { SliderShape } from './BarSlider';
import { DARK_PLATE } from '../../design/tokens';

/**
 * What kind of island a tab makes, which is now the whole of the row of names.
 *
 * They are KINDS OF ISLAND, so they belong in the row that names things: a maze is one of them
 * rather than a second algorithm standing beside a toggle. `island` is a place the generator
 * designs, `maze` is walls and corridors, and the two picture kinds build from what they are given.
 *
 * ONE ISLAND, NOT THREE. Land, Isles and Lakes were three biases of the same generator, and the
 * split cost more than it bought: it made the thing being tuned three things, each with its own
 * look to keep good, where the reference maps and the methodology describe ONE style. What varied
 * between them was how much sea a map holds, which is now the richness knob's business alone.
 */
export type GenerateKind = 'island' | 'maze' | 'text' | 'image';

export interface GenerateTab {
  id: GenerateKind;
  labelKey: string;
}

/** The order is the row of names, left to right, and it is a running order rather than a taxonomy:
 *  the kinds that build from something the visitor brings lead, and the one that designs a whole
 *  place out of a number stands at the end. */
export const TABS: readonly GenerateTab[] = [
  { id: 'maze', labelKey: 'generate.algo_maze' },
  { id: 'text', labelKey: 'gen.kind_text' },
  { id: 'image', labelKey: 'gen.kind_image' },
  { id: 'island', labelKey: 'gen.kind_island' },
];

/** Which generator a kind runs, and which of its own modes. The engine keeps the two apart — a maze
 *  has no terrain mode of its own — so the split happens here, at the one place a kind is read. */
export function algorithmFor(kind: GenerateKind): GenerateAlgorithm {
  if (kind === 'maze') return 'maze';
  if (kind === 'text' || kind === 'image') return 'stencil';
  return 'designed';
}


/** The kinds that build from a PICTURE the shell rasterizes, rather than from a seed alone. */
export function isStencilKind(kind: GenerateKind): boolean {
  return kind === 'text' || kind === 'image';
}

/**
 * The smallest painted region each picture kind will work in, as cells on the shorter side.
 *
 * DECLARED BY THE ENGINE, since it is a fact about what the readers can do with that many cells and
 * not a taste: the shelf's gate and the region brush's own floor both come from the one number.
 */
export { STENCIL_MIN_SIDE };

/** What a picture is built OUT of. Materials rather than a shape setting: the choice is what the
 *  island is made of. */
export type StencilFillKind = 'mountain' | 'water' | 'object' | 'flora' | 'trees' | 'road';
/**
 * What each kind may be built OUT of, and what each kind means by it. A LETTER is a shape: raised as
 * mountain, sunk as water, or tiled with a PICKED item. A PICTURE is colour: `mountain` is the green
 * ramp alone, `water` stands the picture in that ramp and sinks its light areas as water, `object` is the
 * mixed composition (terrain ground, objects at the anchor points), `flora` and `trees` tile every
 * cell with one family, and `road` matches against the path surfaces, which is a picture paved into
 * flat ground rather than planted on it. `pictureRecipe` is the table that says so.
 *
 * ONE FLAT ROW, NOT A CHOICE AND THEN A SUB-CHOICE, and the reason is that NOTHING ON THIS STRIP MAY
 * COME AND GO. A sub-choice under `object` is narrower while the row can drop it again for the other
 * materials — but a control that appears when a neighbour is pressed shoves every knob beside it,
 * which is exactly what the layout rule forbids. Standing in every state it costs 221 css px on every
 * picture; folded into this row the same three answers cost about 110, because they share one plate
 * and one set of paddings with the four they narrow. Flat is the arrangement that FITS once nothing
 * is allowed to vanish.
 *
 * AND HERE IS WHAT THE ROW HAS LEFT. Measured at `design/scale.tsx:FIT_REF` (1280x800, the narrowest the
 * strip is ever drawn, since any window at least 768 css px wide maps to at least 1280 design px)
 * with a picture's four controls all standing: ru has **141 css px** of slack, fr 142, id 157,
 * en 181, th 312, ja 329, zh 382 — and the figure does not move between materials, which is the
 * point. What has been spent buying room here before, if it is ever needed again: the material
 * control's visible label, sixty per cent of the sliders' drawn track length, and six px off every
 * gap in this row.
 *
 * THE OBJECT SPLIT IS THE PICTURE'S, and so is the road palette. A picture tiled with trees and
 * flowers at once reads as a mess in game, where a tree stands far taller than a bloom; a LETTER is
 * tiled with one item, chosen through the item shelf, so neither the split nor a palette of nine and
 * twenty road surfaces means anything to it.
 */
export function fillKindsFor(kind: GenerateKind): readonly StencilFillKind[] {
  return kind === 'image'
    ? ['mountain', 'water', 'object', 'flora', 'trees', 'road']
    : ['mountain', 'water', 'object'];
}

/** What each material is called. A table, not a key assembled at runtime: an assembled key is one no
 *  search finds and no missing-string check can enumerate. */
export const FILL_KEY: Record<StencilFillKind, string> = {
  mountain: 'gen.fill_mountain',
  water: 'gen.fill_water',
  object: 'gen.fill_object',
  flora: 'gen.fill_flora',
  trees: 'gen.fill_trees',
  road: 'gen.fill_road',
};

/**
 * What a segment is CALLED, which is not always what the material is named after.
 *
 * `object` means one picked item to a letter and the whole catalogue to a picture, and the picture's
 * reading only makes sense beside the two narrowed ones: "Objects, Flowers, Trees" reads as three
 * kinds that exclude each other, where "Mixed, Flowers, Trees" says which of them is the mix.
 */
export function fillLabelKey(kind: GenerateKind, fill: StencilFillKind): string {
  return kind === 'image' && fill === 'object' ? 'gen.fill_mixed' : FILL_KEY[fill];
}

/**
 * WHAT EACH PICTURE MATERIAL ACTUALLY BUILDS, as one table.
 *
 * `tiles` is the palette every cell is matched against, or null where the picture is coloured in
 * terrain instead. `decor` is what stands at the picture's anchor points over that result, or null
 * where the material is one thing throughout. `water` is the part water plays in a terrain reading
 * (`core/model/types.ts:StencilWaterRole`).
 *
 * MIXED IS A COMPOSITION, not a palette. It is the ground told in terrain — mountain and water both,
 * so a blue area is a real pond — with objects at the cells that carry the picture: its strongest
 * detail and the colours the green ramp cannot say, which in a catalogue with the trees left out
 * means flowers. That is what "everything but trees" is: the whole map's vocabulary except the one
 * element that would tower over the rest, arranged rather than tiled.
 *
 * WATER IS A MATERIAL, not a ninth colour. Asked for, it is what the INSIDE of the picture is made
 * of: the figure stands in the ramp and its light areas are sunk, since the blue is brighter than
 * any green and a picture's highlights are what it can say. As one entry beside eight greens it was
 * won by blue cells alone, so a picture that was not blue came back with no water in it at all.
 */
export interface PictureRecipe {
  tiles: StencilMaterial | null;
  decor: StencilMaterial | null;
  water: StencilWaterRole;
}

export function pictureRecipe(fill: StencilFillKind): PictureRecipe {
  if (fill === 'road') return { tiles: 'roads', decor: null, water: 'none' };
  if (fill === 'flora' || fill === 'trees') return { tiles: fill, decor: null, water: 'none' };
  if (fill === 'object') return { tiles: null, decor: 'mixed', water: 'palette' };
  return { tiles: null, decor: null, water: fill === 'water' ? 'primary' : 'none' };
}

/** Whether a letter's chosen ITEM is the thing being laid, which is the one state its chip can act
 *  in. It stands in every other state too, dimmed: see the layout rule in `GenerateShelf`. */
export function fillTakesItem(kind: GenerateKind, fill: StencilFillKind): boolean {
  return kind === 'text' && fill === 'object';
}

/**
 * Whether the layer knob has anything to set.
 *
 * A LETTER NEVER HAS A HEIGHT. It stands exactly one layer on whatever surface the region holds, so
 * there is no tallest layer to choose — the knob is gone from that kind entirely. A PICTURE'S
 * heights ARE its colours, so the knob is the depth of the ramp it is matched against, which only
 * means anything while the picture is being coloured in terrain.
 */
export function fillTakesElevation(kind: GenerateKind, fill: StencilFillKind): boolean {
  if (kind === 'text') return false;
  if (kind !== 'image') return true;
  // Whatever is coloured in TERRAIN has a ramp depth, mixed included: its ground is the ramp and
  // only its anchor points are objects.
  return pictureRecipe(fill).tiles === null;
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
 *
 * The TEXT floor here is the smallest region any glyph has been measured to survive, since this gate
 * answers for the whole shelf at once — one region serves five dealt cards and the visitor's own, so
 * up to six different texts are asked of it. Which of those the region can actually carry is each
 * CARD's question, and `textFitsBox` below answers it by measuring the letter that was drawn.
 */
export function regionFitsStencil(kind: GenerateKind, box: { width: number; height: number } | null): boolean {
  if (!isStencilKind(kind)) return true;
  if (!box) return true;    // no region painted: the whole island, which is always big enough
  return Math.min(box.width, box.height) >= STENCIL_MIN_SIDE[kind as 'text' | 'image'];
}

/**
 * Whether THIS WORD has the room, which the region gate above does not answer.
 *
 * TWO WAYS OF ANSWERING, and the good one costs a drawing. The floors in `stencil.ts` are a statement
 * about the hardest letter anyone might type, so a region at or above what the text asks for needs no
 * measuring and is served at once. Below that they say nothing useful about a PARTICULAR letter — an
 * E is three bars and two gaps and is perfect at five cells where an M fuses into a block — so the
 * glyph is drawn and read (`stencil-raster.ts:glyphSurvives`), on the legibility bars — the pieces it
 * came out in, the separation it kept, the share of its box under ink. That is what lets one small
 * region offer the cards it can carry and refuse the ones it cannot, rather than refusing the lot.
 *
 * Asked BEFORE anything is generated: a card that cannot be read is worth saying so on rather than
 * photographing.
 */
export function textFitsBox(text: string, box: { width: number; height: number } | null): boolean {
  if (!box) return true;
  const need = textMinBox(text);
  if (box.width >= need.width && box.height >= need.height) return true;
  return glyphSurvives(text, { origin: { x: 0, y: 0 }, width: box.width, height: box.height }).ok;
}

/** The width a word of this many characters asks for, for the message that refuses one. */
export function textNeedsWidth(text: string): number {
  return textMinBox(text).width;
}

/**
 * What a text run has to say about the ground it was written on, or null where it has nothing.
 *
 * ONE LINE, NAMING THE LARGEST REASON. The three buckets are separate things — a word crossing a
 * step, a word reaching the edge of the ground it stands on, a word with no layer left above it —
 * and each count is only true of its own bucket, so they cannot be added up into one sentence
 * without lying about what happened to which cells. Naming the biggest of them says the useful
 * thing; composing all three says four numbers and reads as a report.
 *
 * THE RULE, in full: the ceiling wins outright when the run wrote NOTHING, whatever the other two
 * counts are, since a word with no layer left above it is the one outcome otherwise
 * indistinguishable from a run with nothing to write; below that the largest bucket wins, and ties
 * go to the earlier one in the order below, which is the order of how much a visitor can do about
 * it. Anything else — the second reason, the total — is either untrue of the cells it names or a
 * report rather than a sentence.
 *
 * ONE CELL IS AN ORDINARY OUTCOME here, not an edge case: a word clips a step by a single cell all
 * the time. So each bucket carries its own singular reading, the way every other counted string in
 * this app does.
 */
export function stencilNote(
  kind: GenerateKind, s: StencilOutcome | undefined, placed: number,
): { key: string; n: number } | null {
  // NOTHING LAID IS ITS OWN CASE, and the silent one — but WHOSE nothing depends on the kind. The
  // buckets below are a letter's: they name what the ground did to a glyph standing one layer on it,
  // and a picture's run never reports them at all, so a picture reaching this function has only ever
  // reached this line. Saying a letter's line there told a visitor building a picture that none of
  // their WORD fit.
  const nothing = kind === 'image' ? 'gen.picture_nothing_laid' : 'gen.text_nothing_laid';
  if (placed === 0 && !s) return { key: nothing, n: 0 };
  if (!s) return null;
  // Both readings written out, never assembled: a key built at runtime is one no search finds and no
  // missing-string check can enumerate.
  const ceiling: Bucket = ['gen.text_at_ceiling', 'gen.text_at_ceiling_one', s.atCeiling];
  if (placed === 0 && s.atCeiling > 0) return said(ceiling);
  const worst = ([
    ['gen.text_off_base', 'gen.text_off_base_one', s.offBase],
    ['gen.text_unsupported', 'gen.text_unsupported_one', s.unsupported],
    ceiling,
  ] as Bucket[]).reduce((a, b) => (b[2] > a[2] ? b : a));
  if (worst[2] > 0) return said(worst);
  // A RUN THAT LAID NOTHING ALWAYS SAYS SO. The buckets above each name a reason the ground gave, and
  // when none of them fired and nothing was laid the reason is the region itself: the word had no ink
  // to put in it, or what it had fell outside the cells that were painted. Left to return null, the
  // press did nothing and said nothing, which reads as the button being broken.
  return placed === 0 ? { key: nothing, n: 0 } : null;
}

/** One reason a word came up short: what to say of several cells, what to say of one, how many. */
type Bucket = [many: string, one: string, n: number];

const said = ([many, one, n]: Bucket): { key: string; n: number } => ({ key: n === 1 ? one : many, n });

/**
 * The terrain bias a run is recorded with. ONE VALUE NOW, because the interface no longer asks.
 *
 * `mode` stays on the config because it still MEANS something to the pipeline and because a saved
 * recipe carries it: an old file naming `earth` or `water` must replay as the map it was. What the
 * UI no longer offers is the CHOICE, and `mixed` is the right thing to stop offering it at — the
 * island generator scales the water richness asked for by 0 on `earth`, 1 on `mixed` and 1.5 on
 * `water` (`designer/pipeline.ts:WATER_SCALE`), so `mixed` is the one bias that neither suppresses
 * the water nor amplifies it. It is also that pipeline's own declared fallback, and both reference
 * maps carry water throughout, which rules `earth` out on the look alone.
 */
export function modeFor(_kind: GenerateKind): GenerateConfig['mode'] {
  return 'mixed';
}

/**
 * How many candidates are drawn FOR the visitor. The row shows one more than this: the last card is
 * the one they type themselves.
 *
 * FIVE, BECAUSE THE COUNT DOES NOT PAY FOR THE PICTURE. The card is capped by `CARD_H`, which is
 * the shelf's FLOOR less what stands under it, and its width follows from that height because its
 * shape is the drawing's. So the row is measured out by the floor, not shared out by the width: the
 * cards only shrink together on a window too narrow for six of them at that height, which is
 * narrower than the frame is drawn for. So the width is not the constraint, and dropping to three
 * buys nothing: the same card at the same size, with two fewer islands to choose between. The cost is
 * real and it is elsewhere: a batch is this many generations.
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
   *  wide shape. The marker behind it is this plus `ring`, which is what keeps the two concentric. At
   *  40 the yellow turns a corner the grey under it does not. */
  radius: 30,
} as const;

/**
 * The yellow a chosen card stands on, as SHARES of the card's own box.
 *
 * A BAND BETWEEN TWO ROUNDED RECTANGLES IS ONLY EVEN IF THE OUTER RADIUS IS THE INNER PLUS THE GAP.
 * Grow a rect by `d` and its corner has to grow by `d` too; leave the radius short and the band
 * measures `sqrt(2)*d` at the corner, leave it long and the band PINCHES there. That is the whole
 * arithmetic, and the two numbers have to be written together: apart, they drift.
 *
 * AND BOTH ARE SHARES, NOT PIXELS, because the card is not drawn at the shelf's nominal scale. Its
 * height is capped by the shelf's floor (`CARD_H`) and its width follows from that, so the plate's
 * SVG lands at whatever fraction of 660 the row could spare — while a radius taken through `px()`
 * would be 30 design px at `SHELF_SCALE` regardless. On any window short enough to cap the card that
 * leaves the ring rounder than the plate under it and thins the yellow at the corners. A percentage
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
export const STRIP = {
  h: 26, gap: 10, padX: 15, right: EDGE_RIGHT,
  /**
   * A chip standing among the knobs, in css px. FIXED, because its reading is a setting: an item's
   * own name, or the n/a of a state it cannot act in. Sized for a name of about a dozen characters
   * beside its label at `TEXT.label`, which covers the catalogue in every locale it was measured in;
   * anything longer ellipsizes rather than pushing the row.
   */
  chip: 160,
} as const;

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
  /**
   * Control to control inside the strip: the chip, then each knob.
   *
   * SIXTEEN, NOT THE TWENTY-TWO the other rows use, and the reason is the same as the track's
   * length: with nothing allowed to come and go, the picture kind's row carries five controls at
   * once and each gap is paid for five times.
   */
  strip: 16,
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

/**
 * How long a track is drawn, in design px, and where the knob's travel starts and ends inside it.
 *
 * THE LENGTH IS A BUDGET, NOT A DRAWING, AND THE BUDGET IS PER KIND. The design source gave each
 * slider a 454 px slot with its name and reading laid out beside it; the names moved onto the
 * track's own bubble and the slot went with them, so what is left is a track as long as the row can
 * afford. What the row can afford depends on what else stands in it, and only ONE kind's row is
 * crowded: a picture carries six material segments and two sliders at once, where a maze carries two
 * switches and two sliders and an island carries two sliders alone. So the drawn length is the
 * design's own everywhere and the short one on the picture, rather than every kind paying the
 * tightest row's price, which leaves the island's and the maze's knobs on a third less track than
 * they were drawn with — and a shorter track is a coarser setting under the same hand.
 *
 * The knob's travel keeps the drawn proportion of whichever track it runs in.
 */
const TRACK_DRAWN = 454;
const TRACK_TIGHT = 300;

/** Two rects, one per slider the design drew, at the length the kind's row can spare. `y` is the row
 *  it was drawn in, which the tick and knob centring is measured against; the shelf no longer places
 *  anything by it. */
const sliderAt = (y: number, w: number): SliderShape => {
  const inset = Math.round((3089 - 3038) * (w / TRACK_DRAWN));
  const span = Math.round((3441 - 3089) * (w / TRACK_DRAWN));
  return {
    track: { x: 3038, y, w, h: 79 },
    first: 3038 + inset,
    last: 3038 + inset + span,
    centreY: y + 39.5,
    tick: 22,
    knob: 96,
    pip: 31,
  };
};

const slidersOf = (w: number) => ({
  /** Richness on the island kinds, corridor width on the maze: one drawn track, and only one of the
   *  two knobs applies to the kind that is running. */
  upper: sliderAt(1511, w),
  maxLayer: sliderAt(1612, w),
} as const);

export const SLIDERS = slidersOf(TRACK_DRAWN);
/** The picture kind's, whose row also carries six material segments. */
export const SLIDERS_TIGHT = slidersOf(TRACK_TIGHT);

/** Which pair a kind's strip draws. */
export function slidersFor(kind: GenerateKind): typeof SLIDERS {
  return kind === 'image' ? SLIDERS_TIGHT : SLIDERS;
}

/**
 * SCENERY RICHNESS: how much of a place an island is. 0..1 in the engine and a percentage on the
 * slider, which is the only place the two forms meet.
 *
 * The default is deliberately not the top of the range. At 100 the generator builds the fullest
 * island it knows how to — terraced to the ceiling, water on every layer, a tree for every flower —
 * and that is one taste rather than the middle of the room; the quiet end is a flat garden town, and
 * a default a little above the middle leaves both within a short drag.
 */
export const RICHNESS = { min: 0, max: 100, default: 70 } as const;

/** Corridor width, the maze's own knob. The generator clamps to this range itself. */
export const CORRIDOR = { min: 1, max: 3 } as const;

/**
 * A maze wall is at most `CORRIDOR.max` cells wide, and V-MTN-03 wants a 3x3 base under anything
 * above layer 3, so a taller maze would have most of its walls refused. The island has no such
 * limit and reaches the grid's own ceiling.
 */
export const MAZE_MAX_ELEVATION = 3;

export function maxElevationFor(kind: GenerateKind): number {
  return kind === 'maze' ? MAZE_MAX_ELEVATION : ELEVATION_MAX;
}

/**
 * The FLOOR of the same knob, one layer for every kind, each for its own reason. The island's
 * composition clamps its tiers to at least 1 (composition.ts `ceiling`, terrain-sculpt likewise), so
 * a cap of 0 builds the same island as a cap of 1 and a slider bottoming out at 0 would be a dead
 * stop; the floor says what the engine does. A MAZE is walls, and a wall at ground level is
 * not one — painting mountain at elevation 0 clears the cell. A picture kind lays its shape AT
 * this height, so zero would clear the cells it just claimed.
 */
export function minElevationFor(_kind: GenerateKind): number {
  return 1;
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
  richness: number;
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
    // The one 0..1 style knob, as a fraction: the shelf holds it as a percentage.
    richness: s.richness / RICHNESS.max,
    ...(s.kind === 'maze' && s.gates ? { mazeGates: s.gates } : {}),
    ...(isStencilKind(s.kind) && s.stencilPlan ? { stencilPlan: s.stencilPlan } : {}),
  };
}
