/**
 * The theme library: every pure theme region the designer can draw, with its family, the coarse lot
 * it wants, the affinity tags the taste cases pair on, and its draw weight. `ThemeId`, `ThemeFamily`
 * and the per-family theme unions are read off this table, so a theme exists exactly where it is
 * listed here.
 */
import type { AffinityTag, AnchorKind } from './types';

interface ThemeEntry {
  id: string;
  family: string;
  /** The coarse lot this theme wants, in macro cells. */
  size: { w: number; h: number };
  tags: readonly AffinityTag[];
  /** Draw weight. Types are picked at random; the weights only say that a park is a commoner sight
   *  than a canyon, never that a type is unreachable. */
  weight: number;
  /** Below this richness the theme is not drawn at all. Only the landmark region uses it: the text or
   *  pattern landmark is an occasional set piece, gated on richness and on lot width. */
  minRichness?: number;
  /** The theme's own kit already wants water, so a district given the water treatment prefers it:
   *  the water then reads as the theme's own material rather than as flooding dropped on top of it. */
  prefersWater?: true;
  /** A stream running through this theme's lot widens into a bay: the water is part of the place. */
  widensStream?: true;
  /** The map's set piece: the region the text or pattern landmark is written across. The layout gives
   *  it the biggest block left and keeps that block whole. */
  setPiece?: true;
  /** The one theme the quiet treatment dresses a block in, where nothing else claimed it. */
  quietDefault?: true;
  /** The one theme an anchor district's place falls back to when no theme was drawn for it. */
  fallback?: true;
  /** The role a movement-line stop met as this theme plays, and the theme's place in that role's
   *  draw order (the stop draw picks by position, so the order is part of a seed's result). */
  stop?: { role: StopRole; rank: number };
}

/** What a stop along the movement line is for; the walk weighs each role by where it stands. */
export type StopRole = 'market' | 'garden' | 'waterside' | 'climb' | 'lookout';

const LIBRARY = [
  // Food and leisure: cafe, teahouse, picnic area, gathering/banquet area, seaside light dining.
  { id: 'cafe', family: 'food-leisure', size: { w: 11, h: 9 }, tags: ['drink'], weight: 3, stop: { role: 'market', rank: 0 } },
  { id: 'teahouse', family: 'food-leisure', size: { w: 10, h: 9 }, tags: ['drink', 'quiet'], weight: 2, stop: { role: 'market', rank: 1 } },
  { id: 'picnic', family: 'food-leisure', size: { w: 11, h: 9 }, tags: ['greenery'], weight: 2, stop: { role: 'market', rank: 3 } },
  { id: 'banquet', family: 'food-leisure', size: { w: 11, h: 10 }, tags: [], weight: 2, stop: { role: 'market', rank: 2 } },
  { id: 'seaside-dining', family: 'food-leisure', size: { w: 13, h: 9 }, tags: ['drink', 'seaside', 'waterside'], weight: 2, prefersWater: true, stop: { role: 'waterside', rank: 2 } },
  // Natural scenery: park/central garden, garden/flower plot, flower field, bamboo sunken courtyard,
  // lake/fountain, tree avenue/grove array, pure mountain-water-waterfall scenery, canyon/valley.
  { id: 'park', family: 'nature', size: { w: 15, h: 13 }, tags: ['greenery'], weight: 3, prefersWater: true, widensStream: true, quietDefault: true, stop: { role: 'garden', rank: 2 } },
  { id: 'garden', family: 'nature', size: { w: 11, h: 10 }, tags: ['greenery'], weight: 3, prefersWater: true, widensStream: true, fallback: true, stop: { role: 'garden', rank: 0 } },
  { id: 'flower-field', family: 'nature', size: { w: 13, h: 11 }, tags: ['greenery'], weight: 3, widensStream: true, stop: { role: 'garden', rank: 1 } },
  { id: 'bamboo-court', family: 'nature', size: { w: 11, h: 11 }, tags: ['bamboo', 'quiet'], weight: 2, prefersWater: true, stop: { role: 'garden', rank: 4 } },
  { id: 'lake-fountain', family: 'nature', size: { w: 13, h: 11 }, tags: ['waterside'], weight: 2, prefersWater: true, widensStream: true, stop: { role: 'waterside', rank: 1 } },
  { id: 'tree-avenue', family: 'nature', size: { w: 19, h: 7 }, tags: ['greenery'], weight: 2, stop: { role: 'garden', rank: 3 } },
  { id: 'mountain-water', family: 'nature', size: { w: 15, h: 13 }, tags: ['waterside'], weight: 2, prefersWater: true, stop: { role: 'climb', rank: 0 } },
  { id: 'canyon', family: 'nature', size: { w: 17, h: 9 }, tags: [], weight: 1, prefersWater: true, stop: { role: 'climb', rank: 1 } },
  // Viewing and photo spots: lookout, panorama platform, waterside deck/lakeside walk, text/pattern landmark.
  { id: 'lookout', family: 'viewpoint', size: { w: 9, h: 9 }, tags: [], weight: 2, stop: { role: 'lookout', rank: 0 } },
  { id: 'panorama-deck', family: 'viewpoint', size: { w: 11, h: 9 }, tags: [], weight: 2, widensStream: true, stop: { role: 'lookout', rank: 1 } },
  { id: 'waterside-deck', family: 'viewpoint', size: { w: 13, h: 7 }, tags: ['waterside'], weight: 2, prefersWater: true, widensStream: true, stop: { role: 'waterside', rank: 0 } },
  { id: 'landmark-text', family: 'viewpoint', size: { w: 21, h: 15 }, tags: [], weight: 1, minRichness: 0.6, setPiece: true },
  // Culture and activity: library, stage/small theatre, chess garden, music corner.
  { id: 'library', family: 'culture', size: { w: 11, h: 10 }, tags: ['library', 'quiet'], weight: 2 },
  { id: 'stage', family: 'culture', size: { w: 13, h: 11 }, tags: ['stage'], weight: 2, stop: { role: 'market', rank: 4 } },
  { id: 'chess-garden', family: 'culture', size: { w: 9, h: 9 }, tags: ['quiet'], weight: 2 },
  { id: 'music-corner', family: 'culture', size: { w: 9, h: 9 }, tags: ['quiet'], weight: 2 },
  // Production and daily life: planting/crop area, orchard, small-animal run.
  { id: 'crop-field', family: 'production', size: { w: 15, h: 13 }, tags: [], weight: 2 },
  { id: 'orchard', family: 'production', size: { w: 15, h: 11 }, tags: ['greenery'], weight: 2 },
  { id: 'animal-run', family: 'production', size: { w: 13, h: 11 }, tags: [], weight: 2 },
] as const satisfies readonly ThemeEntry[];

