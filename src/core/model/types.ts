/**
 * Kernel type definitions: the map, its objects, the catalog items they place, commands and rules.
 *
 * Command types form a discriminated union on `type`. Every command carries
 * only the data needed to apply it; undo/redo snapshots are stored on
 * `HistoryEntry` inside CommandExecutor and never on the command itself.
 *
 * Rule types (`PreCommandRule`, `PostStrokeRule`) never mutate state or the
 * command they judge; returning an empty array means the rule passes.
 */

import type { ProvenanceState } from '../provenance/types';
import type { AnnotationsState } from './annotations';
import type { GridCell, GridId } from '../grid/grids';
import type { LocalizedName } from './locale';
import type { Rect } from '../grid/rect';
import type { ChunkGrid } from '../grid/map-chunks';
import type { MacroCoord, Rotation } from '../base/coords';
import type { CellZone, GroundZone, SandZone } from '../game/zones';

// --- Coordinate Types ---
export type { MacroCoord, Brand, BucketCoord, RegionCoord, Rotation } from '../base/coords';
export { ROTATIONS, turnRotation } from '../base/coords';
// --- Terrain Enum ---
export enum TerrainType { None = 0, Mountain = 1, Water = 2 }

/** Every corner trim; the index is the trim's 3-bit code on the worker grid wire. */
export const CORNER_TRIMS = ['square', 'fan', 'tri-NW', 'tri-NE', 'tri-SW', 'tri-SE', 'empty'] as const;
export type CornerTrim = typeof CORNER_TRIMS[number];
export type Corners = [CornerTrim, CornerTrim, CornerTrim, CornerTrim];

// --- Terrain Cell ---
export interface TerrainCell {
  type: TerrainType;
  elevation: number;
  corners?: Corners;
  patchOnly?: boolean;
  /** Γ-patch only: the real support tier under the cosmetic fillet (the structural top the cell
   *  contributes). 0 = the fillet sits straight on the ground (a from-empty gamma — no base block);
   *  N-1 = the fillet rounds a genuinely real lower block. An edge cut sets this from what the cell
   *  already was; it never invents a base. Absent (old saves) ⇒ falls back to `elevation - 1`. */
  patchBase?: number;
}

// --- The Macro-Cell ---
export interface MacroCell {
  zone: CellZone;
  terrain: TerrainCell | null;
  /** A shore rim cell's own ground when it is sand; a rim cell without it lies over the off-map zone. Only a
   *  planet session canvas sets it, and `core/game/zones.ts:groundZone` is the one reader. `grid-wire.ts`
   *  does not carry it: no worker job reads a session canvas. */
  under?: SandZone;
}

// --- Objects ---
/**
 * A placed object carries no category of its own: `catalogId` already determines it, and
 * `getCatalogItem(catalogId).category` is the one way to ask. Every object resolves, a
 * landmark included (it is registered in the catalog by id for exactly this reason).
 */
export interface PlacedObject {
  id: string;
  catalogId: string;
  position: MacroCoord;
  rotation: Rotation;
  elevation: number;
  spanLength?: number;
  corners?: Corners;
  /** Reserved: no edit sets it on an object, but saves, share codes and the canonical hash carry
   *  it, and an object read with it counts no chunk load. */
  patchOnly?: boolean;
  /** Self-description for an object whose footprint, icon and colour are per map rather than per
   *  catalog item (a landmark). When set, these override the catalog so the object renders
   *  generically, with no special case:
   *  - width/height: per-map footprint (may be fractional)
   *  - icon: sprite basename (resolved by iconUrl)
   *  - color: backing fill (hex), e.g. a landmark's platform */
  width?: number;
  height?: number;
  icon?: string;
  color?: string;
  /** Immutable structure (a landmark): selectable, but rules refuse moving or deleting it, saves
   *  recreate it from the template, and placement rules still see its footprint. */
  locked?: boolean;
}

// --- Item Catalog (Placement System) ---
/** The id of a catalog category. The game's categories are data (`config/catalog/categories.ts`);
 *  the kernel and the engines never name one and ask a category role or a trait instead. */
export type CategoryId = string;

