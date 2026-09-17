/**
 * Core type definitions for PetitMaker, the Petit Planet map editor.
 *
 * Command types form a discriminated union on `type`. Every command carries
 * only the data needed to apply it; undo/redo snapshots are stored on
 * `HistoryEntry` inside CommandExecutor and never on the command itself.
 *
 * Rule types (`PreCommandRule`, `PostStrokeRule`) never mutate STATE. The
 * bridge/ramp placement traits do snap the COMMAND's object during validation
 * (see rules/registry.ts); returning an empty array means the rule passes.
 */

import type { ModelSpec } from './model-spec';
import type { ProvenanceState } from '../provenance/types';
import type { AnnotationsState } from './annotations';

// --- Localization ---
export type Locale = 'en' | 'zh' | 'ja' | 'ru' | 'th' | 'id' | 'fr';

/**
 * A display name localized into one or more locales. `en` is required as the
 * universal fallback; every other locale is optional, so content data (catalog,
 * map templates) may ship only the locales it has translations for and the rest
 * gracefully fall back to English via `localizedName()`.
 */
export type LocalizedName = { en: string } & Partial<Record<Locale, string>>;

// --- Build brush options ---
/**
 * Auto edge-cutting mode for the terrain/tile build brushes. When not 'off', a
 * finished stroke auto-trims its freshly-exposed convex corners: 'rect' uses a
 * straight 45° bevel (triangle cut), 'round' uses a curved chamfer (fan cut).
 */
export type AutoEdgeCut = 'off' | 'rect' | 'round';

/**
 * What one eraser gesture takes back: a DAB under the brush (its size decides the footprint), or a
 * rectangle/circle dragged out and taken on release. The two drag shapes reuse the drawing tool's
 * own figures (`tools/paint/shapes.ts:dragShapeCells`), so the eraser takes back exactly the shape
 * the brush lays, Shift-to-constrain included.
 */
export type EraserShape = 'dot' | 'rect' | 'circle';

// --- Coordinate Types ---
export type MacroCoord = { x: number; y: number };
export type MicroCoord = { x: number; y: number };
export type ChunkCoord = { cx: number; cy: number };
/** A macro-unit box [x, x+w) × [y, y+h). Origin and size may be fractional: an object's footprint
 *  sits on the half grid wherever its anchor does (the plaza, a ramp/bridge). Re-exported by
 *  `grid-model`, which owns the geometry that operates on it. */
export interface Rect { x: number; y: number; w: number; h: number; }

// --- Zone & Terrain Enums ---
export enum CellZone { Void = 0, Beach = 1, Grass = 2, Plaza = 3, Boundary = 4 }
export enum TerrainType { None = 0, Mountain = 1, Water = 2 }

export type CornerTrim = 'square' | 'fan' | 'tri-NW' | 'tri-NE' | 'tri-SW' | 'tri-SE' | 'empty';
export type Corners = [CornerTrim, CornerTrim, CornerTrim, CornerTrim];

// --- Terrain Cell ---
export interface TerrainCell {
  type: TerrainType;
  elevation: number;
  corners?: Corners;
  patchOnly?: boolean;
  /** Γ-patch only: the REAL support tier under the cosmetic fillet (the structural top the cell
   *  contributes). 0 = the fillet sits straight on the ground (a from-empty gamma — no base block);
   *  N-1 = the fillet rounds a genuinely real lower block. An edge cut sets this from what the cell
   *  ALREADY was; it never invents a base. Absent (old saves) ⇒ falls back to `elevation - 1`. */
  patchBase?: number;
}

// --- The Macro-Cell ---
export interface MacroCell {
  zone: CellZone;
  terrain: TerrainCell | null;
}

// --- Objects ---
/**
 * A placed object carries no category of its own: `catalogId` already determines it, and
 * `getCatalogItem(catalogId).category` is the ONE way to ask. Every object resolves, the
 * central plaza included (it is registered in the catalog by id for exactly this reason).
 */
