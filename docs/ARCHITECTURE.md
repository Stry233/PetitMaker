# System Behavior & Architecture

This is the backend/engine reference for the Petit Planet map editor: how the system is built and how it behaves at runtime. What a map may legally *be* is not prose here: the game's building rules live in `src/rules/`, one rule per file, and this document describes the machinery that runs them.

## Architecture at a glance

The editor is a **layered stack with one strict rule: a module may import only from its own layer or a layer BELOW it — never above.** Lower layers are pure and reusable; higher layers compose them. Drawn like an OS stack (user-facing consumers on top, the engine floor at the bottom):

```
┌────────────────────────────────────────────────────────────────────────┐
│ agent/  io/  api/  LLM harness · save/load + share/ + export/ ·        │
│                    programmatic API      (feature surfaces, leaves)    │
├────────────────────────────────────────────────────────────────────────┤
│ ui/        React panels · chrome · hooks · styles      (presentation)  │
├────────────────────────────────────────────────────────────────────────┤
│ canvas/    the view seam (view-projection · active-view) · the shared  │
│            interaction/ pointer machine · TWO LIVE EDITING VIEWS:      │
│            map2d/ (PixiJS) and map3d/ (three.js)                       │
├────────────────────────────────────────────────────────────────────────┤
│ i18n/      7-locale translations + localizedName (used by ui and agent)│
│ legal/     policy docs: markdown source → React + static HTML emitters │
├────────────────────────────────────────────────────────────────────────┤
│ tools/     pointer-gesture → Command handlers: paint/ · objects/ ·     │
│            edge-cut/ · generation/ (zones · water · crossings ·        │
│            placement)                                                  │
├────────────────────────────────────────────────────────────────────────┤
│ rules/     two-phase validators, one per file, in a RuleRegistry       │
├────────────────────────────────────────────────────────────────────────┤
│ state/     Zustand store (composition root) · catalog ·                │
│            object-geometry (catalog-aware footprints) · object-index   │
├────────────────────────────────────────────────────────────────────────┤
│ core/ model/      types · grid-model · constants · rng · noise ·       │
│                   colors · bridge-span · waterfall-geometry ·          │
│                   model-spec · layer-utils · chunk-tracker ·           │
│                   rule-dispatcher (the validate-only rule interface)   │
│       commands/   command-executor (two-phase validation) ·            │
│                   command-apply · provenance-recorder · event-bus      │
│       interaction/                                                     │
│                   pointer-buttons · tool-modes · camera-verbs ·        │
│                   press-plan (resolvePress: what a press, a tap and a  │
│                   drag each mean)                                      │
│       edge-cut/   terrain-silhouette kernel · cut-validator ·          │
│                   trim-lock · cut-reconcile · cut-backing ·            │
│                   road-cut-states                                      │
│       provenance/ edit-source ledger + taint threading                 │
│       runtime/    anim-config · device-quality · window-bridge         │
├────────────────────────────────────────────────────────────────────────┤
│ config/    catalog/<cat>/<id>.json (item + model3d) · maps/    (data)  │
│ assets/    icons · fonts · team art                          (static)  │
└────────────────────────────────────────────────────────────────────────┘
                       imports only ever point DOWN  ↓
```

| Layer | Owns | May import |
|---|---|---|
| `config/` | static JSON data — the catalog (one file per object, with its 3D `model3d` inline) + map templates | — |
| `core/` | the **engine floor**: pure types, grid + geometry, RNG/noise/colour primitives, the command executor + two-phase validation, the event bus, the edge-cut silhouette kernel, the provenance ledger, and the pointer-semantics floor (`interaction/`: the button constants, the tool-mode predicates, the camera-verb catalogue, and `resolvePress`, the one function that answers what a press, a tap and a drag each mean). It depends on `rules/` only through `model/rule-dispatcher.ts`, the validate-only interface the concrete `RuleRegistry` implements, so the edge points down like every other one | `config`, within `core` |
| `state/` | the Zustand store (wires executor + registry + bus), the item catalog, and object-footprint geometry | `core` |
| `rules/` | two-phase validators (pre-command + post-stroke), one rule per file | `core`, `state` |
| `tools/` | interaction handlers (gesture → `Command`) + procedural generation | `core`, `state`, `rules` |
| `i18n/` | the 7-locale translation tables + `localizedName`/`translate` helpers | `core`, `state` |
| `legal/` | policy-document source (constrained markdown → React and static-HTML emitters, config, filing bar) | `core`, `i18n` |
| `assets/` | static icons, fonts, and team art (resolved by `icon-urls.ts`) | — |
| `canvas/` | the view seam (`view-projection.ts`, `active-view.ts`), the shared `interaction/` pointer machine, which executes the plan `core/interaction/press-plan.ts` resolves and drives the active view (drag thresholds, ghosts, overlays, touch, the rubber band remain its own mechanism), and the two live editing views: `map2d/` (PixiJS) and `map3d/` (three.js) | everything below |
| `ui/` | React panels, chrome, hooks, the design tokens, the keyboard-command registry (`keybindings/`) and the cursor catalogue + art (`cursors/`) | everything below |
| `agent/`, `io/`, `api/` | LLM agent harness, save/load + share + image export, programmatic API | everything below (leaf consumers) |

**`core/model` is the canonical primitives floor.** Every shape-free, state-free primitive lives here so no higher layer re-implements or reaches up for it: the seeded RNG (`rng.ts`), value noise (`noise.ts`), colour lookups (`colors.ts`), the 4-neighbour offsets + BFS distance field + `flatIndex`/`cellKey` helpers (`grid-model.ts`), waterfall face geometry (`waterfall-geometry.ts`), and the declarative 3D `ModelSpec` shape (`model-spec.ts`, referenced by `CatalogItem.model3d`). Geometry that additionally needs the **item catalog** (object footprints — `objectRect`, `getPlacedObjectSize`, `buildObjectOccupancy`, …) sits one layer up in `state/object-geometry.ts`, so `rules/`, `tools/`, and both views under `canvas/` import it *downward* rather than reaching into a tool.

**`canvas/` holds two live editing views, not a renderer and a preview.** `map2d/` (PixiJS) and `map3d/` (three.js) both drive the same tools through the same command path. Tools and the pointer machine speak only the `ViewProjection` / `ToolOverlay` / camera-verb interfaces in `view-projection.ts`, and `active-view.ts` re-points them at whichever view is showing — so no tool branches on the view mode, and adding view-specific behaviour means implementing an interface member rather than touching a tool.

**Documented exceptions** (a lower layer that is still catalog-coupled): `core/edge-cut/{cut-validator, road-cut-states}` read `state/catalog` for road/trait facts — road silhouette geometry is inherently catalog-aware. This is the one remaining upward edge out of `core`, tracked for a future inject-the-catalog cleanup.

### The canonical edit flow

Every mutation is a `Command`. The path from a user action to a rendered pixel:

1. A **tool** (or the programmatic API) builds a `Command` and calls `executor.execute(cmd)`.
2. The executor runs **pre-command rules** (`RuleRegistry.validatePreCommand`). On any error the command is rejected and state is left unchanged.
3. On success it snapshots the affected cells, **applies** the command, pushes an undo entry, and emits `cells-changed` / `objects-changed`.
4. At the end of a gesture the tool calls `executor.commitStroke(start)`, which runs **post-stroke rules**, **auto-reverts** offending commands one at a time until the state is clean, and then runs the **edge-cut reconciliation** pass.
5. The **active view** redraws from the emitted events; the store never calls a view directly.

The sections below follow this dependency chain outward, from the data model to the IO/API surface. Where a subsystem has a known wart, the prose says so inline.

---

## Data Model & Types

### Responsibility

`src/core/model/types.ts`, `src/core/model/constants.ts`, and `src/core/model/layer-utils.ts` form the foundational contract for the entire editor. Every other subsystem — rules, renderer, tools, IO, state — imports from this layer; nothing here imports from them. The three files collectively define: the persistent data shapes that cross the command boundary, the enum vocabularies all code narrows against, the event bus contract that decouples renderer from state, and two spatial query utilities (layer enumeration and elevation-based placement eligibility) that are too tightly coupled to `GridState` to live in the renderer or tools.

---

### The Cell Hierarchy

The atomic unit of state is `MacroCell` (`types.ts`): a zone enum (`CellZone`) plus a nullable `TerrainCell`. When `terrain` is `null` the cell is bare ground (layer 0) — this is a deliberate sentinel rather than a default struct with `TerrainType.None`, because it keeps the common case cheap and makes "has terrain?" a single null check everywhere. `TerrainCell` (`types.ts`) holds `type` (a `TerrainType` enum), `elevation` (1–8 per `constants.ts`), and three optional fields that only exist on road/edge-cut cells: `corners?: Corners`, `patchOnly?: boolean`, and `patchBase?: number`. These optional fields are how the road/edge system piggy-backs metadata onto the same terrain slot without adding a separate data structure. `patchBase` is the load-bearing one: a Γ patch is a cosmetic fillet, so `patchBase` records the REAL support tier under it (0 when the fillet sits straight on the ground). Reading `elevation` on such a cell sees a block that is not there, which is why `structuralTop`/`surfaceElevation` exist and why placement and support questions must go through them.

`Corners` (`types.ts`) is a fixed-length tuple `[CornerTrim, CornerTrim, CornerTrim, CornerTrim]` in NW/NE/SW/SE order. The element type `CornerTrim` is a string union (`'square' | 'fan' | 'tri-NW' | 'tri-NE' | 'tri-SW' | 'tri-SE' | 'empty'`). The sentinel value `'empty'` signals "remove this cell entirely" in `TrimCornersCommand` — when all four corners are `'empty'`, `applyCommand` deletes the terrain cell rather than storing an all-empty `Corners` array (`command-apply.ts`). Similarly, all-`'square'` corners normalize to `corners: undefined`, since `undefined` is the canonical form for "no corner data".

`GridState` (`types.ts`) aggregates:
- `cells: MacroCell[][]` — row-major, `cells[y][x]` (documented invariant).
- `objects: Map<string, PlacedObject>` — keyed by UUID.
- `lockedLayers: Set<number>` — UI-controlled; read by `layer-lock` rule but never written by rules.
- `template: MapTemplate` — the immutable blueprint (dimensions, zone layout, plaza config) sourced from `src/config/maps/*.json`.

---

### The Command Discriminated Union

All mutations flow as `Command` values, a discriminated union narrowed by `cmd.type: CommandType` (`types.ts`). The five members are:

- **`PaintTerrainCommand`**: a batch of `MacroCoord[]` plus `terrainType` and `elevation`. The batch design means a full brush stroke can be a single command, though in practice each cell in a stroke is a separate command (tools call `execute()` once per cell, accumulate them as separate undo entries, and call `commitStroke()` at pointer-up).
- **`EraseTerrainCommand`**: same batch shape, no terrain payload.
- **`PlaceObjectCommand`**: embeds the full `PlacedObject` struct plus `loadValue`. `loadValue` is populated by callers but not used for chunk-load accounting, which the rule computes fresh from `state.objects` (see the chunk-load section below).
- **`RemoveObjectCommand`**: mirrors `PlaceObjectCommand`; captures `removedObject` for undo.
- **`TrimCornersCommand`** (`types.ts`): the most structurally overloaded command. A single type covers both terrain-layer corner trimming and road-object corner trimming via the `layer: 'terrain' | 'road'` discriminant and optional `objectId`. The `beforeCorners`/`afterCorners` fields carry the corner state for undo. Optional `beforeRotation`/`afterRotation` fields carry a road rotation change on the command so that `revertEntry`/`reapplyEntry` can restore it faithfully — `reconcileRoadAt` and the edge-cut tool set these instead of mutating `road.rotation` directly.

Every command extends `CommandBase` (`types.ts`) which carries only `timestamp`. Undo/redo snapshots live solely on the executor's private `HistoryEntry { cmd, before, after }` and are never stored on the command itself. `CommandExecutor.execute()` captures before/after cell snapshots via `cloneCell` and stores them on the `HistoryEntry` (`command-executor.ts`). `CellSnapshot` (`types.ts`) is simply `{ coord: MacroCoord; cell: MacroCell }`.

---

### PlacedObject and the Dual Catalog Problem

`PlacedObject` (`types.ts`) is the runtime representation: UUID, `catalogId` reference, `position`, `rotation`, `elevation`, and optionals (`spanLength` for bridges, `corners`/`patchOnly` for road objects). It carries no category of its own: `catalogId` determines it, and `state/catalog.ts:categoryOf` is the one way to ask, answering with the full seven-way `ItemCategory`. That matters because a projection onto fewer members cannot tell a house from a road, a bridge or a ramp, and callers then recover the difference by matching on id strings.

`ItemCategory` (`types.ts`) is the string enum with seven values (Building, Tree, Flora, Road, Bridge, Ramp, Facility) that `CatalogItem` carries. `CatalogItem` (`types.ts`) is the schema for the per-object files under `src/config/catalog/<category>/<id>.json`. `PlacedObject` stores only `catalogId` and looks up its dimensional and behavioral metadata from the catalog at runtime.

