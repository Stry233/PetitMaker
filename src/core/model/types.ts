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

// --- Coordinate Types ---
export type MacroCoord = { x: number; y: number };
export type MicroCoord = { x: number; y: number };
export type ChunkCoord = { cx: number; cy: number };

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
  | { type: 'exclusionRadius'; radius: number }
  // Footprint that other terrain may use as a structural base (3x3 support), at
  // the object's elevation — the central plaza today, any such building later.
  | { type: 'terrainBase' };

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  name: LocalizedName;
  /** Icon PNG basename under src/assets/icons/ (catalog/ or ui/), resolved by iconUrl(). */
  icon?: string;
  color?: string;
  width: number;
  height: number;
  loadValue: number;
  /** Max times this item may be placed on the whole map (omit = unlimited). */
  maxCount?: number;
  /** This item's placement rule is not yet finalized (TBD) — the generator must NOT auto-place it
   *  (manual placement still works under whatever traits it currently has). */
  ruleTBD?: boolean;
  rotatable: boolean;
  placementMode: 'point' | 'brush';
  traits: PlacementTrait[];
  /** Bespoke low-poly 3D model (declarative). Absent → the item falls back to its ItemCategory archetype. */
  model3d?: ModelSpec;
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
}

/**
 * The editor's drawing-mode vocabulary — the UI-facing editing modes a user
 * picks (sibling to ToolType, which is the implementing tool a mode maps to).
 * The mode→tool mapping tables (TOOL_DEFS, designModeToToolType) live in
 * src/ui/menu/design-mode.ts; this union is the core type so state/store can
 * reference it without depending on the ui layer.
 */
export type DesignMode = 'brush' | 'line' | 'curve' | 'rect' | 'circle' | 'eraser' | 'hand' | 'edge-cut';

/** Region-select brush vocabulary (RegionSelectPanel + store.regionTool). */
export type RegionTool = 'brush' | 'eraser' | 'rect' | 'circle' | 'line' | 'curve';

// --- Events ---
export type EditorEvents = {
  'cells-changed': { cells: MacroCoord[] };
  'objects-changed': { added?: PlacedObject[]; removed?: string[] };
  'validation-failed': { cmd: Command; errors: ValidationError[] };
  'tool-changed': { tool: ToolType };
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

export type GenerateAlgorithm = 'random' | 'maze';

export interface GenerateConfig {
  algorithm: GenerateAlgorithm;
  mode: 'earth' | 'water' | 'mixed';
  corridorWidth: number;  // maze param: 1-3 cells wide corridors
  maxElevation: number;
  seed: number;
  region: MacroCoord[] | null;
  // Advanced 'random'-algorithm controls (optional; defaulted by toGenConfig — seed-first).
  relief?: number;
  naturalness?: number;  // 0..1 geometry style: 1 organic (default), 0 rectilinear "lego" terrain + roads
  waterAmount?: number;
  rivers?: number;
  flatness?: number;
  settlement?: number;   // 0..1 building/road density (placement populator)
  nature?: number;       // 0..1 vegetation density
}