export interface PlacedObject {
  id: string;
  catalogId: string;
  position: MacroCoord;
  rotation: 0 | 90 | 180 | 270;
  elevation: number;
  spanLength?: number;
  corners?: Corners;
  patchOnly?: boolean;
  /** Self-description for off-catalog objects (the central plaza), which have no CatalogItem.
   *  When set, these override the catalog so the object renders generically — no special case:
   *  - width/height: per-map footprint (may be fractional)
   *  - icon: sprite basename (resolved by iconUrl), e.g. 'plaza'
   *  - color: backing fill (hex), e.g. the plaza's grey platform */
  width?: number;
  height?: number;
  icon?: string;
  color?: string;
  /** Immutable structure (the central plaza): not selectable / movable / deletable
   *  / serialized; placement rules still see its footprint. */
  locked?: boolean;
}

/**
 * A selected block: an object by id, or a terrain cell by coordinate. The editor's selection is an
 * ordered list of these (`state/store.selection`); `[]` is the one representation of "nothing
 * selected". Compared by VALUE (`state/selection.sameRef`), because a ref is rebuilt on every hover.
 */
export type BlockRef =
  | { kind: 'object'; id: string }
  | { kind: 'terrain'; x: number; y: number };

// --- Item Catalog (Placement System) ---
export enum ItemCategory {
  Building = 'building',
  Tree = 'tree',
  Flora = 'flora',
  Road = 'road',
  Bridge = 'bridge',
  Ramp = 'ramp',
  Facility = 'facility',
}

export type PlacementTrait =
  | { type: 'flat' }
  | { type: 'noFloat' }
  | { type: 'waterSpan'; min: number; max: number }
  | { type: 'heightDrop'; layers: number }
  | { type: 'surfaceCoating' }
  // A coating flora may stand ON (the game plants flowers and crops on some road
  // surfaces — the dirt path here): placing flora keeps this coating instead of
  // stripping it, and the pair passes the standing-on-a-road rule.
  | { type: 'plantable' }
  | { type: 'exclusionRadius'; radius: number }
  // Footprint that other terrain may use as a structural base (3x3 support), at
  // the object's elevation — the central plaza today, any such building later.
  | { type: 'terrainBase' }
  // May anchor on the half-cell grid in both axes (whole or half integer
  // position), not the macro grid only — the game's exception for ramps and
  // bridges, which lets a deck align flush with the terrain grid.
  | { type: 'halfStep' };

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  name: LocalizedName;
  /** Icon PNG basename under src/assets/icons/ (catalog/ or ui/), resolved by iconUrl(). */
  icon?: string;
  color?: string;
  /**
   * The colour this item's SPRITE reads as, derived from the shipped PNG rather than authored: the mean
   * of its mid-luminance opaque pixels, which is what `canvas/icon-sampling.ts` samples at runtime.
   *
   * DERIVED DATA, and the project's colour-extraction tooling is its one writer (its own drift check fails on
   * drift). It is committed because a colour that needs a canvas to read cannot be answered where there
   * is no canvas: the picture generator matches a picture's colours against a palette of items, and it
   * runs in a worker and in the offline benchmark as well as on a page. Unlike `color` it does not mean
   * "draw this item as a flat colour" — an item with a sprite is drawn as its sprite.
   */
  iconColor?: string;
  width: number;
  height: number;
  loadValue: number;
  /** Max times this item may be placed on the whole map (omit = unlimited). */
  maxCount?: number;
  /** This item's placement rule is not yet finalized (TBD) — the generator must NOT auto-place it
   *  (manual placement still works under whatever traits it currently has). */
  ruleTBD?: boolean;
  /** Kept for saves and rendering; no shelf, search, generator or assistant offers it. */
  disabled?: boolean;
  rotatable: boolean;
  placementMode: 'point' | 'brush';
  traits: PlacementTrait[];
  /** Bespoke low-poly 3D model (declarative). Absent → the item falls back to its ItemCategory archetype. */
  model3d?: ModelSpec;
  /** Other names the shelf's search should answer to: common alternate names, nicknames, material
   *  or colour words a person would actually type, mixed en/zh (or any locale) in one list, since
   *  search already crosses locales. Authored per item in its own JSON, not derived. */
  aliases?: string[];
}

