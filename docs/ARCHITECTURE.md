# System Behavior & Architecture

Marked reference sections are generated from code by `npm run docs:generate`; `npm run docs:check` and the test suite detect drift. Narrative sections explain contracts and rationale and need review when behavior changes.

This is the backend/engine reference for the Petit Planet map editor: how the system is built and how it behaves at runtime. What a map may legally *be* is not prose here: the game's building rules live in `src/rules/`, one rule per file, and this document describes the machinery that runs them.

## Architecture at a glance

The editor is a **layered stack with one strict rule: a module may import only from its own layer or a layer BELOW it — never above.** Lower layers are pure and reusable; higher layers compose them. Drawn like an OS stack (user-facing consumers on top, the engine floor at the bottom):

```
┌────────────────────────────────────────────────────────────────────────┐
│ ui/        the owning surfaces: shell · chrome · agent · hints,        │
│            over the shared design/ (tokens, scale, cursors) and        │
│            primitives/                                  (presentation) │
│ legal/     policy docs: markdown source → React + static HTML emitters │
├────────────────────────────────────────────────────────────────────────┤
│ agent/  io/  api/  LLM harness · save/load + share/ + export/ ·        │
│                    programmatic API                  (feature surfaces)│
├────────────────────────────────────────────────────────────────────────┤
│ kit/       the editor's verbs (operations/): newMap · loadMap ·        │
│            generateMap · … — one KitContext-taking implementation the  │
│            UI and the agent both call                      (verb seam) │
├────────────────────────────────────────────────────────────────────────┤
│ canvas/    the view seam (view-projection · active-view) · the shared  │
│            interaction/ pointer machine · TWO LIVE EDITING VIEWS:      │
│            map2d/ (PixiJS) and map3d/ (three.js)                       │
├────────────────────────────────────────────────────────────────────────┤
│ tools/     runtime/ (the active tool + the Tool/ToolContext contract)  │
│            and the modules it drives, each behind an index.ts door:    │
│            paint/ · objects/ · edge-cut/ · macros/ · placement/ ·      │
│            generation/ (the core floor · designer · maze · stencil)    │
├────────────────────────────────────────────────────────────────────────┤
│ i18n/      7-locale translations + localizedName (used by ui and agent)│
├────────────────────────────────────────────────────────────────────────┤
│ rules/     two-phase validators, one per file, in a RuleRegistry       │
├────────────────────────────────────────────────────────────────────────┤
│ state/     Zustand store (composition root) · catalog · object-geometry│
│            (catalog-aware footprints) · object-index · map-stats       │
│            (whole-map derivations) · layer-utils · selection           │
├────────────────────────────────────────────────────────────────────────┤
│ config/    catalog/<cat>/<id>.json (item + model3d) · maps/    (data)  │
│ assets/    icons · fonts · team art                          (static)  │
├────────────────────────────────────────────────────────────────────────┤
│ core/ model/      types · grid-model · constants · rng · noise ·       │
│                   colors · geometry · hash · math · traits ·           │
│                   object-id · bridge-span · waterfall-geometry ·       │
│                   model-spec · grid-wire · layer-utils · edit-mode ·   │
│                   rule-dispatcher (the validate-only rule interface) · │
│                   road-lookup (the paved-cell interface)               │
│       commands/   command-executor (two-phase validation) ·            │
│                   command-apply · road-reconcile ·                     │
│                   provenance-recorder · event-bus                      │
│       interaction/                                                     │
│                   pointer-buttons · tool-modes · camera-verbs ·        │
│                   press-plan (resolvePress: what a press, a tap and a  │
│                   drag each mean)                                      │
│       edge-cut/   terrain-silhouette kernel · corner-index ·           │
│                   cut-validator · trim-lock · cut-reconcile ·          │
│                   cut-backing · patch-corners · road-cut-states ·      │
│                   road-shape · road-region                             │
│       provenance/ edit-source ledger + taint threading                 │
│       runtime/    prefs (the one persisted-key table) · keybindings ·  │
│                   shortcut-manager · anim-config · device-quality ·    │
│                   cursor-spec · region-brush · toast-bus, among others │
└────────────────────────────────────────────────────────────────────────┘
                       imports only ever point DOWN  ↓
```