export type PlacementTrait =
  | { type: 'flat' }
  | { type: 'noFloat' }
  | { type: 'waterSpan'; min: number; max: number }
  | { type: 'heightDrop'; layers: number }
  | { type: 'surfaceCoating'; layer?: number }
  | { type: 'coatingSupport' }
  // A coating flora may stand on (the game plants flowers and crops on some road
  // surfaces): placing flora keeps this coating instead of stripping it, and the
  // pair passes the standing-on-a-road rule.
  | { type: 'plantable' }
  // Stands on a `plantable` coating and keeps it (the flora items).
  | { type: 'growsOnPlantable' }
  | { type: 'exclusionRadius'; radius: number }
  // Footprint that other terrain may use as a structural base (3x3 support), at
  // the layer the object stands at (a landmark).
  | { type: 'terrainBase' }
  // May anchor on the half-cell grid in both axes (whole or half integer
  // position), not the macro grid only — the game's exception for ramps and
  // bridges, which lets a deck align flush with the terrain grid, and for the
  // landmarks, which a planet being shaped moves in half cells.
  | { type: 'halfStep' }
  // Turns as a whole footprint about its centre (width and height swap) while the map it stands
  // on is being shaped, and only unlocked; its art rests upright in every footprint while a spin plays each turn.
  | { type: 'footprintTurn' };

/** The colour families a plant can read as at map scale, in the order generation offers them.
 *  Neutrals (grey, black, brown) name no plant. */
export const COLOR_FAMILIES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'white'] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

/** What a plant is beyond its footprint. */
interface PlantFacts {
  /** Its species' id in the plant species registry; every colourway of one plant shares it. */
  species: string;
  /** The colour it reads as at map scale: its bloom where it is grown for the bloom (every flower,
   *  and a flowering shrub), its foliage where the foliage is the mass (every tree). */
  colorFamily: ColorFamily;
}

/** A catalog item as placement, rules and generation read it; `config/catalog/catalog-entry.ts:CatalogEntry`
 *  adds what only rendering and search read. */
export interface CatalogItem {
  id: string;
  category: CategoryId;
  name: LocalizedName;
  /** Icon PNG basename under src/assets/icons/ (catalog/ or ui/), resolved by iconUrl(). */
  icon?: string;
  color?: string;
  width: number;
  height: number;
  loadValue: number;
  /** Unmeasured load contributes zero until a value is available. */
  loadUnknown?: boolean;
  /** Max times this item may be placed on the whole map (omit = unlimited). */
  maxCount?: number;
  /** This item's placement rule is not yet finalized (TBD) — the generator must not auto-place it
   *  (manual placement still works under whatever traits it currently has). */
  ruleTBD?: boolean;
  /** Kept for saves and rendering; no shelf, search, generator or assistant offers it. */
  disabled?: boolean;
  rotatable: boolean;
  /** Its 2D sprite is contained in its footprint, without the catalog overshoot. */
  artInFootprint?: boolean;
  placementMode: 'point' | 'brush';
  traits: PlacementTrait[];
  /** Centerline exits at rotation 0, as N/E/S/W bits 1/2/4/8. */
  strokeConnections?: number;
  /** Rounded alternative with the same edge exits as an angular stroke. */
  strokeCurve?: boolean;
  /** A tree's or a flower's species and colour family. */
  plant?: PlantFacts;
}

// --- Map Template ---
/** Where a template lays one of the profile's landmarks (`game/profile.ts:LANDMARKS`): the seed of a
 *  locked object over the cells, whose no-build policy is the standard placement rules. It stands on
 *  the template's ground there. A built-in template's landmark may reach past the saved cells over
 *  the presentation sea. */
export interface LandmarkConfig {
  /** The landmark's id in the profile. */
  id: string;
  /** Top-left of the laid footprint, on the half-cell grid. */
  x: number; y: number;
  /** The laid footprint: width and height are already swapped for a quarter turn. */
  width: number; height: number;
  color?: string;
  rotation?: Rotation;
}
export interface MapTemplate {
  id: string;
  name: LocalizedName;
  width: number;
  height: number;
  zones: CellZone[][];
  /** At most one of each landmark, in profile order. */
  landmarks: LandmarkConfig[];
  /** Row-major initial mountain elevations (0 = bare), laid on every fresh state built from this template. */
  terrain?: Uint8Array;
  /** Row-major initial water cells (1 = water at the layer `terrain` gives, 0 when absent), laid with `terrain`. */
  water?: Uint8Array;
  /** Complete reference grid, including sea outside the saved cell rectangle. Origin uses macro cells. */
  chunkGrid?: ChunkGrid;
  /** A built-in template's signature as its saves and share codes record it, which stays fixed when
   *  its ground is corrected (`io/save/canonical.ts:templateHash`). A custom planet has none. */
  signature?: number;
}

// --- Grid State ---
/** The map's title and description, shared by saves, the share code and every export.
 *  `core/model/notes.ts` owns the limits and clamps untrusted input. */
export interface MapNotes { title?: string; description?: string }

/** An image import's original notes and its content as units, kept apart from authorship. The
 *  units are a persisted contract (`state/notes-attribution.ts:attributionUnits`). */
export interface ImageAttribution {
  version: 1;
  templateId: string;
  notes: MapNotes;
  units: string[];
}