// --- Map Template ---
// Seed for the immutable plaza object (see createPlazaObject). The plaza is a
// normal locked object over Grass cells, not terrain — its no-build policy is
// the standard placement rules (no terrainType or micro-grid collision buffer).
export interface PlazaConfig {
  x: number; y: number;
  width: number; height: number;
  elevation: number;
  color?: string;
}
export interface MapTemplate {
  id: string;
  name: LocalizedName;
  width: number;
  height: number;
  zones: CellZone[][];
  plaza: PlazaConfig;
}

// --- Grid State ---
/** Free-text map metadata (export-json "Notes" section). Lengths are clamped on
 *  decode (title/author 80 chars, description 400) — see json-codec.deserialize. */
export interface MapNotes { title?: string; description?: string; author?: string }

/** The objects added/removed by one `objects` mutation. `version` is the
 *  `objectsVersion` it produced, so a consumer can tell "this delta describes the
 *  step I am one behind" from a leftover of an older step. An object present in
 *  both is an in-place replacement (same id). */
export interface ObjectsDelta {
  version: number;
  removed?: readonly PlacedObject[];
  added?: readonly PlacedObject[];
}

/**
 * The complete mutable editor state.
 * - `cells` is row-major: cells[y][x].
 * - `lockedLayers` is managed by the UI layer; rules read but never write it.
 * - Per-chunk object load is not stored here — it is recomputed from `objects`
 *   where needed (see rules/chunk-load.ts).
 */
export interface GridState {
  template: MapTemplate;
  cells: MacroCell[][];
  objects: Map<string, PlacedObject>;
  /** Bumped on every mutation of `objects` (add/remove/in-place edit) — the
   *  freshness key for state/object-index's memoized spatial index. Absent
   *  (legacy states) reads as 0. Mutators call bumpObjectsVersion. */
  objectsVersion?: number;
  /** Bumped on every mutation of `cells`. The freshness key for terrain-derived memoized data
   *  (state/map-stats), the sibling of `objectsVersion`. Absent (legacy states) reads as 0. */
  cellsVersion?: number;
  /** What the mutation that produced `objectsVersion` actually changed, when the
   *  mutator knows. Volatile bookkeeping, never serialized: it lets the memoized
   *  object index PATCH itself instead of rebuilding from every object, which is
   *  what keeps a long stroke (a road fill places one object per cell) linear
   *  rather than quadratic. Absent = "something changed, but not what" → the
   *  index rebuilds, so omitting it is always safe, only slower. */
  objectsDelta?: ObjectsDelta;
  lockedLayers: Set<number>;
  provenance?: ProvenanceState;   // provenance ledger + taint (optional; absent on legacy)
  /** The full GenerateConfig that produced this map by a single FULL generation (region null), if
   *  any. Volatile/session-level (NOT part of the canonical map) — lets the share exporter try the
   *  procedural-v1 codec (replay seed+config, verify exact, store ~tiny seed/residual record). Set
   *  on Generate and on procedural-v1 import; absent for hand-edited or region-restricted maps. */
  generation?: GenerateConfig;
  /** Free-text notes (title/description/author). Round-trips through serialize/deserialize
   *  (json-codec) when present; all other export-json sections are session-only. */
  notes?: MapNotes;
  /** The plan-notes annotation layer (zones, texts, route arrows) plus its own eye/lock state.
   *  Saves and PetitGlyph payloads carry it separately from the canonical terrain/object map. */
  annotations?: AnnotationsState;
}

// --- Commands ---
export enum CommandType {
  PaintTerrain = 'PaintTerrain',
  EraseTerrain = 'EraseTerrain',
  PlaceObject = 'PlaceObject',
  RemoveObject = 'RemoveObject',
  TrimCorners = 'TrimCorners',
}

export interface CellSnapshot { coord: MacroCoord; cell: MacroCell; }

interface CommandBase {
  timestamp: number;
}

export interface PaintTerrainCommand extends CommandBase {
  type: CommandType.PaintTerrain;
  cells: MacroCoord[];
  terrainType: TerrainType;
  elevation: number;
}

export interface EraseTerrainCommand extends CommandBase {
  type: CommandType.EraseTerrain;
  cells: MacroCoord[];
}

export interface PlaceObjectCommand extends CommandBase {
  type: CommandType.PlaceObject;
  object: PlacedObject;
  loadValue: number;
}

export interface RemoveObjectCommand extends CommandBase {
  type: CommandType.RemoveObject;
  objectId: string;
  removedObject: PlacedObject;
}