type Theme = typeof LIBRARY[number];
export type ThemeId = Theme['id'];
/** The five theme families of the theme library. */
export type ThemeFamily = Theme['family'];
/** The themes of one family. */
export type ThemeOf<F extends ThemeFamily> = Extract<Theme, { family: F }>['id'];
export type FoodLeisureTheme = ThemeOf<'food-leisure'>;
export type NatureTheme = ThemeOf<'nature'>;
export type ViewpointTheme = ThemeOf<'viewpoint'>;
export type CultureTheme = ThemeOf<'culture'>;
export type ProductionTheme = ThemeOf<'production'>;
/** A theme together with its family, correlated so a switch on `family` narrows `themeId`. */
export type ThemeRef = { [F in ThemeFamily]: { family: F; themeId: ThemeOf<F> } }[ThemeFamily];

/** A library theme as the stages read it, with its literal types widened. */
export interface ThemeSpec extends Omit<ThemeEntry, 'id' | 'family'> {
  id: ThemeId;
  family: ThemeFamily;
}

/** Every theme in draw order. */
export const THEME_LIBRARY: readonly ThemeSpec[] = LIBRARY;

const FAMILY = new Map<ThemeId, ThemeFamily>(THEME_LIBRARY.map((t) => [t.id, t.family]));

/** The family a theme belongs to, which is the kit library a theme dispatches to. */
export function familyOf(id: ThemeId): ThemeFamily {
  return FAMILY.get(id)!;
}

/** A theme with its family, as a region carries the pair. */
export function themeRef(id: ThemeId): ThemeRef {
  return { themeId: id, family: familyOf(id) } as ThemeRef;
}

const themesWhere = (flag: (t: ThemeSpec) => boolean | undefined): ReadonlySet<ThemeId> =>
  new Set<ThemeId>(THEME_LIBRARY.filter(flag).map((t) => t.id));

/** The themes a water district prefers (`ThemeEntry.prefersWater`). */
export const WATER_THEMES = themesWhere((t) => t.prefersWater);

/** The themes a stream widens into a bay through (`ThemeEntry.widensStream`). */
export const STREAM_BAY_THEMES = themesWhere((t) => t.widensStream);

/** The one theme `flag` marks; the library marks exactly one. */
function onlyTheme(flag: (t: ThemeSpec) => boolean | undefined): ThemeId {
  const marked = THEME_LIBRARY.filter(flag);
  if (marked.length !== 1) throw new Error(`expected one marked theme, found ${marked.length}`);
  return marked[0]!.id;
}

/** The theme of the quiet treatment (`ThemeEntry.quietDefault`). */
export const QUIET_THEME = onlyTheme((t) => t.quietDefault);

/** The theme an anchor district's place falls back to (`ThemeEntry.fallback`). */
export const FALLBACK_THEME = onlyTheme((t) => t.fallback);

/** Whether a theme is the map's set piece (`ThemeEntry.setPiece`). */
export const isSetPieceTheme = (id: ThemeId | undefined): boolean =>
  id !== undefined && THEME_LIBRARY.some((t) => t.id === id && t.setPiece);

/** The themes a stop of `role` is met as, in that role's draw order (`ThemeEntry.stop`). */
export function stopThemes(role: StopRole): readonly ThemeId[] {
  return THEME_LIBRARY.filter((t) => t.stop?.role === role)
    .sort((a, b) => a.stop!.rank - b.stop!.rank).map((t) => t.id);
}

/** What each building-anchor kind asks of the stages beyond its kit. */
interface AnchorKindSpec {
  /** The composition allowance around the members' footprints when the lot is sized. */
  lotMargin: number;
  tags: readonly AffinityTag[];
  /** A stream running through the lot narrows: a home keeps its garden dry. */
  narrowsStream?: true;
  /** A visited building takes a paved forecourt on its entry side. */
  forecourt?: true;
}

/** The building-anchor kinds. A home's margin is the garden, bed or court composed round it: every
 *  building gets its own surroundings rather than a shared yard. The shop's case
 *  rings it with a one-layer mountain carrying a library and a cafe, so its lot is the roomiest; the
 *  museum wants a forecourt; the own house is private. */
export const ANCHOR_KINDS: Readonly<Record<AnchorKind, AnchorKindSpec>> = {
  residential: { lotMargin: 2, tags: ['dwelling'], narrowsStream: true },
  'own-house': { lotMargin: 2, tags: ['dwelling'], narrowsStream: true },
  museum: { lotMargin: 4, tags: ['quiet'], forecourt: true },
  shop: { lotMargin: 6, tags: ['shop'], forecourt: true },
};