/** The objects added/removed by one `objects` mutation. `version` is the
 *  `objectsVersion` it produced, so a consumer can tell "this delta describes the
 *  step I am one behind" from a leftover of an older step. An object present in
 *  both is an in-place replacement (same id). */
export interface ObjectsDelta {
  version: number;
  removed?: readonly PlacedObject[];
  added?: readonly PlacedObject[];
}

/** The fields of a map that live only in the session: no save, share code or export carries them,
 *  and each copy of a map says which of them it keeps. */
export interface MapSessionFields {
  /** Session policy, copied to previews and workers. */
  ignoreChunkLoad?: boolean;
  /** What the mutation that produced `objectsVersion` changed, when the mutator knows: it lets the
   *  memoized object index patch itself instead of rebuilding from every object, which keeps a long
   *  stroke (a road fill places one object per cell) linear. Absent means something changed but not
   *  what, and the index rebuilds, so omitting it is always safe. Never copied. */
  objectsDelta?: ObjectsDelta;
  /** The region the last generation was scoped to, which bounds Clear. Never copied; undo and redo
   *  restore it with `generation`. */
  generationScope?: readonly MacroCoord[];
}

/**
 * The complete mutable editor state.
 * - `cells` is row-major: cells[y][x].
 * - `lockedLayers` is written by the editor's layer-lock state; rules read but never write it.
 * - Per-chunk object load is not stored here: it is recomputed from `objects` where needed
 *   (rules/chunk-load.ts).
 */
export interface GridState extends MapSessionFields {
  template: MapTemplate;
  cells: MacroCell[][];
  objects: Map<string, PlacedObject>;
  /** Bumped on every mutation of `objects` (add, remove, in-place edit): the freshness key for
   *  state/object-index's memoized spatial index. Mutators call bumpObjectsVersion. */
  objectsVersion: number;
  /** Bumped on every mutation of `cells`: the freshness key for terrain-derived memoized data
   *  (state/map-stats), the sibling of `objectsVersion`. */
  cellsVersion: number;
  lockedLayers: Set<number>;
  provenance?: ProvenanceState;   // provenance ledger + taint (optional; absent on legacy)
  /** Recipe metadata for a full-map generation. Share decoding never depends on replaying it. */
  generation?: GenerationRecord;
  /** Title and description. Round-trip through serialize/deserialize (json-codec) and the
   *  PetitGlyph payload when present; all other save sections are session-only. */
  notes?: MapNotes;
  /** Original image attribution survives JSON saves and autosave independently of provenance. */
  imageAttribution?: ImageAttribution;
  /** The plan-notes annotation layer (zones, texts, route arrows) plus its own eye/lock state.
   *  Saves and PetitGlyph payloads carry it separately from the canonical terrain/object map. */
  annotations?: AnnotationsState;
}

/** The recipe of the map's last full generation. Core stores it without reading it: its shape is the
 *  generators' (`tools/generation/recipe.ts:GenerateConfig`), and a reader that needs more than these
 *  fields checks it with `io/save/generation-record.ts:isGenerationConfig`. */
export interface GenerationRecord { readonly algorithm: string; readonly seed: number }

/** The map's generation as a history entry restores it: the recipe and the scope, each absent when
 *  the map has none. */
export interface GenerationMark { readonly record?: GenerationRecord; readonly scope?: readonly MacroCoord[] }

// --- Commands ---
export enum CommandType {
  PaintTerrain = 'PaintTerrain',
  EraseTerrain = 'EraseTerrain',
  PlaceObject = 'PlaceObject',
  RemoveObject = 'RemoveObject',
  TrimCorners = 'TrimCorners',
}

export interface CellSnapshot { coord: MacroCoord; cell: MacroCell; }

export interface PaintTerrainCommand {
  type: CommandType.PaintTerrain;
  cells: MacroCoord[];
  terrainType: TerrainType;
  elevation: number;
  /** Layer-0 edit: the cell's zone becomes this before the terrain effect. Only the planet session's registry admits it. */
  ground?: GroundZone;
}

export interface EraseTerrainCommand {
  type: CommandType.EraseTerrain;
  cells: MacroCoord[];
  /** Layer-0 edit: the cell's zone becomes this before the terrain effect. Only the planet session's registry admits it. */
  ground?: GroundZone;
}

export interface PlaceObjectCommand {
  type: CommandType.PlaceObject;
  object: PlacedObject;
}

export interface RemoveObjectCommand {
  type: CommandType.RemoveObject;
  objectId: string;
}

/** What every corner trim names: the cell (or the road on it) at (x, y) and the corners it takes. */
interface TrimCornersFields {
  type: CommandType.TrimCorners;
  x: number;
  y: number;
  afterCorners: Corners;
}

/** Recut a terrain cell's corners. */
export interface TrimTerrainCommand extends TrimCornersFields {
  layer: 'terrain';
  patchOnly?: undefined;
  objectId?: undefined;
}