export interface TrimCornersCommand extends CommandBase {
  type: CommandType.TrimCorners;
  x: number;
  y: number;
  layer: 'terrain' | 'road';
  objectId?: string;
  beforeCorners: Corners | undefined;
  afterCorners: Corners;
  patchOnly?: boolean;
  /** Γ-patch creation: the type/elevation/base to MATERIALISE the cosmetic fillet on (possibly empty)
   *  terrain, without painting a real support column. `patchBase` is the real support tier (0 = ground). */
  terrainType?: TerrainType;
  elevation?: number;
  patchBase?: number;
  /** Road-layer only: carries a rotation change on the command so undo/redo can restore it. */
  beforeRotation?: 0 | 90 | 180 | 270;
  afterRotation?: 0 | 90 | 180 | 270;
}

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
export interface ValidationError {
  ruleId: string;
  message: string;
  /** Optional i18n interpolation params for `message` (e.g. { n: 3 }). */
  messageParams?: Record<string, string | number>;
  /** The cells that CAUSE the violation — the evidence shown to the user (the error
   *  flash) and echoed to the agent. Complete (every offender, not the first hit),
   *  never a bare click anchor; non-spatial rules (max-count, chunk load, locked
   *  object) report the whole footprint involved. */
  cells: MacroCoord[];
  /** The evidence's exact drawn BODY, where the cause is an OBJECT (or two objects' overlap)
   *  rather than a grid cell. An object's footprint can sit on the half grid — the plaza at
   *  x.5/y.5, a ramp/bridge anchor — and a whole-cell list can then only name every cell the body
   *  PARTIALLY covers, which draws half a cell larger than the thing it accuses. When present, the
   *  error flash paints THESE rects and ignores `cells` for that error; `cells` stays the whole-cell
   *  evidence every non-drawing consumer reads. Both come out of `grid-model:bodyEvidence`, so the
   *  two can never disagree. */
  rects?: Rect[];
  /** Which grid the evidence cells render on: 'micro' = the terrain micro-grid
   *  (−HALF_TILE), 'macro' = the object/zone grid. Absent → the renderer falls back
   *  to the command-type default (Paint/Erase → micro, otherwise macro). */
  grid?: 'macro' | 'micro';
  severity: 'error' | 'warning';
}
export interface ValidationResult { success: boolean; errors: ValidationError[]; }

// --- Rule System ---
/**
 * A rule that gates individual commands before they are applied.
 * `appliesTo` filters by CommandType so the registry skips irrelevant rules.
 * `validate` must be pure — it reads cmd + state, never mutates.
 * Return [] to pass; return errors to reject the command.
 */
