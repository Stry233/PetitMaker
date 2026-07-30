/**
 * Cursor art: one 32x32 SVG per cursor, authored at that size rather than traced from the
 * ~200px hand-drawn icons, whose isometric detail turns to mush this small.
 *
 * CONSTRUCTION RULES, which every cursor below is drawn to:
 *
 * - SIZE: the box is `CURSOR_SIZE` and the viewBox is `0 0 CURSOR_SIZE CURSOR_SIZE`, so an
 *   authored coordinate IS an image pixel and a hotspot in `cursor-spec` needs no conversion.
 * - INK is ONE weight for the whole set: a 2px stroke of `colors.frameDark`, with round joins
 *   and round caps everywhere. No glyph gets a lighter or heavier line to make itself fit.
 *   The only sharp point in the set is the pointer apex, which carries the meaning "this pixel".
 * - AN OUTLINED SHAPE MUST BE WIDE ENOUGH TO CARRY THE INK. A 2px stroke lands 1px inside the path
 *   on each side, so a narrow part closes up and reads as a solid lump instead of a light shape
 *   with an outline. Measured at 32px, the width at which a cream interior survives is 4px for an
 *   axis-aligned part and 4.5px for a DIAGONAL one, which antialiases on both edges. Those are the
 *   floors a hand's finger gaps, the eraser's body across its short axis, the pointer's stem and
 *   every ribbon and shaft are sized against; a shape that cannot carry the line gets WIDER, never
 *   a thinner line.
 * - FILL is `colors.panelCream`, except a tool that paints a material, which is filled with
 *   the colour the MAP draws that material in.
 * - MARGIN: a 2px stroke overhangs its path by 1px, so 2px-stroked geometry stays within
 *   1.5..30.5 and every coordinate in the file stays inside 0..32.
 * - OCCUPANCY: a pointing cursor's ink runs corner to corner, from the arrow apex on (2,2) to
 *   the glyph's far edge near (30,30). A symmetric cursor is centred on (16,16), which is its
 *   hotspot, and spans at least 26 of the 32px on its long axis.
 * - RADIUS: no vertex in a tool glyph is left to the round join, which only rounds a 2px ink
 *   line and leaves the fill under it mitred. A corner is CONSTRUCTED as a quadratic whose
 *   control point is the vertex it replaces, with the path cut back along both edges by the
 *   radius: 4.5px on a tile's square corners, 2.2..3.2px on an angled silhouette's vertices.
 * - THERE IS ONE ARROW. `ARROW` is the set's only pointer, at one size and one weight, and every
 *   pointing cursor is that arrow with its tool glyph drawn OVER it, OVERLAPPING: the arrow
 *   first, the glyph second, so the glyph occludes the arrow's tail and keeps every identifying
 *   feature of its own. Overlapping is what lets the glyph be full size in a 32px box; sitting them
 *   side by side is what used to force the tool into a shrunken corner. The glyph fills
 *   (11,11)..(30,30) and the arrow's apex on (2,2) is the hotspot for all of them.
 * - THE TOOL IS THE LARGER OF THE TWO. A tool cursor names a tool, so the glyph is what the eye
 *   lands on and `TIP` is a small pointer attached to it: `ARROW` scaled to 0.55 about its apex,
 *   with the stem alone widened back to the 4.5px diagonal ink floor. 0.55 is itself a FLOOR: the
 *   barb between head and tail measures 2px there, and anything smaller closes it, at which point
 *   the pointer stops reading as a pointer.
 * - A STROKE-ONLY glyph (orbit, marquee, text) is drawn twice, a wide cream halo first and the
 *   ink over it, so it stays legible on a dark panel where ink alone would vanish.
 * - THERE IS ONE HAND, in three states: `hand-open`, `hand-closed` and `clickable` share a
 *   FOUR-finger grid on the same x boundaries (8.5 / 13.25 / 18 / 22.75 / 27.5), the same palm
 *   box, the same thumb lobe and the same crease positions. A state may change only what closing
 *   a hand changes: how far each finger curls, the resulting height, and where the thumb lies.
 *   A finger may never appear, vanish or change width between them, because `hand-open` and
 *   `hand-closed` ALTERNATE inside one drag and any other difference reads as a flicker.
 *   Fingers are separated by INTERIOR ink lines, not by gaps, since a 2px outline closes any gap
 *   narrow enough to fit four fingers; fingertips are rounded and of UNEQUAL length, which is
 *   the cue that reads as a hand at a glance.
 * - The refusal badge is a circle-slash parked in the top-right corner, clear of the glyph.
 *   The Ctrl membership badges (select-add/select-remove) share that same corner circle, ink
 *   stroke and cream fill; only the mark inside it (a plus, a minus) differs.
 */