| Layer | Owns | May import |
|---|---|---|
| `config/` | static JSON data — the catalog (one file per object, with its 3D `model3d` inline) + map templates | — |
| `core/` | the **engine floor**: pure types, grid + geometry, RNG/noise/colour primitives, the command executor + two-phase validation, the event bus, the edge-cut silhouette kernel, the provenance ledger, and the pointer-semantics floor (`interaction/`: the button constants, the tool-mode predicates, the camera-verb catalogue, and `resolvePress`, the one function that answers what a press, a tap and a drag each mean). It depends on `rules/` only through `model/rule-dispatcher.ts` (the validate-only interface the concrete `RuleRegistry` implements) and on the catalog only through `model/road-lookup.ts` (the paved-cell lookup `state/object-index.ts` supplies), so every edge points down | within `core` |
| `state/` | the Zustand store (wires executor + registry + bus), the item catalog, object-footprint geometry, the memoized whole-map derivations (`map-stats`, `layer-utils`), and the pure selection derivations (`selection`) | `core` |
| `rules/` | two-phase validators (pre-command + post-stroke), one rule per file | `core`, `state` |
| `tools/` | interaction handlers (gesture → `Command`) + procedural generation | `core`, `state`, `rules` |
| `i18n/` | the 7-locale translation tables + `localizedName`/`translate` helpers | `core`, `state` |
| `legal/` | policy-document source (constrained markdown → React and static-HTML emitters, config, filing bar) | `core`, `i18n` |
| `assets/` | static icons, fonts, and team art (resolved by `icon-urls.ts`) | — |
| `canvas/` | the view seam (`view-projection.ts`, `active-view.ts`), the shared `interaction/` pointer machine, which executes the plan `core/interaction/press-plan.ts` resolves and drives the active view (drag thresholds, ghosts, overlays, touch, the rubber band remain its own mechanism), and the two live editing views: `map2d/` (PixiJS) and `map3d/` (three.js) | everything below |
| `kit/` | the editor's verbs (`operations/`: `newMap`, `loadMap`, `generateMap`, `clearGenerated`, …), each one a plain function taking a `KitContext` explicitly, plus the app-shell seam modules with exactly one caller (`host.ts` for camera/feedback effects on the active view, `commands.ts` for the keyboard-command run bodies, `group-edit.ts` for the plural selection's rotate/delete) | everything below |
| `ui/` | four owning surfaces — `shell/` (the frame around the map: mode blocks, bars, windows), `chrome/` (modals, floating overlays, the tour, guards), `agent/` (the assistant's panel: one column of four zones, and the one live character that leaps between the button and its desk), `hints/` — over two shared layers: `design/` (tokens, the scaling factors, `animations.css`, and the cursor CSS in `design/cursors/` over the catalogue declared in `core/runtime/cursor-spec.ts`) and `primitives/` (the generic parts any surface could reach for: modal shell, switch, spinner, fitted text, icons). `hooks/` holds the hooks more than one surface calls | everything below |
| `agent/`, `io/`, `api/` | the LLM agent harness (its own section below), save/load + the share pipeline + image export, and the DEV-only programmatic API | everything below |

**`core/model` is the canonical primitives floor.** Every shape-free, state-free primitive lives here so no higher layer re-implements or reaches up for it: the seeded RNG (`rng.ts`), value noise (`noise.ts`), colour lookups (`colors.ts`), the 4-neighbour offsets + BFS distance field + `flatIndex`/`cellKey` helpers (`grid-model.ts`), waterfall face geometry (`waterfall-geometry.ts`), and the declarative 3D `ModelSpec` shape (`model-spec.ts`, referenced by `CatalogItem.model3d`). Geometry that additionally needs the **item catalog** (object footprints — `objectRect`, `getPlacedObjectSize`, `buildObjectOccupancy`, …) sits one layer up in `state/object-geometry.ts`, so `rules/`, `tools/`, and both views under `canvas/` import it *downward* rather than reaching into a tool.

**`canvas/` holds two live editing views, not a renderer and a preview.** `map2d/` (PixiJS) and `map3d/` (three.js) both drive the same tools through the same command path. Tools and the pointer machine speak only the `ViewProjection` / `ToolOverlay` / camera-verb interfaces in `view-projection.ts`, and `active-view.ts` re-points them at whichever view is showing — so no tool branches on the view mode, and adding view-specific behaviour means implementing an interface member rather than touching a tool. Each view registers its live instance for callers outside the React tree that owns the canvas: `map2d/renderer-registry.ts` for whole-map capture and object-layer resync, `map3d/scene/camera-registry.ts` for `io/autosave`'s 3D-orbit camera round-trip.

**Where `core` needs an answer from above, it declares the question and takes it as an argument.** Two narrow interfaces on the primitives floor carry everything `core` cannot derive for itself: `model/rule-dispatcher.ts` (the validate-only slice of `RuleRegistry`) and `model/road-lookup.ts` (`RoadLookup`, "which object coats this cell?" — a coating is a catalog fact, so the edge-cut geometry is handed the lookup rather than fetching it from `state/object-index`). Both are injected into `CommandExecutor`'s constructor, and every other consumer takes them as a parameter. `__tests__/import-direction.test.ts` holds the result: no file in `src/` imports from a layer above its own.

### The canonical edit flow

Every mutation is a `Command`. The path from a user action to a rendered pixel:

1. A **tool** (or the programmatic API) builds a `Command` and calls `executor.execute(cmd)`.
2. The executor runs **pre-command rules** (`RuleRegistry.validatePreCommand`). On any error the command is rejected and state is left unchanged.
3. On success it snapshots the affected cells, **applies** the command, pushes an undo entry, and emits `cells-changed` / `objects-changed`. For a terrain command it then runs an inline mid-stroke reconcile (a settle-only road pass plus the edge-cut repair over the command's own cells), so the map is right under the moving pointer rather than at its release.
4. At the end of a gesture the tool calls `executor.commitStroke(start)`, which runs in this order: the **road reconcile** (`reconcileRoads`, BEFORE validation, so its re-places are validated and auto-revertable with the stroke), then the **post-stroke rules**, then the **auto-revert loop** (offending commands popped one at a time until the state is clean — never onto the redo stack), then the **edge-cut reconciliation** (`reconcileCuts`), and finally `collapseHistory`, which folds the stroke and its repairs into ONE undo entry.
5. The **active view** redraws from the emitted events; the store never calls a view directly.

The sections below follow this dependency chain outward, from the data model to the IO/API surface. Where a subsystem has a known wart, the prose says so inline.

---

## Data Model & Types

### Responsibility

`src/core/model/types.ts`, `src/core/model/constants.ts`, and `src/core/model/layer-utils.ts` form the foundational contract for the entire editor. Every other subsystem — rules, renderer, tools, IO, state — imports from this layer; nothing here imports from them. The three files collectively define: the persistent data shapes that cross the command boundary, the enum vocabularies all code narrows against, the event bus contract that decouples renderer from state, and the `LayerInfo` type (which cannot contain query functions due to layer ordering constraints).

---

### The Cell Hierarchy

The atomic unit of state is `MacroCell` (`types.ts`): a zone enum (`CellZone`) plus a nullable `TerrainCell`. When `terrain` is `null` the cell is bare ground (layer 0) — this is a deliberate sentinel rather than a default struct with `TerrainType.None`, because it keeps the common case cheap and makes "has terrain?" a single null check everywhere. `TerrainCell` (`types.ts`) holds `type` (a `TerrainType` enum), `elevation` (bounded by `ELEVATION_MAX`), and three optional fields that only exist on road/edge-cut cells: `corners?: Corners`, `patchOnly?: boolean`, and `patchBase?: number`. These optional fields are how the road/edge system piggy-backs metadata onto the same terrain slot without adding a separate data structure. `patchBase` is the load-bearing one: a Γ patch is a cosmetic fillet, so `patchBase` records the REAL support tier under it (0 when the fillet sits straight on the ground). Reading `elevation` on such a cell sees a block that is not there, which is why `structuralTop`/`surfaceElevation` exist and why placement and support questions must go through them.

`Corners` (`types.ts`) is a fixed-length tuple `[CornerTrim, CornerTrim, CornerTrim, CornerTrim]` in NW/NE/SW/SE order. The element type `CornerTrim` is a string union (`'square' | 'fan' | 'tri-NW' | 'tri-NE' | 'tri-SW' | 'tri-SE' | 'empty'`). The sentinel value `'empty'` signals "remove this cell entirely" in `TrimCornersCommand` — when all four corners are `'empty'`, `applyCommand` deletes the terrain cell rather than storing an all-empty `Corners` array (`command-apply.ts`). Similarly, all-`'square'` corners normalize to `corners: undefined`, since `undefined` is the canonical form for "no corner data".

`GridState` (`types.ts`) aggregates:
- `cells: MacroCell[][]` — row-major, `cells[y][x]` (documented invariant).
- `objects: Map<string, PlacedObject>` — keyed by UUID.
- `lockedLayers: Set<number>` — UI-controlled; read by `layer-lock` rule but never written by rules.
- `template: MapTemplate` — the immutable blueprint (dimensions, zone layout, plaza config) sourced from `src/config/maps/*.json`.

---

### The Command Discriminated Union

All mutations flow as `Command` values, a discriminated union narrowed by `cmd.type: CommandType` (`types.ts`). Its variants are:

- **`PaintTerrainCommand`**: a batch of `MacroCoord[]` plus `terrainType` and `elevation`. The batch design means a full brush stroke can be a single command, though in practice each cell in a stroke is a separate command (tools call `execute()` once per cell, accumulate them as separate undo entries, and call `commitStroke()` at pointer-up).
- **`EraseTerrainCommand`**: same batch shape, no terrain payload.
- **`PlaceObjectCommand`**: embeds the full `PlacedObject` struct plus `loadValue`. `loadValue` is populated by callers but not used for chunk-load accounting, which the rule computes fresh from `state.objects` (see the chunk-load section below).
- **`RemoveObjectCommand`**: mirrors `PlaceObjectCommand`; captures `removedObject` for undo.
- **`TrimCornersCommand`** (`types.ts`): the most structurally overloaded command. A single type covers both terrain-layer corner trimming and road-object corner trimming via the `layer: 'terrain' | 'road'` discriminant and optional `objectId`. The `beforeCorners`/`afterCorners` fields carry the corner state for undo. Optional `beforeRotation`/`afterRotation` fields carry a road rotation change on the command so that `revertEntry`/`reapplyEntry` can restore it faithfully — `reconcileRoadAt` and the edge-cut tool set these instead of mutating `road.rotation` directly.

Every command extends `CommandBase` (`types.ts`) which carries only `timestamp`. Undo/redo snapshots are never stored on the command itself: they live on `HistoryEntry` (exported from `command-apply.ts`), which holds the original `cmd`, `before`/`after` arrays of `CellSnapshot`, an optional `objectOps` (the net object add/removes of a COLLAPSED group, set only by `collapseHistory`), and an optional provenance `taint` delta restored in lockstep with the cells. `CommandExecutor.execute()` captures the before/after cell snapshots via `cloneCell` and pushes the entry. `CellSnapshot` (`types.ts`) is simply `{ coord: MacroCoord; cell: MacroCell }`.

---

### PlacedObject and the Dual Catalog Problem

`PlacedObject` (`types.ts`) is the runtime representation: a unique `id`, `catalogId` reference, `position`, `rotation`, `elevation`, and optionals (`spanLength` for bridges, `corners`/`patchOnly` for road objects, and the self-description fields `width`/`height`/`icon`/`color` plus `locked` that let an off-catalog immutable structure — the central plaza — render and validate with no special case). It carries no category of its own: `catalogId` determines it, and `state/catalog.ts:categoryOf` is the one way to ask, answering with the full `ItemCategory`. That matters because a projection onto fewer members cannot tell a house from a road, a bridge or a ramp, and callers then recover the difference by matching on id strings.

`ItemCategory` (`types.ts`) is the catalog category enum that `CatalogItem` carries. `CatalogItem` (`types.ts`) is the schema for the per-object files under `src/config/catalog/<category>/<id>.json`. `PlacedObject` stores only `catalogId` and looks up its dimensional and behavioral metadata from the catalog at runtime.

---

### PlacementTrait Union

`PlacementTrait` (`types.ts`) is a tagged union declared in `types.ts`. Each variant parameterizes a validation strategy: `flat` checks uniform elevation across an extended footprint (W+1 × H+1 to account for the macro/micro grid offset — see "Coordinate duality (macro vs. micro)" below); `noFloat` requires terrain present on every footprint cell; `waterSpan` validates bridge geometry including auto-detecting orientation and mutating `cmd.object.rotation`, `cmd.object.position`, and `cmd.object.spanLength` as side-effects during validation (`placement.ts`); `heightDrop` similarly mutates position, rotation, and elevation for ramps; `surfaceCoating` requires non-water terrain (roads); `plantable` marks a coating flora may stand ON (the game plants flowers on some path surfaces, so placing flora keeps this coating instead of stripping it, and the pair passes the standing-on-a-road rule); `exclusionRadius` enforces Chebyshev distance between same-category items; `terrainBase` declares the footprint usable as structural support for terrain above it; `halfStep` lets the item anchor on the half-cell grid in both axes (the game's exception for ramps and bridges, which is what `ToolContext.halfCoord` exists for).

The mutation-during-validation pattern for `waterSpan` and `heightDrop` is intentional: it allows the placement validation rule to both check and auto-correct object placement geometry in a single pass.

---

### Rule System Interfaces

`PreCommandRule` (`types.ts`) gates individual commands: `appliesTo: CommandType[]` lets `RuleRegistry.validatePreCommand` skip irrelevant rules cheaply. `PostStrokeRule` (`types.ts`) gets the full `GridState` with no command context — it must scan for structural violations globally. Neither mutates the map; placement validation may normalize the proposed command before subsequent rules inspect it. `ValidationError` (`types.ts`) carries a `ruleId`, i18n `message` key with optional `messageParams` interpolation values, evidence `cells`, optional `rects` (the evidence's exact drawn BODY when the cause is an object rather than a grid cell — an object's footprint can sit on the half grid, so when present the error flash paints THESE and ignores `cells` for that error; both come out of `grid-model:bodyEvidence` so the two cannot disagree), and `severity: 'error' | 'warning'` (only `'error'` triggers rejection; `'warning'` is defined but not acted on by `CommandExecutor`). **`cells` is the evidence contract**: the cells that *cause* the violation — complete (every offender, e.g. every non-flat cell in the `flat` trait's extended sweep, or the intersection region of an overlap), never a bare click anchor; non-spatial rules (max-count, chunk load, locked object) report the whole footprint involved. The optional `grid: 'macro' | 'micro'` says which grid the evidence renders on ('micro' = the terrain micro-grid, −HALF_TILE); when absent, the renderer falls back to the command-type default. The error flash (`OverlayLayer.flashErrors` via the pure `canvas/map2d/layers/error-flash.ts:resolveErrorFlashCells`) lights exactly these cells, per-error grid, deduped across rules — and the agent bridge's `formatErrors` echoes the same coordinates to the LLM.

---

### Layer Utilities

The `LayerInfo` type lives in `core/model/layer-utils.ts`; the derivation that produces it lives one layer up, in `state/layer-utils.ts`, since it reads the per-layer counts `state/map-stats.ts` derives from the catalog (`core/model` cannot import `state/`, so the split follows that boundary).

**`getActiveLayers(state, activeLayer)`** (`state/layer-utils.ts`) derives a contiguous `LayerInfo[]` (Ground..top) for the layer panel UI from `getMapStats(state)`. Cell counts are cumulative: a cell at elevation 3 counts in layers 1, 2, and 3; an object counts only at its own elevation, Ground included. `top` is the higher of `activeLayer` and the map's highest occupied layer, clamped to `ELEVATION_MAX`, so a newly selected empty layer still appears and an added intermediate layer stays listed once a higher one is active.

`layer-utils` contains no rule logic: V-MTN-03 (3×3 base support) lives in exactly one place, `rules/base-support.ts`. The renderer's buildable-region overlay is driven by `host.buildableRegion.show(cells)` with externally supplied cells (generation preview), not by a predictor here.

---

### Game Constants

<!-- generated:constants:start -->

Source: [src/core/model/constants.ts](../src/core/model/constants.ts).

| Constant | Value |
|---|---|
| `CHUNK_SIZE` | `16` |
| `CHUNK_LOAD_LIMIT` | `10000` |
| `CHUNK_LOAD_ENABLED` | `false` |
| `ELEVATION_MAX` | `8` |
| `TILE_SIZE` | `64` |
| `PLAZA_ID` | `"__plaza__"` |
| `ZOOM_MIN` | `0.05` |
| `ZOOM_MAX` | `4` |
| `PAN_KEEP_PX` | `160` |
| `WATER_COLOR` | `"#97e1ff"` |

<!-- generated:constants:end -->

Chunk and elevation rules, grid conversion, and camera bounds read these constants directly. The same module owns the elevation and zone palettes. Per-item parameters such as exclusion radii belong to catalog traits.

---

### Composition with Neighbouring Subsystems

- **Rules** import `PreCommandRule`, `PostStrokeRule`, `Command`, `CommandType`, `GridState`, `ValidationError`, `PlacementTrait` — all from `types.ts`. The type system enforces the purity contract: rules receive only read-only-by-convention values and return `ValidationError[]`.
- **CommandExecutor** (`command-executor.ts`) owns `GridState` and applies mutations; it uses `CellSnapshot` for undo/redo and emits typed `EditorEvents`. The `EventBus<EditorEvents>` is parameterized by the `EditorEvents` map from `types.ts`, giving compile-time guarantees that event payloads match listener signatures.
- **Renderer** subscribes to `cells-changed` and `objects-changed`; it reads `MacroCell.terrain.corners` to determine trim shape, `PlacedObject.elevation` for layer visibility, and `ELEVATION_COLORS`/`ZONE_COLORS` from constants.
- **IO** (`json-codec.ts`) serializes/deserializes `GridState`.
- **Chunk load** is read from one place, `state/map-stats.ts`'s memoized `chunks` map (`getMapStats(state).chunks`), by both the chunk-load rule (`rules/chunk-load.ts`) and the programmatic API. Chunk load is never stored on `state` itself and no command carries a delta for it directly — map-stats derives and patches it from the same object add/remove deltas every other whole-map count already folds against, so there is one accounting path, not two.

---

## Grid Model, Event Bus & Chunk Tracking

### Responsibility

This subsystem defines the editor's spatial data model, the decoupled notification channel between state mutators and the renderer, and the accounting types for per-chunk object-load budgets. It is the foundation every other subsystem builds on: rules read `GridState`, commands mutate it via `grid-model.ts` helpers, the renderer reacts to `EventBus` notifications, and chunk-load enforcement lives in the pre-command rule, reading the same per-chunk load `state/map-stats.ts` already keeps for the whole map (see below).

---

### Grid Model (`src/core/model/grid-model.ts`)

The grid is a **row-major 2-D array** of `MacroCell` (`types.ts:MacroCell`), indexed as `cells[y][x]`. Each `MacroCell` holds exactly two fields: a `CellZone` (static, set at template load and never mutated) and an optional `TerrainCell | null`. Null terrain means "bare ground at layer 0" — there is no stored layer-0 entry (Layer 0 = Ground, implicit).

**Grid lifecycle:**

`createGrid` (`grid-model.ts`) is the only constructor. It iterates the `MapTemplate` zone table and produces a fresh cell array with **every** cell starting at `terrain: null`. The plaza is not a terrain exception: a template's `CellZone.Plaza` cells are mapped to `CellZone.Grass` at creation ("the plaza is a locked object, not a zone"), and the plaza itself arrives as an ordinary immutable `PlacedObject` built by `createPlazaObject` and seeded into `state.objects` by the store's `initMap`.

**Access:**

`getCell` (`grid-model.ts`) returns `null` for any out-of-bounds index; it never throws. This is the universal safe-read contract used everywhere (rules, tools, renderers). `setCell` (`grid-model.ts`) has a symmetric no-op contract for out-of-bounds writes. Together they form a boundary layer so callers never guard indices themselves.

**Mutation:**

The grid is intentionally mutable. `applyCommand` directly sets `cell.terrain` or calls `setCell` (`command-apply.ts`). The undo/redo mechanism relies on `cloneCell` (`grid-model.ts`) to capture deep snapshots before and after each command. `cloneCell` copies `zone`, `terrain.type`, `terrain.elevation`, and the optional `corners` (as a fresh array copy), `patchOnly` and `patchBase` fields (`grid-model.ts`). Terrain `TrimCorners` undo/redo therefore faithfully restores corner geometry.

**Coordinate duality (macro vs. micro):**

The editor has two overlapping grids. Object placement uses the macro grid; the micro grid subdivides each macro cell into two steps per axis. Terrain blocks are centered on macro intersections, with their top-left at `x * TILE_SIZE - HALF_TILE`; objects start at `x * TILE_SIZE`. These offsets and conversions are defined in [grid-model.ts](../src/core/model/grid-model.ts).

`macroToMicro` (`grid-model.ts`) converts by doubling: `(x, y) → (x*2, y*2)`. Bridge geometry is the main consumer of the micro grid, and it lives in `core/model/bridge-span.ts:detectBridgeSpan` — shared by the `waterSpan` trait rule and the placement ghost, so validation and preview cannot disagree about where a bridge lands.

`microToTerrain(mx, my)` resolves the terrain block containing a pointer, including the half-tile offset and negative coordinates. `Tool.terrainGrid(ctx)` opts terrain drawing and terrain erasing into this conversion. `ToolManager` uses it for pointer down, move and up; the cursor refusal probe and ghost use the same coordinates. Roads, object placement, selection, region tools and corner detection retain their own coordinate contracts. The 2D and 3D views share this dispatch rule.

The practical consequence of the −`HALF_TILE` terrain offset is captured in the "Flat trait" rule: placement flatness checks extend one extra column and row right/bottom to account for the fact that a macro cell's terrain block bleeds into the adjacent macro-grid region (`grid-model.ts` header comment) — this is what prevents micro-block floating at cliff edges due to the macro/micro grid offset difference.

**The plaza:**

The plaza is no special case in the geometry: `createPlazaObject` (`grid-model.ts`) builds it as an ordinary `PlacedObject` carrying `locked: true`, and the object-collision rules (V-PLACE-BLOCK, V-PLACE-OVERLAP) are what keep terrain and placements off it. V-LOCK-02 refuses modifying it by name. What remains here is the rect math those rules share: `cellOverlapsRect(rect, x, y, cellShift)` asks whether a macro cell's *area* overlaps a rect rather than whether a corner is inside, so any cell the edge cuts through counts. `cellShift` is the cell's lower-bound offset — terrain renders on the micro-grid (`−HALF_TILE`) so its cell spans `[x−0.5, x+0.5]`, while objects render unshifted and span `[x, x+1]`.

---

### EventBus (`src/core/commands/event-bus.ts`)

`EventBus<EventMap>` is a generic, synchronous, in-process pub/sub hub. It maintains a `Map<key, Set<Handler>>` (`event-bus.ts`). The generic parameter `EventMap` constrains all `on`, `off`, and `emit` calls to the same event-to-payload mapping at compile time.

The editor instantiates a single `EventBus<EditorEvents>` in `store.ts` and shares it to both `CommandExecutor` (at executor construction time, `store.ts`) and `MapRenderer` (at renderer construction time, `PixiCanvas.tsx`). This is the **only cross-cutting channel** between the state layer and the rendering layer; the renderer never reads `GridState` directly except during `initMap` and snapshot operations.

**`EditorEvents` (`types.ts`):**

| Event | Payload | Who emits | Who handles |
|---|---|---|---|
| `cells-changed` | `{ cells: MacroCoord[] }` | `CommandExecutor` (execute, undo, redo, commitStroke revert) | `MapRenderer`: selective terrain redraw + layer number refresh |
| `objects-changed` | `{ added?, removed? }` | `applyCommand` inside `PlaceObject`, `RemoveObject`, `TrimCorners` | `MapRenderer`: object layer sync |
| `validation-failed` | `{ cmd, errors }` | `CommandExecutor.execute` on pre-command rejection | `MapRenderer`: flash error overlay; `Toast.tsx`: auto-show error toast |
| `tool-synced` | `{ tool: ToolType }` | `PixiCanvas`, after writing the store's tool/shape/surface/floor/brush into the ToolManager + DrawingTool | `usePointerInteraction`: re-run the cursor's refusal probe; `use-cursor`: push the tool's cursor |
| `history-changed` | `{ canUndo, canRedo }` | `CommandExecutor` after every execute/undo/redo | the undo/redo pair's enable/disable |
| `history-applied` | `{ cells, objects? }` | `CommandExecutor.undo()`/`redo()`, with the cells the step touched (and its objects, for an object-anchored flash) | the renderer's reverted/reapplied-region flash (`resolveHistoryFlash`) |
| `viewport-changed` | `{ zoom }` | the viewport, after a pan/zoom transform applies | screen-anchored React overlays (selection handles) re-track |

**Decoupling contract:** `CommandExecutor` emits `cells-changed` after every successful state mutation. The renderer reacts by redrawing only the listed cells (`terrain-layer.ts:redrawCells`). This means the renderer is entirely driven by events and holds no authoritative state — it is a pure projection of the `GridState` via the bus.

For road `TrimCornersCommand`, `applyCommand` emits `objects-changed { removed }` followed immediately by `objects-changed { added }` on the same object (two separate `emit` calls). This causes the object layer to perform a remove-then-add cycle rather than an in-place update — a known rendering trade-off to force a sprite refresh. The executor adds a road-seam re-announce on top: a coating arriving, leaving or changing its cut re-emits `objects-changed { added }` for each road it borders, because a road tile's drawn boundary (`road-shape.ts`) depends on its neighbours and both views answer that idiom by redrawing the object in place.

---

### Chunk Load (`rules/chunk-load.ts` reading `state/map-stats.ts`)

Chunk load has no accounting structure of its own: it is one of the whole-map figures `state/map-stats.ts` already derives and memoizes per `GridState` (`chunks: Map<chunkKey, ChunkStat>`, patched from `state.objectsDelta` the same way every other map-stats figure is — see Map Stats below). A chunk key is produced by `chunkKey` (`grid-model.ts`): `"cx,cy"` with `cx = Math.floor(x / CHUNK_SIZE)`.

**How objects span multiple chunks:**

`chunksOf` (`state/map-stats.ts`, exported for `rules/chunk-load.ts` to reuse against a candidate that is not yet on the map) iterates every `(dx, dy)` offset within an object's `w × h` footprint and collects the distinct chunk keys. For a 2×2 object placed at macro (15, 15), all four cells (15,15), (16,15), (15,16), (16,16) fall in different chunks (chunk 0 and chunk 1 on each axis), so the object contributes its full `loadValue` to all four chunk buckets. This is a per-chunk-cell-coverage model, not a per-object-anchor model.

**The rule reads the memoized figure:** The chunk-load pre-command rule (`rules/chunk-load.ts:chunkLoadViolations`) calls `getMapStats(state).chunks` and, for each chunk key in the *candidate's own footprint*, checks `existing.load + loadValue` against `loadMaxFor(state, key)` — a function, not a bare constant, so a chunk's ceiling can vary by map template or in-game config later; every chunk defaults to `CHUNK_LOAD_LIMIT` today. One placement check therefore costs the candidate's own footprint, not the map's object count, as long as map-stats itself is patched rather than rebuilt (a mutation that skips or corrupts the object delta forces map-stats to fall back to a full rebuild that touches every object once — a property of map-stats's staleness-never/speed-sometimes contract, not of this rule; see Map Stats below). If `candidate.id` already names an object on the map — a caller validating a replacement before the old copy under the same id has been removed — that prior copy's own contribution is discounted per chunk so a candidate is never charged against itself.

**`CHUNK_LOAD_ENABLED` gate:** The flag in the generated constants table controls enforcement. Catalog load values must be established before enabling it. When the flag is `false`, `chunkLoadRule.validate` immediately returns `[]` and every placement is free. Flipping the flag to `true` and setting real `loadValue` entries in the catalog enables enforcement with no further plumbing.

---

### Composition with Neighbouring Subsystems

- **CommandExecutor** is the exclusive writer to both `GridState.cells` and `GridState.objects`. After every write it emits the appropriate `EventBus` event. Rules are read-only consumers of `GridState`.
- **RuleRegistry** reads `GridState` for validation but never mutates it. V-CHUNK-01 reads chunk load from `state/map-stats.ts`'s memoized `chunks` map rather than computing it from `state.objects` itself.
- **MapRenderer** subscribes to `cells-changed` and `objects-changed` at construction time; it never polls state.
- **Zustand store** owns the `EventBus` singleton and passes it to both `CommandExecutor` and `MapRenderer`, keeping them in sync without direct coupling.
- **JSON codec** reconstructs a `GridState` from disk; chunk load is not persisted (it is derived from the objects).
- **Tools** construct commands carrying only what the executor and the rules read; chunk load is derived, never passed along.

---

## Command Executor & Two-Phase Validation

### Responsibility

`command-executor.ts:CommandExecutor` is the sole mutator of `GridState`. Every change to the map — painting terrain, placing/removing objects, trimming corners — flows through its `execute()` method. It owns the undo/redo stacks and enforces correctness through a two-phase validation model: a pre-command gate that can reject individual operations, and a post-stroke sweep that auto-reverts whole sequences that leave the grid in an illegal state.

### Key Types and Data Structures

- `HistoryEntry` (`command-apply.ts`, exported — the revert/reapply state machinery lives beside it): the unit of undo history. Holds the original `Command`, `before` and `after` arrays of `CellSnapshot` (coord + deep-copied `MacroCell`) captured by the executor around the mutation, an optional `objectOps` (the net object add/removes of a collapsed group), and an optional provenance `taint` delta. The `HistoryEntry` is the sole authoritative history record — `CommandBase` carries only `timestamp`; undo/redo snapshots live exclusively on `HistoryEntry`.
- `CellSnapshot` (`types.ts`): a `{ coord: MacroCoord, cell: MacroCell }` pair, produced by `command-executor.ts:snapshot()` via `grid-model.ts:cloneCell()`.
- `RuleRegistry` (`rules/registry.ts`): a dual-list dispatcher. Pre-command rules are filtered by `rule.appliesTo` before invocation; post-stroke rules always run against the full state. On the pre-command side all applicable rules execute to completion — errors accumulate rather than short-circuit. `validatePostStroke` takes an optional `{ firstOnly: true }`, which returns at the first rule that errors: the auto-revert and undo loops re-check with it, since inside a loop the only question is "clean yet?".
- `EditorEvents` (`types.ts`): the typed event bus schema. The executor emits `cells-changed`, `objects-changed`, `validation-failed`, `history-changed`, and `history-applied` (undo/redo only, for the history flash).

### Phase 1 — Pre-Command Validation (`execute`)

`execute()` (`command-executor.ts`) runs the full sequence:

1. `registry.validatePreCommand(cmd, state)` fans out to all registered pre-command rules whose `appliesTo` includes `cmd.type`. Registered pre-command rules (in priority order, `rules/index.ts`): `layerLockRule`, `lockedObjectRule`, `elevationRangeRule`, `mountainFloatingRule`, `waterFloatingRule`, `objectBlocksTerrainRule`, `traitPlacementRule`, `zoneRestrictionRule`, `placementOverlapRule`, `placementMaxCountRule`, `chunkLoadRule`.
2. If any error is returned, `validation-failed` is emitted (picked up by `Toast.tsx` for display) and `ValidationResult { success: false }` is returned with state unchanged.
3. If clean: `getAffectedCells(cmd)` determines which macro-coordinates will be touched (one coord per object position for `PlaceObject`/`RemoveObject`, the full cell list for terrain commands, `{x, y}` for `TrimCorners`). Snapshots are taken **before** and **after** mutation, the provenance recorder captures the entry's taint delta, the `HistoryEntry` is pushed to the undo stack, and the redo stack is cleared.
4. If the command placed, removed or re-cut a coating, the executor re-announces the bordering roads (`objects-changed { added }` per neighbour) so both views redraw seams whose drawn boundary the change moved.
5. `cells-changed` and `history-changed` are emitted unconditionally on success.
6. For a terrain command (`PaintTerrain`/`EraseTerrain`), an **inline mid-stroke reconcile** runs before `execute` returns: `reconcileRoads(..., { settleOnly: true })` carries a road whose footprint now stands uniform at a new level, and `reconcileCuts` repairs edge cuts over the command's own cells — so the map is right under the moving pointer, with `commitStroke`'s full passes as the backstop. A `reconciling` re-entrancy guard keeps the repairs (which come back through `execute`) from re-triggering the pass.

A subtle contract: `state` is mutated **in place** by `applyCommand`. There is no rollback path within `execute` itself — the contract is that pre-command rules must catch all failures before the mutation runs.

### `applyCommand` — Per-Command Mutations

`applyCommand` (`command-apply.ts`) is a direct switch over `CommandType`:

- **`PaintTerrain`**: iterates `cmd.cells`, writes `createDefaultTerrainCell(terrainType, elevation)` per cell. Special case: `Mountain` at `elevation === 0` is treated as an erase (sets `terrain = null`) rather than a paint.
- **`EraseTerrain`**: sets `terrain = null` on each cell.
- **`PlaceObject`**: calls `state.objects.set(cmd.object.id, cmd.object)` and emits `objects-changed {added}`.
- **`RemoveObject`**: calls `state.objects.delete(cmd.objectId)` and emits `objects-changed {removed}`.
- **`TrimCorners`** (terrain layer): updates `cell.terrain.corners` and optionally `cell.terrain.patchOnly` in place, or nulls `terrain` entirely if `afterCorners` is all-`'empty'`. `execute()` emits `cells-changed` after `applyCommand` returns; `applyCommand` itself does not emit a second `cells-changed` for terrain, so there is no duplicate emission for terrain `TrimCorners`.
- **`TrimCorners`** (road layer): mutates the `PlacedObject` in place (applying `afterCorners`, `patchOnly`, and `afterRotation` if set), or deletes it if `afterCorners` is all-`'empty'`. Emits `objects-changed {removed}` + `objects-changed {added}` as a remove-then-re-add dance to force the renderer to refresh the object sprite.

### Phase 2 — Post-Stroke Validation (`commitStroke`)

`commitStroke(strokeStartSize, opts?)` (`command-executor.ts`) is called by tools at pointer-up. `strokeStartSize` is the undo stack depth at the moment the stroke began (retrieved via `getUndoStackSize()`); this bounds how far back the auto-revert can reach. `opts.reconcile` (default true) lets a corner-only stroke skip both reconcile passes — the edge-cut tool's cuts change only the silhouette, never support, so they cannot invalidate anything.

1. **The road reconcile runs first**, before validation: `road-reconcile.ts:reconcileRoads` over the stroke's changed cells, so a coating carried to a new level is validated (and auto-revertable) with the stroke rather than landing after judgement.
2. `registry.validatePostStroke(state)` runs all post-stroke rules (registered: `baseSupportRule`, `waterContainmentRule`, `waterfallAdjacentUniformityRule`, `objectOnCoatingRule`). These are stateful grid scans, not command-gated.
3. If violations exist, the executor enters a revert loop: it pops entries off the undo stack (up to `maxUndos = undoStack.length - strokeStartSize`) and calls the private `revertEntry(entry)` helper for each (which restores `entry.before` cell snapshots **and** undoes the command's object-layer effect — `PlaceObject` deletes the object, `RemoveObject` re-adds it, road `TrimCorners` restores corners and rotation). The popped entries are **deliberately NOT pushed to the redo stack** — in the code's own words, "an auto-reverted fragment is an ILLEGAL partial state — redo would reinstate it unvalidated, and the fragment (sitting below every later stroke's revert window) would then make every future commitStroke fully revert its own stroke. Auto-reverted work is simply gone." After each pop it re-checks with `validatePostStroke(state, { firstOnly: true })` and exits as soon as the state is clean or the entire stroke has been reverted. A single `cells-changed` + `history-changed` pair is emitted after all reverts are batched.
4. `commitStroke` then computes the set of cells actually changed by the surviving stroke history (entries from `strokeStartSize` to the current top), and calls `cut-reconcile.ts:reconcileCuts`. That function expands the changed region to its 8-neighbourhood and issues repair `TrimCorners` commands back through `execute()` to square any stale edge cuts and patch-only terrain pieces. These repair commands join the undo stack as first-class entries, extending the stroke's history.
5. `collapseHistory(strokeStartSize)` folds the whole stroke — its commands AND the reconcile repairs — into ONE undo entry, so undo reverts a change and its repair together and can never stop at a reconcile-orphaned (illegal) intermediate.
6. `commitStroke` returns the **initial** violation list (before any revert) — callers use this to show a toast message.

The undo-grouping model: all commands executed between two `commitStroke` calls form a logical stroke, and the closing collapse makes the survivors one undo entry. Post-stroke validation drives which commands survive; partial reversal is possible (earliest commands within a stroke can survive if they satisfy rules without the later ones).

### Undo Semantics

`undo()` (`command-executor.ts`) pops entries one at a time, calling the private `revertEntry(entry)` helper for each, and re-checks `validatePostStroke(state, { firstOnly: true })` after each pop. It keeps undoing until the state is clean or the stack is empty. This means a single user undo can revert multiple `HistoryEntry` items, skipping through any intermediate state that would itself be illegal. The redo stack receives all popped entries in order (a USER undo, unlike the auto-revert loop, produces a legal boundary that redo may safely reinstate), and the step emits `history-applied` with the cells and objects it touched so the renderer can flash the reverted region.

`redo()` (`command-executor.ts`) pops one entry, calls the private `reapplyEntry(entry)` helper (which restores `entry.after` cell snapshots and re-applies the command's object-layer effect — the exact inverse of `revertEntry`), pushes it back to the undo stack, and emits the same `history-applied`. Redo does not validate — it trusts that the after-state was valid when it was originally executed.

**`revertEntry` / `reapplyEntry`:** the shared implementation for undo, redo, and `commitStroke`'s revert loop. On the executor they are one-line wrappers that restore the entry's provenance taint in lockstep and then delegate to `revertEntryState`/`reapplyEntryState` in `command-apply.ts`, which restore the relevant cell snapshots (`before` for revert, `after` for reapply) **and** handle the command's object-layer effect: `PlaceObject` ↔ delete/add on `state.objects`, `RemoveObject` ↔ add/delete, road `TrimCorners` ↔ restore corners + `beforeRotation`/`afterRotation`, and a collapsed group's `objectOps` net. Each call emits the corresponding `objects-changed` event. One edge case: a road deleted by an all-`'empty'` `TrimCorners` is not re-created on undo, because the command does not store the full `PlacedObject` — this situation is not reachable from current authoring tools.

**`commitStrokeGroup`** (`command-executor.ts`): an alias of `commitStroke`, kept for call-site intent — batch operations (generation, Clear, the agent's write tools) call it to say "one undo step" explicitly. Both collapse the stroke into a single undo entry via `collapseHistory`, which merges the earliest `before` and latest `after` snapshot per cell **and** the net object add/removes across the group (`HistoryEntry.objectOps`), so a batch that mixes terrain edits with object placement/removal — e.g. terrain generation, or the Generate shelf's Clear that wipes tiles + placements — undoes/redoes as one step. A terrain-only batch carries an empty `objectOps` and collapses on its cell snapshots alone. The executor also exposes `rollbackTo(watermark)`: a silent, unconditional revert of everything above a watermark (no redo entries, no per-entry validation), for callers that must guarantee "nothing happened" after a mid-operation failure — the agent tool bridge rolls a crashed stroke back to its start with it.

### Cut-Reconcile Hook

`reconcileCuts` (`cut-reconcile.ts`) reaches the executor only through the `CutReconcileTarget` interface, which requires `execute(cmd)` plus the `roadAt` lookup its road repairs ask which cells are paved. The executor satisfies `RoadReconcileTarget` the same way for `reconcileRoads`, and carries a third injected lookup, `loadValueOf: LoadValueLookup`, which prices the `PlaceObject` a road repair issues (every app construction passes `state/catalog:catalogLoadValue`). These narrow interfaces let both reconcile passes be tested independently and keep them decoupled from full executor semantics. Repair commands are plain commands, meaning they go through pre-command validation and produce their own `HistoryEntry` items. Undo fidelity is complete: `cloneCell` copies corner data, and road rotation changes travel on the command's `beforeRotation`/`afterRotation` fields and are restored by `revertEntry`.

### Event Emission Summary

| Situation | Events Emitted |
|---|---|
| `execute` succeeds (terrain/erase) | `cells-changed`, `history-changed` |
| `execute` succeeds (PlaceObject) | `objects-changed {added}` (from applyCommand) + `cells-changed` + `history-changed` |
| `execute` succeeds (RemoveObject) | `objects-changed {removed}` (from applyCommand) + `cells-changed` + `history-changed` |
| `execute` succeeds (TrimCorners terrain) | `cells-changed` + `history-changed` |
| `execute` succeeds (TrimCorners road) | `objects-changed {removed}` + `objects-changed {added}` (from applyCommand) + `cells-changed` + `history-changed` |
| `execute` succeeds (coating placed/removed/re-cut) | the rows above + `objects-changed {added}` per bordering road (the seam re-announce) |
| `execute` fails | `validation-failed` only |
| `undo` | `objects-changed` (if PlaceObject/RemoveObject/road TrimCorners) + `cells-changed` + `history-applied` + `history-changed` |
| `redo` | `objects-changed` (if PlaceObject/RemoveObject/road TrimCorners) + `cells-changed` + `history-applied` + `history-changed` |
| `commitStroke` with reverts | `objects-changed` (for any object commands reverted) + `cells-changed` + `history-changed` |

### Invariants

- After a successful `execute()`, `undoStack` has at least one more entry (a terrain command's inline reconcile can append repairs of its own) and `redoStack` is empty.
- After `commitStroke()`, `validatePostStroke(state)` returns `[]` (assuming rules are monotone with respect to reversal).
- State is only mutated during `execute()` / `undo()` / `redo()` / `commitStroke()` — never by rules or the event bus.
- The executor holds a reference to the same `GridState` instance that the store, renderer, and rules all share; mutations are immediately visible to all readers.

---

## Provenance: the Edit-Source Ledger (`src/core/provenance/`)

Every unit of map content — each terrain cell and each object — carries a taint saying whose work it is. `core/provenance/` holds the machinery (`types.ts`, `policy.ts`, `tracker.ts`, `serialize.ts`), and `core/commands/provenance-recorder.ts` threads it through the executor: a caller declares who is editing with `executor.pushSource(ctx)`/`popSource()` (the UI, the generator, the agent), the recorder captures a `TaintDelta` on every `HistoryEntry`, and `revertEntry`/`reapplyEntry` restore the taint in lockstep with the cells, so undo history and authorship history can never disagree. Work a pass derives from other work (the road and cut reconciles) runs inside `deriveScope`, so a repair inherits its trigger's authorship rather than claiming its own.

The readers: `ProvenanceTracker.cellAuthor(x, y)` and `objectAuthor(id)` answer `'ai' | 'human' | 'procedural' | null` via `policy.ts:dominantAuthor`, and `getSummary()` produces the `MapProvenanceSummary` the share exporter embeds as the map's disclosure. The Generate shelf's Clear is the load-bearing consumer: it takes back a generation while sparing anything a person placed or painted inside the same region (`kit/operations/generate.ts` passes `cellAuthor(x, y) === 'human'` as the spare predicate). The ledger serializes into the save envelope (`SaveFile.provenance`) and survives a round-trip; a map loaded without one has no authorship to read.

---

## Rule Registry & Pre-Command Rules

### Responsibility

The rule system is the editor's contract enforcement layer. Its sole job is to answer two questions at two different points in the editing lifecycle: (1) "Is this individual command legal to apply right now?" (pre-command), and (2) "Is the overall grid state legal after the user finishes a stroke?" (post-stroke). This document focuses on the pre-command half and the registry that hosts both phases.

### RuleRegistry

`registry.ts:RuleRegistry` is a simple dispatcher. It holds two typed arrays — `preCommandRules: PreCommandRule[]` and `postStrokeRules: PostStrokeRule[]` — exposes validation and introspection methods:

- `register(rule: AnyRule)` — appends to the correct array based on `rule.phase`.
- `validatePreCommand(cmd, state)` — iterates `preCommandRules`, skips any whose `appliesTo` array does not contain `cmd.type`, and accumulates errors from the rest. All applicable rules always run; there is no short-circuit on first error.
- `validatePostStroke(state)` — iterates `postStrokeRules` unconditionally (post-stroke rules have no `appliesTo` filter) and accumulates errors.

The `appliesTo` field is a `CommandType[]` on `PreCommandRule` (`types.ts:PreCommandRule`). This means the dispatch cost is O(R × |appliesTo|) per call, where R is the number of registered rules. The registry scans each rule's declared command set; registration and dispatch remain separate from validation behavior.

### createDefaultRegistry

[createDefaultRegistry](../src/rules/index.ts) is the sole assembly point. It registers the canonical rule list into each rule's declared phase.

<!-- generated:rules:start -->

Source: [src/rules/index.ts](../src/rules/index.ts), through `createDefaultRegistry().getRules()`.

| Order | Rule | Phase |
|---|---|---|
| 1 | `V-LOCK-01` | pre-command |
| 2 | `V-LOCK-02` | pre-command |
| 3 | `V-MTN-01` | pre-command |
| 4 | `V-MTN-02` | pre-command |
| 5 | `V-WTR-01` | pre-command |
| 6 | `V-PLACE-BLOCK` | pre-command |
| 7 | `V-PLACE-TRAIT` | pre-command |
| 8 | `V-ZONE-01` | pre-command |
| 9 | `V-PLACE-OVERLAP` | pre-command |
| 10 | `V-PLACE-MAX` | pre-command |
| 11 | `V-CHUNK-01` | pre-command |
| 12 | `V-MTN-03` | post-stroke |
| 13 | `V-WTR-02` | post-stroke |
| 14 | `V-WTR-03` | post-stroke |
| 15 | `V-PLACE-COATED` | post-stroke |

<!-- generated:rules:end -->

Most of this order is about which message wins in the UI, since errors accumulate into one `ValidationError[]` rather than short-circuiting. **One part of it is load-bearing for correctness**: `traitPlacementRule` runs BEFORE zone and overlap because the `waterSpan`/`heightDrop` traits SNAP the object's position, rotation and span during validation. Zone and overlap must judge the snapped footprint, not the raw click — otherwise a bridge or ramp can snap onto a non-grass zone and be accepted, which is how the generator once placed a ramp on the beach.

`ALL_RULES` is also what `RULE_HINTS` is derived from: each rule's own `agentHint` is the single source for how that policy is explained to the LLM agent, so the wording lives in the rule file rather than in a prompt.

The registry is a value object: `createDefaultRegistry()` is called once during store initialisation and the resulting instance is passed to `CommandExecutor` (see `command-executor.ts:CommandExecutor`). Rules are stateless singletons exported from their files; there is no per-registry rule state.

### How rules plug into the editor lifecycle

`command-executor.ts:CommandExecutor.execute()` calls `registry.validatePreCommand(cmd, state)` before touching state. If any errors are returned, it emits a `validation-failed` event (which `Toast.tsx` handles automatically) and returns `{ success: false }` — state is never mutated. If all rules pass, the command is applied and snapshotted for undo/redo.

`CommandExecutor.commitStroke()` calls `registry.validatePostStroke(state)` after the stroke's last command. On violations it incrementally undoes commands until the state is clean again. Rules never mutate state and never interact with undo/redo directly.

### GridState contract that rules read

Every rule receives `state: GridState` (`types.ts:GridState`), which contains:
- `cells: MacroCell[][]` — row-major `cells[y][x]`, accessed via `grid-model.ts:getCell` (returns `null` for out-of-bounds). A cell with `terrain: null` is grass at elevation 0.
- `objects: Map<string, PlacedObject>` — keyed by object ID.
- `lockedLayers: Set<number>` — the buildable layers that the user has locked.
- `template: MapTemplate` — static map geometry including `plaza: PlazaConfig`.

Rules read this state purely; the only exception is the `waterSpan` and `heightDrop` trait handlers in `placement.ts`, which mutate `cmd.object.rotation`, `cmd.object.position`, and `cmd.object.spanLength` as a side effect of successful validation (described below).

### Pre-command rules in detail

**V-LOCK-01 (`layer-lock.ts`)** — Applies to `PaintTerrain` and `EraseTerrain`. Fast-paths on an empty `lockedLayers`. For `PaintTerrain`, it first checks whether the *target* elevation is locked (blocking entire command immediately), then checks existing terrain at each cell. For `EraseTerrain` it only checks existing terrain. The helper `isOccupyingLockedLayer` walks layers 1..cell.terrain.elevation for each cell. This reflects the cumulative-layer model: a cell at elevation 3 occupies layers 1, 2, and 3, so locking any of those blocks the cell.

**V-ZONE-01 (`zone-restriction.ts`)** — Rejects any edit on a non-Grass zone (`isBuildableZone`). For `PlaceObject` it walks the rotated footprint from `getPlacedObjectSize`; for terrain edits it walks the command's own cells. Out-of-bounds differs by command on purpose: an object may not hang over the void, so a null cell is an error there, while a terrain edit off-map is simply skipped. It does NOT apply to `RemoveObject` — removal must always succeed, or an object that somehow reached a non-grass cell could never be cleared. The plaza needs no clause of its own here: it is a locked object, and the object rules cover it. One error per invalid cell.

**V-MTN-01 (`elevation-range.ts`)** — Applies to `PaintTerrain`. Guards only `TerrainType.Mountain` commands. Returns a single error for the whole command (not per-cell) if `cmd.elevation` is outside `[0, ELEVATION_MAX]`. Elevation 0 is valid because it is the clear-terrain sentinel in `applyCommand()`.

**V-MTN-02 / V-WTR-01 (`floating-block.ts`)** — Both rules share `validateNoFloating`. Applies to `PaintTerrain`. Skips elevations ≤ 1 (layer 1 is always supported by the implicit ground). For each cell in `cmd.cells`, reads existing terrain and rejects if `cell.terrain.elevation < cmd.elevation - 1` (or if no terrain at all). Water counts as valid support for floating purposes; the rule checks only structural adjacency, not terrain type. Two distinct rule instances (`mountainFloatingRule`, `waterFloatingRule`) are registered separately and both appear in `appliesTo: [CommandType.PaintTerrain]`.

**V-PLACE-BLOCK (`object-blocks-terrain.ts`)** — Applies to `PaintTerrain` and `EraseTerrain`. For each edited cell it asks `object-index`'s `entriesNear` what is there rather than scanning `state.objects`: a stroke issues one command per cell, so a scan here would cost cells × objects. Each blocker is reported once, with its whole footprint as the error's evidence cells. Footprints come from `getPlacedObjectSize`, which accounts for rotation and bridge `spanLength`.

**V-PLACE-OVERLAP (`placement-overlap.ts`)** — Applies to `PlaceObject`. Checks the incoming footprint against the objects already there, and returns on the first conflict. It sees the **snapped** footprint: `traitPlacementRule` runs before it, so a bridge or ramp that auto-oriented during trait validation is judged where it will actually land. A `surfaceCoating` (road) is exempt — a road is coated OVER, not collided with, and the placer strips the overlapped coatings itself.

**V-PLACE-TRAIT (`placement.ts:traitPlacementRule`)** — The richest pre-command rule. Applies to `PlaceObject`. Dispatches to `validateTrait` for each trait in `item.traits`. Traits are processed sequentially and errors are accumulated.

The trait dispatch (`placement.ts:validateTrait`) covers nine trait types:

- `flat` — Iterates `dx` 0..w and `dy` 0..h (i.e., `(w+1) × (h+1)` cells, expanding the nominal footprint by one column right and one row down). Rejects if any cell has water or a different elevation from the footprint's first cell. This +1 extension compensates for the macro/micro grid offset where micro-blocks sit at `x * TILE_SIZE - HALF_TILE`, causing the rightmost/bottom column of a multi-cell object's visual footprint to overlap the next macro column.

- `noFloat` — Checks every cell in the standard footprint has non-null terrain. Any missing terrain (grass at ground level) causes rejection.

- `waterSpan` — The most complex trait. Handles bridge placement, delegating the geometry to `detectBridgeSpan` (`core/model/bridge-span.ts`), which is shared with the placement ghost so preview and validation can't drift. A bridge spans any *below-deck* gap — water, off-map void, OR lower terrain. Using an "effective level" (water/off-map read as below everything), it scans both orientations out from the clicked gap cell to the two raised, **flat, equal-height** ends, validates the full-width gap (below deck) + flat ends, and checks the gap length against `trait.min..max` (3–6, unchanged). On success it **mutates** `cmd.object.rotation`, `cmd.object.position` (snapped to the near end), `cmd.object.spanLength`, and `cmd.object.elevation` (the deck height). This mutation is the only case where a pre-command rule modifies the incoming command; it auto-snaps the bridge rather than require precise placement. If no orientation satisfies the constraints, returns `error.bridge_invalid`.

- `heightDrop` — The ramp placement handler. Scans all four cardinal neighbors for an elevation difference exactly equal to `trait.layers`. For each valid neighbor it determines rotation (0/90/180/270 based on slope direction), computes a footprint that spans from the high side, then validates at micro-block resolution that all cells have the expected elevation. Also validates that the high-side terrain provides full-width support. On success **mutates** `cmd.object.rotation`, `cmd.object.position`, and `cmd.object.elevation`. Returns `error.ramp_wrong_height` if no valid neighbor found.

- `surfaceCoating` — Checks every cell in the footprint has non-null, non-water terrain. Roads must be placed on land. Simple rejection with `error.road_needs_terrain`.

- `exclusionRadius` — Rejects when another object of the same catalog category sits within `trait.radius` on both axes (a Chebyshev check), with `error.tree_too_close`.

- `terrainBase` — Not a placement check but a declaration: this object's footprint counts as solid structural support at its own elevation, so terrain may use it as the 3×3 base V-MTN-03 asks for. The central plaza is the only carrier today — and its `CatalogItem` is synthesised in code (`state/catalog.ts:PLAZA_ITEM`, registered `byId` only so it never appears in a placement list), not a catalog JSON.

- `plantable` — Another passive marker: flora may stand ON this coating. Placing flora keeps the coating instead of stripping it, and the pair passes the standing-on-a-road rule (V-PLACE-COATED reads it).

- `halfStep` — Passive: grants the item a half-cell anchor on both axes (`state/object-geometry:hasHalfStep`). An item WITHOUT it is what the fractional-position guard rejects, so ramps and bridges may sit flush with the terrain grid while everything else stays whole-celled.

**V-CHUNK-01 (`chunk-load.ts`)** — Applies to `PlaceObject`. Gated by `CHUNK_LOAD_ENABLED` in the generated constants table; while disabled, placement is free and the rule returns no errors. When enabled, the exported `chunkLoadViolations` helper reads `getMapStats(state).chunks` (the same memoized per-chunk load `state/map-stats.ts` keeps for every other whole-map question) and, for each chunk key in the candidate's **own footprint**, checks the existing load plus the candidate's `loadValue` against that chunk's ceiling (`loadMaxFor`, defaulting every chunk to `CHUNK_LOAD_LIMIT` — exactly the limit is permitted), returning an error if any chunk would overflow. The enforcement is unit-tested via the exported helper; flip `CHUNK_LOAD_ENABLED` and set real catalog `loadValue` entries to activate it.

### Composition with neighbouring subsystems

The registry is the seam between tools (which produce commands) and the executor (which applies them). Tools construct commands and call `executor.execute()`; the executor populates `HistoryEntry.before`/`after` from cell snapshots — commands carry no snapshot data. The executor never consults rules independently of the registry. The registry itself has no knowledge of tools, rendering, or state storage.

The `waterSpan` and `heightDrop` traits deliberately blur the pure-validator boundary: they mutate `cmd.object` during validation, effectively acting as command transformers. The executor applies the mutated command after `validatePreCommand` returns, so the final placed object carries the auto-snapped position/rotation/spanLength without any separate transformation step.

`object-blocks-terrain.ts` and `placement-overlap.ts` both import the span-aware footprint geometry (`getPlacedObjectSize` / `objectRect`) from `state/object-geometry.ts` — a clean *downward* dependency (`rules/` → `state/`). It sits in `state/` (it only needs the catalog) so the rules, the tools, and both editing views under `canvas/` all import it downward instead of reaching up into a tool.

---

## Post-Stroke Rules & Waterfall Detection

### Responsibility and Position in the Pipeline

Post-stroke rules are the second validation phase in the two-phase rule system. Unlike pre-command rules (which gate individual `Command` objects before they mutate state), post-stroke rules receive no command context at all — they are passed only the full `GridState` and are expected to scan it for structural invariant violations. The post-stroke policies are:

- **`base-support.ts`** — rule `V-MTN-03`, checks 3x3 structural base requirements for high mountains
- **`water-containment.ts`** — rule `V-WTR-02`, checks that every water cell's open faces are perpendicularly capped by mountains
- **`waterfall-uniformity.ts`** — rule `V-WTR-03`, checks that the row immediately downstream of every capped waterfall face has uniform elevation
- **`object-on-coating.ts`** — rule `V-PLACE-COATED`, checks that nothing stands on a road. It is post-stroke by necessity: the overlap rule exempts coatings so the placement ghost stays green over a road the click will strip, so only the finished stroke can tell "coated over" from "left standing on" (bridges and ramps are exempt — a crossing deck is paved across on purpose)

The canonical waterfall geometry primitives both water rules share live in **`core/model/waterfall-geometry.ts`** (pure geometry over the grid — not a rule). It belongs on the primitives floor rather than in `rules/` because the edge-cut kernel (`core/edge-cut/trim-lock`) needs it too, and a copy in `rules/` would force a `core/` → `rules/` upward import. From `core/model`, every importer — the two water rules, the edge-cut kernel, the 2D terrain layer and the 3D scene — depends on it downward.

The design motivation for post-stroke (vs. per-command) validation is that these invariants are fundamentally relational: whether a water cell is properly capped depends on what its neighbours are, and a single brush stroke may legally remove a capping mountain only if the water cell is simultaneously removed in the same stroke. Evaluating these constraints per-command (one `PaintTerrain` at a time) would reject intermediate states that are legal in aggregate. Post-stroke validation defers judgement until the user lifts the mouse.

### Integration with CommandExecutor

The entry point is `command-executor.ts:commitStroke`. Tools call `ctx.commitStroke(this.strokeStartUndoSize)` when a brush stroke ends — the argument is the undo-stack size recorded at `pointerdown` time. `commitStroke` delegates to `registry.ts:validatePostStroke`, which iterates all registered `PostStrokeRule` instances in registration order (base-support → water-containment → waterfall-adjacent-uniformity → object-on-coating, as declared in `index.ts`'s `ALL_RULES`).

If `validatePostStroke` returns violations, `commitStroke` auto-reverts: it pops entries from the undo stack one at a time (up to `maxUndos = undoStack.length - strokeStartSize`), restoring the `before` snapshot for each command, and re-runs `validatePostStroke` after every pop. It stops as soon as the state is clean or the entire stroke has been unwound (`command-executor.ts`). The initial violation list (from the first check, before any undo) is what `commitStroke` returns to the tool; the tool is responsible for showing a toast. This asymmetry — `validation-failed` event for pre-command failures, direct return value for post-stroke — is a deliberate design choice.

The road reconcile (`reconcileRoads`) runs BEFORE the post-stroke validation, so a coating it re-seats is judged and auto-revertable with the stroke. After any auto-revert (and after recording the final clean set of commands), `commitStroke` calls `reconcileCuts` to repair edge-cut corners invalidated by the stroke. The post-stroke rules therefore run between the two reconcile passes, and the geometry the cuts are reconciled against is already in the clean, rule-satisfying state.

The same `validatePostStroke` call also drives undo behaviour (`command-executor.ts`): when the user presses Undo, the executor pops commands one at a time until the undo-ed state also satisfies all post-stroke rules, skipping intermediate states that would be invalid.

### core/model/waterfall-geometry.ts — Shared Geometry Primitives

This module exports four functions and two interfaces. The key types are:

- `WaterfallFace` — `{ x, y, flowDirection: Direction }` — a single flow-direction on a single water cell
- `WaterfallInfo` — `{ cells: MacroCoord[], faces: WaterfallFace[] }` — aggregated per water cell (the `cells` array is always a singleton)

The primitive helpers are:

- `cellElevation(state, x, y)` — returns `-1` for out-of-bounds (treats the map edge as a lower-elevation drain), `0` for `terrain: null` (implicit ground), or `terrain.elevation` otherwise.
- `isWaterAtElev` — the typed cell-type predicate `waterfall-uniformity.ts` walks a strip with.
- `traceToMountain(state, x, y, elev, dx, dy)` — walks in direction `(dx,dy)` from one step past `(x,y)`, passing through cells that are water at exactly `elev`. Returns `true` if and only if the first non-matching cell is a mountain at exactly `elev`. Returns `false` for ground, map edge, or a mountain at a different elevation. The "exactly equal" constraint for the capping mountain's elevation (not `>=`) is the capping rule itself: only a mountain at the water's own elevation caps it, and one standing higher does not.

`detectWaterfalls(state)` is a full O(width × height × 4) grid scan. For every water cell, it tests each cardinal direction for a height drop; for each such face, it calls `traceToMountain` in both perpendicular directions. Only faces with both perpendicular traces returning `true` (i.e., fully capped faces) are included. A deduplication set (`processed`) ensures each water cell appears at most once in the output even if it has multiple capped faces. The function is called both by the two water rules and by `terrain-layer.ts:drawWaterfallIndicators` for rendering the directional arrow overlays — the renderer only uses `info.faces`.

Because `cells-changed` fires once per COMMAND (a brush stroke issues dozens), the renderer does NOT re-run this full-grid scan per event. `touchesWaterfallDependency(state, x, y)` (same module) answers whether an edit at a cell could possibly alter the face set: every cell a face depends on — the water cell itself, its 4-neighbours (the height-drop elevations), the same-elevation trace cells, and both cap terminators — is water or cardinally adjacent to water in any state where the face exists. `TerrainLayer.redrawCells` recomputes arrows only when a changed cell passes that test OR carried a face at the last draw (the erase-a-whole-body-in-one-command case, checked against the layer's memoized last face set); `drawFull` always recomputes.

### base-support.ts (V-MTN-03)

The rule iterates all cells, filters for `TerrainType.Mountain` whose STANDABLE surface (`surfaceElevation` — a Γ patch counts as its `patchBase`, not its cosmetic tier) is `>= 4`, and for each invokes `has3x3Base`. Mountains at elevation 1–3 are exempt because ground (elevation 0) always provides a valid base and the check would be redundant. Object footprints tagged `terrainBase` (the plaza) are collected once up front and act as solid support at their own elevation.

`has3x3Base` needs SOME elevation `E` in `[max(1, targetElev - 3), targetElev - 1]` at which the full centered 3×3 is solid. Per-cell support ("surface/base reaches `>= E`") is monotone decreasing in `E`, so such an `E` exists iff the LOWEST candidate works — the implementation makes ONE pass over the 9 cells at `E = max(1, targetElev - 3)`: each cell must exist and have solid mass reaching `>= E`: a Mountain surface counts at its own `surfaceElevation`, a Water surface one tier BELOW its own `surfaceElevation` (the riverbed under the depth-1 water block, never the water block itself), or a covering `terrainBase` footprint with `elevation >= E`. The base is strictly BELOW the cell by construction — only elevations `< targetElev` are candidates.

### water-containment.ts (V-WTR-02)

This rule ensures every water cell is fully contained: every face with a lower-elevation neighbour must have mountain caps on both perpendicular ends. It mirrors the geometry of `detectWaterfalls` but reports violations instead of detecting valid waterfalls.

The scan is also O(width × height × 4). For each water cell, it checks four cardinal faces. If a neighbour is out-of-bounds (`!neighborCell`), the face is immediately reported as uncapped and the inner loop breaks (one error per cell, not per face). If the neighbour exists and is lower, `traceToMountain` is called in both perpendicular directions (imported from `core/model/waterfall-geometry.ts`). If either returns false, an error is pushed and the inner loop breaks.

`DIR_OFFSETS`, `PERP_DIRS`, `cellElevation` and `traceToMountain` all come from `core/model/waterfall-geometry.ts`; the rule holds no geometry of its own.

### waterfall-uniformity.ts (V-WTR-03)

This rule validates the "adjacent row uniformity" constraint: for every capped waterfall face, the full-width row of cells one step downstream (including the capping mountains at both ends) must all share the same elevation.

The outer loop is the same water-cell-and-direction scan as `detectWaterfalls` and `water-containment`. When it finds a water cell with a lower-elevation neighbour, it calls `traceToMountain` in both perpendicular directions to confirm the face is capped (importing `traceToMountain` and `cellElevation` from `core/model/waterfall-geometry.ts`).

For each confirmed capped face, it:

1. Calls `getFullStrip` to build the ordered strip of cells: `[capA, ...waterCells..., capB]` along the perpendicular axis. `getFullStrip` walks outward in both directions through same-elevation water cells, then appends the bounding mountain cell at each end.
2. Constructs a `faceKey = "${strip.cells[0].x},${strip.cells[0].y},${flowDir}"` for deduplication — anchored to the first cap mountain. This correctly collapses multiple water cells in the same strip: all of them discover the same strip and produce the same key.
3. Calls `checkAdjacentRowUniformity`, which reads the elevation of each cell in the strip shifted one step in the flow direction, checks if they are all equal to the first element's elevation, and pushes an error for each non-equal cell. Out-of-bounds adjacent cells receive elevation `-1` (via `cellElevation`); if the entire adjacent row is off-map, they are all `-1` and therefore uniformly equal — no violation, as confirmed by the test at `waterfall-uniformity.test.ts`.

Like `water-containment.ts`, it takes its direction tables and cell-elevation reads from the shared `core/model/waterfall-geometry.ts` rather than restating them.

### Invariants Maintained

After every committed stroke:

- No mountain at elevation >= 4 lacks a valid 3×3 support block at some elevation in the range `[targetElev-3, targetElev-1]`.
- No water cell has an open face (lower-elevation cardinal neighbour) without mountain caps on both ends of the perpendicular axis at exactly the water cell's elevation.
- No capped waterfall face has a non-uniform elevation profile in the immediately downstream row.

These invariants are guaranteed by auto-revert in `commitStroke`: if the post-stroke check fails, the stroke is wound back until the state is clean again. The same invariants are re-checked on every Undo step.

---

## Edge-Cut System: Validation, Locking & Reconciliation

### Responsibility

This subsystem owns the geometry of edge-cut corners — both the rules about which corner shapes are legal in a given context, and the repair pass that keeps existing cuts consistent after the grid changes under them. Its core files: `terrain-silhouette.ts` (the layer-occupancy kernel every other module sits on), `cut-validator.ts` (edge-coverage geometry + cut legality), `trim-lock.ts` (which corners are frozen by neighbourhood), `road-cut-states.ts` (canonical road-cut states + rotation/connection helpers), and `cut-reconcile.ts` (the driven-to-fixpoint repair pass). Beside them: `corner-index.ts` (corner/quadrant index helpers), `patch-corners.ts` (the per-corner Γ-patch read), `cut-backing.ts` (the pure per-corner backing-fill derivation both renderers draw a cut's revealed surface from), `road-shape.ts` (a road TILE's drawn outline, for ghosts and stand-ins), and `road-region.ts` (a connected same-material road SURFACE as one region — the feather geometry both renderers share). The subsystem plugs into `command-executor.ts:commitStroke` and, mid-stroke, into `execute()`'s inline reconcile.

### Key Data Structures

A `Corners` tuple (`types.ts`) holds four `CornerTrim` values — one per sub-block corner in TL/TR/BL/BR order. Each value is one of `square | fan | tri-NW | tri-NE | tri-SW | tri-SE | empty`. Terrain cuts live on `TerrainCell.corners` (`types.ts`); road cuts live on `PlacedObject.corners` (`types.ts`). `undefined` corners and an all-`square` corners array are treated identically by the executor (both normalize to `undefined` on write — `command-executor.ts`). Gamma-patches (`patchOnly: true`) are a special terrain cell variant whose sole purpose is to fill the concave inner corner left by three abutting filled cells; they carry exactly one non-`empty` corner.

The `TrimCornersCommand` (`types.ts`) is the only mutating unit this subsystem issues. It records the cell, the layer, an optional `objectId` for roads, `beforeCorners`/`afterCorners`, and optional `beforeRotation`/`afterRotation` for road rotation changes. The executor's `applyCommand` handles both terrain and road targets, including the special-case of all-`'empty'` `afterCorners` which triggers full terrain-null or road-object deletion.

### Edge-Coverage Model (`cut-validator.ts`)

The geometric core models each macro-cell edge as a unit interval [0, 1] and asks: which sub-intervals does a given `Corners` configuration cover on a given side?

`SIDE_CONTRIBUTIONS` (`cut-validator.ts`) maps each side (N/S/W/E) to the two corner positions that contribute to it, each owning one half of the interval. `shapeProvidesCoverage` (`cut-validator.ts`) decides whether a corner's shape actually covers its half: `square` and `fan` always cover; a triangle covers only the two sides matching its compass label (encoded in `TRI_SIDES`); `empty` covers nothing.

`computeCellEdgeCoverage` (`cut-validator.ts`) assembles the raw half-intervals from both contributing corners, sorts and merges them (with `EPSILON = 1e-6` tolerance), and returns a list of `EdgeInterval` segments. When `corners` is `undefined` the whole edge [0, 1] is returned — meaning a plain square cell fully covers every side.

`hasPositiveEdgeContact` (`cut-validator.ts`) checks whether two cells share physical geometry along their shared edge. It computes coverage on each side independently, then **flips** the neighbour's interval list (`flipIntervals`, `cut-validator.ts`) before calling `intervalsOverlap`. The flip is necessary because position 0 on the N side of cell A corresponds to position 1 on the S side of cell B (left-to-right on A is right-to-left viewed from B).

### Cut Validation (`cut-validator.ts:validateCut`)

`validateCut` (`cut-validator.ts`) is the single gate that decides whether a proposed `candidateCorners` is legal at (x, y) on a given layer. It iterates the four cardinal neighbours and, for each that counts as a "connected neighbour" in the current layer, asserts that `hasPositiveEdgeContact` holds between the candidate and that neighbour's current corners. A single failing side is enough to reject.

The definition of "connected neighbour" differs by layer:

- **Terrain**: the neighbour must have the same `TerrainType` and same `elevation`, and must not be a patch-only cell (`cut-validator.ts`).
- **Road**: the neighbour just needs to carry a coating, which the injected `RoadLookup` reports (`cut-validator.ts`).

After edge connectivity, a road-specific structural check follows (`cut-validator.ts`): if a road cell connects to two or more neighbours, the candidate corners must be all-`square` when the connections are opposite (N+S or E+W) or when there are 3+ connections. For exactly two adjacent (L-shaped) connections, fans at any corner that is adjacent to a connected side are forbidden — only triangles or `square` are acceptable there.

### The Layer-Silhouette Kernel (`terrain-silhouette.ts`)

A cell at elevation N is a vertical **stack** of layers, so every trim question is really a question about the silhouette of solid terrain at a specific layer e. The kernel's exports sort into four families:

- **Solidity**: `terrainSolidAt(cell, type, e)` — does the cell hold solid mass of `type` at layer e? Mountain at N fills layers 1..N; water at N fills 0..N (a lake sits at ground level; a waterfall is a column). Γ patches are fillets, not mass — never solid. `solidTopOf` is its top-of-stack read.
- **Structural reads**: `structuralTop`, `surfaceElevation` and `realSurface` — the ONLY correct way to read a cell's standable surface, since a raw `elevation` read sees a Γ fillet as a full block. Every placement, support and bridge question goes through these.
- **Adjacency + corner tests**: `CORNER_NEIGHBORS` (corner i is met by its two edge-sharing neighbours plus the diagonal) and `EDGE_NEIGHBORS` (the two edge neighbours alone — the convex test's inputs, since a diagonal touch never pins); `cornerWrappedAt`/`cornerWrappedBy` (the Γ-notch wrap tests); `enclosedGap` (a bare cell walled on all four edges is a PIT, refused outright); `groundConvexCornerInWater` (the ground-islet figure test).
- **Reveal tiers**: `cornerRevealTier` (what surface a cut opens onto) and `cornerEdgeCoverTier` (the taller mountain flanking BOTH edges of a cut corner, which the reveal opens onto instead of the buried ground); `highestNeighborTerrain` (the reference tier a Γ corner is rounded toward).

Everything in the kernel is geometry, governed by ONE generic rule (no per-type special cases): a corner is a FREE convex corner unless a same-type **EDGE** neighbour covers it, and a cut reveals the lower surface behind it. The CONVEX test uses only the two EDGE neighbours (`EDGE_NEIGHBORS`) — a diagonal touches at a single point and never pins, so a diagonal pinch is cuttable; the CONCAVE Γ-wrap test (notch-fill) uses all three (`cornerWrappedAt`). The genuine **design policies** on top, named:

- **ISLET-ROUNDS-REVEALING-WATER** (the generic figure rule) — any islet in water rounds its convex corner and reveals the water, regardless of elevation or type: a mountain@E rock (real corners, a cut with no lower step reveals its edge water) OR a ground@0 islet (`groundConvexCornerInWater`; materialised as a `type: None` cell with corners — reads as ground via `realSurface`, renders grass kept-shape + water backing). There is **no** "mountain never cuts toward water" lock; the renderer backs a cut water corner with its mountain rim and a cut mountain corner with its lake, symmetrically (`cornerRevealTier` is EDGE-only and layer-gated: water@e reveals a mountain solid at layer e; a river@0 reveals its ground bank — EXCEPT where a taller mountain flanks BOTH EDGES of the cut corner (`cornerEdgeCoverTier`): the mountain turns a corner over that cell, so the cut opens onto it at the LOWER of the two flanking tiers and the junction reads as one straight line, down the steps of a Γ notch and at the point where two diagonally-attached shores meet alike. That test is DIAGONAL-BLIND, unlike the fillet's: the diagonal governs whether MASS may be ADDED at a corner (an open one is a pinch, still refused by `cornerWrappedBy`), and a backing adds none. One mountain edge is a river running ALONG a cliff and keeps its ground bank.)
- **WATERFALL-LIP** (elevated water never cuts toward a DROP — open ground/void OR lower terrain), **CYCLE-OFF-KEEPS-BASE** (removing a fillet restores the N-1 base block, never nulls the cell), **AUTO-TRIM-IS-COSMETIC** (auto-trim only trims corners + fills EMPTY Γ notches; raising a real block is a manual action — but cuttability is ELEVATION-INDEPENDENT, identical to the manual tool: a convex corner rounds at any height, and the renderer draws the lower step / surrounding ground behind it; there is no height gate in the automatic paths), **NO NOTCH FILLS BESIDE ELEVATED WATER** (`auto-edge-cut.ts:nearElevatedWater` skips Γ candidates within the 8-neighbourhood of water at elevation ≥ 1: both fill kinds change what RAW elevation reads see at the cell — `raiseToTier` adds real mass, a `patchOnly` trim stores the wrapping tier — and inside a waterfall's uniform downstream row that flips a legal fall illegal (V-WTR-03) and auto-reverts the whole stroke/generation), **WATERFALL-FRAME** (cap mountains keep their flow-side corners square).

Auto-trim symmetry between the layers: the post-stroke pass (`applyAutoEdgeCut`) sweeps the stroke **plus its 8-neighbour border** for BOTH terrain and roads (`withBorder` — a stroke can make a neighbour's corner newly convex, or a neighbour road newly an end-cap). A generated picture cuts the same way: the stencil algorithm calls `edgeCutGeneratedTerrain`/`edgeCutTerrainWith` over the cells it laid, so a letter's diagonal stroke and a picture's edge recover the diagonal whole cells cannot draw. The planet generator lays no cuts of its own — its terraces are rectilinear by design, the way the reference maps are built.
- **ATOMIC UNDO** — `commitStroke` folds the whole stroke AND its auto-reconcile (`reconcileCuts`) into ONE undo entry via `collapseHistory`, so undo reverts a change and its repair together and can never stop at a reconcile-orphaned (illegal) intermediate.

### Corner Locking (`trim-lock.ts:computeLockedCorners`)

`computeLockedCorners` answers: which corners of cell (x, y) **must** be `square` because the neighbourhood demands it?

**Terrain**: a corner is locked when it is *not a free corner of the terrain's silhouette at the cell's top layer* — i.e. when a same-type **EDGE** neighbour holds solid mass at that layer (`terrainSolidAt` over the two `EDGE_NEIGHBORS`; a diagonal-only touch does NOT lock — that is what makes a pinch cuttable). A same-type **taller** neighbour locks (its stack covers this layer); a same-type **lower** step does not (the bevel down to it is intended). On top of the geometry, three things lock extra corners: **WATERFALL-LIP** (an elevated-water corner facing a drop), **WATERFALL-FRAME** (a cap mountain's flow side), and **MOUNTAIN BANK** — a MOUNTAIN meeting water on EXACTLY ONE edge of a corner is the water's bank there, so that corner is locked (cutting it would peel the mountain off the water, leaving the pond unbanked on the rendered map). A mountain fronted by water on BOTH of a corner's edges is an islet or peninsula tip and still rounds (revealing the water); a ground islet in water is unaffected (it rounds via `groundConvexCornerInWater`).

**Road**: road locking uses a count-based policy rather than per-corner geometry. Zero neighbours → nothing locked. Three or more neighbours, or two opposite neighbours → all four corners locked. Exactly one neighbour → the two corners on that side locked (same as terrain Rule A for one edge). Two adjacent neighbours → all four corners locked **except** the one in the "free" quadrant — the corner diagonally opposite to the connecting pair (`trim-lock.ts`).

This asymmetry between terrain and road locking reflects that terrain cuts are per-corner shape choices whereas road cuts use a small canonical vocabulary where the only valid cut is at a single free corner.

### Gamma-Patch Detection (`cut-validator.ts:isInnerCorner`)

`isInnerCorner` (`cut-validator.ts`) determines whether a patch-only cell at (x, y) with a given corner index is still in a valid concave-corner context. The target cell must itself be empty of real terrain. For each corner index the function checks three specific neighbours — the two orthogonally adjacent cells and the diagonal cell in the corner's quadrant (`maps` array, `cut-validator.ts`). All three must be non-patch cells of the matching type and elevation for the patch to be considered "intact". This is used exclusively in reconciliation to prune stale patches.

### Canonical Road States (`road-cut-states.ts`)

Road cuts are stored and reasoned about in a **canonical (left-connected) form**: `CANONICAL_ROAD_STATES` (`road-cut-states.ts`) lists five valid cut shapes, all expressed as if the road connects to the left. Index 0 is `undefined` (sentinel). The five canonical shapes are:

| Index | Description | Kind |
|-------|-------------|------|
| 1 | BR fan | round |
| 2 | TR fan | round |
| 3 | diagonal `\` (tri-SE pair) | direct |
| 4 | diagonal `/` (tri-NE pair) | direct |
| 5 | wedge (TR + BR fan) | round |

`classifyRoadKind` (`road-cut-states.ts`) maps a `Corners` to `'round' | 'direct' | null` based on whether it contains a `fan` or a triangle. `null` means all-square (unconstrained).

`canonicalToActual` (`road-cut-states.ts`) rotates a canonical corners tuple into the coordinate frame of the actual connection direction. The rotation is a two-step process: first `rotateCornerTrim` (`road-cut-states.ts`) remaps triangle compass labels via `TRI_ROTATE` (a `conn → old-trim → new-trim` lookup, `road-cut-states.ts`); then the positions of the four corners within the tuple are permuted to match the connection direction (the `switch` in `canonicalToActual`).

`detectRoadConn` (`road-cut-states.ts`) probes the four cardinal neighbours of a road object through the `RoadLookup` it is handed, and returns the first direction that holds another road. If no real neighbour exists, it falls back to `ROTATION_TO_CONN[road.rotation]`. This fallback makes isolated roads self-consistent with their visual rotation.

`countRoadNeighbors` (`road-cut-states.ts`) performs the same scan but counts all four directions rather than returning early, used by `reconcileRoadAt` to detect the isolated case.

### Reconciliation Pass (`cut-reconcile.ts:reconcileCuts`)

`reconcileCuts` (`cut-reconcile.ts`) is the entry point called by `commitStroke` after the stroke's terrain/object changes have settled. It:

1. **Seeds the working region**: takes the set of changed `MacroCoord`s from the stroke and inflates it by one cell in every direction (8-neighbourhood) via `expandRegion` (`cut-reconcile.ts`), storing the result in a `Set<string>`.

2. **Iterates to fixpoint with cascading growth**: runs up to `MAX_RECONCILE_PASSES` passes over the current region. Each pass visits every cell in the region and applies three orthogonal reconcilers. When a cell is repaired, its 8-neighbourhood is immediately folded into the region `Set`, so that cascading road repairs beyond the initial ring are picked up in subsequent passes. The loop exits early as soon as a pass makes no changes.

The four reconcilers:

- **`reconcileTerrainCell`** (`cut-reconcile.ts`): for real (non-patch) terrain cells with non-square corners, recomputes `computeLockedCorners` against the current state and rewrites any locked corner that is not already `square` to `square`. Issues a `TrimCornersCommand` via the target executor.

- **`reconcileGroundIsland`** (`cut-reconcile.ts`): the repair half of the ISLET-ROUNDS-REVEALING-WATER policy — a ground islet-cut cell (`type: None` + corners) whose corner no longer pokes into water (the surrounding water was filled or moved) has that corner squared, and squaring the last one drops the cell back to plain ground.

- **`reconcilePatchTerrain`** (`cut-reconcile.ts`): for `patchOnly` cells, calls `isInnerCorner` on the active non-`empty` corner. If the inner-corner context is broken, issues a `TrimCornersCommand` with all-`empty` afterCorners, which the executor converts to `cell.terrain = null`.

- **`reconcileRoadAt`** (`cut-reconcile.ts`): for roads with non-square corners, recomputes `detectRoadConn` + `canonicalToActual` and feeds the result to `validateCut`. If still valid, no action. If invalid, it attempts to find a **same-kind** canonical state that does validate by iterating `CANONICAL_ROAD_STATES[1..]` (skipping index 0). For isolated roads every canonical state is tried at all four rotations; for connected roads only the current connection direction is used. If a replacement is found, it issues a `TrimCornersCommand` with the replacement canonical corners, carrying `beforeRotation`/`afterRotation` on the command when a rotation change is needed (so that `revertEntry`/`reapplyEntry` can restore it faithfully — `road.rotation` is not mutated directly). If no same-kind replacement validates, the road is reset to all-`square`.

All repairs are issued through `target.execute(cmd)` where `target` is a `CutReconcileTarget` — a minimal interface (`cut-reconcile.ts`) satisfied by `CommandExecutor`, which supplies its injected `roadAt` as the other half. This means reconciliation repairs enter the undo stack as `TrimCornersCommand` entries within the same stroke, participating in history.

### Composition with `commitStroke`

`commitStroke` (`command-executor.ts`) proceeds in this order:

1. Run `reconcileRoads` over the stroke's changed cells (before validation, so its re-places are judged with the stroke).
2. Run post-stroke rule validation. If violations exist, auto-revert the stroke's commands one by one until the state is clean (never onto the redo stack).
3. Collect the set of macro coordinates affected by whichever stroke commands remain on the undo stack (i.e. after any auto-revert).
4. Call `reconcileCuts(changed, this.state, this)` if the set is non-empty, then `collapseHistory(strokeStartSize)` to fold the stroke and its repairs into one undo entry.

Reconciliation therefore sees the **post-revert state**, not the raw stroke state. Any repairs `reconcileCuts` issues are appended to the undo stack beyond `strokeStartSize`, so they are included in the stroke's logical commit. Undoing the triggering stroke also undoes the repairs: terrain `TrimCorners` undo restores corner geometry faithfully (because `cloneCell` now copies `corners`/`patchOnly`), and road rotation changes travel on the command's `beforeRotation`/`afterRotation` fields and are restored by `revertEntry`.

### Invariants Maintained

- **Edge-connectivity**: every pair of same-layer, same-type/elevation adjacent cells always shares positive-length geometry along their boundary after any stroke commit.
- **Lock-respected corners**: no corner of a terrain cell is non-`square` when `computeLockedCorners` would mark it locked.
- **Patch integrity**: a `patchOnly` terrain cell exists only when `isInnerCorner` holds for its active corner; otherwise it is removed.
- **Road shape validity**: every road with non-`square` corners satisfies `validateCut` in its deployed orientation, or the corners are all-`square`.
- **Convergence**: every reconciliation pass moves at least one value strictly toward `square`/`empty`, which is always a valid state, so the fixpoint loop cannot cycle.

---

## Tools & Tool Context

### Responsibility

The tools subsystem is the single entry point for all user gestures. It translates raw pointer events (with macro- and micro-grid coordinates already resolved by the active view's projection) into sequences of `Command` objects, mediates the stroke lifecycle that wraps those commands in a post-validation boundary, and owns the ghost-overlay feedback loop. Nothing in this layer mutates `GridState` directly; every mutation goes through `CommandExecutor` via the `ToolContext` façade.

The editor renders through one of two live views over this same pipeline — the 2D PixiJS map or the 3D editor (`src/canvas/map2d`, `src/canvas/map3d`) — and the tool layer is view-agnostic by construction: `ToolContext.viewport`/`overlay` are the `ViewProjection`/`ToolOverlay` interfaces (`src/canvas/view-projection.ts`), the pointer state machine drives camera verbs (`pan`/`zoomStep`/`zoomBy`/`endGesture`, plus 3D-only `orbit`/`orbitTwist`/`tilt`), and the active-view registry (`src/canvas/active-view.ts`) re-points everything when the persisted `viewMode` toggles. In 3D, the projection resolves the pointer by ray-marching the terrain heightfield to the first VISIBLE surface, so a stroke lands on the cell under the cursor exactly as the eye reads it.

### Key Types

The [Tool contract](../src/tools/runtime/types.ts) declares pointer callbacks, cursor/refusal probes, terrain-coordinate selection and pending-gesture hooks. Concrete tools keep gesture state; `ToolManager` supplies the current context and resolves coordinates before dispatch.

<!-- generated:tool:start -->

Source: [src/tools/runtime/types.ts](../src/tools/runtime/types.ts).

```ts
export interface Tool {
    id: ToolType;
    terrainGrid?(ctx: ToolContext): boolean;
    cursor: CursorId;
    cursorFor?(ctx: ToolContext): CursorId;
    canActAt?(coord: MacroCoord, ctx: ToolContext): boolean;
    cancelPending?(ctx: ToolContext): boolean;
    undoPendingStep?(ctx: ToolContext): boolean;
    hasPending?(ctx: ToolContext): boolean;
    grabAt?(coord: MacroCoord, ctx: ToolContext): boolean;
    selects?(ctx: ToolContext): boolean;
    selectHit?(coord: MacroCoord, ctx: ToolContext): {
        id: string;
        selected: boolean;
    } | null;
    onPointerDown(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
    onPointerMove(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
    onPointerUp(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
    onPointerCancel?(ctx: ToolContext): void;
    onActivate(ctx: ToolContext): void;
    onDeactivate(ctx: ToolContext): void;
}
```

<!-- generated:tool:end -->

**`ToolContext`** (`types.ts`) — a plain object assembled and refreshed by `ToolManager` before each pointer dispatch. It bundles:
- `gridState` — read-only reference to the live `GridState` (cells, objects, lockedLayers).
- `viewport` / `overlay` — the active view's `ViewProjection`/`ToolOverlay` handles for coordinate transforms and ghost graphics, plus `halfCoord` (the pointer's nearest half-cell grid point, which only a `halfStep` item's ghost/click reads).
- `executeCommand` / `commitStroke` / `validateCommand` / `rules` / `undo` / `getUndoStackSize` / `collapseHistory` / `rollbackTo` — forwarding closures to `CommandExecutor` and the rule dispatcher. `collapseHistory` is how a tool folds follow-up commands (auto-trim, a gamma click's raise+trim) into the user-visible step they belong to; `rollbackTo` is the all-or-nothing revert for a stroke that rewrites a shape.
- `terrainType`, `elevation`, `layerPinned`, `brushSize` — mutable tool parameters injected fresh on every call (see `refreshCtx` below).
- the editor's ARMING, mirrored per event so tools never reach into the store: `contentType`, `layerVisibility`, `autoEdgeCut`, `eraserShape`, `tileMaterial` + `tileMaterialPicked`, `armedItem`, `placementRotation`, `armedMacro` + `armingEpoch`, and `macroContext` (the executor-taking context the macro layer runs on, shared by the shell, the agent's director tools and tests).
- `t(key)` — i18n helper that reads the active locale from the Zustand store at call time — plus the feedback hooks `setDisplayLayer` and the optional `plopObject`.

The context is a single long-lived object whose mutable fields are updated by `refreshCtx()` before each dispatch rather than being re-constructed. This avoids allocation on every pointer event but means the same object reference is passed to all invocations — a tool must not cache `ctx` across frames.

### ToolManager: Registration and Dispatch

`ToolManager` (`tool-manager.ts`) holds a `Map<ToolType, Tool>` and an `activeTool` pointer. `HandTool` is instantiated in the constructor and is the default; the rest (`DrawingTool`, `EraserTool`, `ObjectPlacerTool`, `EdgeCutTool`, `MacroTool`) are registered by `registerDefaultTools()` in the same constructor, so a caller only constructs the manager. Every `ToolType` names a tool the manager registers, which `tool-cursors.test.ts` pins: scattering is the generation populator's job and roads are painted by `DrawingTool` in tile mode, so neither has a ToolType of its own.

`setView` swaps the ACTIVE view (2D map ↔ 3D editor) by rebuilding the context around the new projection/overlay pair, which is how the whole tool layer follows a mode switch without any tool knowing a switch happened.

`setActiveTool` calls `onDeactivate` on the outgoing tool and `onActivate` on the incoming one, both with a freshly refreshed context. On each of `handlePointerDown`, `handlePointerMove`, and `handlePointerUp`, `ToolManager` calls `refreshCtx()` then delegates to the active tool. The manager's public fields (`terrainType`, `elevation`, `brushSize`) are the source of truth for tool parameters; `PixiCanvas.tsx` syncs them from the Zustand store inside a `useEffect` that runs whenever the relevant store slices change.

`HandTool` receives special treatment in `handlePointerMove`: the raw screen-space delta `(dx, dy)` computed from `lastScreenX/Y` is passed to `handleRawMouseMove` before the standard macro/micro coordinate path runs. This is the only place where sub-pixel movement reaches a tool; all other tools work in macro coordinates. It applies only in views whose left-drag pans there (the 2D map): the 3D editor sets `leftDragPans: false` and pans from the pointer machine instead, since left is reserved for selection and tools while right/middle orbit.

`PixiCanvas.tsx` owns the manager's lifecycle: one is constructed in the `gridState` effect (a new map, an import, a generate) and published through `registerToolManager`, so the editor has exactly one at a time and the active-view registry re-points it on a mode switch.

### Stroke Lifecycle

Every brush stroke follows a two-phase lifecycle, with the tool owning both phases.

**Phase 1 — command accumulation.** On `onPointerDown` (or, for shape modes, on `onPointerUp`), the tool records `strokeStartUndoSize = ctx.getUndoStackSize()`. As the user drags, it calls `ctx.executeCommand(cmd)` for each cell group. Each `execute` call runs all applicable pre-command rules synchronously; a failure is silently skipped (the cell is not painted) and a `validation-failed` event fires, which `MapRenderer` converts into a red error flash on the overlay.

**Phase 2 — stroke commit.** When the gesture ends, the tool calls `ctx.commitStroke(strokeStartUndoSize)` (`command-executor.ts:commitStroke`). The executor runs all post-stroke rules against the final state. If any rule reports a violation, the executor unwinds entries from the undo stack one at a time — applying `before` snapshots back to `GridState` — until no violations remain or the entire stroke is reverted. The first violation array (the one that triggered revert) is returned; the tool is responsible for showing a toast from this return value. After revert, `commitStroke` runs `reconcileCuts` over the cells that survived, repairing any edge-cut corners that became geometrically invalid.

The `strokeStartUndoSize` watermark is critical: it tells `commitStroke` exactly how many undo entries belong to the current stroke. Tools must snapshot this value **before** issuing any commands for the stroke. `DrawingTool` snapshots it at `onPointerDown` — for a curve, only at the FIRST anchor, because the curve collects its clicks into one stroke and re-snapshotting per click would wipe the record.

The curve is a multi-click ANCHOR CHAIN, not a fixed three-click quadratic: `DrawingTool` collects `curveAnchors` across clicks, paints through `splineCells` (`shapes.ts`) over the anchors' spline, and holds an adjust session (`curve-session.ts` — a module singleton the tool owns and React only reads, with drag handles rendered by the chrome's `CurveHandles`). A tweak is restore-then-relay: it restores every cell to the baseline captured before the curve and lays the curve again, because a mountain curve stacks and painting over the old path would raise it twice; a refused tweak reverts whole via `ctx.rollbackTo`. The pending-gesture members (`cancelPending`/`undoPendingStep`/`hasPending`) are how Escape, Delete and a nav tap reach a chain that has painted nothing yet.

`EdgeCutTool` uses the shortest possible stroke window: it snapshots the stack size, issues one or two commands, and calls `commitStroke` all within `onPointerDown` — with `{ reconcile: false }`, since a silhouette-only cut cannot invalidate any cut and the neighbourhood repair pass could only mis-touch a neighbour's. There is no drag phase.

`ObjectPlacerTool` never calls `commitStroke` — object placement commands are individually pre-validated with sufficient pre-command rules that post-stroke rules do not apply to them.

### DrawingTool — the Multi-Mode Brush

`DrawingTool` (`drawing-tool.ts`) handles five drawing modes under a single `ToolType.TerrainBrush` id: `brush`, `line`, `rect`, `circle`, and `curve`. This consolidation means `PixiCanvas.tsx` manages mode changes by directly mutating `tool.mode` and `tool.contentType` on the registered instance (inside the store-sync effect) rather than switching between registered tools.

What a paint click issues is planned in `paint-plan.ts:planPaint` (with `water-layers.ts` beside it for the water brush's layer questions), and the tool's `canActAt` probe reads the SAME `planPaint`, so the cursor's forbidden badge and the click cannot disagree. The plan has a significant asymmetry between mountain and water content: mountains group cells by their **target elevation** (one `PaintTerrain` command per distinct level, starting from the cell's STRUCTURAL surface via `surfaceElevation`, producing correct incremental stacking), while water paints at the pinned layer when a hand chose one (`layerPinned`) and at each cell's own surface when it did not. A `strokeCells: Set<string>` guard prevents re-painting the same macro cell twice within a brush stroke — important for brush mode where the pointer can revisit a cell.

Ghost preview uses `ctx.overlay.showGhost(cells, color, terrainMode)`. The third argument controls a pixel offset: terrain ghosts are offset by `-HALF_TILE` to align with the micro-grid rendering of terrain tiles; object ghosts pass `false` to sit on the macro-grid.

### EraserTool

`EraserTool` (`eraser.ts`) delegates single-cell peel to `peelCommand` (`terrain-peel.ts`). Water erases to ground; mountain at elevation N lowers to N−1, with elevation zero clearing terrain. The eraser reads current layer visibility and content selection from `ToolContext`; `ToolManager` refreshes those values from the store before each event.

### ObjectPlacerTool

`ObjectPlacerTool` (`object-placer.ts`) has two behavioural modes gated by whether `selectedItemId` is set in the store. With an item selected it places on pointer-down; with no item selected it is passive (drag-to-move lives in the shared pointer machine, outside the tool).

Bridge ghost computation delegates to `core/model/bridge-span.ts:detectBridgeSpan` — the same function the `waterSpan` trait rule validates with, so the ghost shows exactly the span the click will produce. Ramp ghost computation (`computeRampGhost`, `object-placer.ts`) scans the four cardinal neighbours for an elevation difference matching the ramp's `layers` field and derives the footprint orientation from that.

`removeOverlappingCoatings` removes any `surfaceCoating` objects whose footprint overlaps the incoming footprint before placement — invoked by both `ObjectPlacerTool.onPointerDown` and the tile brush. This keeps road replacement atomic: erase-then-place instead of overlap-validation-fail.

### Tile coating (the road/tile brush)

There is no separate road tool. `DrawingTool` in tile mode (`contentType: 'tile'`) drives the same shape vocabulary as terrain and delegates each cell to `tools/paint/tile-coating.ts`: `placeTileCell` calls `removeOverlappingCoatings` and then issues the `PlaceObject`, so dragging over an existing road replaces it, and `eraseTileCells` is the inverse. A per-stroke `painted` set guards against double-placement, the same way `strokeCells` does for terrain. Tiles are ordinary `surfaceCoating` objects, which is why the overlap rule exempts them rather than the brush working around it.

### EdgeCutTool

`EdgeCutTool` (`edge-cut-tool.ts`) operates at micro-grid intersection points. A single macro-coord click maps to four `TerrainSlot`s (the four cells sharing the micro-corner at that intersection, via `getTerrainSlots`). For each slot it cycles the corner through `square → fan → tri-* → square` for outer corners, and `empty → fan → tri-* → empty` for inner (Γ-patch) corners. Road corners cycle through `CANONICAL_ROAD_STATES` with orientation derived from detected road connectivity. All commands are `TrimCorners`; no terrain elevation is changed. Because the tool calls `commitStroke` in `onPointerDown`, `cut-reconcile` (called from `commitStroke` inside the executor) repairs any cuts that became geometrically invalid due to the just-applied corner change.

### Smart Build Macros (`tools/macros/`)

`MacroTool`, registered under `ToolType.Macro`, routes editor gestures through [`macros/index.ts`](../src/tools/macros/index.ts). The shell and the agent's director tools reach the same operation bodies. The [macro registry](../src/tools/macros/run.ts) owns available operations, and the [surface menu](../src/ui/shell/bars/smart-menu.ts) selects their interface entries. Whole-map road networks remain available to programmatic callers.

[Road and river gestures](../src/tools/macros/drag-tool.ts) use the shared line geometry, preview on detached maps, and build on release. [Mountain spray](../src/tools/macros/spray-tool.ts) queues local mounds in input order: a tap builds a mound, held bursts raise nested terraces, and dragging extends a ridge. Each stroke retains its original terrain and seed, includes any supporting terraces, and forms one undo entry. Held planting also groups its bursts into one undo entry. Rivers connect selected endpoints and construct legal channels, pools and waterfall frames through [terrain drafts](../src/tools/macros/terrain-draft.ts).

Each operation builds on a detached map with live rules before replaying accepted commands. The installed worker runner shares the candidate-generation pool; validated replay and commit run on the main thread. [Previews](../src/tools/macros/preview.ts) use the same builders and include the complete changed footprint. Road and river results replay atomically. Their adjustments share the [curve session](../src/tools/paint/curve-session.ts), retaining a baseline for restore-and-replay while the current result stays visible. Each adjustment is its own undo step. Map identity, arming epochs and fingerprints prevent cancelled or stale worker results from landing. Preview caches belong to individual maps and include layer locks as well as edit versions. Legacy point operations remain available to programmatic callers.

### Shared Shape Utilities

`shapes.ts` is the one home for pure coordinate generation, and its export surface sorts into four families: the line primitives (`bresenham`, `line4`, `expandLine` — the brush-width corridor — and the composed `lineCells`), the filled figures (`rectCells`/`rectSpans`, `circleCells`/`circleSpans`, plus `dragShapeCells`/`dragShapeSpans`/`snapShapeEnd`, which the shape drags and the region brush share), the Bézier pair (`interpolateBezier`, `bezier4`, `curveCells`), and the anchor-chain spline family the current curve tool draws with (`anchorHandles`, `splinePath`, `splineCells`).

`DrawingTool`, the eraser's shapes, the region brush and the generators all import from `shapes.ts`, so each of these implementations exists in exactly one copy.

### terrain-peel

`terrain-peel.ts` exports a single function `peelCommand(x, y, cell, convertWater = false)` that constructs the correct `Command` to remove one layer from a cell without touching the tool's stroke state; `convertWater` is the water eraser's variant, where erased water becomes the layer's mountain instead of vanishing. Its two live callers are the eraser and the single-block delete in `tools/objects/actions.ts` (a selected terrain block's Delete peels one layer, the same behaviour), so the water-vs-mountain branching logic exists once.

### road-reconcile

`core/commands/road-reconcile.ts` exports `reconcileRoads(changedCells, state, target)`, run by `commitStroke` itself over whatever a stroke changed — before post-stroke validation, so its repairs are validated (and auto-revertable) with the stroke. Living in the commit pipeline rather than in a tool is what binds every terrain-editing path at once: the brush, the eraser, the macros and the agent's tools all keep the invariant without knowing about it. The pass:
1. Identifies every `surfaceCoating` object whose 2×2 footprint intersects any changed cell (through the executor's injected `RoadLookup`).
2. For each affected road, if its footprint elevation is no longer uniform (mountain raised under part of it, ground erased from under it, or water appeared), removes it via `RemoveObject` and tries to re-place it at the new elevation via `PlaceObject` (quietly pre-validated). A footprint uniform again at some level carries the road there — up under a paint, down under an erase; if the placement is invalid (a cliff edge, water), the road stays removed — the game's no-floating rule.

The remove/replace commands become part of the stroke's history — so a single Ctrl+Z undoes both the terrain change and the road adjustment. The catalog questions the pass needs arrive as the executor's injected lookups (`RoadLookup`, `LoadValueLookup`), the same move as `RuleDispatcher`. V-PLACE-BLOCK admits mountain paint AND erase over coating cells for exactly this reason; water paint on a road cell stays blocked.

### Invariants

- A tool never writes to `GridState` except through `ctx.executeCommand`.
- `commitStroke` is always called exactly once per user gesture that issued at least one command (brush tools on `onPointerUp`, shape tools on the gesture-completion event, edge-cut on `onPointerDown`). Omitting it leaves the undo stack in an unchecked state.
- `strokeStartUndoSize` must be snapshotted **before** the first `executeCommand` of a stroke; any tool that re-snapshots it mid-stroke (e.g., for each shape in a multi-shape session) must do so only when starting a new logical stroke.
- `peelCommand` returns `null` for ground cells (no terrain); callers must guard.
- Ghost overlay state is owned by the tool: each tool clears the overlay in `onDeactivate` and manages its own `showGhost`/`clearGhost` calls during the gesture.

### Composition with Neighbouring Subsystems

- **CommandExecutor / RuleRegistry**: Tools receive both via closures in `ToolContext`. Pre-command validation is transparent (execute returns a `ValidationResult`); post-stroke validation is triggered explicitly by `commitStroke`.
- **The pointer machine (`canvas/interaction/usePointerInteraction.ts`)**: one state machine shared by BOTH canvases, which mount it and register themselves as the active view. Raw DOM `PointerEvent`s are partially intercepted there — camera pan/orbit, drag-to-move, selection and the rubber band — before reaching `ToolManager.handlePointer*`. The tool system therefore only sees left-click events that are not handled by those higher-priority paths, and it never learns which view is live.
- **The camera gestures (`canvas/interaction/camera-gestures.ts`)**: the mapping from a drag to a camera move, factored out of the machine so a surface with no tools runs the same one. Right or middle drag calls `orbit ?? pan`, an armed drag pans, the wheel routes by intent, touch pinches. It speaks `ViewCamera` rather than a view, and it deliberately does not decide WHEN a left drag pans — in the editor that depends on the tool and the selection, so `core/interaction/press-plan.ts:resolvePress` decides and the module does everything downstream. `canvas/interaction/use-camera-only.ts` binds it (plus the cursor) for a camera-only overlay; the export shot editor is the one such surface, which is what keeps its buttons and its cursors identical to the 3D editor's.
- **Zustand store**: `ToolManager.refreshCtx` pushes store values into `ToolContext`; tools also read `useEditorStore.getState()` directly for `selectedItemId` (ObjectPlacer) and `layerVisibility` (Eraser). The `t()` helper also calls `getState()` at invocation time.
- **The overlay**: Tools write to `ctx.overlay.showGhost` / `clearGhost` for cursor feedback. The pointer machine writes to the same overlay for drag-to-move previews and selection rings, creating a shared resource with no explicit ownership protocol.

---

## Procedural Generation

### Responsibility

The generation subsystem produces rule-valid maps from three algorithms — the PLANET generator (`src/tools/generation/designer/`, the default `'designed'`), a recursive-backtracker MAZE (`maze/`), and the STENCIL that reads a picture or a phrase as terrain (`stencil/`) — and deposits their results into `GridState` through the standard command/validation pipeline. The Generate shelf fronts them as FOUR kinds (`ui/shell/bars/generate-shelf.ts:GenerateKind = 'island' | 'maze' | 'text' | 'image'`), with `algorithmFor()` mapping the two picture kinds onto `'stencil'`. Generation runs inside `kit/operations/generate.ts:generateMap`, an async function that `await`s `yieldFrame()` before its first synchronous chunk so a caller's loading-spinner state can paint first (`ui/shell/bars/GenerateShelf.tsx` holds that flag).

Generation algorithms operate on supplied map state. All persistent output goes through `executeCommand`, which is `CommandExecutor.execute` bound at call time.

Stencil input floors are declared in `stencil/stencil.ts:STENCIL_MIN_SIDE`; the shelf gate and localized minimum-size message read that same source. Text uses font-derived grid fitting while strokes are small, then native outlines with component and counter checks. Image sampling has a separate compact-region boundary, `COMPACT_IMAGE_LIMIT`: smaller pictures preserve subcell color detail, while larger pictures retain standard sampling and material allocation. Text outline cleanup does not run on image stencils. Browser decoding, font readiness and bounded raster/plan caches belong to `ui/shell/bars/stencil-raster.ts` and `stencil-plan.ts`; engine placement still goes through ordinary commands and validation.

---

### Entry Points

`terrain-generator.ts:generateTerrain` is the single public dispatch function, and the only file at `generation/`'s root. It reads `config.algorithm` and routes to `generateMaze` (`maze/`), `runStencilPlan` (imported from `stencil/stencil-generator.ts` directly — the stencil's `index.ts` deliberately keeps the run entry off its door, as its header says) or `generateDesigned` (`designer/`), which is also what an unrecognised algorithm falls back to. Each of the three is a module, and all three stand on `generation/core/` — the floor: `types.ts` (what a terrain plan is), `repair.ts` (the decrease-only fixpoint that certifies one, plus the per-template scratch state it validates against) and `commit.ts` (plan → bottom-up `PaintTerrain` commands). Nothing else: the cell-set helpers went down to `core/model/geometry.ts` and the tuning table across to `tools/placement/`, both to their readers. The `GenerateConfig` interface (`core/model/types.ts`) carries the parameters a run is recorded with: `algorithm` (`'designed' | 'maze' | 'stencil'`), `maxElevation`, `seed`, `corridorWidth` (maze), `mazeGates` (maze), `stencilPlan` (stencil), an optional `region: MacroCoord[] | null`, `mode` (`'earth' | 'water' | 'mixed'`, a multiplier on the water a planet holds — the shelf offers one planet kind and always sends `mixed`, so this moves only for a recipe saved before the kinds collapsed, or for the agent's own call), and `richness` — the ONE 0..1 style knob (0 a flat garden town, 1 a terraced planet with water on every layer), which scales the terrain drama, the water, the theme count and the decoration together.

Only `'designed'` needs the rule set, and it takes the CALLER'S registry (`reg`, a `RuleDispatcher`) rather than building one, so a run is judged by exactly the rules the map is otherwise edited under. It throws rather than guessing if none is supplied.

`clearAllTerrain` issues a single `EraseTerrain` command covering every grass cell that has terrain; `clearAllObjects` is its object-side twin and skips `locked` objects, so a Clear never takes the plaza. Both take an optional cell list to restrict the sweep to, and an optional `spare` predicate for what to leave standing inside it: Generate passes the region it is about to rewrite, and the shelf's Clear passes the last run's region plus the map's own authorship, so taking back a generation never takes a placement the person made alongside it.

`generation/core/seam.ts` handles a bounded operation's effects on terrain outside its region. A mountain just beyond the boundary can depend on lower support inside it (V-MTN-03), and an elevated water body can depend on a same-height cap inside it (V-WTR-02). `readRegionBase` records the region's legal starting ground before clearing, and `repairRegionSeam` validates through the live registry before commit. A flagged editable cell steps down one tier; when the violation sits outside the region or under an authorship-spared object, the relevant inside cell steps one tier toward its recorded ground. Each move converges toward a known legal state without restoring more height than the seam needs. `runGeneration` records these commands with the generation stroke, so cached candidates replay the same settled seam.

---

### Randomness primitives (`src/core/model/`)

Every generator draws from the same two primitives on the engine floor, not from anything under `generation/`: `core/model/rng.ts` (`makeRng`, mulberry32) and `core/model/noise.ts` (`valueNoise01`, seeded value noise). The maze, the stencil, each stage of the planet pipeline and the agent's terraform/director tools all seed their own stream from `makeRng`, which is what keeps a `(seed, config)` pair reproducible across them. `makeRng`'s first draw off neighbouring seeds is itself neighbouring, so a planner whose first decision is a weighted choice avalanches the seed first (`mix`) — otherwise a batch of seeds counting up makes the same choice over and over.

---

### The planet generator (`src/tools/generation/designer/`)

A deterministic, seeded pipeline that PLANS a map before it touches one, the way a player lays a planet out, and commits the plan through the shared machinery. It works at three scales, and `pipeline.ts:generateDesigned` is the orchestrator that runs them in order.

EVERY STAGE IS A DIRECTORY, so the tree reads in the order the run does: `composition/` → `streets/` → `places/` → `terrain/` + `water/` → `build/` → `dressing/`, with `types.ts` beside them as the plan model they all speak and `eval/` off to one side, read by nobody in the pipeline. `designer/index.ts` is the door: the app takes `generateDesigned` through it, the evaluation harness takes the two plans it re-derives a map's story from, and a reach past it into a stage would mean the stage boundary is in the wrong place.

1. **The composition and the walk** (`composition/`) — `composition.ts:planComposition` picks a per-seed ARCHETYPE (which side of the planet the mass sits on: a wall, a corner highland, a rim, distributed massifs, or low relief), then covers the whole buildable planet in continuous terrace PLATES, every cell on one, tiers rising along the archetype's own axis with the step the base-support rule allows. `movement-line.ts:planMovementLine` lays the WALK out of the plaza that the districts are sequenced along and the water is composed at.
2. **The streets as the partition** (`streets/`) — `streets.ts:planStreets` lays few, long, STRAIGHT hierarchical streets on the plates: trunks spanning the planet, branches subdividing. Streets plus plate edges are what cut the planet into DISTRICTS, so the partition is the road network rather than a separate pass. A street crossing a tier step takes a RAMP inline, replacing pavement cells rather than overlapping them; ramps exist only there and at place entries. Widths come from one source (`TRUNK_W`/`BRANCH_W`), and the skeleton is measured so no street is one cell wide.
3. **The places** (`places/`, then `terrain/` and `dressing/`) — `districts.ts:planDistricts` hands every district a treatment and cuts it into composed places at the reference maps' own scale; `anchors.ts:planAnchors` seats every distinct Building and Facility exactly once, gate-aware, so each door faces its look-out; `terrain/terrain-sculpt.ts:sculptTerrain` cuts the ground the places stand on (per-region backing, terraced floors, the water below) and `dressing/` fills each place from its theme, under the symmetry (`symmetry.ts`) and single-colour-family (`palette.ts`) operators.

Water (`water/`) is composed as ONE story rather than as independent bodies: `water-story.ts` runs a source to a destination, `water-forms.ts` cuts the large composed figures, `fountain.ts` draws the regular nested court, and `cascade-stair.ts` steps a fall down a terrace as one body. All of them share `water-cut.ts`, whose two tests are the whole legality argument — a body whose every surrounding cell stands at or above its own level shows no FACE, so the containment rule asks it for no caps; a body that does show one needs mountain at exactly its own tier at each perpendicular end and a uniform row downstream. `terrain/landmark.ts` writes the text or pattern figure into the far wall.

`build/` is the only stage that touches a map, which is why it is the last one and a directory of its own: `scope.ts` is the painted region as a predicate, `terrain-commit.ts` the one place terrain is written, `paving.ts` the course every doorstep, plaza ring, bridge bank and figure frame reaches the streets by, and `crossings.ts` the decks and flights (each ANCHORED rather than positioned — the `heightDrop` and `waterSpan` traits snap the object themselves, so every one is placed and then read back).

The plan reaches the map through the same three doors every other generator uses: `commit.ts:planToCommands` turns a `TerrainPlan` into `PaintTerrain` commands built bottom-up (layer L carries every cell whose FINAL elevation is ≥ L, so no cell ever floats), `repair.ts:repairPlan` certifies a plan against the live rule set by a rule-agnostic **decrease-only** fixpoint, and `placement/object.ts:tryPlace`/`tryDecorate` place every object with reject-and-skip. `repair.ts` validates on ONE cached scratch `GridState` per template (`applyPlanToScratch` rewrites and returns it per call, valid only until the next one) because a run validates plans hundreds of times and a fresh W×H grid per candidate was the dominant allocation.

`eval/` is the scoring surface the offline evaluation loop and the tests share, and NO stage of the pipeline reads it — a generator that scored itself while building would be tuning to its own scorer. `evaluateMap` (`eval/scorecard.ts`) reads a finished `GridState` and produces the hard-rule ledger (every anchor once, the plaza reaches the network, no dead end, no one-wide road, every street end arriving somewhere, every body of water accounted for), the soft methodology scores, and the map's distance to the decoded reference; the readings it gathers are one file per subject (`streets`, `districts`, `arrivals`, `junctions`, `terraces`, `climb`, `water-bodies`, `water`, `figure`, `decor`, `reference`, and `composition`, which judges a BATCH rather than a map), all taken over the masks `grid.ts` reads once. `eval/index.ts` is the door both callers come through. `design-quality.test.ts` pins those as tests; `_render.test.ts` and `_render_real.test.ts` dump a generated grid as JSON so it can be rendered to an image offline (there is **no browser** in the test environment, so this is how terrain is eyeballed).

### The placement machinery (`src/tools/placement/`)

A module of its own beside `macros/`, not a stage under `generation/`: it puts objects on ground that already exists, whoever made the ground. This is the layer where "how do you put a thing on a map legally" lives:

- `object.ts` — `makeCtx` builds the placement context (state, execute, rules, seed, road style, clearance set); `tryPlace`/`tryDecorate` validate and place; `buildingGate` derives a house's door and the strip in front of it; `reserveClearance`/`sweepClearanceCells`/`enforceClearance` keep gates and crossing ends walkable.
- `analysis.ts` — `analyzeTerrain` reads the map once into the placeable mask, the elevation-aware regions and the distance-to-water field every later pass asks questions of.
- `network.ts`, `portals.ts` and `network-variation.ts` build road networks. `scanPortals` uses sparse candidates and dry-run validation to find bridge and ramp crossings; `buildNetwork` connects the network nodes through them.
- `route.ts`, `route-search.ts`, `route-offers.ts` and `route-portals.ts` plan aimed roads. Direction-aware search compares land paths with validated bridges and ramps. Crossing discovery includes dry ravines, half-grid placements and narrower catalog geometry; `object.ts:probePlacement` validates the snapped command without applying temporary objects. Candidates retain their catalog geometry and deck exits so pavement can join the crossing within the available approach space.
- `road-style.ts` — what kind of roads the map ALREADY has, measured rather than assumed: `bendDensity` reads the fraction of paved cells that turn (a grid near 0, a ramble near 1) and `turnPenaltyFor` maps that to the A* per-turn cost, so a new lane matches the streets it grows out of.
- `nature.ts` — `placeNature`, the layered ecology: forest stands with glades and soft edges, biome bands by elevation and moisture, waterside and ecotone flora in drifts rather than confetti.
- `themes.ts` — the six themed room decorators (`decorateZone`: orchard, farm, garden, hamlet, waterfront, peak) and the mirrored crossing vignette (`decorateCrossing`).
- `tuning.ts` — every knob the files above read, plus `macros/road-paving.ts`, which grows a lane out of the streets they built.

Its live callers are the planet generator (`object.ts` only), the smart-build macros in `tools/macros/`, and the agent's director tools, which come through `index.ts` because they sit outside `tools/`.

### Maze Generator (`maze/maze-generator.ts:generateMaze`)

The maze uses a randomized DFS (recursive backtracker) on a logical cell-wall grid, but physically maps cells to `step = corridorWidth + 1` macro-coordinate strides. The algorithm:

1. Computes the bounding box of the region (or full Grass extent if no region).
2. Derives `cellsW = floor((maxX - minX) / step)` and `cellsH = floor((maxY - minY) / step)` — the dimensions of the logical maze in cell units.
3. Initializes a `mazeH × mazeW` boolean grid, all `false` (wall).
4. Carves starting from `(1,1)` using iterative DFS with a stack. On each step, picks a random unvisited neighbor (2 steps away). Carving a passage marks the wall midpoint plus the destination room as `true`. Corridor and room widths are both `corridorWidth × corridorWidth` cells.
5. All `false` cells in the maze grid that map to valid in-region Grass cells become Mountains, painted bottom-up from elevation 1 to `min(maxElevation, 3)`.

The elevation cap at 3 (`maze/maze-generator.ts`) is hardcoded because the 3x3 base rule (V-MTN-03) exempts elevations 1–3, and a one-cell wall above that height would need width it cannot have. This avoids any base-support violations with no support planning at all.

The wall-midpoint carving (lines 125–131) covers the rectangle from `min(cx,nx)` to `max(cx,nx)+cw-1` in both axes. For `corridorWidth=1` this is correct: both the single-cell wall midpoint and the corner cells of the 1×1 rooms are included. For `corridorWidth > 1`, the rectangle over-carves slightly — walls that are `cw` cells wide between rooms are cleared as a block rather than as individual cells, but this is acceptable because the maze only places Mountains on `false` cells.

Region filtering (`regionSet`) is applied after the logical maze is computed. The maze is generated in the bounding rectangle of the region, then cells outside the region's actual shape are skipped. This means a non-rectangular region (e.g. L-shaped) will silently lose some maze arms — the bounding box is generated but only the intersection with the region is painted.

Painting uses a bulk-command-then-per-cell fallback: one `PaintTerrain` command per elevation covering all cells, and on a batch failure each cell is painted individually, with only the cells that took a layer advancing to the next one.

---

### Integration with Command/Validation Pipeline

All three generators receive `executeCommand: (cmd: Command) => ValidationResult` as a plain callback, not a direct `CommandExecutor` reference. In production (`kit/operations/generate.ts:generateMap`), this is `(cmd) => executor.execute(cmd)`. This means every generation command passes through the full pre-command rule set (zone restriction, layer lock, elevation range, floating block, placement overlap, object-blocks-terrain, chunk-load). The generators observe the `ValidationResult` and skip or retry cells on failure.

`kit/operations/generate.ts:generateMap` calls `executor.commitStrokeGroup(watermark)` once the run has finished. This runs post-stroke validation and cut-reconciliation once at the end, then collapses the entire generation into a **single undo entry** so the user undoes the whole generation in one Ctrl+Z rather than command-by-command. Generators are designed to produce rule-valid output structurally, so post-stroke revert should never fire in practice; the headless generation tests verify this by running post-stroke rules directly against the state after generation.

`CommandExecutor.execute` captures `before`/`after` cell snapshots for each generated command; `commitStrokeGroup` then collapses all those individual entries into one, so undo works correctly as a single operation.

---

### Region Selection

The region selection system is the `ui/shell/use-region-brush.ts` state machine, and it registers a `RegionBrushHandler` on `core/runtime/region-brush.ts`'s channel (`setRegionBrushHandler`) to receive cells the pointer machine reports via `paintRegionCell`/`finishRegionStroke`. Brush, eraser, rect, circle, line, and curve modes are supported via `shapes.ts` utilities, accumulating buildable cells into a mutable buffer during the drag and committing on pointer-up. The selected region is the store's own fact — `region: MacroCoord[]` in `state/slices/edit.ts`, written through `setRegion` (`[]` is the ONE representation of "no region painted") — and it reaches `generateTerrain` via `config.region`. Each generator converts this to a `Set<string>` (`"x,y"` keys) for O(1) membership tests.

The hook owns the region's OWN undo/redo stack, separate from the map's command history: a painted region is a scope for a future generate, not a map edit, so it must never share the executor's stack. While `selectingRegion` is on, the keyboard command routes Ctrl+Z/Ctrl+Y here instead of to the executor. One snapshot per perceived action (a brush drag, a shape drag, a whole curve sequence, a Clear tap), never per cell, and the stack lives on refs because it is read only imperatively and must survive the effect re-runs that every region commit causes.

---

### Invariants Maintained

- All generated terrain lands only on `CellZone.Grass` cells not colliding with plazas.
- **Rule-valid by construction**: terrain certifies through `repairPlan` against the live `RuleRegistry` (decrease-only fixpoint); every object goes through `tryPlace` (reject-and-skip). The real-map tests assert zero post-stroke violations and no object on a non-grass cell, on both shipped templates and every planet kind.
- The plate tiers satisfy V-MTN-03 (3×3 base) and no-floating BY CONSTRUCTION: a plate steps by at most the rule's own window and `planToCommands` builds every column bottom-up, so tall ground requires width.
- Elevated water is validated as a whole-plan candidate against the live registry BEFORE commit (`water-cut.ts`'s face/cap tests), satisfying V-WTR-02/03 with no post-stroke revert.
- Every district the streets reach is walkable from the plaza, and the eval ledger fails a run that strands one.
- The maze elevation cap (3) ensures `V-MTN-03` never fires for maze output.

---

## The Verb Seam (`src/kit/`)

`kit/` is the layer where "an editor operation" is one function with three interchangeable callers — the UI, the agent, and a test's by-hand context. `operations/` holds the verbs (`newMap`, `loadMap`, `generateMap`, `generateCandidate`, `clearGenerated`, `transferMap`): each is a plain function over a `KitContext` (`context.ts`, whose `currentKit()`/`installMap`/`installLoadedMap` are the one sanctioned path into a live map — `operations/` never imports the store itself), runs as one stroke group with provenance pushed and popped, and returns its outcome as DATA (`outcome.ts`) so the UI and the agent narrate it separately. Beside the verbs: `host.ts` (the typed surface for camera, feedback, buildable-region overlay, capture and resync on the active view), `commands.ts` (the keyboard-command RUN bodies, zipped with the identity metadata in `core/runtime/keybindings.ts`), `actions.ts`, and `group-edit.ts` (the shared toast/animation side of single and group object actions).

Candidate generation leaves the main thread: `operations/candidate-pool.ts` + `candidate.worker.ts` run planet builds in a small worker pool (`min(3, cores - 2)` workers — the main thread still has the map to draw and each worker holds a whole grid), with queueing, pre-dispatch cancellation, and a main-thread fallback where a worker cannot boot, gated on `typeof Worker` so headless runs never construct one. Jobs cross the boundary as `core/model/grid-wire` buffers in both directions, because a structured clone of a raw grid costs tens of milliseconds ON the main thread. The Smart Build macros' ghost preview and press share the same pool at queue-front priority.

---

## Editor Store & Item Catalog

### Responsibility

The Zustand store (`src/state/store.ts`) is the composition root of the entire editor. It holds — and is the single authoritative owner of — the live `GridState`, the `CommandExecutor` that mutates it, the `EventBus` that broadcasts mutations, and every piece of editor UI state (active tool, layer, selection, overlays). The catalog module (`src/state/catalog.ts`) is a purely static lookup table assembled at module-load time from the per-category barrels under `src/config/catalog/`; it has no runtime lifecycle and no dependency on the store.

---

### Store Shape

`EditorStore` (`store.ts`) is FOUR independently-typed slices composed at one `create()` call: `PrefsSlice & ShellSlice & EditSlice & EngineSlice` (`state/slices/{prefs,shell,edit,engine}.ts`). Each slice factory types its own `set`/`get` no wider than the fields it actually touches, so a slice naming a field outside its declared type is a compile error rather than a convention — and `shell` declares no engine field at all, which is the boundary a shell replaces. Roughly:

**The engine slice** — the "engine bundle" components reach into:
- `gridState: GridState | null` — the row-major cell grid, object map, locked layers, and map template. `null` until `initMap` or `loadMap` is called.
- `commandExecutor: CommandExecutor | null` — the command pipeline; `null` until a map is initialised.
- `eventBus: EventBus<EditorEvents>` — created once at store construction and **never replaced**. This is intentional: PixiCanvas subscribes to it on mount and the subscription lives for the component's lifetime. The event bus is the only member that survives `initMap`/`loadMap` unchanged.
- the selection cluster: `selection: BlockRef[]`, `contextMenu`, `deletePopover`.

**The edit slice** — the arming: `editMode: EditModeInputs` is the INPUT, and `activeTool`/`designMode`/`contentType` are DERIVED from it by `setEditMode` (`core/model/edit-mode.ts:resolveEditMode`, so the four facts cannot disagree). Beside them: `selectedItemId`, `placementRotation`, `tileMaterial` + `tileMaterialPicked`, `autoEdgeCut`, `eraserShape`, `activeLayer`, `displayLayer`, `layerVisibility`, `layerLocked`, `brushSize`, and the region cluster (`region`, `selectingRegion`, `regionTool`, `regionBrushSize`). The tool PARAMETERS themselves (`terrainType`, `elevation`, `brushSize`) are mirrored onto `ToolManager` by `PixiCanvas.tsx`.

**The prefs and shell slices** — persisted preferences (`locale`, `viewMode`, `showGrid`, `showChunkBounds`, motion, UI zoom, …, all through `core/runtime/prefs.ts`'s one key table) and the interface's open-surface state (`modals`, the mode row, panel flags).

---

### initMap and loadMap as Wiring Points

`initMap(template, registry)` (`state/slices/engine.ts`) is the factory for a new editing session:
1. Calls `createGrid(template)` to build a fresh row-major `MacroCell[][]`.
2. Constructs a `GridState` with empty `lockedLayers` and an `objects` map seeded with the plaza (`createPlazaObject(template)` — the locked object the template's plaza zone becomes).
3. Instantiates `CommandExecutor(gridState, eventBus, registry, roadLookup(gridState), catalogLoadValue)` — five collaborators: the two injected lookups are how `core` asks its questions about coatings and load values without importing up.
4. Writes `gridState` and `commandExecutor` into the store atomically via Zustand `set()`, along with the per-map layer state reset (active layer to Ground, no pin, visibility and locks cleared).

`loadMap(state, registry)` (`state/slices/engine.ts`) is identical except it accepts a pre-built `GridState` (from the JSON codec after import) instead of calling `createGrid`. In both cases the **existing `eventBus` instance is reused** — only `gridState` and `commandExecutor` are replaced.

The caller is responsible for supplying the `RuleRegistry`. In production this is always `createDefaultRegistry()` (from `src/rules/index.ts`), which registers all fifteen rules in the canonical phase order — called from `kit/operations/map.ts` (`newMap`/`loadMap`) and, for the app's cold-start map, `canvas/map2d/PixiCanvas.tsx`. This means rule configuration is opaque to the store — the store binds the executor to whatever registry it receives, with no knowledge of which rules are active.

`PixiCanvas.tsx` reacts to `gridState` changing (the `useEffect` at `PixiCanvas.tsx`) and rebuilds a fresh `ToolManager` with the new executor and grid state, completing the wiring from store update to renderer.

---

### CommandExecutor and Two-Phase Validation

`CommandExecutor` (`src/core/commands/command-executor.ts`) owns the undo/redo stacks and is the only entity that mutates `GridState`. Its API surface, grouped:
- `execute(cmd)` — pre-command validation via `RuleRegistry.validatePreCommand`, then `applyCommand`, then snapshot bookkeeping, event emission, and (for terrain) the inline mid-stroke reconcile.
- `commitStroke(strokeStartSize, opts?)` / `commitStrokeGroup` (its alias) — the full commit pipeline described in the executor chapter: roads reconciled, post-stroke validated, offenders reverted, cuts reconciled, history collapsed.
- `undo()` / `redo()` — restore cell snapshots and, for undo, skip intermediate states that would violate post-stroke rules (the same iterative clean-up loop as `commitStroke`).
- `validatePre(cmd)` — pre-command validation with no execution and no `validation-failed` event, for probes whose refusals are outcomes rather than errors.
- `runSilently(fn)` / `runSilentlyAsync(fn)` — suppress `validation-failed` events for bulk generation, which reject-and-skips many candidates by design.
- `rollbackTo(watermark)` / `collapseHistory(start)` — the all-or-nothing revert and the atomic-undo fold.
- `getUndoEntries()` / `commandsSince(watermark)` / `restoreHistory(entries)` — the history read/replay surface (the exported step history, and the agent's region lock reading commands AS APPLIED).
- `pushSource(ctx)` / `popSource()` / `noteAnalysisOnly()` / `getProvenanceSummary()` / `getProvenanceTracker()` — the provenance surface (its own section above).
- `getRegistry()` — exposes the registry so callers (notably `EditorAPI`) can perform dry-run validation without executing.

On `execute`, the executor captures `before` snapshots of affected cells, applies the command, captures `after` snapshots, pushes a `HistoryEntry`, clears the redo stack, and emits `cells-changed` / `history-changed`. For `PlaceObject` and `RemoveObject` the `applyCommand` path also emits `objects-changed` (and for `TrimCorners` on a road object it emits remove + add to force a renderer refresh).

The `EventBus<EditorEvents>` (`src/core/commands/event-bus.ts`) is a simple typed pub/sub with `on`/`off`/`emit`. There is no wildcard, no ordering guarantee beyond insertion order, and no async batching — every `emit` is synchronous. The renderer subscribes to `cells-changed` and `objects-changed` to trigger incremental redraws; `Toast.tsx` subscribes to `validation-failed` to auto-show error messages for pre-command rejections.

The `RuleRegistry` (`src/rules/registry.ts`) splits rules into two lists by phase. `validatePreCommand` filters the pre-command list by `appliesTo` and accumulates all errors (no short-circuit). `validatePostStroke` runs all post-stroke rules unconditionally. Registration order determines priority for pre-command rules; `rules/index.ts` documents the canonical order (layer-lock before zone before elevation, etc.).

---

### BlockRef / Selection Model

`BlockRef` (`core/model/types.ts`, re-exported by `store.ts`) is a discriminated union:
```
{ kind: 'object'; id: string }
| { kind: 'terrain'; x: number; y: number }
```
A `BlockRef` is used for three distinct but related purposes:
- `selection: BlockRef[]` (`state/slices/engine.ts`) — the selected blocks, in the order they were added, drawn as selection rings by the renderer. `[]` is the ONE representation of "nothing selected"; there is deliberately no scalar beside the list, because a scalar and a list are two sources for one fact and drift. Mutated only through `setSelection` / `toggleSelection` / `clearSelection`. Consumers that can express only one member (the corner handles, the delete popover, the keyboard rotate/delete, the agent's tool surface) read the pure derivation `singleSelection(selection)` from `state/selection.ts`, which returns null for a PLURAL selection rather than an arbitrary member. `sameRef` there compares by VALUE, since a `BlockRef` is rebuilt on every hover.
- `contextMenu: { x: number; y: number; target: BlockRef } | null` — right-click menu anchored to a position with its target. The `target` is always a `BlockRef` because the menu is always triggered on a real block.
- `deletePopover: BlockRef | null` — the keyboard-delete confirmation popover; non-null exactly while the popover is visible.

`ContextMenu.tsx` and `DeletePopover.tsx` both pull `commandExecutor` and `gridState` directly from the store, but the operations themselves run through shared call paths rather than being built inline: single-object rotate/peel through `tools/objects/actions.ts` (rotate is a remove plus a place of the same id, collapsed into one undo step), and delete/rotate's toast + animation side through `kit/group-edit.ts:deleteSelection`/`rotateObjectAction`/`rotateGroupAction` — the same functions `SelectionHandles.tsx` and the keyboard shortcuts (`kit/commands.ts`) call, so the three surfaces cannot answer the same action differently.

The store's `selectedItemId: string | null` is the catalog selection. `ToolManager` resolves it into `ToolContext.armedItem` and supplies `placementRotation` alongside it. The object placer reads that context, keeping the toolbar, rotation shortcut, placement command and ghost synchronized without reaching into Zustand itself.

---

### Catalog Loader/Indexer

`catalog.ts` is a module-level singleton built immediately at import time. It assembles the per-category barrels under `src/config/catalog/`, with one JSON file and one inline low-poly `model3d` description per object, and builds two `Map` indexes:
- `byId: Map<string, CatalogItem>` — O(1) lookup by `item.id` string (e.g. `"building-forest-cabin"`).
- `byCategory: Map<string, CatalogItem[]>` — ordered list per `ItemCategory` string value, holding only items still offered for placement; an item marked `disabled` stays in `byId` so saved maps load and render.

The Road family comes from the in-game path entries (`path-*`); each icon is also the tile texture drawn in both views. Retired road ids remain exact-match migrations in `io/legacy-catalog.ts`, so persisted maps convert them to their current replacements instead of dropping them.

The exported surface is a set of pure reads on these maps: the lookups (`getCatalogItem`, `getOfferedItem`, `getCatalogByCategory`, `getPlaceableByCategory`, `getAllCategories`, `getAllItems`, `getKnownItems`, `getCategoryMeta`, `searchCatalog`), the per-object questions (`categoryOf`, `isDecoration`), `getRoadMaterials` (the tile brush's surface list), and `catalogLoadValue` (the `LoadValueLookup` every `CommandExecutor` construction injects). There is no lazy loading and no hot-reload path; the one mutation door, `registerCatalogItem`, is test support (rule unit tests register controlled footprints), and `catalogEpoch()` exists so higher-layer memo caches can notice it.

`CatalogItem` (`types.ts`) carries the `PlacementTrait[]` array that drives `V-PLACE-TRAIT` (`rules/placement.ts`). Each trait is a tagged union variant; the rule iterates the trait list and dispatches to per-trait validation logic. This makes adding a new trait type a two-file change (add to the union in `types.ts`, handle in `placement.ts`) with no changes to the registry or executor.

`CatalogItem` is entirely disjoint from `PlacedObject`. A `PlacedObject` stores only `catalogId`, `position`, `rotation`, `elevation`, and optionally `spanLength` and `corners` — it looks up its dimensional and behavioral metadata from the catalog at runtime via `getCatalogItem(obj.catalogId)`. The catalog is therefore the authoritative schema for object rules; `PlacedObject` is the minimal persistent payload.

---

### Map Stats (`src/state/map-stats.ts`)

`getMapStats(state)` derives every whole-map count the editor reads: per-layer cell/object counts (`cellsByLayer`, `objectsByLayer`, `maxElevation` — the layer panel's question, via `state/layer-utils.ts:getActiveLayers`) and per-chunk object load (`chunks: Map<string, ChunkStat>` — the chunk-load rule's question, and the programmatic API's `EditorAPI.getChunkLoad`). Per-catalogId tallies are a separate question answered by `state/object-index.ts:countByCatalog` instead, so this module does not keep a second, differently-scoped count of the same fact.

The result is memoized per `GridState` and, like `state/object-index.ts`, **patched rather than rebuilt**: an object mutation folds its `state.objectsDelta` into the cached counts instead of re-deriving them from every object, while the terrain half rebuilds on `state.cellsVersion` changing (one grid walk per frame in which cells actually moved). Anything the cache cannot trust — a missing delta, a skipped version, a post-patch count that disagrees with `state.objects` — falls back to a full rebuild, so it can be slow but never stale.

The returned `MapStats` is a **live view, not a snapshot**: it is the same object instance on every call for a given `GridState`, mutated in place by the delta-patch path. A consumer that memoizes on the object's *identity* rather than its field values will not see later updates; React consumers should read the fields they need at render time rather than caching the `MapStats` reference itself. `subscribeMapStats` is the rAF-coalesced subscription React surfaces read through, so a brush stroke recomputes at most once per frame.

---

### Invariants

1. The `eventBus` instance is immutable for the lifetime of the application. It must be subscribed to before `initMap` is called; subscriptions are not re-established on map reload.
2. `commandExecutor` and `gridState` change together in one `set()` call. Any code that reads one should always check the other (both are nullable for the same reason).
3. `GridState.lockedLayers` is mutated directly by a `useEffect` in `PixiCanvas.tsx` whenever `layerLocked` changes (`PixiCanvas.tsx`); it is not mediated through a command. Rules read it but never write it.
4. Rule purity: neither `PreCommandRule.validate` nor `PostStrokeRule.validate` may mutate state. The registry enforces this only by convention — TypeScript does not prevent mutations.
5. Commands carry no snapshot data — `CommandBase` has only `timestamp`. `CommandExecutor.execute` captures `before`/`after` cell snapshots and stores them on the `HistoryEntry`.

---

### Composition with Neighbouring Subsystems

- **Tools**: `ToolManager` receives `executor` and `gridState` at construction time (from the store) and never re-reads them from the store. When `gridState` changes (new project), `PixiCanvas` destroys and rebuilds `ToolManager`. Tools call `ctx.executeCommand` / `ctx.commitStroke`, which delegate to the executor.
- **Renderer**: Subscribes to `eventBus` events for incremental redraws. The renderer's `initMap` is called reactively on `gridState` change. It never touches the store directly except through the event bus.
- **Rules**: Created externally (`createDefaultRegistry()`), passed into `initMap`/`loadMap`, held by the executor. Rules read `GridState` but have no reference to the store.
- **IO**: `json-codec` serialises/deserialises `GridState` only. Chunk loads are not persisted — they are derived from the objects.
- **EditorAPI** (`src/api/editor-api.ts`): Installed on `window.__PETIT_API` at mount **in DEV builds only** (`installAPI` gates the window assignment on `import.meta.env.DEV`; a production build ships no global). Accesses `gridState` and `commandExecutor` via getters that call `useEditorStore.getState()` — this avoids capturing stale references while still being synchronous.

---

## IO Codec & Programmatic API

### Responsibility

This subsystem has three loosely related jobs that share the `GridState` type as their interface surface:

1. **Persistence** (`src/io/`): Serialise and deserialise `GridState` to/from a versioned JSON envelope, compress the cell grid with run-length encoding, and provide the transport helpers — file download, clipboard copy, and a debounced localStorage autosave. Around the codec: `export-json.ts`/`import-sections.ts` (the optional save sections), `import-file.ts` (one entry for a picked/dropped/pasted file, JSON or image, that never throws), `import-validate.ts`, `history-codec.ts` (an exported undo stack, validated before replay), `legacy-catalog.ts` (retired-id renames), and `local-reset.ts` (the Settings "Local data" wipe).
2. **The share pipeline** (`src/io/share/`): the map as an importable PICTURE — its own section below.
3. **Programmatic API** (`src/api/editor-api.ts`): Expose the live editor as a typed object on `window.__PETIT_API` — **DEV builds only** — so browser-console scripts and automation harnesses can read grid state, issue commands, and round-trip JSON without touching the React/Zustand layer.

### JSON Codec (`src/io/json-codec.ts`)

#### SaveFile schema

The save envelope and its current version come from [save-format/types.ts](../src/io/save-format/types.ts). The codec writes declared fields directly. Optional domain sections stay `unknown` at this boundary and are parsed by their owners.

<!-- generated:save:start -->

Source: [src/io/save-format/types.ts](../src/io/save-format/types.ts).

```ts
export const CURRENT_VERSION = 1;

export interface SaveObject {
    id: string;
    catalogId: string;
    x: number;
    y: number;
    rotation: number;
    elevation?: number;
    spanLength?: number;
    corners?: string;
    patchOnly?: boolean;
}

export interface PersistedCamera {
    view2d?: {
        x: number;
        y: number;
        zoom: number;
    };
    view3d?: {
        az: number;
        el: number;
        dist: number;
        tx?: number;
        tz?: number;
    };
}

export interface SaveFile {
    version: number;
    templateId: string;
    cells: string;
    objects: SaveObject[];
    metadata: {
        savedAt: string;
    };
    provenance?: SerializedProvenance;
    notes?: MapNotes;
    imageAttribution?: ImageAttribution;
    annotations?: unknown;
    generation?: unknown;
    session?: unknown;
    history?: unknown;
    stats?: unknown;
    catalogInfo?: unknown;
    manifest?: unknown;
    camera?: PersistedCamera;
}
```

<!-- generated:save:end -->

**Versioning** (`io/save-format/`): `migrate.ts` runs an append-only chain of version-to-version transformations before decoding, and rejects future versions with `SaveVersionError`. A breaking change adds a migration, advances `CURRENT_VERSION`, and freezes a fixture. Additive optional sections require no version bump. `metadata.savedAt` is informational; `cells` contains packed row-major terrain tokens.

#### Cell encoding pipeline

`serialize` (`json-codec.ts`) iterates cells in row-major order (`y` outer, `x` inner) and converts each `MacroCell` to a short text token:

- Empty cell (`terrain: null`) → `"_"`.
- Terrain cell → `terrainToken` (`json-codec.ts`), which produces `t<type>:<elevation>` plus an optional corner suffix and optional `:P` patch-only flag. The corner suffix encodes the four `CornerTrim` values using a single-char map (`S/F/1/2/3/4/E`); if all four corners are `'square'` the suffix is omitted entirely, saving space for the most common case.

The token array is then RLE-compressed by `rleEncode` (`json-codec.ts`): consecutive identical tokens become `<count>*<token>`. For a fresh map this collapses all empty cells to a single `400*_`-style run. On `deserialize` (`json-codec.ts`), `rleDecode` (`json-codec.ts`) expands the RLE, then `tokenToCell` (`json-codec.ts`) reconstructs each `MacroCell` — restoring `zone` from the live template rather than persisting it (zone data is the template's responsibility, not the save file's).

`tokenToCell` handles legacy saves: tokens may contain `+`-joined parts with `c` (old corner) or `r` (old road) prefixes which are silently ignored. Only `t`-prefixed parts are read.

#### Object encoding

`SaveObject` (`io/save-format/types.ts`) flattens `PlacedObject` to scalar fields. Notable details:

- Objects carrying `locked` are NOT written. The plaza is the only one, and it is rebuilt from the template on load, so a save never carries a copy that could drift from the template's.


- `spanLength` and `corners` are only written when present (bridges only have `spanLength`; road patches may have `corners`).
- A corner-suffix omission optimisation mirrors the terrain case: if all four corners encode to `"SSSS"`, `corners` is omitted from the saved object entirely.
- `patchOnly` is a declared optional `SaveObject` field and round-trips directly through the codec.
- Object rotation, coordinates, elevation and span are validated before constructing a placement. Unknown catalog items and invalid placements are skipped; object identifiers are normalized before they reach tool output.

#### Deserialization invariants

`deserialize` (`json-codec.ts`) rejects a declared template mismatch and cell data that does not cover the template. It reconstructs zones and the immutable plaza from the template, validates imported objects and removes fully covered duplicate coatings. The returned state starts with an empty `lockedLayers` set; layer locks are not persisted.

`parseTerrain` (`json-codec.ts`) includes a legacy entry in its decode map: `T: 'tri-NW'` alongside `'1': 'tri-NW'` (`json-codec.ts`). The encoder only ever writes numeric codes, so `T` is a dead read path for forward-compat with an older encoding.

#### Autosave (`src/io/autosave.ts`)

`scheduleAutosave` uses `AUTOSAVE_DEBOUNCE_MS` in [autosave.ts](../src/io/autosave.ts) to coalesce edits. Only content-bearing maps are written. If storage fails, it retries without provenance; undo history is retained only when the full map and its provenance were saved together. `readAutosave` returns null on decoding failure, and `readRestorableAutosave` additionally applies the shared `autosaveWorthy` content predicate.

#### Image export (`src/io/image-export.ts`)

`image-export.ts` provides `downloadBlob`, `downloadJSON` and `dataUrlToBlob` as pure DOM utilities. `dataUrlToBlob` exists because `fetch()` of a `data:` URL is blocked by the CSP's `connect-src`, which is the obvious way to convert one and does not work here. Full-map image export goes through `kit/host.ts`'s `capture2d()`, which calls the live `MapRenderer.captureMapImage()` via `canvas/map2d/renderer-registry.ts`'s `getMapRenderer()`, not through this module. The composed share-image shot (header, grid, layer strip, 3D cards, footer) is `io/export/`'s job.

### The Share Pipeline (`src/io/share/`)

The share image is not only a picture of the map; it carries the map. `export.ts:buildShareCode` encodes the whole `GridState` into the visible, fixed-footprint PetitGlyph band. `codec/` packs the map into a payload (`bitio.ts` bit-level IO, `map-coder.ts` and `payload.ts` the format, `grid-io.ts` the cell stream). `glyph/` selects a payload-sized color and module-density profile, protects shortened blocks with Reed-Solomon parity over GF(256), interleaves them, and places their modules in a centered capsule; its decoder retains the released version 1 and 2 transports. `raster/` reads and writes PNG without a browser API (`png-chunks.ts`, `zlib.ts`), so the same import path runs in Node tests.

Two laws hold the format together. The payload always carries the complete canonical map and ends in its SHA-256 (`canonical.ts`, `crypto/`); import (`import.ts:importFromBytes`/`importFromRaster`) decodes, rebuilds and compares, so a share image imports exactly or fails rather than returning a partial map. An optional generation-recipe note records how a generated map was made, but import never depends on replaying the generator. Each object travels as an INDEX into append-only `codec/catalog-order.ts`: the position is part of the wire format, so new items go at the end and retired ids keep their slots before migration to current ids.

### Programmatic API (`src/api/editor-api.ts`)

#### Installation

`installAPI` (`editor-api.ts`) is called once from `App.tsx`. It creates an `EditorAPI` instance with two thunks — `getState` and `getExecutor` — that call `useEditorStore.getState()` at invocation time. This means the API always reflects the latest `GridState` and `CommandExecutor` even after `initMap`/`loadMap` replace them in the store. The window assignment is gated: `if (import.meta.env.DEV) window.__PETIT_API = api`, so the console surface exists in DEV builds only, while the returned object stays available for in-app use.

#### Read surface

`getCell`, `getRegion`, `getObjects`, `getChunkLoad`, `getMapDimensions` are thin wrappers around `grid-model:getCell` and direct `GridState` field reads. They return live references (not clones), so a script that mutates the returned `MacroCell` would corrupt state without going through the command pipeline.

#### Command surface

`paintTerrain`, `eraseTerrain`, `placeObject`, `removeObject` each manually construct a `Command` with the correct `CommandType` and pass it to `executor.execute()`. This is **exactly the same path** the UI tools use: `execute` runs pre-command rules via `RuleRegistry.validatePreCommand`, applies the command only on success, pushes to the undo stack, and emits `cells-changed` and `history-changed` events. The renderer reacts to those events identically whether the change came from mouse drag or console script.

Two construction details stand out:

- Each method builds a typed command literal, so a field added to a command type surfaces here as a compile error rather than being silently dropped.
- `placeObject` (`editor-api.ts`) builds its command through `objectPlacementCommand`, the same factory the placer tool uses, and sets `elevation` from the terrain at the target cell. A bridge placed via the API will not have `spanLength` set, making it semantically incomplete (a bridge without `spanLength` would fail `waterSpan` trait validation in a pre-command rule before it even reaches placement).

#### Validation surface

`validate` (`editor-api.ts`) calls `executor.getRegistry().validatePreCommand(cmd, state)` and wraps the result in a `ValidationResult`. This lets scripts dry-run commands, but it only covers pre-command rules — the full two-phase picture (including post-stroke rules that might revert the command) is not exposed.

#### I/O surface

`exportJSON` delegates to `serialize(getState())`. `importJSON` delegates to `deserialize(data, getState().template)` but does **not** install the result — it returns the `GridState` without calling `store.loadMap`. A caller that wants to actually load the imported state must call `store.loadMap` separately.

#### History

`undo` and `redo` are direct delegates to `CommandExecutor`. They participate in the same undo stack that UI operations use, so console-issued commands are undoable with Ctrl+Z in the browser.

### Composition with neighbouring subsystems

- **Command Executor / Rules**: The API reuses `CommandExecutor.execute` verbatim, receiving the same pre-command validation and event emission as UI tools. Post-stroke validation (`commitStroke`) is **not** called by the API — `commitStroke` is the tool's responsibility and the API provides no stroke-level grouping.
- **Zustand store**: The API reads state via late-bound thunks (`getState`/`getExecutor`) so it is transparent to `initMap`/`loadMap` replacing the live objects in the store.
- **Renderer**: Because the API routes through `execute`, all renderer event subscriptions (`cells-changed`, `objects-changed`) fire normally.
- **Autosave**: The codec's `serialize`/`deserialize` are used by both the autosave module and the API's `exportJSON`/`importJSON`.

---

## The 3D View (`src/canvas/map3d/`)

The 3D editor is the second LIVE view over the same command pipeline, not a preview: the whole 2D tool set works on its surface unchanged, because editing goes through `interaction/pick.ts` (a pure heightfield ray-march to the first visible surface) and `interaction/projection.ts` (the 3D `ViewProjection`), with tool overlays drawn as surface-draped decals. The scene is live-synced to the event bus — `cells-changed` remeshes the dirty chunk ring, `objects-changed` updates slot-managed instanced meshes — and the chunk is lazy, so three.js stays out of the main bundle until the Layer panel's 3D toggle flips the persisted `viewMode`. Within: `core/` (three-free contracts over the shared palette and tile constants), `build/` (pure, unit-tested geometry builders, honouring the edge-cut trims), `models/` (the declarative per-item `ModelSpec` system, each catalog item carrying its `model3d` inline), and `scene/` (the ONE GPU file plus camera controls and the camera registry `io/autosave` round-trips the 3D orbit through). The 2D canvas stays mounted as the capture/export engine.

## The Interface Layer (`src/ui/`)

One interface, mounted by App as `ui/shell/Shell`: two shared layers below (`design/` for tokens, the UI-scaling factor and cursors; `primitives/` for generic parts), and three owning surfaces above. `shell/` is the game-style frame around the map: its mode is the store's `editMode.mode`, so the visible bottom bar and the armed map action are one fact; `bars/` contains the per-mode shelves and `windows/` the layer panel and related surfaces. `chrome/` owns modals, floating overlays, guards and the first-launch tour. `agent/` is the assistant panel, loaded separately so its tool layer and provider SDKs stay out of the eager graph. Every user-facing string goes through `i18n/`, and every shell motion is declared in `shell/motion/registry.ts`.

`design/scale.tsx:fittedUiScale` owns the shared fit for the frame and chrome, including the remaining workspace beside a docked assistant. The frame layout plan coordinates corner actions and rail folding, keeping history on the right and fitting expanded layers above the lower controls when space permits. Each bottom row reserves only the rail cells intersecting its height; crowded rows scroll horizontally. Fitting changes the displayed size while retaining the saved scale preference. Layout transitions use the shared motion registry and reduced-motion gates.

`assets/fonts/family.ts` declares the common interface and map-label font stack. `ui/design/text-weight.ts` adapts text weight to visible text size, a bounded allowance for display density and script density. Small text becomes lighter while normal body text and larger headings retain their emphasis. Native controls inherit their surface's font; portalled slider readings carry the font explicitly and use the same weight adaptation.

`GenerateShelf` owns generation settings and applying a chosen result. Its preview hook owns detached candidate/custom previews, caches and cancellation; font readiness and strip controls have their own modules. Help renders text immediately and admits illustration work after the modal entrance and near the reading viewport. Preview frames retain their dimensions while unseen map generation, captures and renderer setup wait; examples still use the live components and editor operations.

## The Agent Harness (`src/agent/`)

The LLM assistant edits the map by tool call, and its architecture is one sentence: THE LOG IS THE STATE, and everything else is a projection of it. `core/log.ts` is an append-only `SessionEvent` list; `core/project-view.ts` folds it into what the panel renders and `core/project-messages.ts` folds the same log into provider messages, so the UI and the wire can never tell two different stories. `core/loop.ts:runJob` drives adapter turns from the log and back into it — its only state IS the log, so a fresh call over the same log resumes exactly where the last one stopped (an unanswered gate is re-entered rather than re-asked), with the governor's dampers (turn budget, verbatim-retry and repeated-revert escalations, the repeat refusal) reading their counters back off the log too.

`providers/` is BYOK in-browser. `defaults.ts:PROVIDER_IDS` is the provider roster, including the custom OpenAI-compatible endpoint; `detect.ts` identifies a pasted key from its format or a `/models` probe. `exec/` is the seam to the app: `executor.ts` adapts the tool layer to the loop, and `runner.ts` owns the in-flight job. `session/` bridges to Zustand and persists the log. `prompts/` and `skills/` are markdown, with the system prompt rebuilt from the live `RuleRegistry.getRules()` and catalog so those runtime facts cannot drift from the model's instructions.

The tool sandbox (`tools/**` and `exec/executor.ts`) exposes map operations without storage, DOM or network access. A write call groups its accepted edits into one undo step. Pre-command refusals return rule evidence; post-stroke validation rolls back only as far as legality requires, so a valid prefix may remain. Tool feedback and the panel report the retained cell/object edits explicitly. Crashes and region-lock violations roll back the whole call; the region boundary is checked against commands as applied, including snapped placements. The key vault uses AES-GCM with a non-extractable IndexedDB key, transcript redaction and HTTPS-only custom endpoints with a loopback exception. See [THREAT_MODEL.md](THREAT_MODEL.md).

Cancellation and pause are checked again after approval and write waits, before execution. Stream waits and compaction observe cancellation even when a provider does not. Runner callbacks are scoped to their active log so late completion cannot replace a newer job. `session/validate-log.ts` validates persisted event structure and sequence before projection; unanswered gates from earlier jobs cannot block a current pause. An oversized context that cannot be shortened becomes a reported incident instead of a retry loop.

---

## Editor Interaction: Block Selection

Selection is editor-interaction state rather than map data, but it drives several command paths, so it belongs here. Any block can be selected — a placed object or a terrain cell (mountain, water, or bare ground) — and there is no separate object-only selection path. The selection is a SET: `selection: BlockRef[]` in `state/store.ts`, ordered as the user built it, holding object references (by id) and terrain references (by coordinate). Only objects can be selected plurally; terrain is always a selection of one (see "Group operations" below).

**When selection is active.** An unmodified click selects in drag mode: the Hand tool, or the Object Placer with no item chosen (`inSelectMode` in `core/interaction/tool-modes.ts`). During creation modes (brushing, painting, road brush, edge cutting) a click means "draw here", so selection is disabled to avoid ambiguity — and switching to one of them drops the selection, since it can no longer be made.

With an item armed the placer is a special case, because a selection is still reachable there (`canHoldSelection`, the wider gate that keeps the selection alive) in two ways. Holding the multi-select modifier routes the press to the ordinary toggle / rubber-band path instead of placing, and once that gesture leaves something selected the armed item is dropped, so the pointer lands in plain select/drag mode; a gesture that selected nothing keeps the item. An unmodified press on an existing object where the placement would be REFUSED selects that object instead of raising the refusal, and keeps the item armed so placing continues afterwards (`armedPressSelects`, gated on the placer's own `canActAt` so a LEGAL placement always still places — coating over a road, or a bridge/ramp snapping from an anchor cell that carries a decoration).

**What you can do with a selection:**

| Action | Object | Terrain |
|--------|--------|---------|
| Select (left-click) | ✔ | ✔ |
| Show layer number | ✔ (forced) | ✔ (forced) |
| Drag to move | ✔ | — |
| Right-click rotate | ✔ (if rotatable) | — |
| Delete | removes object | peels one layer (eraser behavior) |

A selected block shows its layer number as a fallback for when the global show-numbers toggle is off; when that toggle is on, the terrain/object layers already draw the number, so the selection suppresses its own label to avoid drawing it twice.

**Delete semantics.** Deleting a terrain block peels exactly one layer (mountain N → N−1, water → cleared to ground) — the same peel the eraser uses. Deleting an object removes it. Right-click → context menu deletes instantly; keyboard Delete/Backspace opens a confirm popover (Enter confirms, Esc cancels). Ground is undeletable: for a ground cell the context-menu Delete is greyed out and the Delete key does nothing (ground *water* is not ground — it peels to ground like any other water).

Deselecting — including the implicit deselect after a delete, or leaving drag mode — clears the selection outline through a single subscription on the selection state, the inverse of drawing it.

### Group operations

Ctrl is a selection modifier and nothing else: Ctrl+click toggles a member, Ctrl+drag rubber-bands, Ctrl+A takes every object on the map. Moving is unmodified and does not care how many members there are — a drag arms only on a press over an ALREADY-selected object, which is the same rule single selection has always used, so extending it to N needs no new gesture. The band is a MACRO rectangle (`canvas/interaction/marquee.ts`): the drag's endpoints go through `ViewProjection.screenToMacro` and the resulting rect is both what is drawn and what selects, so the 2D and 3D behaviours are identical by construction and the rule is testable without a camera. An object is covered when its footprint INTERSECTS the rect, and candidates come from `object-index`'s `entriesNear`, never a scan of `state.objects`.

Terrain is never multi-selected. Ctrl over bare ground begins a band instead of selecting the cell, and a band collects objects only; a set of terrain cells has no group operation the brushes do not already do better.

`PlacedObject.locked` is a tag, not an object kind. Locked objects remain hit-testable, selectable, and eligible for group membership; V-LOCK-02 rejects any attempted mutation. Both views therefore resolve the same object under the pointer before the rule layer decides whether an action is allowed.

Whether a group operation refuses wholly or applies partially follows from whether a partial result is coherent, and has nothing to do with which member is locked. **Move and rotate are geometric**, so a partial application would silently deform the arrangement being manipulated and leave an undo restoring something the user never saw: if any member's destination is illegal, or any member is locked or cannot turn, the whole operation is refused and the blocker is named. For a move the refusal is visible before release, as the drag ghost tints invalid. **Delete applies to what it can and reports the rest**, since the survivors are exactly where they were: Ctrl+A then Delete clears the map and keeps the plaza, with a message saying so. Both run through `tools/objects/group-actions.ts` (the plural sibling of `tools/objects/actions.ts`) as one stroke group and one undo entry, so the context menu, the delete popover and the keyboard command (via `kit/commands.ts`/`kit/group-edit.ts`) share one implementation. Membership is re-resolved from ids on every operation (`groupMembers`), because nothing validates a selection centrally and another path may have removed a member since.

A group rotation is ONE rigid body turning about ONE point: every member's position rotates about the selection's macro bounding-box centre, and each rotatable member's own facing advances by the same quarter turn. A member that cannot turn but is SQUARE is carried — its position travels, its facing does not — because `rotatable: false` marks an item with no meaningful facing, and refusing on that flag would let one flower kill nearly every real selection while protecting nothing. A member that cannot turn and is NOT square refuses the whole rotation: it cannot swap its extent, so the bounding box changes shape from turn to turn and the arrangement walks away from where it started. The animation contract lives in `canvas/group-arc.ts` and is shared by both views: what eases is the ANGLE about the pivot with the radius held (a straight line cuts the chord, visibly contracting the arrangement mid-turn), the whole turn is one spec on one clock rather than a signal per member, and offsets are measured FROM the already-committed rest pose, since the commands apply instantly and a tween can only land where the map already put the object.