/** Lay a cosmetic patch on a terrain cell (possibly empty): its corners drawn at `elevation`, its
 *  real support `patchBase` (0 = ground), without painting a support column. */
export interface MaterialisePatchCommand extends TrimCornersFields {
  layer: 'terrain';
  patchOnly: true;
  terrainType: TerrainType;
  elevation: number;
  patchBase?: number;
  objectId?: undefined;
}

/** Recut the road at (x, y), turning it to `afterRotation` when set. */
export interface TrimRoadCommand extends TrimCornersFields {
  layer: 'road';
  objectId: string;
  afterRotation?: Rotation;
  patchOnly?: undefined;
}

/** A corner trim, told apart by `layer` and `patchOnly`; what each does to the map is the terrain
 *  domain's (`core/commands/command-apply.ts:TrimApplier`). */
export type TrimCornersCommand = TrimTerrainCommand | MaterialisePatchCommand | TrimRoadCommand;

/**
 * Discriminated union of all editor commands.
 * Narrow via `cmd.type` to access command-specific fields.
 * CommandExecutor stores before/after CellSnapshot arrays on its own
 * HistoryEntry — commands carry only the data needed to apply them.
 */
export type Command =
  | PaintTerrainCommand
  | EraseTerrainCommand
  | PlaceObjectCommand
  | RemoveObjectCommand
  | TrimCornersCommand;

// --- Validation ---
/** A validation error whose evidence lies on grid `G`. */
interface ValidationErrorOn<G extends GridId> {
  ruleId: string;
  message: string;
  /** Optional i18n interpolation params for `message` (e.g. { n: 3 }). */
  messageParams?: Record<string, string | number>;
  /** The cells that cause the violation — the evidence shown to the user (the error
   *  flash) and echoed to the agent. Complete (every offender, not the first hit),
   *  never a bare click anchor; non-spatial rules (max-count, chunk load, locked
   *  object) report the whole footprint involved. */
  cells: GridCell<G>[];
  /** The evidence's exact drawn body, where the cause is an object (or two objects' overlap)
   *  rather than a grid cell. An object's footprint can sit on the half grid — a landmark at
   *  x.5/y.5, a ramp/bridge anchor — and a whole-cell list can then only name every cell the body
   *  partially covers, which draws half a cell larger than the thing it accuses. When present, the
   *  error flash paints these rects and ignores `cells` for that error; `cells` stays the whole-cell
   *  evidence every non-drawing consumer reads. Both come out of `core/grid/footprint:bodyEvidence`, so the
   *  two can never disagree. */
  rects?: Rect[];
  /** The grid the evidence cells and rects lie on. */
  grid: G;
}
/** A validation error on any grid, its cells on the grid it names. */
export type ValidationError = { [G in GridId]: ValidationErrorOn<G> }[GridId];
export interface ValidationResult { success: boolean; errors: ValidationError[]; }
/** A refused command and why: the `validation-failed` payload the toast and the map flash read. */
export interface Refusal { cmd: Command; errors: ValidationError[]; }

// --- Rule System ---
/**
 * A rule that gates individual commands before they are applied.
 * `appliesTo` filters by CommandType so the registry skips irrelevant rules.
 * `resolve`, where a rule has one, returns the command as it lands (a copy when it changes) and is
 * idempotent; `validate` judges the resolved command. Both are pure: they read cmd + state and
 * never write to either. Return [] to pass; return errors to reject the command.
 */
export interface PreCommandRule {
  id: string;
  phase: 'pre-command';
  appliesTo: CommandType[];
  resolve?(cmd: Command, state: GridState): Command;
  validate(cmd: Command, state: GridState, scope?: StrokeScope): ValidationError[];
}

/** What a pre-command judgement knows beyond the map: the objects the open stroke took off it, or a
 *  placement probe leaves out, by id, so a re-placed object is judged on its net change. The
 *  executor holds its stroke's and clears them when the stroke commits or rolls back. */
export interface StrokeScope {
  readonly lifted: ReadonlyMap<string, PlacedObject>;
}

/**
 * A rule that validates the full grid state after a brush stroke completes.
 * Unlike pre-command rules, these have no command context — they scan the
 * entire grid for structural violations.
 * Return [] if the state is clean; return errors to trigger auto-revert.
 */
export interface PostStrokeRule {
  id: string;
  phase: 'post-stroke';
  /** `opts.firstOnly` asks for a yes/no answer: return on the first violation
   *  found. The auto-revert loop re-validates once per undone command, so the
   *  full-grid error sweep there is pure waste; honoring the flag is optional. */
  validate(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[];
}

export type AnyRule = PreCommandRule | PostStrokeRule;