import { colors } from '../styles';
import { ELEVATION_COLORS, WATER_COLOR } from '../../core/model/constants';
import { CURSORS, CURSOR_SIZE, type CursorId } from './cursor-spec';

const INK = colors.frameDark;
const CREAM = colors.panelCream;
/** Road tan: the same value the catalog gives road-dirt, which tileGhostColor() reads. */
const ROAD = '#c4a882';
const MOUNTAIN = ELEVATION_COLORS[3]!;

/** A filled shape with the house outline: ink stroke, cream or material fill. */
function body(d: string, fill: string): string {
  return `<path d="${d}" fill="${fill}" stroke="${INK}"`
    + ' stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
}

/** Ink strokes over a cream halo, so the glyph survives a dark background. */
function haloed(d: string, width: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${CREAM}" stroke-width="${width + 3.6}"`
    + ' stroke-linecap="round" stroke-linejoin="round"/>'
    + `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width}"`
    + ` stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

/** Interior ink lines that divide a hand's silhouette into fingers. */
function creases(d: string): string {
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
}

/** The refusal badge: a circle-slash at the TOP-RIGHT, where no glyph puts its identifying feature. */
const FORBIDDEN_BADGE = [
  `<circle cx="25.5" cy="6.5" r="5.8" fill="${CREAM}" stroke="${INK}" stroke-width="2"/>`,
  `<circle cx="25.5" cy="6.5" r="3.6" fill="none" stroke="${colors.statusError}" stroke-width="1.9"/>`,
  `<path d="M23 9 L28 4" stroke="${colors.statusError}" stroke-width="1.9" stroke-linecap="round"/>`,
].join('');

/** The same top-right circle as the refusal badge, ink over cream and no status colour. */
const MEMBERSHIP_BADGE_CIRCLE = `<circle cx="25.5" cy="6.5" r="5.8" fill="${CREAM}" stroke="${INK}" stroke-width="2"/>`;

/** Ctrl held over an unselected object: this click joins it to the selection. */
const ADD_BADGE = MEMBERSHIP_BADGE_CIRCLE
  + `<path d="M25.5 3.3 L25.5 9.7 M22.3 6.5 L28.7 6.5" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`;

/** Ctrl held over a selected object: this click drops it from the selection. */
const REMOVE_BADGE = MEMBERSHIP_BADGE_CIRCLE
  + `<path d="M22.3 6.5 L28.7 6.5" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`;

/**
 * The one pointer arrow, shared by every cursor that points: `select` (there is something here to
 * act on), `default` (there is not), and each tool, which draws its glyph over this.
 */
const ARROW = body('M2 2 L2 25 L8 19.2 L12.8 29.5 L17.4 27.3 L12.8 17.8 L20.5 17.8 Z', CREAM);

/**
 * The pointer a TOOL cursor carries: `ARROW`'s head scaled to 0.55 about the apex, its tail scaled
 * with it, and the stem widened to the 4.5px a 2px diagonal line needs. Head and tail keep the
 * shared arrow's proportions; the stem is the one part the floor lifts off them.
 */
const TIP = body('M2 2 L2 14.65 L5.3 11.46 L7.98 17.1 L12.05 15.17 L9.37 9.53 L12.18 10.69 Z', CREAM);

/** A tool cursor: the pointer with its glyph OVER it, so only the tail is what the overlap hides. */
function pointing(glyph: string): string {
  return TIP + glyph;
}

/** Shapes per cursor. */
const SHAPES: Record<Exclude<CursorId, 'busy'>, string> = {
  // Two domed peaks, the shape the brush builds. Both summits sit right of the pointer, which meets
  // the long left flank, the one stretch of the silhouette that carries no information.
  mountain: pointing(body('M10.5 27.1 L16.1 13 Q17 10.8 17.8 13.1 L20.1 19.1 Q21 21.5 22.4 19.3'
    + ' L24.2 16.5 Q25.5 14.5 26.2 16.8 L29.5 27 Q30.3 29.5 27.7 29.5 L12.1 29.5'
    + ' Q9.5 29.5 10.5 27.1 Z', MOUNTAIN)),
  // Two waves, each a water-coloured stroke inside a wider ink one. A cubic per crest, so the
  // crest is a broad dome rather than the tight turn a quadratic makes. The left ends cover the
  // pointer's stem; both crests stay clear of it.
  water: pointing(['M11.8 13.2 C14.1 10.2 17.6 10.2 20 13.2 C22.4 16.2 25.9 16.2 28.2 13.2',
    'M11.8 24.2 C14.1 21.2 17.6 21.2 20 24.2 C22.4 27.2 25.9 27.2 28.2 24.2']
    .map((d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="6.5" stroke-linecap="round"/>`
      + `<path d="${d}" fill="none" stroke="${WATER_COLOR}" stroke-width="2.8" stroke-linecap="round"/>`)
    .join('')),
  // A paved strip running away in perspective. Its centre line, which is what says "road", runs
  // down the right of the arrow.
  road: pointing(body('M15.9 11 L19.7 11 Q22.1 11 23 13.2 L28.3 26.5 Q29.5 29.5 26.3 29.5'
    + ' L11.7 29.5 Q8.5 29.5 9.3 26.4 L12.9 13.3 Q13.5 11 15.9 11 Z', ROAD)
    + `<path d="M18.2 14.4 L19.4 26.7" fill="none" stroke="${CREAM}" stroke-width="2.2"`
    + ' stroke-dasharray="3.4 3.2" stroke-linecap="round"/>'),
  // A tilted block with its working end inked and crumbs rubbed off it. Its body is 14 across the
  // short axis, the widest of the tool glyphs, because the ink band takes 4.4 of that from the
  // inside: the cream left between band and outline is 8.6, in line with its siblings.
  eraser: pointing(body('M18.1 11.6 L27.4 16.2 Q29.9 17.5 28.7 20 L24.9 27.5 Q23.6 30 21.1 28.7'
    + ' L11.8 24.1 Q9.3 22.8 10.6 20.3 L14.4 12.8 Q15.6 10.3 18.1 11.6 Z', CREAM)
    + body('M10.9 19.8 L25.2 26.9 L24.9 27.5 Q23.6 30 21.1 28.7 L11.8 24.1'
      + ' Q9.3 22.8 10.6 20.3 Z', INK)
    + `<circle cx="4.3" cy="26.6" r="1.6" fill="${INK}"/>`
    + `<circle cx="7.6" cy="30.2" r="1.1" fill="${INK}"/>`),
  // A tile with one corner taken off and the removed corner ghosted in. The notch spans half the
  // side, not a nick, and sits at the bottom-right where the arrow never reaches.
  'edge-cut': pointing(body('M12.5 17 Q12.5 12.5 17 12.5 L26 12.5 Q30.5 12.5 30.5 17 L30.5 19.3'
    + ' Q30.5 21.5 28.9 23.1 L23.1 28.9 Q21.5 30.5 19.3 30.5 L17 30.5 Q12.5 30.5 12.5 26 Z', CREAM)
    + `<path d="M30.5 23.6 L30.5 28.2 Q30.5 30.5 28.2 30.5 L23.6 30.5" fill="none" stroke="${INK}"`
    + ' stroke-width="1.8" stroke-dasharray="2.8 2.6" stroke-linecap="round"/>'),
  // A tile with a plus, the "add here" idiom. The plus is centred clear of the arrow.
  place: pointing(`<rect x="12.5" y="12.5" width="18" height="18" rx="4.5" fill="${CREAM}" stroke="${INK}" stroke-width="2"/>`
    + `<path d="M21.5 16 L21.5 27 M16 21.5 L27 21.5" fill="none" stroke="${INK}"`
    + ' stroke-width="2.8" stroke-linecap="round"/>'),
  select: ARROW,
  // The pointer arrow plus a membership badge, the same composition `blocked` uses.
  'select-add': ARROW + ADD_BADGE,
  'select-remove': ARROW + REMOVE_BADGE,
  // One four-way arrow, a single closed path rather than four loose heads.
  move: body('M16 2.5 L21.5 8.5 L18.6 8.5 L18.6 13.4 L23.5 13.4 L23.5 10.5 L29.5 16 L23.5 21.5'
    + ' L23.5 18.6 L18.6 18.6 L18.6 23.5 L21.5 23.5 L16 29.5 L10.5 23.5 L13.4 23.5 L13.4 18.6'
    + ' L8.5 18.6 L8.5 21.5 L2.5 16 L8.5 10.5 L8.5 13.4 L13.4 13.4 L13.4 8.5 L10.5 8.5 Z', CREAM),
  // The hand, open: four fingers on the shared grid, extended and of unequal length, over the
  // palm, with the thumb lobe out to the side.
  'hand-open': body('M8.5 14 C8.5 8 13.25 8 13.25 12 C13.25 5.5 18 5.5 18 10.5'
    + ' C18 6.5 22.75 6.5 22.75 12.5 C22.75 9 27.5 9 27.5 16 L27.5 24 Q27.5 29.5 22 29.5'
    + ' L12 29.5 Q6.5 29.5 6.5 24 L6.5 21 Q6.5 19 4.5 18.5 Q1.8 17.9 2.4 15.4'
    + ' Q3 13.2 5.6 14 Q7 14.4 8.5 14 Z', CREAM)
    + creases('M13.25 12 L13.25 17.5 M18 10.5 L18 16.5 M22.75 12.5 L22.75 18.5'),
  // The SAME hand, closed: the same four fingers on the same grid and the same thumb lobe, curled
  // so the tips tuck toward the palm. Only the curl, the resulting height and the thumb's
  // position differ; the lobe drops to the palm's front and a crease marks where it lies across.
  'hand-closed': body('M8.5 19.5 C8.5 16 13.25 16 13.25 18.5 C13.25 14.5 18 14.5 18 17.5'
    + ' C18 15 22.75 15 22.75 18.5 C22.75 16.5 27.5 16.5 27.5 21.5 L27.5 24.5 Q27.5 29.5 22 29.5'
    + ' L12 29.5 Q6.5 29.5 6.5 25 L6.5 24.5 Q6.5 22.5 4.5 22 Q1.8 21.4 2.4 18.9'
    + ' Q3 16.7 5.6 17.5 Q7 17.9 8.5 19.5 Z', CREAM)
    + creases('M13.25 18.5 L13.25 23 M18 17.5 L18 22.5 M22.75 18.5 L22.75 23')
    + creases('M6.6 23.4 Q13 25.6 18.5 24.6'),
  // An arrow curving around a point: the head sits AT the arc's end, near 9 o'clock where the
  // clockwise tangent runs upward, and points along it, so arc and head read as one sweep.
  orbit: haloed('M16 5 A11 11 0 1 1 5.2 18.1', 3.4)
    + `<path d="M2 17.5 L8.4 17.5 L5.2 10.5 Z" fill="${INK}" stroke="${CREAM}" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<circle cx="16" cy="16" r="3.4" fill="${INK}" stroke="${CREAM}" stroke-width="1.8"/>`,
  // A dashed selection box around a crosshair, so the acting point is on the hotspot rather
  // than in the empty middle of a rectangle.
  marquee: haloed('M7 3.5 L25 3.5 Q28.5 3.5 28.5 7 L28.5 25 Q28.5 28.5 25 28.5 L7 28.5'
    + ' Q3.5 28.5 3.5 25 L3.5 7 Q3.5 3.5 7 3.5 Z', 2.2, ' stroke-dasharray="4 3.6"')
    + haloed('M16 11.5 L16 14 M16 18 L16 20.5 M11.5 16 L14 16 M18 16 L20.5 16', 2),

  // The app-wide arrow: the same drawing as `select`.
  default: ARROW,
  // The SAME hand again, with one finger extended: the index occupies the grid's first column, so
  // its tip is on the hotspot, and the other three are curled knuckles on the same boundaries.
  clickable: body('M8.5 14 L8.5 6.5 Q8.5 3 11 3 Q13.25 3 13.25 6.5 L13.25 16.5'
    + ' C13.25 13.5 18 13.5 18 16.5 C18 14 22.75 14 22.75 17 C22.75 14.5 27.5 14.5 27.5 18.5'
    + ' L27.5 24 Q27.5 29.5 22 29.5 L12 29.5 Q6.5 29.5 6.5 24 L6.5 21'
    + ' Q6.5 19 4.5 18.5 Q1.8 17.9 2.4 15.4 Q3 13.2 5.6 14 Q7 14.4 8.5 14 Z', CREAM)
    + creases('M13.25 16.5 L13.25 20.5 M18 16.5 L18 20 M22.75 17 L22.75 20.5'),
  // The arrow plus the shared refusal badge.
  blocked: ARROW + FORBIDDEN_BADGE,
  // An I-beam with full serifs.
  text: haloed('M10.5 3.5 H21.5 M16 3.5 V28.5 M10.5 28.5 H21.5', 2.4),

};

/**
 * Cursors whose art ALREADY carries the refusal badge. Asking such a cursor for `forbidden`
 * must not stamp a second one on top of the first.
 */
const SELF_BADGED: ReadonlySet<CursorId> = new Set<CursorId>(['blocked']);

/**
 * The complete SVG for a cursor, or null when the catalogue leaves it to the OS.
 * `forbidden` composes the badge in; a null-art cursor has nothing to badge.
 */
export function cursorSvg(id: CursorId, opts: { forbidden?: boolean } = {}): string | null {
  if (!CURSORS[id].hasArt) return null;
  const shape = SHAPES[id as Exclude<CursorId, 'busy'>];
  const badge = opts.forbidden && !SELF_BADGED.has(id) ? FORBIDDEN_BADGE : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" `
    + `viewBox="0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}">${shape}${badge}</svg>`;
}