export interface PreCommandRule {
  id: string;
  phase: 'pre-command';
  appliesTo: CommandType[];
  /** Plain-language explanation of the policy, colocated with its implementation
   *  (the single source of truth). The agent system prompt lists it and the tool
   *  layer appends it to error feedback, so a policy change is a one-file edit. */
  agentHint?: string;
  validate(cmd: Command, state: GridState): ValidationError[];
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
  /** See PreCommandRule.agentHint. */
  agentHint?: string;
  /** `opts.firstOnly` asks for a yes/no answer: return on the first violation
   *  found. The auto-revert loop re-validates once per undone command, so the
   *  full-grid error sweep there is pure waste; honoring the flag is optional. */
  validate(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[];
}

export type AnyRule = PreCommandRule | PostStrokeRule;

// --- Tool System ---
export enum ToolType {
  TerrainBrush = 'TerrainBrush',
  ObjectPlacer = 'ObjectPlacer',
  Eraser = 'Eraser',
  Hand = 'Hand',
  EdgeCut = 'EdgeCut',
  Macro = 'Macro',
  Annotate = 'Annotate',
}

/**
 * The editor's drawing-mode vocabulary — the UI-facing editing modes a user
 * picks (sibling to ToolType, which is the implementing tool a mode maps to).
 * The mode→tool mapping (DESIGN_MODE_TOOL, designModeToToolType) and its
 * inverse (designModeToEditInputs) live in core/model/edit-mode.ts. This union
 * is the core type so state/store can reference it without depending on ui.
 */
export type DesignMode = 'brush' | 'line' | 'curve' | 'rect' | 'circle' | 'eraser' | 'hand' | 'edge-cut';

/** Region-select brush vocabulary: the scope screen's row, and `store.regionTool`. */
export type RegionTool = 'brush' | 'eraser' | 'rect' | 'circle' | 'line' | 'curve';

// --- Events ---
export type EditorEvents = {
  'cells-changed': { cells: MacroCoord[] };
  'objects-changed': { added?: PlacedObject[]; removed?: string[] };
  'validation-failed': { cmd: Command; errors: ValidationError[] };
  /** The tool layer now matches the store. The ToolManager and the DrawingTool MIRROR the store's
   *  tool, shape, surface, build floor and brush size, and the canvas writes that mirror in an
   *  effect — which runs after the store has already told its subscribers. Anything that asks a
   *  TOOL a question waits for this, or it asks the tool the user has just left. */
  'tool-synced': { tool: ToolType };
  'catalog-reveal': { catalogId: string };
  'history-changed': { canUndo: boolean; canRedo: boolean };
  /** Fired by undo()/redo() with the cells they touched, so the renderer can
   *  flash the reverted/reapplied region without flashing normal edits.
   *  `objects` is set for object-only steps so the flash tracks each item's real
   *  footprint (macro-grid, no terrain offset) instead of the terrain region. */
  'history-applied': { cells: MacroCoord[]; objects?: PlacedObject[] };
  /** Fired after the viewport pan/zoom transform is applied, so screen-anchored
   *  React overlays (e.g. selection handles) can reposition. */
  'viewport-changed': { zoom: number };
};

/* ── Terrain generation config (used by the generator + the Generate panel) ── */

/** `designed` is the planet generator (`tools/generation/designer/`): the methodology pipeline the
 *  shelf's planet kinds run, and the default for a recipe that names no algorithm. */
export type GenerateAlgorithm = 'maze' | 'stencil' | 'designed';

/**
 * A picture to build from: how much of each cell it covers, and what colour it is there.
 *
 * It is DATA rather than a source, because turning a letter or a photograph into pixels needs a
 * canvas and the candidate pipeline runs in a browser-API-free worker. The shell rasterizes once and
 * passes this down; `tools/generation/stencil/stencil.ts` is everything that reads one.
 */
/**
 * What KIND of picture a stencil was read from, which decides how it is read and how it is matched.
 *
 * `flat` is art drawn in a few solid colours — pixel art, an emoji, a sticker, a logo, a line
 * drawing. Its colours are already a palette, so a cell wants the colour MOST of it is rather than
 * the average of what it covers (averaging an outline with the ground behind it invents a colour the
 * picture never had), and spreading a quantisation error over its neighbours only lays noise across
 * an edge that was already exact.
 *
 * `photographic` is everything else: continuous tone, where averaging is the truth and error
 * diffusion is what lets a small palette say a gradient.
 */
export type StencilSourceNature = 'flat' | 'photographic';

export interface Stencil {
  width: number;
  height: number;
  /** Shape only: grid-fitted edges need no smoothing or corner cuts. */
  cellAligned?: boolean;
  /** Coverage 0..255 per cell, row-major. */
  coverage: Uint8Array;
  /** Packed 0xRRGGBB per cell, row-major; meaningful where coverage is non-zero. */
  color: Uint32Array;
  /**
   * Coverage 0..255 per QUADRANT of each cell, 4 per cell in corner order [TL, TR, BL, BR]
   * (`core/edge-cut/corner-index`), row-major by cell. The rasterizer draws at twice the cell
   * resolution, so this is the sub-cell detail the whole-cell threshold throws away — and it is what
   * lets the trim pass choose each corner's shape from the SOURCE rather than applying one mode
   * everywhere. Absent on a stencil built without it (a test's hand-drawn one); the trim then falls
   * back to the blanket mode.
   */
  quad?: Uint8Array;
  /** What the source was read as. Absent on a stencil built by hand or from a glyph, where there is
   *  no source picture to have a nature; the readers then take the photographic path. */
  nature?: StencilSourceNature;
}

/** How a stencil is read onto the map. `shape` builds the covered cells (the text mode); `color`
 *  ignores the outline and matches each cell's colour to the terrain that draws in it (the image
 *  mode). `fill` names what `shape` builds WITH. */
export interface StencilPlan {
  read: 'shape' | 'color';
  /** shape only: terrain, or one catalog item tiled across the figure. */
  fill?: { kind: 'terrain'; terrain: TerrainType } | { kind: 'object'; catalogId: string };
  stencil: Stencil;
  /** Where the stencil's top-left cell lands on the map. */
  origin: MacroCoord;
  /**
   * The cells the run may write to, as flat `y * mapWidth + x` indices, or absent for "anywhere
   * buildable". A stencil is fitted to the region's BOUNDING BOX, which is not the region: a
   * free-painted blob has a rectangular box, and without this the picture filled the box and spilled
   * over everything the visitor did not paint.
   */
  allow?: ReadonlySet<number>;
  /**
   * color only: how much of the picture's own tonal range is spread across the palette, 0..2 with 1
   * leaving it alone. Above 1 the window narrows and the extremes clip; below 1 it widens and the
   * result is gentler (`tools/generation/stencil/stencil.ts:narrowRange`).
   */
  contrast?: number;
  /** color only: what part water plays in the terrain reading. Absent is `none`. */
  water?: StencilWaterRole;
  /**
   * color only: the OBJECTS a picture may be built from, each with the colour it reads as. Present,
   * the picture is tiled with objects rather than coloured in terrain — which is what gives it a
   * real palette, since the catalogue carries dozens of hues where the terrain ramp is eight greens
   * and a blue. Sampled from the item icons on the main thread, because reading a picture's colours
   * needs a canvas and this plan crosses into a worker. The palette is the MATERIAL — every flower,
   * the flowers alone, the trees alone, or the road surfaces (`tools/generation/stencil/stencil-palette.ts`).
   */
  objectPalette?: readonly { catalogId: string; rgb: number }[];
  /**
   * The DECORATION: objects placed at the picture's anchor points, over whatever the primary
   * material left standing — what says a bow, an eye or a red trim that one palette could not.
   *
   * Absent is none. `density` is a share of the picture's cells and is capped by the generator
   * whatever it asks for; the placements go through the rules like any other and a refusal simply
   * skips.
   */
  decor?: {
    palette: readonly { catalogId: string; rgb: number }[];
    density?: number;
  };
}

/**
 * What part water plays when a picture is coloured in TERRAIN.
 *
 * `none` is the green ramp alone. `palette` adds the one blue as a ninth entry, so an area of the
 * picture that is genuinely blue becomes a real pond. `primary` is the water MATERIAL: the picture
 * is built as a body of water with its darkest cells raised as the mountain that draws its outline —
 * because a palette that holds one blue among eight greens only ever spends it on a blue picture,
 * and a visitor who asked for water is asking for water.
 */
export type StencilWaterRole = 'none' | 'palette' | 'primary';

/** Requested maze gates, in map coordinates. Each is snapped to the nearest cell on the maze's
 *  border ring, so a coordinate may sit anywhere, including deep inside the maze. Either may be
 *  absent, and both absent means two openings on opposite sides. */
export interface MazeGates { entrance?: MacroCoord | null; exit?: MacroCoord | null }

/** Where the gates landed once snapped — what a caller pins its entrance/exit markers to. Null on
 *  a side no gate was carved on. */
export interface ResolvedMazeGates { entrance: MacroCoord | null; exit: MacroCoord | null }

export interface GenerateConfig {
  algorithm: GenerateAlgorithm;
  mode: 'earth' | 'water' | 'mixed';
  corridorWidth: number;  // maze param: 1-3 cells wide corridors
  maxElevation: number;
  seed: number;
  region: MacroCoord[] | null;
  mazeGates?: MazeGates;
  /** 'stencil' algorithm only: the picture, and how to read it. */
  stencilPlan?: StencilPlan;
  /**
   * THE ONE 0..1 STYLE KNOB: SCENERY RICHNESS, 0 a flat garden town and 1 a terraced planet with
   * water on every layer. It scales the planet generator's terrain drama, its water, its theme
   * count and its decoration together.
   *
   * The recipe is informational in a share code; map reconstruction uses its cells and objects.
   */
  richness?: number;
}