---

### PlacementTrait Union

`PlacementTrait` (`types.ts`) is a tagged union of seven variants. Each variant parameterizes a validation strategy: `flat` checks uniform elevation across an extended footprint (W+1 × H+1 to account for the macro/micro grid offset — see "Coordinate duality (macro vs. micro)" below); `noFloat` requires terrain present on every footprint cell; `waterSpan` validates bridge geometry including auto-detecting orientation and mutating `cmd.object.rotation`, `cmd.object.position`, and `cmd.object.spanLength` as side-effects during validation (`placement.ts`); `heightDrop` similarly mutates position, rotation, and elevation for ramps; `surfaceCoating` requires non-water terrain (roads); `exclusionRadius` enforces Chebyshev distance between same-category items; `terrainBase` declares the footprint usable as structural support for terrain above it.

The mutation-during-validation pattern for `waterSpan` and `heightDrop` is intentional: it allows the placement validation rule to both check and auto-correct object placement geometry in a single pass.

---

### Rule System Interfaces

`PreCommandRule` (`types.ts`) gates individual commands: `appliesTo: CommandType[]` lets `RuleRegistry.validatePreCommand` skip irrelevant rules cheaply. `PostStrokeRule` (`types.ts`) gets the full `GridState` with no command context — it must scan for structural violations globally. Both are pure (no mutation). `ValidationError` (`types.ts`) carries a `ruleId`, i18n `message` key, evidence `cells`, and `severity: 'error' | 'warning'` (only `'error'` triggers rejection; `'warning'` is defined but not acted on by `CommandExecutor`). **`cells` is the evidence contract**: the cells that *cause* the violation — complete (every offender, e.g. every non-flat cell in the `flat` trait's extended sweep, or the intersection region of an overlap), never a bare click anchor; non-spatial rules (max-count, chunk load, locked object) report the whole footprint involved. The optional `grid: 'macro' | 'micro'` says which grid the evidence renders on ('micro' = the terrain micro-grid, −HALF_TILE); when absent, the renderer falls back to the command-type default. The error flash (`OverlayLayer.flashErrors` via the pure `canvas/map2d/layers/error-flash.ts:resolveErrorFlashCells`) lights exactly these cells, per-error grid, deduped across rules — and the agent bridge's `formatErrors` echoes the same coordinates to the LLM.

---

### Layer Utilities

`layer-utils.ts` provides two exports:

**`getActiveLayers(state, activeLayer)`** scans all cells and objects to produce a `LayerInfo[]` for the layer panel UI. The cell counting is cumulative: a cell at elevation 3 increments buckets 1, 2, and 3 (`layer-utils.ts`). Objects contribute to their single `elevation` bucket. The function always ensures layers 0, 1, and `activeLayer` appear even if their count is 0 (`layer-utils.ts`), guaranteeing the UI always shows at least the ground and first layer. Layers with zero cells (and not forced) are omitted.

`layer-utils` contains no rule logic: V-MTN-03 (3×3 base support) lives in exactly one place, `rules/base-support.ts`. The renderer's buildable-region overlay is driven by `__petitShowPreview(cells)` with externally supplied cells (generation preview), not by a predictor here.

---

### Game Constants

`constants.ts` holds the actively used spatial constants: `CHUNK_SIZE = 16` (chunk key math in `grid-model.ts`), `CHUNK_LOAD_LIMIT = 10_000` (referenced in the chunk-load rule's violation helper), `CHUNK_LOAD_ENABLED = false` (gates chunk-load enforcement — see the chunk-load section below), `ELEVATION_MAX = 8` (range rules and layer utils; the floor is 0, the clear-terrain sentinel, and needs no constant), `TILE_SIZE = 64`, `ZOOM_MIN`/`ZOOM_MAX` and `PAN_KEEP_PX` (renderer), `PLAZA_ID` (the reserved id of the locked central plaza), and `ELEVATION_COLORS`/`ZONE_COLORS`/`WATER_COLOR` (renderer). Per-item numeric parameters (e.g. exclusion radii) are not constants here — they live in the catalog as trait parameters (`exclusionRadius.radius`).

---

### Composition with Neighbouring Subsystems

- **Rules** import `PreCommandRule`, `PostStrokeRule`, `Command`, `CommandType`, `GridState`, `ValidationError`, `PlacementTrait` — all from `types.ts`. The type system enforces the purity contract: rules receive only read-only-by-convention values and return `ValidationError[]`.
- **CommandExecutor** (`command-executor.ts`) owns `GridState` and applies mutations; it uses `CellSnapshot` for undo/redo and emits typed `EditorEvents`. The `EventBus<EditorEvents>` is parameterized by the `EditorEvents` map from `types.ts`, giving compile-time guarantees that event payloads match listener signatures.
- **Renderer** subscribes to `cells-changed` and `objects-changed`; it reads `MacroCell.terrain.corners` to determine trim shape, `PlacedObject.elevation` for layer visibility, and `ELEVATION_COLORS`/`ZONE_COLORS` from constants.
- **IO** (`json-codec.ts`) serializes/deserializes `GridState`.
- **`ChunkTracker`** (`chunk-tracker.ts`) is used by the chunk-load rule (`rules/chunk-load.ts`) and the programmatic API to compute current chunk loads on-the-fly from `state.objects`. Chunk load is never stored on state and no command carries a delta for it: every consumer builds an ephemeral tracker, so there is no accounting map that can drift.

---

## Grid Model, Event Bus & Chunk Tracking

### Responsibility

This subsystem defines the editor's spatial data model, the decoupled notification channel between state mutators and the renderer, and the accounting types for per-chunk object-load budgets. It is the foundation every other subsystem builds on: rules read `GridState`, commands mutate it via `grid-model.ts` helpers, the renderer reacts to `EventBus` notifications, and chunk-load enforcement lives in the pre-command rule (see `ChunkTracker` below).

---

### Grid Model (`src/core/model/grid-model.ts`)

The grid is a **row-major 2-D array** of `MacroCell` (`types.ts:MacroCell`), indexed as `cells[y][x]`. Each `MacroCell` holds exactly two fields: a `CellZone` (static, set at template load and never mutated) and an optional `TerrainCell | null`. Null terrain means "bare ground at layer 0" — there is no stored layer-0 entry (Layer 0 = Ground, implicit).

**Grid lifecycle:**

`createGrid` (`grid-model.ts`) is the only constructor. It iterates the `MapTemplate` zone table and produces a fresh cell array. Plaza cells (`CellZone.Plaza`) are the sole exception to the null-terrain default: their `TerrainCell` is pre-populated by `createDefaultTerrainCell` using `plaza.terrainType ?? TerrainType.Mountain` at `plaza.elevation` (`grid-model.ts`). All other cells, including `Beach`, `Boundary`, and `Grass`, start with `terrain: null`.

**Access:**

`getCell` (`grid-model.ts`) returns `null` for any out-of-bounds index; it never throws. This is the universal safe-read contract used everywhere (rules, tools, renderers). `setCell` (`grid-model.ts`) has a symmetric no-op contract for out-of-bounds writes. Together they form a boundary layer so callers never guard indices themselves.

**Mutation:**

The grid is intentionally mutable. `applyCommand` directly sets `cell.terrain` or calls `setCell` (`command-apply.ts`). The undo/redo mechanism relies on `cloneCell` (`grid-model.ts`) to capture deep snapshots before and after each command. `cloneCell` copies `zone`, `terrain.type`, `terrain.elevation`, and the optional `corners` (as a fresh array copy), `patchOnly` and `patchBase` fields (`grid-model.ts`). Terrain `TrimCorners` undo/redo therefore faithfully restores corner geometry.

**Coordinate duality (macro vs. micro):**

The editor has two overlapping grids. The macro-grid is the placement unit (1 tile = `TILE_SIZE = 64 px`). The micro-grid subdivides each macro tile into a 2×2 sub-grid (0.5 tile = 32 px = `HALF_TILE`). Terrain blocks render at pixel position `x * TILE_SIZE - HALF_TILE` (a −32 px offset), centering each block on the intersection of four macro cells. Objects render at `x * TILE_SIZE` with no offset.

`macroToMicro` (`grid-model.ts`) converts by doubling: `(x, y) → (x*2, y*2)`. Bridge geometry is the main consumer of the micro grid, and it lives in `core/model/bridge-span.ts:detectBridgeSpan` — shared by the `waterSpan` trait rule and the placement ghost, so validation and preview cannot disagree about where a bridge lands.

The practical consequence of the −`HALF_TILE` terrain offset is captured in the "Flat trait" rule: placement flatness checks extend one extra column and row right/bottom to account for the fact that a macro cell's terrain block bleeds into the adjacent macro-grid region (`grid-model.ts` header comment) — this is what prevents micro-block floating at cliff edges due to the macro/micro grid offset difference.

**The plaza:**

The plaza is not a special case in the geometry any more — `createPlazaObject` (`grid-model.ts`) builds it as an ordinary `PlacedObject` carrying `locked: true`, and the object-collision rules (V-PLACE-BLOCK, V-PLACE-OVERLAP) are what keep terrain and placements off it. V-LOCK-02 refuses modifying it by name. What remains here is the rect math those rules share: `cellOverlapsRect(rect, x, y, cellShift)` asks whether a macro cell's *area* overlaps a rect rather than whether a corner is inside, so any cell the edge cuts through counts. `cellShift` is the cell's lower-bound offset — terrain renders on the micro-grid (`−HALF_TILE`) so its cell spans `[x−0.5, x+0.5]`, while objects render unshifted and span `[x, x+1]`.

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
| `tool-changed` | `{ tool: ToolType }` | `store.setActiveTool` | (subscribed by tools, not visible in grep — used by ToolManager) |
| `history-changed` | `{ canUndo, canRedo }` | `CommandExecutor` after every execute/undo/redo | `HistoryControls.tsx` button enable/disable |

**Decoupling contract:** `CommandExecutor` emits `cells-changed` after every successful state mutation. The renderer reacts by redrawing only the listed cells (`terrain-layer.ts:redrawCells`). This means the renderer is entirely driven by events and holds no authoritative state — it is a pure projection of the `GridState` via the bus.

For road `TrimCornersCommand`, `applyCommand` emits `objects-changed { removed }` followed immediately by `objects-changed { added }` on the same object (two separate `emit` calls). This causes the object layer to perform a remove-then-add cycle rather than an in-place update — a known rendering trade-off to force a sprite refresh.

---

### ChunkTracker (`src/core/model/chunk-tracker.ts`)

`ChunkTracker` maintains a `Map<string, number>` of chunk-key → accumulated load value. A chunk key is produced by `chunkKey` (`grid-model.ts`): `"cx,cy"` with `cx = Math.floor(x / CHUNK_SIZE)`.

**How objects span multiple chunks:**

`affectedChunks` (`chunk-tracker.ts`) iterates every `(dx, dy)` offset within the object's `w × h` footprint and collects the distinct chunk keys. For a 2×2 object placed at macro (15, 15), all four cells (15,15), (16,15), (15,16), (16,16) fall in different chunks (chunk 0 and chunk 1 on each axis), so the object contributes its `loadValue` to all four chunk buckets. This is a per-chunk-cell-coverage model, not a per-object-anchor model.

**Current role — live computation in the rule:** The chunk-load pre-command rule (`rules/chunk-load.ts:chunkLoadViolations`) builds a fresh `ChunkTracker` from `state.objects` on every invocation, populating it by iterating all placed objects and calling `tracker.addObject` for each. It then checks whether adding the candidate's full footprint would exceed `CHUNK_LOAD_LIMIT` on any chunk. This approach is stateless: the tracker is ephemeral and the load figure is always consistent with the current `state.objects`, with no separate accounting map to drift.

**`CHUNK_LOAD_ENABLED` gate:** The rule is currently gated off (`constants.ts:CHUNK_LOAD_ENABLED = false`) because the real in-game load values are unknown. When the flag is `false`, `chunkLoadRule.validate` immediately returns `[]` and every placement is free. Flipping the flag to `true` and setting real `loadValue` entries in the catalog enables enforcement with no further plumbing.

---

### Composition with Neighbouring Subsystems

- **CommandExecutor** is the exclusive writer to both `GridState.cells` and `GridState.objects`. After every write it emits the appropriate `EventBus` event. Rules are read-only consumers of `GridState`.
- **RuleRegistry** reads `GridState` for validation but never mutates it. V-CHUNK-01 computes chunk load from `state.objects`.
- **MapRenderer** subscribes to `cells-changed` and `objects-changed` at construction time; it never polls state.
- **Zustand store** owns the `EventBus` singleton and passes it to both `CommandExecutor` and `MapRenderer`, keeping them in sync without direct coupling.
- **JSON codec** reconstructs a `GridState` from disk; chunk load is not persisted (it is derived from the objects).
- **Tools** construct commands carrying only what the executor and the rules read; chunk load is derived, never passed along.

---

## Command Executor & Two-Phase Validation

### Responsibility

`command-executor.ts:CommandExecutor` is the sole mutator of `GridState`. Every change to the map — painting terrain, placing/removing objects, trimming corners — flows through its `execute()` method. It owns the undo/redo stacks and enforces correctness through a two-phase validation model: a pre-command gate that can reject individual operations, and a post-stroke sweep that auto-reverts whole sequences that leave the grid in an illegal state.

### Key Types and Data Structures

- `HistoryEntry` (`command-executor.ts`): the private unit of undo history. Holds the original `Command`, plus `before` and `after` arrays of `CellSnapshot` (coord + deep-copied `MacroCell`) captured by the executor around the mutation. The `HistoryEntry` is the sole authoritative history record — `CommandBase` carries only `timestamp`; undo/redo snapshots live exclusively on `HistoryEntry`.
- `CellSnapshot` (`types.ts`): a `{ coord: MacroCoord, cell: MacroCell }` pair, produced by `command-executor.ts:snapshot()` via `grid-model.ts:cloneCell()`.
- `RuleRegistry` (`rules/registry.ts`): a dual-list dispatcher. Pre-command rules are filtered by `rule.appliesTo` before invocation; post-stroke rules always run against the full state. All applicable rules execute to completion — errors accumulate rather than short-circuit.
- `EditorEvents` (`types.ts`): the typed event bus schema. The executor emits `cells-changed`, `objects-changed`, `validation-failed`, and `history-changed`.

### Phase 1 — Pre-Command Validation (`execute`)

`execute()` (`command-executor.ts`) runs the full sequence:

1. `registry.validatePreCommand(cmd, state)` fans out to all registered pre-command rules whose `appliesTo` includes `cmd.type`. Registered pre-command rules (in priority order, `rules/index.ts`): `layerLockRule`, `lockedObjectRule`, `elevationRangeRule`, `mountainFloatingRule`, `waterFloatingRule`, `objectBlocksTerrainRule`, `traitPlacementRule`, `zoneRestrictionRule`, `placementOverlapRule`, `placementMaxCountRule`, `chunkLoadRule`.
2. If any error is returned, `validation-failed` is emitted (picked up by `Toast.tsx` for display) and `ValidationResult { success: false }` is returned with state unchanged.
3. If clean: `getAffectedCells(cmd)` determines which macro-coordinates will be touched (one coord per object position for `PlaceObject`/`RemoveObject`, the full cell list for terrain commands, `{x, y}` for `TrimCorners`). Snapshots are taken **before** and **after** mutation. The `HistoryEntry` is pushed to the undo stack and the redo stack is cleared.
4. `cells-changed` and `history-changed` are emitted unconditionally on success.

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

`commitStroke(strokeStartSize)` (`command-executor.ts`) is called by tools at pointer-up. `strokeStartSize` is the undo stack depth at the moment the stroke began (retrieved via `getUndoStackSize()`); this bounds how far back the auto-revert can reach.

1. `registry.validatePostStroke(state)` runs all post-stroke rules (registered: `baseSupportRule`, `waterContainmentRule`, `waterfallAdjacentUniformityRule`, `objectOnCoatingRule`). These are stateful grid scans, not command-gated.
2. If violations exist, the executor enters a revert loop: it pops entries off the undo stack (up to `maxUndos = undoStack.length - strokeStartSize`), calls the private `revertEntry(entry)` helper for each (which restores `entry.before` cell snapshots via `setCell + cloneCell` **and** undoes the command's object-layer effect — `PlaceObject` deletes the object, `RemoveObject` re-adds it, road `TrimCorners` restores corners and rotation), and pushes the entry to the redo stack. After each undo, it re-runs `validatePostStroke`. The loop exits as soon as the state is clean or the entire stroke has been reverted. A single `cells-changed` + `history-changed` pair is emitted after all reverts are batched.
3. Regardless of whether reverts happened, `commitStroke` then computes the set of cells actually changed by the surviving stroke history (entries from `strokeStartSize` to the current top), and calls `cut-reconcile.ts:reconcileCuts`. That function expands the changed region to its 8-neighbourhood and issues repair `TrimCorners` commands back through `execute()` to square any stale edge cuts and patch-only terrain pieces. These repair commands join the undo stack as first-class entries, extending the stroke's history.
4. `commitStroke` returns the **initial** violation list (before any revert) — callers use this to show a toast message.

The undo-grouping model is implicit: all commands executed between two `commitStroke` calls form a logical stroke. Post-stroke validation drives which commands survive as a group; partial reversal is possible (earliest commands within a stroke can survive if they satisfy rules without the later ones).

### Undo Semantics

`undo()` (`command-executor.ts`) pops entries one at a time, calling the private `revertEntry(entry)` helper for each, and re-runs `validatePostStroke` after each pop. It keeps undoing until the state is clean or the stack is empty. This means a single user undo can revert multiple `HistoryEntry` items, skipping through any intermediate state that would itself be illegal. The redo stack receives all popped entries in order.

`redo()` (`command-executor.ts`) pops one entry, calls the private `reapplyEntry(entry)` helper (which restores `entry.after` cell snapshots and re-applies the command's object-layer effect — the exact inverse of `revertEntry`), and pushes it back to the undo stack. Redo does not validate — it trusts that the after-state was valid when it was originally executed.

**`revertEntry` / `reapplyEntry`:** These two private helpers (`command-executor.ts`, `228`) are the shared implementation for undo, redo, and `commitStroke`'s revert loop. Both restore the relevant cell snapshots (`before` for revert, `after` for reapply) **and** handle the command's object-layer effect: `PlaceObject` ↔ delete/add on `state.objects`, `RemoveObject` ↔ add/delete, road `TrimCorners` ↔ restore corners + `beforeRotation`/`afterRotation`. Each call emits the corresponding `objects-changed` event. One edge case: a road deleted by an all-`'empty'` `TrimCorners` is not re-created on undo, because the command does not store the full `PlacedObject` — this situation is not reachable from current authoring tools.

**`commitStrokeGroup`** (`command-executor.ts`): like `commitStroke` but also collapses all the stroke's history entries into a single undo entry after the stroke is committed. The collapse merges the earliest `before` and latest `after` snapshot per cell, **and** the net object add/removes across the group (`HistoryEntry.objectOps`), so a batch that mixes terrain edits with object placement/removal — e.g. terrain generation, or the Generate-panel Clear that wipes tiles + placements — undoes/redoes as one step. (Road *corner* edits aren't captured by `objectOps`, so don't group those.) Terrain-only batches get an empty `objectOps` and behave exactly as before.

### Cut-Reconcile Hook

`reconcileCuts` (`cut-reconcile.ts`) satisfies the `CutReconcileTarget` interface, which requires only `execute(cmd)`. This narrow interface lets `cut-reconcile.ts` be tested independently and keeps it decoupled from full executor semantics. Repair commands are plain `TrimCorners` commands, meaning they go through pre-command validation and produce their own `HistoryEntry` items. Undo fidelity is now complete: `cloneCell` copies corner data, and road rotation changes travel on the command's `beforeRotation`/`afterRotation` fields and are restored by `revertEntry`.

### Event Emission Summary

| Situation | Events Emitted |
|---|---|
| `execute` succeeds (terrain/erase) | `cells-changed`, `history-changed` |
| `execute` succeeds (PlaceObject) | `objects-changed {added}` (from applyCommand) + `cells-changed` + `history-changed` |
| `execute` succeeds (RemoveObject) | `objects-changed {removed}` (from applyCommand) + `cells-changed` + `history-changed` |
| `execute` succeeds (TrimCorners terrain) | `cells-changed` + `history-changed` |
| `execute` succeeds (TrimCorners road) | `objects-changed {removed}` + `objects-changed {added}` (from applyCommand) + `cells-changed` + `history-changed` |
| `execute` fails | `validation-failed` only |
| `undo` | `objects-changed` (if PlaceObject/RemoveObject/road TrimCorners) + `cells-changed` + `history-changed` |
| `redo` | `objects-changed` (if PlaceObject/RemoveObject/road TrimCorners) + `cells-changed` + `history-changed` |
| `commitStroke` with reverts | `objects-changed` (for any object commands reverted) + `cells-changed` + `history-changed` |

### Invariants

- After a successful `execute()`, `undoStack` has one more entry and `redoStack` is empty.
- After `commitStroke()`, `validatePostStroke(state)` returns `[]` (assuming rules are monotone with respect to reversal).
- State is only mutated during `execute()` / `undo()` / `redo()` / `commitStroke()` — never by rules or the event bus.
- The executor holds a reference to the same `GridState` instance that the store, renderer, and rules all share; mutations are immediately visible to all readers.

---

## Rule Registry & Pre-Command Rules

### Responsibility

The rule system is the editor's contract enforcement layer. Its sole job is to answer two questions at two different points in the editing lifecycle: (1) "Is this individual command legal to apply right now?" (pre-command), and (2) "Is the overall grid state legal after the user finishes a stroke?" (post-stroke). This document focuses on the pre-command half and the registry that hosts both phases.

### RuleRegistry

`registry.ts:RuleRegistry` is a simple dispatcher. It holds two typed arrays — `preCommandRules: PreCommandRule[]` and `postStrokeRules: PostStrokeRule[]` — and exposes three methods:

- `register(rule: AnyRule)` — appends to the correct array based on `rule.phase`.
- `validatePreCommand(cmd, state)` — iterates `preCommandRules`, skips any whose `appliesTo` array does not contain `cmd.type`, and accumulates errors from the rest. All applicable rules always run; there is no short-circuit on first error.
- `validatePostStroke(state)` — iterates `postStrokeRules` unconditionally (post-stroke rules have no `appliesTo` filter) and accumulates errors.

The `appliesTo` field is a `CommandType[]` on `PreCommandRule` (`types.ts:PreCommandRule`). This means the dispatch cost is O(R × |appliesTo|) per call, where R is the number of registered rules. With the current 11 pre-command rules and command sets of 2–4 types this is negligible, but the filtering is a linear scan rather than an indexed lookup.

### createDefaultRegistry

`index.ts:createDefaultRegistry` is the sole assembly point. It walks one `ALL_RULES` array — 15 rules, 11 pre-command then 4 post-stroke — and registers each into the phase list its own `phase` field names. The pre-command order is:

1. `layerLockRule` (V-LOCK-01) — first, so a locked-layer error takes priority over zone or elevation errors on the same cell.
2. `lockedObjectRule` (V-LOCK-02)
3. `elevationRangeRule` (V-MTN-01)
4. `mountainFloatingRule` (V-MTN-02)
5. `waterFloatingRule` (V-WTR-01)
6. `objectBlocksTerrainRule` (V-PLACE-BLOCK)
7. `traitPlacementRule` (V-PLACE-TRAIT)
8. `zoneRestrictionRule` (V-ZONE-01)
9. `placementOverlapRule` (V-PLACE-OVERLAP)
10. `placementMaxCountRule`
11. `chunkLoadRule` (V-CHUNK-01)

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
- `lockedLayers: Set<number>` — layers 1–8 that the user has locked.
- `template: MapTemplate` — static map geometry including `plaza: PlazaConfig`.

Rules read this state purely; the only exception is the `waterSpan` and `heightDrop` trait handlers in `placement.ts`, which mutate `cmd.object.rotation`, `cmd.object.position`, and `cmd.object.spanLength` as a side effect of successful validation (described below).

### Pre-command rules in detail

**V-LOCK-01 (`layer-lock.ts`)** — Applies to `PaintTerrain` and `EraseTerrain`. Fast-paths on an empty `lockedLayers`. For `PaintTerrain`, it first checks whether the *target* elevation is locked (blocking entire command immediately), then checks existing terrain at each cell. For `EraseTerrain` it only checks existing terrain. The helper `isOccupyingLockedLayer` walks layers 1..cell.terrain.elevation for each cell. This reflects the cumulative-layer model: a cell at elevation 3 occupies layers 1, 2, and 3, so locking any of those blocks the cell.

**V-ZONE-01 (`zone-restriction.ts`)** — Rejects any edit on a non-Grass zone (`isBuildableZone`). For `PlaceObject` it walks the rotated footprint from `getPlacedObjectSize`; for terrain edits it walks the command's own cells. Out-of-bounds differs by command on purpose: an object may not hang over the void, so a null cell is an error there, while a terrain edit off-map is simply skipped. It does NOT apply to `RemoveObject` — removal must always succeed, or an object that somehow reached a non-grass cell could never be cleared. The plaza needs no clause of its own here: it is a locked object, and the object rules cover it. One error per invalid cell.

**V-MTN-01 (`elevation-range.ts`)** — Applies to `PaintTerrain`. Guards only `TerrainType.Mountain` commands. Returns a single error for the whole command (not per-cell) if `cmd.elevation` is outside `[0, ELEVATION_MAX]` (currently 0–8, per `constants.ts:ELEVATION_MAX`). Elevation 0 is valid because it is the clear-terrain sentinel in `applyCommand()`.

**V-MTN-02 / V-WTR-01 (`floating-block.ts`)** — Both rules share `validateNoFloating`. Applies to `PaintTerrain`. Skips elevations ≤ 1 (layer 1 is always supported by the implicit ground). For each cell in `cmd.cells`, reads existing terrain and rejects if `cell.terrain.elevation < cmd.elevation - 1` (or if no terrain at all). Water counts as valid support for floating purposes; the rule checks only structural adjacency, not terrain type. Two distinct rule instances (`mountainFloatingRule`, `waterFloatingRule`) are registered separately and both appear in `appliesTo: [CommandType.PaintTerrain]`.

**V-PLACE-BLOCK (`object-blocks-terrain.ts`)** — Applies to `PaintTerrain` and `EraseTerrain`. For each edited cell it asks `object-index`'s `entriesNear` what is there rather than scanning `state.objects`: a stroke issues one command per cell, so a scan here would cost cells × objects. Each blocker is reported once, with its whole footprint as the error's evidence cells. Footprints come from `getPlacedObjectSize`, which accounts for rotation and bridge `spanLength`.

**V-PLACE-OVERLAP (`placement-overlap.ts`)** — Applies to `PlaceObject`. Checks the incoming footprint against the objects already there, and returns on the first conflict. It sees the **snapped** footprint: `traitPlacementRule` runs before it, so a bridge or ramp that auto-oriented during trait validation is judged where it will actually land. A `surfaceCoating` (road) is exempt — a road is coated OVER, not collided with, and the placer strips the overlapped coatings itself.

**V-PLACE-TRAIT (`placement.ts:traitPlacementRule`)** — The richest pre-command rule. Applies to `PlaceObject`. Dispatches to `validateTrait` for each trait in `item.traits`. Traits are processed sequentially and errors are accumulated.

The trait dispatch (`placement.ts:validateTrait`) covers seven trait types:

- `flat` — Iterates `dx` 0..w and `dy` 0..h (i.e., `(w+1) × (h+1)` cells, expanding the nominal footprint by one column right and one row down). Rejects if any cell has water or a different elevation from the footprint's first cell. This +1 extension compensates for the macro/micro grid offset where micro-blocks sit at `x * TILE_SIZE - HALF_TILE`, causing the rightmost/bottom column of a multi-cell object's visual footprint to overlap the next macro column.

- `noFloat` — Checks every cell in the standard footprint has non-null terrain. Any missing terrain (grass at ground level) causes rejection.

- `waterSpan` — The most complex trait. Handles bridge placement, delegating the geometry to `detectBridgeSpan` (`core/model/bridge-span.ts`), which is shared with the placement ghost so preview and validation can't drift. A bridge spans any *below-deck* gap — water, off-map void, OR lower terrain. Using an "effective level" (water/off-map read as below everything), it scans both orientations out from the clicked gap cell to the two raised, **flat, equal-height** ends, validates the full-width gap (below deck) + flat ends, and checks the gap length against `trait.min..max` (3–6, unchanged). On success it **mutates** `cmd.object.rotation`, `cmd.object.position` (snapped to the near end), `cmd.object.spanLength`, and `cmd.object.elevation` (the deck height). This mutation is the only case where a pre-command rule modifies the incoming command; it auto-snaps the bridge rather than require precise placement. If no orientation satisfies the constraints, returns `error.bridge_invalid`.

- `heightDrop` — The ramp placement handler. Scans all four cardinal neighbors for an elevation difference exactly equal to `trait.layers`. For each valid neighbor it determines rotation (0/90/180/270 based on slope direction), computes a footprint that spans from the high side, then validates at micro-block resolution that all cells have the expected elevation. Also validates that the high-side terrain provides full-width support. On success **mutates** `cmd.object.rotation`, `cmd.object.position`, and `cmd.object.elevation`. Returns `error.ramp_wrong_height` if no valid neighbor found.

- `surfaceCoating` — Checks every cell in the footprint has non-null, non-water terrain. Roads must be placed on land. Simple rejection with `error.road_needs_terrain`.

- `exclusionRadius` — Rejects when another object of the same catalog category sits within `trait.radius` on both axes (a Chebyshev check), with `error.tree_too_close`.

- `terrainBase` — Not a placement check but a declaration: this object's footprint counts as solid structural support at its own elevation, so terrain may use it as the 3×3 base V-MTN-03 asks for. The central plaza is the only item carrying it today.

**V-CHUNK-01 (`chunk-load.ts`)** — Applies to `PlaceObject`. Gated behind `CHUNK_LOAD_ENABLED = false` (`constants.ts`) — currently returns `[]` unconditionally (placement is free because real in-game load values are unknown). When enabled, the exported `chunkLoadViolations` helper builds a fresh `ChunkTracker` from `state.objects` (using catalog `loadValue` per object), checks the candidate's **full footprint** across all affected chunks against `CHUNK_LOAD_LIMIT` (10,000 — exactly the limit is permitted), and returns an error if any chunk would overflow. The enforcement is unit-tested via the exported helper; flip `CHUNK_LOAD_ENABLED` and set real catalog `loadValue` entries to activate it.

### Composition with neighbouring subsystems

The registry is the seam between tools (which produce commands) and the executor (which applies them). Tools construct commands and call `executor.execute()`; the executor populates `HistoryEntry.before`/`after` from cell snapshots — commands carry no snapshot data. The executor never consults rules independently of the registry. The registry itself has no knowledge of tools, rendering, or state storage.

The `waterSpan` and `heightDrop` traits deliberately blur the pure-validator boundary: they mutate `cmd.object` during validation, effectively acting as command transformers. The executor applies the mutated command after `validatePreCommand` returns, so the final placed object carries the auto-snapped position/rotation/spanLength without any separate transformation step.

`object-blocks-terrain.ts` and `placement-overlap.ts` both import the span-aware footprint geometry (`getPlacedObjectSize` / `objectRect`) from `state/object-geometry.ts` — a clean *downward* dependency (`rules/` → `state/`). It sits in `state/` (it only needs the catalog) so the rules, the tools, and both editing views under `canvas/` all import it downward instead of reaching up into a tool.

---

## Post-Stroke Rules & Waterfall Detection

### Responsibility and Position in the Pipeline

Post-stroke rules are the second validation phase in the two-phase rule system. Unlike pre-command rules (which gate individual `Command` objects before they mutate state), post-stroke rules receive no command context at all — they are passed only the full `GridState` and are expected to scan it for structural invariant violations. The four post-stroke rules are:

- **`base-support.ts`** — rule `V-MTN-03`, checks 3x3 structural base requirements for high mountains
- **`water-containment.ts`** — rule `V-WTR-02`, checks that every water cell's open faces are perpendicularly capped by mountains
- **`waterfall-uniformity.ts`** — rule `V-WTR-03`, checks that the row immediately downstream of every capped waterfall face has uniform elevation
- **`object-on-coating.ts`** — rule `V-PLACE-COATED`, checks that nothing stands on a road. It is post-stroke by necessity: the overlap rule exempts coatings so the placement ghost stays green over a road the click will strip, so only the finished stroke can tell "coated over" from "left standing on" (bridges and ramps are exempt — a crossing deck is paved across on purpose)

The canonical waterfall geometry primitives both water rules share live in **`core/model/waterfall-geometry.ts`** (pure geometry over the grid — not a rule). It belongs on the primitives floor rather than in `rules/` because the edge-cut kernel (`core/edge-cut/trim-lock`) needs it too, and a copy in `rules/` would force a `core/` → `rules/` upward import. From `core/model`, every importer — the two water rules, the edge-cut kernel, the 2D terrain layer and the 3D scene — depends on it downward.

The design motivation for post-stroke (vs. per-command) validation is that these invariants are fundamentally relational: whether a water cell is properly capped depends on what its neighbours are, and a single brush stroke may legally remove a capping mountain only if the water cell is simultaneously removed in the same stroke. Evaluating these constraints per-command (one `PaintTerrain` at a time) would reject intermediate states that are legal in aggregate. Post-stroke validation defers judgement until the user lifts the mouse.

### Integration with CommandExecutor

The entry point is `command-executor.ts:commitStroke`. Tools call `ctx.commitStroke(this.strokeStartUndoSize)` when a brush stroke ends — the argument is the undo-stack size recorded at `pointerdown` time. `commitStroke` delegates to `registry.ts:validatePostStroke`, which iterates all registered `PostStrokeRule` instances in registration order (base-support → water-containment → waterfall-adjacent-uniformity → object-on-coating, as declared in `index.ts`'s `ALL_RULES`).

If `validatePostStroke` returns violations, `commitStroke` auto-reverts: it pops entries from the undo stack one at a time (up to `maxUndos = undoStack.length - strokeStartSize`), restoring the `before` snapshot for each command, and re-runs `validatePostStroke` after every pop. It stops as soon as the state is clean or the entire stroke has been unwound (`command-executor.ts`). The initial violation list (from the first check, before any undo) is what `commitStroke` returns to the tool; the tool is responsible for showing a toast. This asymmetry — `validation-failed` event for pre-command failures, direct return value for post-stroke — is a deliberate design choice.

After any auto-revert (and after recording the final clean set of commands), `commitStroke` calls `reconcileCuts` to repair edge-cut corners invalidated by the stroke. The post-stroke rules run before `reconcileCuts`, so the geometry the cuts are reconciled against is already in the clean, rule-satisfying state.

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

`has3x3Base` needs SOME elevation `E` in `[max(1, targetElev - 3), targetElev - 1]` at which the full centered 3×3 is solid. Per-cell support ("surface/base reaches `>= E`") is monotone decreasing in `E`, so such an `E` exists iff the LOWEST candidate works — the implementation makes ONE pass over the 9 cells at `E = max(1, targetElev - 3)`: each cell must exist and have either a non-water Mountain surface with `surfaceElevation >= E`, or a covering `terrainBase` footprint with `elevation >= E`. The base is strictly BELOW the cell by construction — only elevations `< targetElev` are candidates.

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

This subsystem owns the geometry of edge-cut corners — both the rules about which corner shapes are legal in a given context, and the repair pass that keeps existing cuts consistent after the grid changes under them. It spans five files: `terrain-silhouette.ts` (the layer-occupancy kernel every other module sits on), `cut-validator.ts` (edge-coverage geometry + cut legality), `trim-lock.ts` (which corners are frozen by neighbourhood), `road-cut-states.ts` (canonical road-cut states + rotation/connection helpers), and `cut-reconcile.ts` (the driven-to-fixpoint repair pass). The subsystem plugs into `command-executor.ts:commitStroke` as the last step before the stroke is finished.

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
- **Road**: the neighbour just needs to have any `surfaceCoating` object (`hasRoadAt`, `cut-validator.ts`).

After edge connectivity, a road-specific structural check follows (`cut-validator.ts`): if a road cell connects to two or more neighbours, the candidate corners must be all-`square` when the connections are opposite (N+S or E+W) or when there are 3+ connections. For exactly two adjacent (L-shaped) connections, fans at any corner that is adjacent to a connected side are forbidden — only triangles or `square` are acceptable there.

### The Layer-Silhouette Kernel (`terrain-silhouette.ts`)

A cell at elevation N is a vertical **stack** of layers, so every trim question is really a question about the silhouette of solid terrain at a specific layer e. The kernel provides exactly that and nothing else:

- `terrainSolidAt(cell, type, e)` — does the cell hold solid mass of `type` at layer e? Mountain at N fills layers 1..N; water at N fills 0..N (a lake sits at ground level; a waterfall is a column). Γ patches are fillets, not mass — never solid.
- `CORNER_NEIGHBORS` — the single source for corner adjacency: corner i of a cell is met by its two edge-sharing neighbours plus the diagonal.
- `cornerWrappedAt(state, x, y, i, type, e)` — does the layer-e silhouette **wrap** corner i (all three meeting cells solid)? This is the Γ-notch test; a taller neighbour's lower layers count, because its stack reaches layer e too.
- `highestNeighborTerrain(state, x, y)` — the tallest orthogonally-adjacent real terrain; the reference tier a Γ corner is rounded toward.

Everything in the kernel is geometry, governed by ONE generic rule (no per-type special cases): a corner is a FREE convex corner unless a same-type **EDGE** neighbour covers it, and a cut reveals the lower surface behind it. The CONVEX test uses only the two EDGE neighbours (`EDGE_NEIGHBORS`) — a diagonal touches at a single point and never pins, so a diagonal pinch is cuttable; the CONCAVE Γ-wrap test (notch-fill) uses all three (`cornerWrappedAt`). The genuine **design policies** on top, named:

- **ISLAND-ROUNDS-REVEALING-WATER** (the generic figure rule) — any island in water rounds its convex corner and reveals the water, regardless of elevation or type: a mountain@E rock (real corners, a cut with no lower step reveals its edge water) OR a ground@0 island (`groundConvexCornerInWater`; materialised as a `type: None` cell with corners — reads as ground via `realSurface`, renders grass kept-shape + water backing). There is **no** "mountain never cuts toward water" lock; the renderer backs a cut water corner with its mountain rim and a cut mountain corner with its lake, symmetrically (`cornerRevealTier` is EDGE-only and layer-gated: water@e reveals a mountain solid at layer e; a river@0 reveals its ground bank).
- **WATERFALL-LIP** (elevated water never cuts toward a DROP — open ground/void OR lower terrain), **CYCLE-OFF-KEEPS-BASE** (removing a fillet restores the N-1 base block, never nulls the cell), **AUTO-TRIM-IS-COSMETIC** (auto-trim only trims corners + fills EMPTY Γ notches; raising a real block is a manual action — but cuttability is ELEVATION-INDEPENDENT, identical to the manual tool: a convex corner rounds at any height, and the renderer draws the lower step / surrounding ground behind it; there is no height gate in the automatic paths), **NO NOTCH FILLS BESIDE ELEVATED WATER** (`auto-edge-cut.ts:nearElevatedWater` skips Γ candidates within the 8-neighbourhood of water at elevation ≥ 1: both fill kinds change what RAW elevation reads see at the cell — `raiseToTier` adds real mass, a `patchOnly` trim stores the wrapping tier — and inside a waterfall's uniform downstream row that flips a legal fall illegal (V-WTR-03) and auto-reverts the whole stroke/generation), **WATERFALL-FRAME** (cap mountains keep their flow-side corners square).

Auto-trim symmetry between the layers: the post-stroke pass (`applyAutoEdgeCut`) sweeps the stroke **plus its 8-neighbour border** for BOTH terrain and roads (`withBorder` — a stroke can make a neighbour's corner newly convex, or a neighbour road newly an end-cap), and generated maps cut both alike — `edgeCutGeneratedTerrain` (called by `terrain-generator`) and `edgeCutGeneratedRoads` (called by `populate` after the road network is paved) share one seed-picked mode from `generation/style.ts:generationCutMode`, which is `'off'` below the naturalness cut threshold (cuts are the map's only true diagonals).
- **ATOMIC UNDO** — `commitStroke` folds the whole stroke AND its auto-reconcile (`reconcileCuts`) into ONE undo entry via `collapseHistory`, so undo reverts a change and its repair together and can never stop at a reconcile-orphaned (illegal) intermediate.

### Corner Locking (`trim-lock.ts:computeLockedCorners`)

`computeLockedCorners` answers: which corners of cell (x, y) **must** be `square` because the neighbourhood demands it?

**Terrain**: a corner is locked when it is *not a free corner of the terrain's silhouette at the cell's top layer* — i.e. when a same-type **EDGE** neighbour holds solid mass at that layer (`terrainSolidAt` over the two `EDGE_NEIGHBORS`; a diagonal-only touch does NOT lock — that is what makes a pinch cuttable). A same-type **taller** neighbour locks (its stack covers this layer); a same-type **lower** step does not (the bevel down to it is intended). On top of the geometry, three things lock extra corners: **WATERFALL-LIP** (an elevated-water corner facing a drop), **WATERFALL-FRAME** (a cap mountain's flow side), and **MOUNTAIN BANK** — a MOUNTAIN meeting water on EXACTLY ONE edge of a corner is the water's bank there, so that corner is locked (cutting it would peel the mountain off the water, leaving the pond unbanked on the rendered map). A mountain fronted by water on BOTH of a corner's edges is an island/peninsula tip and still rounds (revealing the water); a ground island in water is unaffected (it rounds via `groundConvexCornerInWater`).

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

`detectRoadConn` (`road-cut-states.ts`) probes the four cardinal neighbours of a road object for another road object (excluding `patchOnly`) and returns the first direction it finds. If no real neighbour exists, it falls back to `ROTATION_TO_CONN[road.rotation]`. This fallback makes isolated roads self-consistent with their visual rotation.

`countRoadNeighbors` (`road-cut-states.ts`) performs the same scan but counts all four directions rather than returning early, used by `reconcileRoadAt` to detect the isolated case.

### Reconciliation Pass (`cut-reconcile.ts:reconcileCuts`)

`reconcileCuts` (`cut-reconcile.ts`) is the entry point called by `commitStroke` after the stroke's terrain/object changes have settled. It:

1. **Seeds the working region**: takes the set of changed `MacroCoord`s from the stroke and inflates it by one cell in every direction (8-neighbourhood) via `expandRegion` (`cut-reconcile.ts`), storing the result in a `Set<string>`.

2. **Iterates to fixpoint with cascading growth**: runs up to `MAX_RECONCILE_PASSES = 16` passes over the current region. Each pass visits every cell in the region and applies three orthogonal reconcilers. When a cell is repaired, its 8-neighbourhood is immediately folded into the region `Set`, so that cascading road repairs beyond the initial ring are picked up in subsequent passes. The loop exits early as soon as a pass makes no changes.

The three reconcilers:

- **`reconcileTerrainCell`** (`cut-reconcile.ts`): for real (non-patch) terrain cells with non-square corners, recomputes `computeLockedCorners` against the current state and rewrites any locked corner that is not already `square` to `square`. Issues a `TrimCornersCommand` via the target executor.

- **`reconcilePatchTerrain`** (`cut-reconcile.ts`): for `patchOnly` cells, calls `isInnerCorner` on the active non-`empty` corner. If the inner-corner context is broken, issues a `TrimCornersCommand` with all-`empty` afterCorners, which the executor converts to `cell.terrain = null`.

- **`reconcileRoadAt`** (`cut-reconcile.ts`): for roads with non-square corners, recomputes `detectRoadConn` + `canonicalToActual` and feeds the result to `validateCut`. If still valid, no action. If invalid, it attempts to find a **same-kind** canonical state that does validate by iterating `CANONICAL_ROAD_STATES[1..]` (skipping index 0). For isolated roads every canonical state is tried at all four rotations; for connected roads only the current connection direction is used. If a replacement is found, it issues a `TrimCornersCommand` with the replacement canonical corners, carrying `beforeRotation`/`afterRotation` on the command when a rotation change is needed (so that `revertEntry`/`reapplyEntry` can restore it faithfully — `road.rotation` is not mutated directly). If no same-kind replacement validates, the road is reset to all-`square`.

All repairs are issued through `target.execute(cmd)` where `target` is a `CutReconcileTarget` — a minimal interface (`cut-reconcile.ts`) satisfied by `CommandExecutor`. This means reconciliation repairs enter the undo stack as `TrimCornersCommand` entries within the same stroke, participating in history.

### Composition with `commitStroke`

`commitStroke` (`command-executor.ts`) proceeds in this order:

1. Run post-stroke rule validation. If violations exist, auto-revert the stroke's commands one by one until the state is clean.
2. Collect the set of macro coordinates affected by whichever stroke commands remain on the undo stack (i.e. after any auto-revert).
3. Call `reconcileCuts(changed, this.state, this)` if the set is non-empty.

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

**`Tool` interface** (`types.ts`) — five pointer callbacks (`onPointerDown`, `onPointerMove`, `onPointerUp`, `onActivate`, `onDeactivate`) plus an `id: ToolType`, a semantic `cursor: CursorId` (the canvas layer turns it into CSS — see `src/ui/cursors/`), and an optional `canActAt(coord, ctx)` pre-click validity probe. Every concrete tool is a stateful class that implements this interface. The interface is coordinate-aware: each callback receives a `MacroCoord` (integer, resolved at `TILE_SIZE` granularity) and a `MicroCoord` (half-cell, resolved at `HALF_TILE`), so tools that need sub-cell precision (edge-cut corner detection) have it available without further computation.

**`ToolContext`** (`types.ts`) — a plain object assembled and refreshed by `ToolManager` before each pointer dispatch. It bundles:
- `gridState` — read-only reference to the live `GridState` (cells, objects, lockedLayers).
- `viewport` / `overlay` — renderer handles for coordinate transforms and ghost graphics.
- `executeCommand` / `commitStroke` / `validateCommand` / `undo` / `getUndoStackSize` — thin forwarding closures to `CommandExecutor` and `RuleRegistry`.
- `terrainType`, `elevation`, `brushSize` — mutable tool parameters injected fresh on every call (see `refreshCtx` below).
- `t(key)` — i18n helper that reads the active locale from the Zustand store at call time.

The context is a single long-lived object whose mutable fields are updated by `refreshCtx()` before each dispatch rather than being re-constructed. This avoids allocation on every pointer event but means the same object reference is passed to all invocations — a tool must not cache `ctx` across frames.

### ToolManager: Registration and Dispatch

`ToolManager` (`tool-manager.ts`) holds a `Map<ToolType, Tool>` and an `activeTool` pointer. `HandTool` is instantiated in the constructor and is the default; the rest (`DrawingTool`, `EraserTool`, `ObjectPlacerTool`, `EdgeCutTool`) are registered by `registerDefaultTools()` in the same constructor, so a caller only constructs the manager. Every `ToolType` names a tool the manager registers, which `tool-cursors.test.ts` pins: scattering is the generation populator's job and roads are painted by `DrawingTool` in tile mode, so neither has a ToolType of its own.

`setView` swaps the ACTIVE view (2D map ↔ 3D editor) by rebuilding the context around the new projection/overlay pair, which is how the whole tool layer follows a mode switch without any tool knowing a switch happened.

`setActiveTool` calls `onDeactivate` on the outgoing tool and `onActivate` on the incoming one, both with a freshly refreshed context. On each of `handlePointerDown`, `handlePointerMove`, and `handlePointerUp`, `ToolManager` calls `refreshCtx()` then delegates to the active tool. The manager's public fields (`terrainType`, `elevation`, `brushSize`) are the source of truth for tool parameters; `PixiCanvas.tsx` syncs them from the Zustand store inside a `useEffect` that runs whenever the relevant store slices change.

`HandTool` receives special treatment in `handlePointerMove`: the raw screen-space delta `(dx, dy)` computed from `lastScreenX/Y` is passed to `handleRawMouseMove` before the standard macro/micro coordinate path runs. This is the only place where sub-pixel movement reaches a tool; all other tools work in macro coordinates. It applies only in views whose left-drag pans there (the 2D map): the 3D editor sets `leftDragPans: false` and pans from the pointer machine instead, since left is reserved for selection and tools while right/middle orbit.

`PixiCanvas.tsx` owns the manager's lifecycle: one is constructed in the `gridState` effect (a new map, an import, a generate) and published through `registerToolManager`, so the editor has exactly one at a time and the active-view registry re-points it on a mode switch.

### Stroke Lifecycle

Every brush stroke follows a two-phase lifecycle, with the tool owning both phases.

**Phase 1 — command accumulation.** On `onPointerDown` (or, for shape modes, on `onPointerUp`), the tool records `strokeStartUndoSize = ctx.getUndoStackSize()`. As the user drags, it calls `ctx.executeCommand(cmd)` for each cell group. Each `execute` call runs all applicable pre-command rules synchronously; a failure is silently skipped (the cell is not painted) and a `validation-failed` event fires, which `MapRenderer` converts into a red error flash on the overlay.

**Phase 2 — stroke commit.** When the gesture ends, the tool calls `ctx.commitStroke(strokeStartUndoSize)` (`command-executor.ts:commitStroke`). The executor runs all post-stroke rules against the final state. If any rule reports a violation, the executor unwinds entries from the undo stack one at a time — applying `before` snapshots back to `GridState` — until no violations remain or the entire stroke is reverted. The first violation array (the one that triggered revert) is returned; the tool is responsible for showing a toast from this return value. After revert, `commitStroke` runs `reconcileCuts` over the cells that survived, repairing any edge-cut corners that became geometrically invalid.

The `strokeStartUndoSize` watermark is critical: it tells `commitStroke` exactly how many undo entries belong to the current stroke. Tools must snapshot this value **before** issuing any commands for the stroke. `DrawingTool` is careful to reset it inside `onPointerDown` for brush mode and inside `onPointerUp` for shape modes (lines 163, 174, 184), because shape strokes do not accumulate commands during the drag — they emit everything at once on mouse-up.

For the curve tool, the stroke spans three click events rather than a pointer-down/up pair. `DrawingTool` collects `curvePoints` across calls; on the third click it samples the quadratic Bézier, calls `paintCells`, then calls `finishStroke` (which calls `commitStroke`) — all within `onPointerDown` (`drawing-tool.ts`). `strokeStartUndoSize` is re-snapshotted at the moment the third click begins, so any phantom undo entries from aborted previews are excluded.

`EdgeCutTool` uses the shortest possible stroke window: it snapshots the stack size, issues one or two commands, and calls `commitStroke` all within `onPointerDown` (`edge-cut-tool.ts,219`). There is no drag phase.

`ObjectPlacerTool` never calls `commitStroke` — object placement commands are individually pre-validated with sufficient pre-command rules that post-stroke rules do not apply to them.

### DrawingTool — the Multi-Mode Brush

`DrawingTool` (`drawing-tool.ts`) handles five drawing modes under a single `ToolType.TerrainBrush` id: `brush`, `line`, `rect`, `circle`, and `curve`. This consolidation means `PixiCanvas.tsx` manages mode changes by directly mutating `tool.mode` and `tool.contentType` on the registered instance (lines 236–244) rather than switching between registered tools.

The `paintCells` method (`drawing-tool.ts`) has a significant asymmetry between mountain and water content. For mountains it groups cells by their **target elevation** (`min(existing + 1, ELEVATION_MAX)`) and emits one `PaintTerrain` command per distinct elevation level, producing correct incremental stacking. For water it emits a single command covering all cells at `ctx.elevation`. A `strokeCells: Set<string>` guard prevents re-painting the same macro cell twice within a brush stroke — important for brush mode where the pointer can revisit a cell.

Ghost preview uses `ctx.overlay.showGhost(cells, color, terrainMode)`. The third argument controls a pixel offset: terrain ghosts are offset by `-HALF_TILE` (32 px) to align with the micro-grid rendering of terrain tiles; object ghosts pass `false` to sit on the macro-grid.

### EraserTool

`EraserTool` (`eraser.ts`) delegates single-cell peel to `peelCommand` (`terrain-peel.ts`). This helper (`terrain-peel.ts`) encodes the erosion rule: water erases to ground (`EraseTerrain` command); mountain at elevation N emits a `PaintTerrain` command at elevation N-1 (elevation 0 is the special case that clears via `applyCommand`). The eraser reads `layerVisibility` directly from the Zustand store to skip hidden layers — one of only two places in the tools layer that reads Zustand state at event time (the other being `ObjectPlacerTool`, which reads `selectedItemId`).

### ObjectPlacerTool

`ObjectPlacerTool` (`object-placer.ts`) has two behavioural modes gated by whether `selectedItemId` is set in the store. With an item selected it places on pointer-down; with no item selected it is passive (drag-to-move lives in the shared pointer machine, outside the tool).

Bridge ghost computation delegates to `core/model/bridge-span.ts:detectBridgeSpan` — the same function the `waterSpan` trait rule validates with, so the ghost shows exactly the span the click will produce. Ramp ghost computation (`computeRampGhost`, `object-placer.ts`) scans the four cardinal neighbours for an elevation difference matching the ramp's `layers` field and derives the footprint orientation from that.

`removeOverlappingCoatings` removes any `surfaceCoating` objects whose footprint overlaps the incoming footprint before placement — invoked by both `ObjectPlacerTool.onPointerDown` and the tile brush. This keeps road replacement atomic: erase-then-place instead of overlap-validation-fail.

### Tile coating (the road/tile brush)

There is no separate road tool. `DrawingTool` in tile mode (`contentType: 'tile'`) drives the same shape vocabulary as terrain and delegates each cell to `tools/paint/tile-coating.ts`: `placeTileCell` calls `removeOverlappingCoatings` and then issues the `PlaceObject`, so dragging over an existing road replaces it, and `eraseTileCells` is the inverse. A per-stroke `painted` set guards against double-placement, the same way `strokeCells` does for terrain. Tiles are ordinary `surfaceCoating` objects, which is why the overlap rule exempts them rather than the brush working around it.

### EdgeCutTool

`EdgeCutTool` (`edge-cut-tool.ts`) operates at micro-grid intersection points. A single macro-coord click maps to four `TerrainSlot`s (the four cells sharing the micro-corner at that intersection, via `getTerrainSlots`). For each slot it cycles the corner through `square → fan → tri-* → square` for outer corners, and `empty → fan → tri-* → empty` for inner (Γ-patch) corners. Road corners cycle through `CANONICAL_ROAD_STATES` with orientation derived from detected road connectivity. All commands are `TrimCorners`; no terrain elevation is changed. Because the tool calls `commitStroke` in `onPointerDown`, `cut-reconcile` (called from `commitStroke` inside the executor) repairs any cuts that became geometrically invalid due to the just-applied corner change.

### Shared Shape Utilities

`shapes.ts` exports five pure coordinate generators:
- `bresenham` — integer Bresenham line between two macro coords.
- `expandLine` — inflates a point list into a brush-sized corridor (square expansion, deduped).
- `interpolateBezier` — samples a quadratic Bézier at adaptive step count, deduped.
- `rectCells` — axis-aligned filled rectangle.
- `circleCells` — axis-aligned filled ellipse with the standard unit-ellipse membership test.
- `lineCells` / `curveCells` — composed wrappers calling `bresenham`/`interpolateBezier` through `expandLine`.

`DrawingTool` imports from `shapes.ts`. The earlier `terrain-brush.ts` and `terrain-line.ts` files (which contained duplicated Bresenham and expandLine implementations) have been removed; `DrawingTool` is the sole terrain-drawing entry point.

### terrain-peel

`terrain-peel.ts` exports a single function `peelCommand(x, y, cell)` that constructs the correct `Command` to remove one layer from a cell without touching the tool's stroke state. The eraser uses it, and nothing else currently does — though the function was designed to be reusable (e.g., a future "reduce elevation" gesture could use it without duplicating the water-vs-mountain branching logic).

### road-reconcile

`road-reconcile.ts` exports `reconcileRoadsAfterMountainPaint(paintedCells, ctx)`, called by `DrawingTool.finishStroke` **before** `commitStroke`. The function:
1. Identifies every `surfaceCoating` object whose 2×2 footprint intersects any painted cell.
2. For each affected road, if its footprint elevation is no longer uniform (mountain raised under part of it, or water appeared), removes it via `RemoveObject` and tries to re-place it at the new elevation via `PlaceObject` (pre-validated with `validateCommand`). If the new placement is invalid (cliff edge, water), the road stays removed.

This runs inside the stroke — the remove/replace commands become part of the undo history — so a single Ctrl+Z undoes both the terrain paint and the road adjustment. The check uses `getCell` after the terrain commands have already been applied, so it sees the post-paint state.

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

The procedural generation subsystem produces rule-valid terrain layouts from two algorithms — a deterministic multi-stage procedural pipeline (`src/tools/generation/`, the default `'random'`) and a recursive-backtracker maze generator (`maze-generator.ts`) — and deposits their results into `GridState` through the standard command/validation pipeline. It is invoked inside a `setTimeout(..., 0)` wrapper in `App.tsx` so the React render can first show a loading-spinner state via `generating: true`.

The subsystem is entirely stateless: it never stores state of its own. All persistent output goes through `executeCommand`, which is `CommandExecutor.execute` bound at call time.

---

### Entry Points

`terrain-generator.ts:generateTerrain` is the single public dispatch function. It reads `config.algorithm` and routes to either `generateMaze` (`maze-generator.ts`) or `runLandform` (`generation/index.ts`, the default `'random'`). The `GenerateConfig` interface (`core/model/types.ts`) carries the user-facing parameters: `algorithm` (`'random' | 'maze'`), `mode` (`'earth' | 'water' | 'mixed'`), `maxElevation`, `seed`, `corridorWidth` (maze), an optional `region: MacroCoord[] | null`, and optional advanced fields (`archetype`, `relief`, `naturalness`, `waterAmount`, `rivers`, `flatness`, `settlement`, `nature`) that `generation/index.ts:toGenConfig` defaults seed-first (relief 0.8, naturalness 1). `naturalness` (0..1) is the geometry-STYLE dial, mapped in ONE place (`generation/style.ts:geoStyle`) to: zone-seam wobble amplitude, a rectilinear block-snap lattice, the terrace step (stacked cliffs), Chebyshev-vs-Manhattan erosion, river-walk axis stickiness, a road A* turn penalty, and the edge-cut gate — 1 reproduces the classic organic output byte-for-byte, 0 generates fully axis-aligned "lego" terrain and straight roads with no cuts. `runLandform` commits the certified plan as batched `PaintTerrain` commands and returns the `ZonePlan` (see below) so the placement populator can decorate per room.

`clearAllTerrain` issues a single `EraseTerrain` command covering every grass cell that has terrain; `clearAllObjects` is its object-side twin and skips `locked` objects, so a Clear never takes the plaza. Both take an optional cell list to restrict the sweep to, and an optional `spare` predicate for what to leave standing inside it: Generate passes the region it is about to rewrite, and the panel's Clear passes the last run's region plus the map's own authorship, so taking back a generation never takes a placement the person made alongside it.

---

### Randomness primitives (`src/core/model/`)

Both generators draw from the same two primitives on the engine floor, not from anything under `generation/`: `core/model/rng.ts` (`makeRng`, mulberry32) and `core/model/noise.ts` (`valueNoise01`, seeded value noise). The maze generator, the zone pipeline, the naturalness mapping in `generation/style.ts`, and the agent's terraform/director tools all seed their own stream from `makeRng`, which is what keeps a `(seed, config)` pair reproducible across them.

---

### Procedural Pipeline (`src/tools/generation/`) — the ZONE-GRAPH "designed island"

A deterministic, seeded pipeline that designs the island as a set of **rooms** (the way a player lays out an Animal-Crossing-style island) rather than simulating a heightfield. Shared grid helpers (`makeField`, `makeScratchState`) live in `field.ts`, with the pure primitives they build on (`distanceField`, `NEIGHBORS4`, `flatIndex`, `valueNoise01`) on the `core/model` floor; every tunable in `tuning.ts` (`TUNING.*`); cross-stage types in `types.ts`; one mulberry32 RNG (`rng.ts`) threaded by seed — same `(seed, config)` → byte-identical plan.

`generateLandform(config, template, reg)` returns `{ plan: TerrainPlan, zonePlan: ZonePlan }`:

1. **archetype** (`archetype.ts:resolveShaping`) — `GenConfig` → `ShapingParams` (continentalness / erosionAmt / peaksValleys / mtnThreshold / mtnCapTier / waterCoverage / riverDensity / targetFlat / maxTier). `archetype: 'random'` resolves from the seed; `earth` zeroes water; `water` zeroes the land cap.
2. **zones** (`zones.ts:buildZones`) — the room plan. A noisy-Voronoi partition (farthest-point sites, distance warped by low-freq noise → organic seams; the wobble amplitude scales with `naturalness`) cut into **rooms** — one per `zoneAreaPerSite` of grass, clamped to `zoneCountMin`..`zoneCountMax` (6..70), so a small test map gets a handful and a real one gets dozens rather than a few giant ones — with a **sliver cleanup** pass (largest-component + reabsorb tiny zones), then — below naturalness 1 — a **lattice snap** (`snapToLattice`: majority vote per `block×block` tile) that makes every seam axis-aligned with straight runs ≥ block. The town's room is id 0, anchored BESIDE the plaza (offset, never under it, never at the island edge — `townAnchor` in `index.ts`). **Levels** are a wedding cake: `level = BFS graph-distance from the LOW SET`, which is grown **connected** outward from the town room — so the ground floor is one contiguous walkable level and adjacent rooms differ by ≤1 BY CONSTRUCTION. `relief` shrinks the low set (more climbs), `flatness` grows it; a relief FLOOR stops seed luck from flattening the island, both edits preserving connectivity. **Crowns** (`raiseCrowns`) carve nested plateau-on-plateau terraces inside the tallest rooms so peaks stack even on shallow graphs; scenic spire rings climb `geoStyle().step` levels per inset (stacked slabs at low naturalness), nav rings always +1 so the ramp rule can link them; the inset erosion goes Chebyshev (square corners) in the rectilinear style. **Themes** (town/waterfront/peak/garden/orchard/farm/hamlet/park/lake) are assigned from room properties; raised rooms get the lived-in themes first (hillside living).
3. **zone-water** (`zone-water.ts:buildZoneWater`) — water at ground level, with per-seed RECIPES so maps differ: `water` mode floods seams into an archipelago of islets (channel widths read from the LIVE bridge `waterSpan` trait via `bridgeSpanRange`, so they stay spannable; ~15% dry-seam merging + bays for variety); `mixed` mode floods 1–3 lake rooms (rim variance + a bridgeable raised island) and traces 1–2 winding seam rivers from a high room to a lake/coast. Marks `riverside`/`lake` rooms.
4. **rasterize → terrace → repair → usability → re-certify** (`index.ts`): room level → `tier`; `terrace` staircases the seams to a max slope of `geoStyle().step` per neighbour (V-MTN-03 + no-floating by construction — step 1 is the classic wedding cake over the 4-neighbourhood; steps 2–3 allow STACKED slabs, legal because V-MTN-03 only needs the full 3×3 at ≥ N−3, and clamp over the 8-neighbourhood so diagonals can't drift out of the rule's window); `repair.ts:repairPlan` rasterizes onto a scratch `GridState` and runs the LIVE `RuleRegistry.validatePostStroke`, backing off flagged cells to a fixpoint (rule-agnostic, **decrease-only**; the scratch is ONE cached grid per template — `applyPlanToScratch` fully rewrites and returns it per validation, valid only until the next call, because generation validates plans hundreds of times and a fresh W×H grid per candidate was the pipeline's dominant allocation); `usability.ts:enforceUsability` grows the largest connected flat region outward **ring by ring** (minimal peel — it never flattens the whole map) until `targetFlat` is met; a final `repairPlan` re-certifies.
5. **the terrain-following river** (`zone-water-course.ts:carveRiverCourse`, AFTER certification — the additive, self-validating slot, because terrace/repair are decrease-only and would shave caps off a validated unit): `carvePool` puts a headwater POND in a raised room's interior (every neighbour is the room's own mass at the pond's level → containment holds with NO faces — the only legal way to put a water body ON the mountain; one whole-plan validation per pool, shrink-then-skip); `descend` then steps the course down the terraces in TRANSACTIONAL HOPS — find a lip (`findDrop`), carve the waterfall unit there (`waterfalls.ts:tryCarveWaterUnit`: water at E, caps at exactly E, uniform `landE` downstream — the proven legal pattern, now with a `landE` parameter so a PLUNGE can drop straight onto the valley floor and pour INTO existing water), then dig the CHANNEL that joins the stream's foot to the fall (`carveChannel`: an axis-aligned dogleg through the terrace surface at exactly E, whole-plan validated); a hop whose channel fails reverts its fall (never a blind canal or an unfed fall). The course ends by tying into the ground water (`connectGround`); a course that ends DRY is reverted whole (`grounded` guard — one chained water story or nothing). `feederFalls` then drops spaced falls straight into the ground river at cliffs that touch it. A full at-level river is IMPOSSIBLE (the seam river always borders a lower room → illegal containment along its length) — that is why the ground body is carved by `zone-water.ts` and the elevation comes from the course + feeders. The chaining is pinned by the TERRACED RIVER design-quality probe (every elevated body sees lower water within Chebyshev 3).
6. **crossings** (`crossings.ts:planCrossings`) — a SCARCE, strategic plan on the room graph: a spanning tree from the town room (open same-level seams are free; else a ramp for a 1-level seam, a bridge for a ground-water seam) + a settlement-scaled loop budget + a couple of GORGE BRIDGES joining same-height rooms across a lower seam (the bridge rule spans any below-deck gap — water, void, OR lower terrain). Classification is per crossing SITE, judged from BOTH sides of the seam (a river clipping one corner must not strand the far room; an elevated channel sits at bank height → not a below-deck gap → unbridgeable by rule, so it stays a wall). The populator REALIZES these via `tryPlace`.

`TerrainPlan` (`width`, `height`, `tier: Int8Array`, `water: Int8Array`) is the committed terrain; `ZonePlan` (`zoneOf`, `zones[]` with level/theme/cells/centroid, `adjacency`, `river[]`, `crossings[]`, `town`, `levelCap`) is threaded `terrain-generator → App → populate(...)` so the placement populator decorates each room in character.

Headless tests (`src/__tests__/tools/generation/`) pin invariants: rule-robustness (seeds × modes → zero `validatePostStroke` violations), determinism, connected-flat usability, the partition/levels/themes (`zones.test.ts`), crossings reachability (`crossings.test.ts`), and **design quality** (`design-quality.test.ts`: no boring flats, elevated water survives commit, crossings realized, NO ISOLATED REGIONS — walkable coverage ≥85% from the town, ALL catalog buildings present, determinism). `_render.test.ts` (square grids) + `_render_real.test.ts` (the real hexia template) dump the generated grid as JSON so it can be rendered to an image offline (the maintainers keep a small private renderer for this) — there is **no browser** in the test environment, so this is how terrain is eyeballed.

### Maze Generator (`maze-generator.ts:generateMaze`)

The maze uses a randomized DFS (recursive backtracker) on a logical cell-wall grid, but physically maps cells to `step = corridorWidth + 1` macro-coordinate strides. The algorithm:

1. Computes the bounding box of the region (or full Grass extent if no region).
2. Derives `cellsW = floor((maxX - minX) / step)` and `cellsH = floor((maxY - minY) / step)` — the dimensions of the logical maze in cell units.
3. Initializes a `mazeH × mazeW` boolean grid, all `false` (wall).
4. Carves starting from `(1,1)` using iterative DFS with a stack. On each step, picks a random unvisited neighbor (2 steps away). Carving a passage marks the wall midpoint plus the destination room as `true`. Corridor and room widths are both `corridorWidth × corridorWidth` cells.
5. All `false` cells in the maze grid that map to valid in-region Grass cells become Mountains, painted bottom-up from elevation 1 to `min(maxElevation, 3)`.

The elevation cap at 3 (`maze-generator.ts`) is hardcoded because the 3x3 base rule (V-MTN-03) exempts elevations 1–3 and the maze does not run the erosion precomputation that the noise generator uses. This avoids any base-support violations without erosion logic.

The wall-midpoint carving (lines 125–131) covers the rectangle from `min(cx,nx)` to `max(cx,nx)+cw-1` in both axes. For `corridorWidth=1` this is correct: both the single-cell wall midpoint and the corner cells of the 1×1 rooms are included. For `corridorWidth > 1`, the rectangle over-carves slightly — walls that are `cw` cells wide between rooms are cleared as a block rather than as individual cells, but this is acceptable because the maze only places Mountains on `false` cells.

Region filtering (`regionSet`) is applied after the logical maze is computed. The maze is generated in the bounding rectangle of the region, then cells outside the region's actual shape are skipped. This means a non-rectangular region (e.g. L-shaped) will silently lose some maze arms — the bounding box is generated but only the intersection with the region is painted.

The same bulk-command-then-per-cell fallback strategy as in the noise generator is used: one `PaintTerrain` command per elevation covering all cells, with individual retry on batch failure.

---

### Integration with Command/Validation Pipeline

Both generators receive `executeCommand: (cmd: Command) => ValidationResult` as a plain callback, not a direct `CommandExecutor` reference. In production (`App.tsx`), this is `(cmd) => exec.execute(cmd)`. This means every generation command passes through the full pre-command rule set (zone restriction, layer lock, elevation range, floating block, placement overlap, object-blocks-terrain, chunk-load). The generators observe the `ValidationResult` and skip or retry cells on failure.

The `App.tsx` orchestration layer calls `exec.commitStrokeGroup(strokeStart)` after generation (`App.tsx`, `498`). This runs post-stroke validation and cut-reconciliation once at the end, then collapses the entire generation into a **single undo entry** so the user undoes the whole generation in one Ctrl+Z rather than command-by-command. Generators are designed to produce rule-valid output structurally, so post-stroke revert should never fire in practice; the test suite in `terrain-generator.test.ts` verifies this by running post-stroke rules directly against the state after generation.

`CommandExecutor.execute` captures `before`/`after` cell snapshots for each generated command; `commitStrokeGroup` then collapses all those individual entries into one, so undo works correctly as a single operation.

---

### Region Selection

The region selection system is the `ui/hooks/useRegionBrush.ts` state machine, and it uses a window-global callback pattern (`__petitRegionBrushCallback`, `__petitRegionBrushDone`) to bridge the pointer machine to React state. Brush, eraser, rect, circle, line, and curve modes are supported via `shapes.ts` utilities, accumulating buildable cells into a mutable buffer during the drag and committing on pointer-up. The selected region is stored as `MacroCoord[]` in `genRegion` React state and passed to `generateTerrain` via `config.region`. Both generators convert this to a `Set<string>` (`"x,y"` keys) for O(1) membership tests.

The hook owns the region's OWN undo/redo stack, separate from the map's command history: a painted region is a scope for a future generate, not a map edit, so it must never share the executor's stack. While `selectingRegion` is on, the keyboard command routes Ctrl+Z/Ctrl+Y here instead of to the executor. One snapshot per perceived action (a brush drag, a shape drag, a whole curve sequence, a Clear tap), never per cell, and the stack lives on refs because it is read only imperatively and must survive the effect re-runs that every `genRegion` commit causes.

---

### Invariants Maintained

- All generated terrain lands only on `CellZone.Grass` cells not colliding with plazas (`makeField` excludes object-occupied + up/left-bleeding cells).
- **Rule-valid by construction**: terrain certifies through `repairPlan` against the live `RuleRegistry` (decrease-only fixpoint); every object goes through `tryPlace` (reject-and-skip). The `commits cleanly for every mode × seed` test asserts zero rejected commands + zero post-stroke violations.
- The terrace levels satisfy V-MTN-03 (3×3 base) + no-floating BY CONSTRUCTION via `terrace` staircasing at the style's step (1 = wedding cake; 2–3 = stacked slabs, clamped over the 8-neighbourhood); tall rooms therefore require width (less of it at low naturalness).
- Elevated water (headwater pools + channels + fall units + ground tie-ins) is each validated as a whole-plan candidate against the live registry BEFORE commit (`zone-water-course.ts` / `tryCarveWaterUnit`), satisfying V-WTR-02/03 with no post-stroke revert; ungrounded courses are reverted whole.
- A connected ground floor + planned crossings keep every room reachable from the town (design-quality NO ISOLATED REGIONS probe, ≥85% walkable coverage).
- The maze elevation cap (3) ensures `V-MTN-03` never fires for maze output.

---

## Editor Store & Item Catalog

### Responsibility

The Zustand store (`src/state/store.ts`) is the composition root of the entire editor. It holds — and is the single authoritative owner of — the live `GridState`, the `CommandExecutor` that mutates it, the `EventBus` that broadcasts mutations, and every piece of editor UI state (active tool, layer, selection, overlays). The catalog module (`src/state/catalog.ts`) is a purely static lookup table assembled at module-load time from the per-category barrels under `src/config/catalog/`; it has no runtime lifecycle and no dependency on the store.

---

### Store Shape

`EditorStore` (`store.ts`) is a flat interface combining three distinct concern groups:

**Core engine references** — These three fields form the "engine bundle" that components reach into:
- `gridState: GridState | null` — the row-major cell grid, object map, chunk loads, locked layers, and map template. `null` until `initMap` or `loadMap` is called.
- `commandExecutor: CommandExecutor | null` — the command pipeline; `null` until a map is initialised.
- `eventBus: EventBus<EditorEvents>` — created once at store construction (`store.ts`) and **never replaced**. This is intentional: PixiCanvas subscribes to it on mount and the subscription lives for the component's lifetime. The event bus is the only member that survives `initMap`/`loadMap` unchanged.

**Tool/UI parameters** — `activeTool`, `designMode` (the UI-facing editing mode the active tool is derived from), `contentType`, `tileMaterial`, `autoEdgeCut`, `activeLayer`, `displayLayer`, `layerVisibility`, `layerLocked`, `brushSize`, `locale`, `viewMode`, `showGrid`, `showChunkBounds`, `showLayerNumbers`, and the region-selection cluster (`selectingRegion`, `regionTool`, `regionBrushSize`). The tool PARAMETERS themselves (`terrainType`, `elevation`, `brushSize`) live on `ToolManager`, which `PixiCanvas.tsx` syncs from these store slices.

**Selection/overlay state** — `selectedItemId`, `selection: BlockRef[]`, `contextMenu`, `deletePopover`.

---

### initMap and loadMap as Wiring Points

`initMap(template, registry)` (`store.ts`) is the factory for a new editing session:
1. Calls `createGrid(template)` to build a fresh row-major `MacroCell[][]`.
2. Constructs a `GridState` with empty `objects` and `lockedLayers`.
3. Instantiates `CommandExecutor(gridState, eventBus, registry)`, binding the three collaborators together.
4. Writes `gridState` and `commandExecutor` into the store atomically via Zustand `set()`.

`loadMap(state, registry)` (`store.ts`) is identical except it accepts a pre-built `GridState` (from the JSON codec after import) instead of calling `createGrid`. In both cases the **existing `eventBus` instance is reused** — only `gridState` and `commandExecutor` are replaced.

The caller is responsible for supplying the `RuleRegistry`. In production, `App.tsx` always passes `createDefaultRegistry()` (from `src/rules/index.ts`), which registers all fifteen rules in the canonical phase order. This means rule configuration is opaque to the store — the store binds the executor to whatever registry it receives, with no knowledge of which rules are active.

`PixiCanvas.tsx` reacts to `gridState` changing (the `useEffect` at `PixiCanvas.tsx`) and rebuilds a fresh `ToolManager` with the new executor and grid state, completing the wiring from store update to renderer.

---

### CommandExecutor and Two-Phase Validation

`CommandExecutor` (`src/core/commands/command-executor.ts`) owns the undo/redo stacks and is the only entity that mutates `GridState`. Its API surface is:
- `execute(cmd)` — pre-command validation via `RuleRegistry.validatePreCommand`, then `applyCommand`, then snapshot bookkeeping and event emission.
- `commitStroke(strokeStartSize)` — post-stroke validation; if violations exist, iteratively undoes commands added during the current stroke (identified by `strokeStartSize = getUndoStackSize()` captured before the stroke began) until the state is clean, then calls `reconcileCuts` on the net-changed cells.
- `undo()` / `redo()` — restore cell snapshots and, for undo, skip intermediate states that would violate post-stroke rules (the same iterative clean-up loop as `commitStroke`).
- `getRegistry()` — exposes the registry so callers (notably `EditorAPI`) can perform dry-run validation without executing.

On `execute`, the executor captures `before` snapshots of affected cells, applies the command, captures `after` snapshots, pushes a `HistoryEntry`, clears the redo stack, and emits `cells-changed` / `history-changed`. For `PlaceObject` and `RemoveObject` the `applyCommand` path also emits `objects-changed` (and for `TrimCorners` on a road object it emits remove + add to force a renderer refresh).

The `EventBus<EditorEvents>` (`src/core/commands/event-bus.ts`) is a simple typed pub/sub with `on`/`off`/`emit`. There is no wildcard, no ordering guarantee beyond insertion order, and no async batching — every `emit` is synchronous. The renderer subscribes to `cells-changed` and `objects-changed` to trigger incremental redraws; `Toast.tsx` subscribes to `validation-failed` to auto-show error messages for pre-command rejections.

The `RuleRegistry` (`src/rules/registry.ts`) splits rules into two lists by phase. `validatePreCommand` filters the pre-command list by `appliesTo` and accumulates all errors (no short-circuit). `validatePostStroke` runs all post-stroke rules unconditionally. Registration order determines priority for pre-command rules; `rules/index.ts` documents the canonical order (layer-lock before zone before elevation, etc.).

---

### BlockRef / Selection Model

`BlockRef` (`store.ts`) is a discriminated union:
```
{ kind: 'object'; id: string }
| { kind: 'terrain'; x: number; y: number }
```
A `BlockRef` is used for three distinct but related purposes:
- `selection: BlockRef[]` (`store.ts`) — the selected blocks, in the order they were added, drawn as selection rings by the renderer. `[]` is the ONE representation of "nothing selected"; there is deliberately no scalar beside the list, because a scalar and a list are two sources for one fact and drift. Mutated only through `setSelection` / `toggleSelection` / `clearSelection`. Consumers that can express only one member (the corner handles, the delete popover, the keyboard rotate/delete, the agent's tool surface) read the pure derivation `singleSelection(selection)` from `state/selection.ts`, which returns null for a PLURAL selection rather than an arbitrary member. `sameRef` there compares by VALUE, since a `BlockRef` is rebuilt on every hover.
- `contextMenu: { x: number; y: number; target: BlockRef } | null` — right-click menu anchored to a position with its target. The `target` is always a `BlockRef` because the menu is always triggered on a real block.
- `deletePopover: BlockRef | null` — the keyboard-delete confirmation popover; non-null exactly while the popover is visible.

`ContextMenu.tsx` and `DeletePopover.tsx` both pull `commandExecutor` and `gridState` directly from the store and issue commands themselves (remove object, peel terrain, rotate object via remove+place). They call `executor.commitStroke(start)` after each operation.

There is also `selectedItemId: string | null` in the store, which is the **catalog-level** selection — which item in the `PlacementPanel` is armed for placement. `ObjectPlacerTool` reads it via `useEditorStore.getState().selectedItemId` to know what to place, and `placementRotation` beside it carries the armed item's pending rotation (it lives in the store because the rotate shortcut, the ghost preview and the placement command are three separate call sites, only one of which touches a tool).

---

### Catalog Loader/Indexer

`catalog.ts` is a module-level singleton built immediately at import time. It assembles the seven per-category barrels under `src/config/catalog/` — one JSON per object, 81 in all, each carrying its own low-poly `model3d` inline — and builds two `Map` indexes:
- `byId: Map<string, CatalogItem>` — O(1) lookup by `item.id` string (e.g. `"house-wooden"`).
- `byCategory: Map<string, CatalogItem[]>` — ordered list per `ItemCategory` string value.

The four exported functions (`getCatalogItem`, `getCatalogByCategory`, `getAllCategories`, `getAllItems`) are pure reads on these maps. There is no lazy loading, no hot-reload path, and no catalog mutations at runtime.

`CatalogItem` (`types.ts`) carries the `PlacementTrait[]` array that drives `V-PLACE-TRAIT` (`rules/placement.ts`). Each trait is a tagged union variant; the rule iterates the trait list and dispatches to per-trait validation logic. This makes adding a new trait type a two-file change (add to the union in `types.ts`, handle in `placement.ts`) with no changes to the registry or executor.

`CatalogItem` is entirely disjoint from `PlacedObject`. A `PlacedObject` stores only `catalogId`, `position`, `rotation`, `elevation`, and optionally `spanLength` and `corners` — it looks up its dimensional and behavioral metadata from the catalog at runtime via `getCatalogItem(obj.catalogId)`. The catalog is therefore the authoritative schema for object rules; `PlacedObject` is the minimal persistent payload.

---

### Invariants

1. The `eventBus` instance is immutable for the lifetime of the application. It must be subscribed to before `initMap` is called; subscriptions are not re-established on map reload.
2. `commandExecutor` and `gridState` change together in one `set()` call. Any code that reads one should always check the other (both are nullable for the same reason).
3. `GridState.lockedLayers` is mutated directly by a `useEffect` in `PixiCanvas.tsx` whenever `layerLocked` changes (`PixiCanvas.tsx`); it is not mediated through a command. Rules read it but never write it.
4. Rule purity: neither `PreCommandRule.validate` nor `PostStrokeRule.validate` may mutate state. The registry enforces this only by convention — TypeScript does not prevent mutations.
5. Commands carry no snapshot data — `CommandBase` has only `timestamp`. `CommandExecutor.execute` captures `before`/`after` cell snapshots and stores them on the private `HistoryEntry`.

---

### Composition with Neighbouring Subsystems

- **Tools**: `ToolManager` receives `executor` and `gridState` at construction time (from the store) and never re-reads them from the store. When `gridState` changes (new project), `PixiCanvas` destroys and rebuilds `ToolManager`. Tools call `ctx.executeCommand` / `ctx.commitStroke`, which delegate to the executor.
- **Renderer**: Subscribes to `eventBus` events for incremental redraws. The renderer's `initMap` is called reactively on `gridState` change. It never touches the store directly except through the event bus.
- **Rules**: Created externally (`createDefaultRegistry()`), passed into `initMap`/`loadMap`, held by the executor. Rules read `GridState` but have no reference to the store.
- **IO**: `json-codec` serialises/deserialises `GridState` only. Chunk loads are not persisted — they are derived from the objects.
- **EditorAPI** (`src/api/editor-api.ts`): Installed on `window.__PETIT_API` at mount. Accesses `gridState` and `commandExecutor` via getters that call `useEditorStore.getState()` — this avoids capturing stale references while still being synchronous.

---

## IO Codec & Programmatic API

### Responsibility

This subsystem has two loosely related jobs that share the `GridState` type as their interface surface:

1. **Persistence** (`src/io/`): Serialise and deserialise `GridState` to/from a versioned JSON envelope, compress the cell grid with run-length encoding, and provide three transport helpers — file download, clipboard copy, and a 2-second debounced localStorage autosave.
2. **Programmatic API** (`src/api/editor-api.ts`): Expose the live editor as a typed object on `window.__PETIT_API` so browser-console scripts and automation harnesses can read grid state, issue commands, and round-trip JSON without touching the React/Zustand layer.

### JSON Codec (`src/io/json-codec.ts`)

#### SaveFile schema

`SaveFile` and `CURRENT_VERSION` live in `io/save-format/types.ts`, not in the codec — the shape is versioned data, and the codec is one reader of it:

| Field | Type | Purpose |
|---|---|---|
| `version` | number | The shape this file was written in; `migrate.ts` lifts an older one before the decoder sees it |
| `templateId` | string | Identifies which `MapTemplate` to pair with on load; the codec does not embed template data |
| `cells` | RLE string | Packed row-major terrain tokens |
| `objects` | `SaveObject[]` | Placed objects with all placement metadata |
| `metadata.savedAt` | ISO-8601 string | Informational only; not validated on load |
| `provenance` | object | The edit-source ledger, written only when the map carries one |
| `notes` | object | Title/description/author, written only when non-empty |
| `camera` | object | The 2D/3D framing to resume at, written only when supplied |

**Versioning** (`io/save-format/`): `migrate.ts` runs an append-only chain of vN→vN+1 steps, pure JSON→JSON, before decoding, and rejects a FUTURE version with `SaveVersionError` rather than guessing. A breaking change means adding `migrations/NNN-*.ts`, bumping `CURRENT_VERSION`, and freezing a fixture.

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
- `patchOnly` is written through a cast: `SaveObject` does not declare it, so it round-trips without appearing in the schema. The read on load is symmetric.
- `rotation` is read back with a type assertion to `0 | 90 | 180 | 270` (`json-codec.ts`) without runtime validation; an invalid serialised value would silently pass through.

#### Deserialization invariants

`deserialize` (`json-codec.ts`) rebuilds `GridState` from scratch via `createGrid(template)`, which ensures `zone` is always sourced from the template (not persisted). This means importing a save against a different template than it was created with will produce mismatched zone assignments — the codec does not validate `templateId` against the provided template. The returned state always has `lockedLayers: new Set()` regardless of what was in the save file; layer locks are not persisted.

`parseTerrain` (`json-codec.ts`) includes a legacy entry in its decode map: `T: 'tri-NW'` alongside `'1': 'tri-NW'` (`json-codec.ts`). The encoder only ever writes numeric codes, so `T` is a dead read path for forward-compat with an older encoding.

#### Autosave (`src/io/autosave.ts`)

`scheduleAutosave` (`autosave.ts`) wraps `serialize` + `localStorage.setItem` behind a 2-second debounce. Errors (quota exceeded, serialisation failure) are silently swallowed. Reading back is deliberately split: `readAutosave` decodes and returns `null` on any exception, while `readRestorableAutosave` additionally applies `autosaveWorthy` — a map with no content is not offered for restore, so a fresh session never proposes resuming an empty one. `hasAutosave` and `clearAutosave` round out the surface.

#### Image export (`src/io/image-export.ts`)

`image-export.ts` provides `downloadBlob`, `downloadJSON` and `dataUrlToBlob` as pure DOM utilities. `dataUrlToBlob` exists because `fetch()` of a `data:` URL is blocked by the CSP's `connect-src`, which is the obvious way to convert one and does not work here. Full-map image export goes through `window.__petitExportFullMap()`, set by `PixiCanvas.tsx` directly, not through this module.

### Programmatic API (`src/api/editor-api.ts`)

#### Installation

`installAPI` (`editor-api.ts`) is called once in `App.tsx:useEffect` (`App.tsx`). It creates an `EditorAPI` instance with two thunks — `getState` and `getExecutor` — that call `useEditorStore.getState()` at invocation time. This means the API always reflects the latest `GridState` and `CommandExecutor` even after `initMap`/`loadMap` replace them in the store. The API object itself lives at `window.__PETIT_API` for console use.

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

`PlacedObject.locked` is a tag on an object, not a kind of object. A locked object (today only the central plaza) is selectable, joins a group, and draws a ring like anything else; what it cannot do is change, and V-LOCK-02 refuses the modification by name. Hit-testing therefore must not filter locked objects out — doing so made the same map answer the same click two different ways in the two views.

Whether a group operation refuses wholly or applies partially follows from whether a partial result is coherent, and has nothing to do with which member is locked. **Move and rotate are geometric**, so a partial application would silently deform the arrangement being manipulated and leave an undo restoring something the user never saw: if any member's destination is illegal, or any member is locked or cannot turn, the whole operation is refused and the blocker is named. For a move the refusal is visible before release, as the drag ghost tints invalid. **Delete applies to what it can and reports the rest**, since the survivors are exactly where they were: Ctrl+A then Delete clears the map and keeps the plaza, with a message saying so. Both run through `ui/chrome/group-actions.ts` (the plural sibling of `object-actions.ts`) as one stroke group and one undo entry, so the context menu, the delete popover and the keyboard command share one implementation. Membership is re-resolved from ids on every operation (`groupMembers`), because nothing validates a selection centrally and another path may have removed a member since.

A group rotation is ONE rigid body turning about ONE point: every member's position rotates about the selection's macro bounding-box centre, and each rotatable member's own facing advances by the same quarter turn. A member that cannot turn but is SQUARE is carried — its position travels, its facing does not — because `rotatable: false` marks an item with no meaningful facing, and refusing on that flag would let one flower kill nearly every real selection while protecting nothing. A member that cannot turn and is NOT square refuses the whole rotation: it cannot swap its extent, so the bounding box changes shape from turn to turn and the arrangement walks away from where it started. The animation contract lives in `canvas/group-arc.ts` and is shared by both views: what eases is the ANGLE about the pivot with the radius held (a straight line cuts the chord, visibly contracting the arrangement mid-turn), the whole turn is one spec on one clock rather than a signal per member, and offsets are measured FROM the already-committed rest pose, since the commands apply instantly and a tween can only land where the map already put the object.
