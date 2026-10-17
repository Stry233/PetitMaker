# System Behavior & Architecture

Marked reference sections are generated from code by `npm run docs:generate`; `npm run docs:check` and the test suite detect drift. Narrative sections explain contracts and rationale and need review when behavior changes.

This is the backend/engine reference for the Petit Planet map editor: how the system is built and how it behaves at runtime. What a map may legally *be* is not prose here: the game's building rules live in `src/rules/`, one rule family per file, and this document describes the machinery that runs them.

## Architecture at a glance

The editor is a **layered stack with one strict rule: a module may import only from its own layer or a layer below it, never above.** Lower layers are pure and reusable; higher layers compose them. Drawn like an OS stack (user-facing consumers on top, the engine floor at the bottom):

<!-- generated:layers:start -->

Source: [scripts/layers.mts](../scripts/layers.mts), `LAYERS`, `CORE_FOLDERS`, `LEAF_RANKS` and `LAYER_DOCS`.

```
┌────────────────────────────────────────────────────────────────────────┐
│ entry      the root files of src/ and src/lite/, which compose the app │
├────────────────────────────────────────────────────────────────────────┤
│ ui/        the app roots and the owning surfaces (shell, chrome,       │
│            agent), over the shared design layer and primitives         │
├────────────────────────────────────────────────────────────────────────┤
│ legal/     policy documents: facts, markdown sources, parser, static   │
│            HTML                                                        │
├────────────────────────────────────────────────────────────────────────┤
│ agent/     the LLM assistant harness                                   │
├────────────────────────────────────────────────────────────────────────┤
│ editor/    the live editor: the session, its verbs, the host, command  │
│            bodies, interactive helpers, the development console API    │
├────────────────────────────────────────────────────────────────────────┤
│ io/        save and load, the share pipeline, image export             │
├────────────────────────────────────────────────────────────────────────┤
│ view/      the active view, the shared pointer machine, view-neutral   │
│            parts, and the two live editing views: map2d (PixiJS) and   │
│            map3d (three.js)                                            │
├────────────────────────────────────────────────────────────────────────┤
│ pipelines/ self-contained feature pipelines: planet-scan, stylize,     │
│            moderation                                                  │
├────────────────────────────────────────────────────────────────────────┤
│ tools/     the pointer tools and their Tool/ToolContext contract in    │
│            `pointer/`, and the map-edit libraries and generation they  │
│            share, each behind an index.ts door                         │
├────────────────────────────────────────────────────────────────────────┤
│ i18n/      the seven locale tables, localizedName and the brand name   │
├────────────────────────────────────────────────────────────────────────┤
│ rules/     two-phase validators, one rule family per file, in a        │
│            RuleRegistry                                                │
├────────────────────────────────────────────────────────────────────────┤
│ state/     the Zustand store, the catalog, object geometry, whole-map  │
│            derivations, selection, editing vocabulary, keymap          │
├────────────────────────────────────────────────────────────────────────┤
│ config/    game data: the catalog, its 3D model sidecars, built-in     │
│            maps                                                        │
│ assets/    icons, fonts, team art, the cursor catalogue, the brand     │
│            palette                                                     │
├────────────────────────────────────────────────────────────────────────┤
│ platform/  the browser and build boundary: build identity and edition, │
│            storage, device, input, async scheduling, remote helpers,   │
│            app-wide channels                                           │
├────────────────────────────────────────────────────────────────────────┤
│ core/      the engine floor: pure primitives, the game profile, grids, │
│            the edit-source ledger, the kernel model and the command    │
│            executor, then the terrain domain                           │
│            folders, bottom to top: base < game < grid < provenance <   │
│            model < commands < domain/terrain < domain/edge-cut         │
└────────────────────────────────────────────────────────────────────────┘
                       imports only ever point DOWN  ↓
```

| Layer | Owns | May import |
|---|---|---|
| `core/` | the **engine floor**, in folders that import downward in the order shown above: `base/` (pure primitives: coordinates and turns, math, hashes, RNG, noise, fields, splines, colour arithmetic, guards, text, the listener signal), `game/` (the game profile and its zones), `grid/` (grids, cell conversions, rects, footprints, directions, cell sets), `provenance/` (the edit-source ledger), `model/` (the kernel types, the grid state, landmarks, planets and templates, notes, traits), `commands/` (the executor and two-phase validation, the event bus and its `KernelEvents`), then the game's terrain domain, which no kernel folder names: `domain/terrain/` (the cell stack, bridges, waterfalls) and `domain/edge-cut/` (the silhouette kernel, cut validation, locks, reconciliation, the terrain stroke policy the executor receives). It depends on `rules/` only through `model/rule-dispatcher.ts` (the validate-only interface the concrete `RuleRegistry` implements) and on the catalog only through `model/road-lookup.ts` (the paved-cell lookup `state/object-index.ts` supplies) | only itself |
| `platform/` | the browser and build boundary: build identity, the edition profile and the deployment target (`build/`), the one persisted-key table and the key vault (`storage/`), device and viewport signals (`device/`), key tokens and text entry (`input/`), frame scheduling and the module-worker client (`async/`), endpoint and prompt helpers (`remote/`), and the toast, overlay and reduced-motion channels (`channels/`) | `core` |
| `config/` | static data typed by `core`: the catalog (one item file per object, its 3D model in a `<id>.model.json` sidecar collected by `catalog/models.ts`), the category table and roles, plant species, built-in map templates and the other game data | `core`, `platform`, and `assets` beside it |
| `assets/` | static icons, fonts and team art (resolved by `icon-urls.ts`), the cursor catalogue and the brand palette | `core`, `platform`, and `config` beside it |
| `state/` | the Zustand store (wires executor, registry and bus), the item catalog, object-footprint geometry, the memoized whole-map derivations (`map-stats`, `layer-utils`), the pure selection derivations and `BlockRef` (`selection`), the editor's vocabulary above the kernel (`editing/`: tool types and modes, the edit-mode selectors, `EditorEvents`), the per-view camera pose (`view-camera`), the keymap and the fuzzy scorer (`fuzzy`) | `core` through `assets` |
| `rules/` | two-phase validators (pre-command and post-stroke), one rule family per file | `core` through `state` |
| `i18n/` | the seven-locale translation tables, the `localizedName` and `translate` helpers, and the brand name (`terms/brand.ts`) | `core` through `rules` |
| `tools/` | interaction handlers (gesture to `Command`) behind the `pointer/runtime/` contract, and the libraries, which import no pointer tool: shared placement and object edits, Smart Build macros, map readings and `generation/` (designed planets, mazes, stencil pictures, the carry between planets, and the run that builds candidates in a worker pool) | `core` through `i18n` |
| `pipelines/` | self-contained feature pipelines, one folder each behind its own door: `planet-scan/` (ground from a game recording), `stylize/` (the export illustration), `moderation/` (text and picture checks); pipelines never import one another, and what one needs from a higher layer arrives as an argument | `core` through `tools` |
| `view/` | the view side of the seam (`active-view.ts`, implementing `tools/pointer/runtime/view-seam.ts`), the shared `interaction/` pointer machine, which executes the plan the pointer-semantics floor in `interaction/press/` resolves (the button constants, the camera-verb catalogue and `resolvePress`, the one function that answers what a press, a tap and a drag each mean) and drives the active view, and the two live editing views: `map2d/` (PixiJS) and `map3d/` (three.js) | `core` through `pipelines` |
| `io/` | save and load, the share pipeline and image export | `core` through `view` |
| `editor/` | the live editor: `session/` (`currentEditor`, map installs, the session's tools), the editor's verbs in `operations/` (`newMap`, `loadMap`, `generateMap`, each a plain function taking an `EditContext` or a port), what a shell asks of the view (`host/host.ts`), the keyboard and tap command bodies (`commands/`), the interactive helpers around an operation (`editing/`) and the development-only programmatic API (`dev/`). A tool computes, `editor/` runs it against the live editor, `ui/` presents it; a pipeline is run by the surface that needs it | `core` through `io` |
| `agent/` | the LLM assistant harness (its own section below) | `core` through `editor` |
| `legal/` | policy-document source: the legal facts (`config.ts`), the constrained markdown and its parser, and the static-HTML emitter; `ui/` renders the documents | `core` through `agent` |
| `ui/` | the app roots in `app/` and the owning surfaces: `shell/` (the frame around the map: mode blocks, bars, windows), `chrome/` (modals, floating overlays, the tour, guards), `agent/` (the assistant's panel), over two shared layers: `design/` (tokens, the scaling factors, the motion registry, the cursor CSS) and `primitives/` (the generic parts and behaviour hooks any surface could reach for) | `core` through `legal` |
| entry | the root files of `src/` and `src/lite/`, which compose the app; nothing imports them | `core` through `ui` |

Ranked with a lower layer than their folder: `i18n/keys` with `config`, `i18n/terms/layer-name` with `config`, `i18n/locales/` with `config`.

<!-- generated:layers:end -->

**`core/base` and `core/grid` are the canonical primitives floor.** Every shape-free, state-free primitive lives there so no higher layer re-implements or reaches up for it: the seeded RNG (`base/rng.ts`), value noise (`base/noise.ts`), colour arithmetic (`base/color.ts`), the neighbour offsets (`grid/directions.ts`), the bfs distance field and the other cell-set measures (`grid/cell-sets.ts`), `flatIndex`/`cellKey` (`grid/rect.ts`). The game's terrain and zone colours are profile data (`game/profile.ts:PALETTE` and `ZONES`), read through `model/palette.ts`; waterfall face geometry is `domain/terrain/waterfall-geometry.ts`, and the declarative 3D `ModelSpec` shape is `config/catalog/model-spec.ts` (the shape of each `config/catalog/models.ts:CATALOG_MODELS` entry). Geometry that additionally needs the **item catalog** (object footprints: `objectRect`, `getPlacedObjectSize`, `buildObjectOccupancy`, …) sits one layer up in `state/object-geometry.ts`, so `rules/`, `tools/`, and both views under `view/` import it *downward* rather than reaching into a tool.

**`view/` holds two live editing views, not a renderer and a preview.** `map2d/` (PixiJS) and `map3d/` (three.js) both drive the same tools through the same command path. Tools and the pointer machine speak only the `ViewProjection` / `ToolOverlay` / camera-verb interfaces in `tools/pointer/runtime/view-seam.ts` (declared below `view`, which implements them), and `active-view.ts` re-points them at whichever view is showing, so no tool branches on the view mode, and adding view-specific behaviour means implementing an interface member rather than touching a tool. Each view registers its live instance for callers outside the React tree that owns the canvas: `map2d/scene/renderer-registry.ts` for whole-map capture and object-layer resync, `map3d/scene/renderer-registry.ts` for the live scene and the 3D camera pose `editor/host/host.ts` reads and saves restore.

**Where `core` needs an answer from above, it declares the question and takes it as an argument.** Two narrow interfaces on the primitives floor carry everything `core` cannot derive for itself: `model/rule-dispatcher.ts` (the validate-only slice of `RuleRegistry`) and `model/road-lookup.ts` (`RoadLookup`, "which object coats this cell?"; a coating is a catalog fact, so the edge-cut geometry is handed the lookup rather than fetching it from `state/object-index`). Both are injected into `CommandExecutor`'s constructor, and every other consumer takes them as a parameter. `__tests__/repo/import-direction.test.ts` holds the result against the order `scripts/layers.mts` declares: no file in `src/` imports from a layer above its own, the root entry files and `src/lite` ranking above every layer, apart from the edges `__tests__/repo/import-direction-allowlist.json` lists.

**The game is one profile and its data, within one terrain model.** Game facts are confined to one profile module the kernel imports, `core/game/profile.ts`, and to the data under `config/`. The profile holds the facts of the game the editor plans for: grids, chunk size and load limit, `ELEVATION_MAX`, the mountain-support thresholds `BASE_SUPPORT` and `GROUND_SUPPORT_LAYER`, the landmarks, zones and palette, and `PLANET_PROFILE` for custom planets. Rules, macros, generators and the assistant's tools read those values rather than restating them, and shared modules ask generic questions instead of naming concrete ids: zone kinds are predicates in `core/game/zones.ts` (`isSeaZone`, `isLandZone`, `isGrassZone`, `groundZone`), a landmark is reached through `core/model/landmarks.ts` (`templateLandmark`, `isLandmarkItem`), and item behaviour through catalog traits read by `core/model/traits.ts`. The kernel types an item's category as a plain `CategoryId`; the game's categories (`ItemCategory`) are data in `config/catalog/categories.ts`, which maps each to a `CategoryRole` the kernel declares in `core/model/traits.ts`, and shared code asks the role (`isPlantRole`, `isStructureRole`, `state/catalog.ts:itemRole`). `src/__tests__/core/game-facts.test.ts` counts category ids and zone-id comparisons in shared layers, and `src/__tests__/core/portability.test.ts` runs the engine under an anchor-less profile with another chunk size.

Porting to another game that shares this terrain model (a square cell grid of stacked terrain and water layers, ground zones, corner cuts, and catalog objects with placement traits) replaces:

- the profile, `core/game/profile.ts`, with its zones, landmarks, grids and thresholds;
- the data under `config/`: the catalog with its category ids and roles, plant species, built-in maps, neighbours, annotation tags and generation style;
- the assistant's game content: its prompts in `agent/prompts/` and build playbooks in `agent/skills/`;
- the pipeline profiles: `pipelines/planet-scan/profile.ts`, `calibration.json` and its landmark reader `ground/landmark.ts`, and the stylize scene wording, presets and legend colours;
- the designed generator's layout guidance, which `tools/generation/designer/` carries as code: the street ranks (`designer/types.ts:TRUNK_W`, `BRANCH_W`), the theme library `designer/themes.ts`, and the centre-to-rim, backing-hill and furnished-leisure habits its stages follow;
- the frozen wire tables where the new catalog or templates differ, since they are a format rather than branching: `io/share/codec/catalog-order.ts`, `io/share/codec/template-mask.ts`, `io/share/codec/template-record.ts`, `io/save/format/migrations/001-v1-to-v2.ts` and `io/save/canonical.ts:templateHash`, which hashes category ids;
- the surfaces that name the game or its art: Help figures, `ui/help/facts.ts` and `ui/help/search-examples.ts`, the locale tables, `i18n/terms/brand.ts`, `src/legal/`, `src/assets/`, `public/boot-guard.js` with its own copy, and `public/manifest.webmanifest`.

A game with a different terrain model also replaces:

- the terrain id sets the kernel types declare in `core/model/types.ts` (`TerrainType`, `CornerTrim`);
- the terrain model: `core/domain/terrain/`, `core/domain/edge-cut/`, `core/model/shore.ts` and the terrain rules (support, water containment, waterfalls, base support).

Each category role belongs to one category and the role set is fixed at four (`canopy`, `groundcover`, `home`, `amenity`), so a game with two tree categories or a new kind of crossing also needs engine changes.

**Module-level channels have one shape each.** `core/base/signal.ts:createSignal` is the synchronous listener channel with an optional current value, and `platform/async/worker-client.ts:createWorkerClient` is the request and response plumbing for a module worker (spawned on demand, shut down when idle, respawned after a crash). `platform/async/memo-load.ts:memoLoad` is the one shape of a lazy chunk's loader (loaded once, a failure retried by the next caller); every `React.lazy` site and the startup warm schedule (`ui/shell/warm/`) share one per chunk. `platform/async/abort.ts` is the one cancellation kit: `abortError`, `isAbortError`, `throwIfAborted`, `linkedController` (a child controller that follows its parent), `withDeadline` and `nextMacrotask`, written by hand because the oldest supported browsers lack `AbortSignal.any`, `AbortSignal.timeout` and `scheduler.yield`. `core/commands/map-edits.ts:onMapEdited` is the one "the map was edited" subscription over the bus: undo and redo emit `cells-changed` before `history-applied`, so `cells-changed` and `objects-changed` cover every edit. `platform/build/edition.ts` is the edition profile interface code asks for capabilities and copy variants, and `platform/channels/motion-state.ts` is the reduced-motion flag the renderer loops read. Higher up, `view/active-view.ts:onProjectionChange` tells a map-following overlay to place itself again, and `ui/session/use-map-revision.ts:useMapRevision` gives React surfaces the live map's edit revision.

### The canonical edit flow

Every mutation is a `Command`. The path from a user action to a rendered pixel:

1. A **tool** (or the programmatic API) builds a `Command` and calls `executor.execute(cmd)`.
2. The executor **resolves** the command (`RuleRegistry.resolve`: a bridge or ramp snapped onto a copy) and runs the **pre-command rules** over the resolved command (`RuleRegistry.validatePreCommand`). On any error the command is rejected and state is left unchanged; neither step writes to the command it was handed.
3. On success it snapshots the affected cells, **applies** the command, pushes an undo entry, and emits `cells-changed` / `objects-changed`. The executor's **stroke policy** then gets the command: the terrain policy runs an inline mid-stroke reconcile for a terrain command (a settle-only road pass plus the edge-cut repair over the command's own cells), so the map is right under the moving pointer rather than at its release.
4. A gesture's commands belong to the `Stroke` the tool began at the press (`ctx.beginStroke()`). At the end of the gesture the tool calls `stroke.commit()`, which runs in this order: the policy's pass before validation (the terrain policy's **road reconcile**, `reconcileRoads`, so its re-places are validated and auto-revertable with the stroke), then the **post-stroke rules**, then the **auto-revert loop** (offending commands popped one at a time until the state is clean, never onto the redo stack), then the policy's pass after validation (the **edge-cut reconciliation**, `reconcileCuts`), and finally `collapseHistory`, which folds the stroke and its repairs into one undo entry.
5. The **active view** redraws from the emitted events; the store never calls a view directly.

The sections below follow this dependency chain outward, from the data model to the IO/API surface. Where a subsystem has a known wart, the prose says so inline.

---

## Data Model & Types

### Responsibility

`src/core/model/types.ts` is the foundational contract for the entire editor. Every other subsystem (rules, renderer, tools, IO, state) imports from this layer; nothing here imports from them. It defines the persistent data shapes that cross the command boundary and the enum vocabularies all code narrows against. The event bus contract that decouples renderer from state is `core/commands/events.ts:KernelEvents`, which the editor extends in `state/editing/events.ts:EditorEvents`.

---

### The Cell Hierarchy

The atomic unit of state is `MacroCell` (`types.ts`): a zone enum (`CellZone`, `core/game/zones.ts`) plus a nullable `TerrainCell`. When `terrain` is `null` the cell is bare ground (layer 0): this is a deliberate sentinel rather than a default struct with `TerrainType.None`, because it keeps the common case cheap and makes "has terrain?" a single null check everywhere. `TerrainCell` (`types.ts`) holds `type` (a `TerrainType` enum), `elevation` (bounded by `ELEVATION_MAX`), and three optional fields that only exist on road/edge-cut cells: `corners?: Corners`, `patchOnly?: boolean`, and `patchBase?: number`. These optional fields are how the road/edge system piggy-backs metadata onto the same terrain slot without adding a separate data structure. `patchBase` is the load-bearing one: a Γ patch is a cosmetic fillet, so `patchBase` records the real support tier under it (0 when the fillet sits straight on the ground). Reading `elevation` on such a cell sees a block that is not there, which is why `structuralTop`/`surfaceElevation` exist and why placement and support questions must go through them.

`Corners` (`types.ts`) is a fixed-length tuple `[CornerTrim, CornerTrim, CornerTrim, CornerTrim]` in NW/NE/SW/SE order. The element type `CornerTrim` is a string union (`'square' | 'fan' | 'tri-NW' | 'tri-NE' | 'tri-SW' | 'tri-SE' | 'empty'`). The sentinel value `'empty'` signals "remove this cell entirely" in `TrimCornersCommand`: when all four corners are `'empty'`, `applyCommand` deletes the terrain cell rather than storing an all-empty `Corners` array (`command-apply.ts`). Similarly, all-`'square'` corners normalize to `corners: undefined`, since `undefined` is the canonical form for "no corner data".

`GridState` (`types.ts`) aggregates:
- `cells: MacroCell[][]`: row-major, `cells[y][x]` (documented invariant).
- `objects: Map<string, PlacedObject>`: keyed by UUID.
- `lockedLayers: Set<number>`: UI-controlled; read by `layer-lock` rule but never written by rules.
- `template: MapTemplate`: the immutable blueprint (dimensions, zone layout, landmarks), either a built-in planet from `src/config/maps/` or a custom planet template carried by the save, the share code or the planet library.

---

### The Command Discriminated Union

All mutations flow as `Command` values, a discriminated union narrowed by `cmd.type: CommandType` (`types.ts`). Its variants are:

- **`PaintTerrainCommand`**: a batch of `MacroCoord[]` plus `terrainType` and `elevation`. The batch design means a full brush stroke can be a single command, though in practice each cell in a stroke is a separate command (tools call `execute()` once per cell, accumulate them as separate undo entries, and call `stroke.commit()` at pointer-up).
- **`EraseTerrainCommand`**: same batch shape, no terrain payload.
- Both terrain commands may carry `ground` (`Void`, `Beach` or `Grass`). The cell's zone becomes that value before the terrain effect, which is how the planet session shapes layer 0; V-GROUND-LOCK refuses such a command on an ordinary map.
- **`PlaceObjectCommand`**: embeds the full `PlacedObject` struct plus `loadValue`. `loadValue` is populated by callers but not used for chunk-load accounting, which the rule computes fresh from `state.objects` (see the chunk-load section below).
- **`RemoveObjectCommand`**: names the object to remove by `objectId`; its history entry records the object for undo.
- **`TrimCornersCommand`** (`types.ts`): a union of three kinds under one command type, told apart by `layer` and `patchOnly`: `TrimTerrainCommand` recuts a terrain cell, `MaterialisePatchCommand` lays a cosmetic patch (`terrainType`, `elevation`, `patchBase`) without a support column, and `TrimRoadCommand` recuts the road `objectId`, turning it to an optional `afterRotation`. Each has its builder (`trimTerrainCommand`, `materialisePatchCommand`, `trimRoadCommand`). `afterCorners` is the corner state the trim writes; the state before lives on the history entry. What a trim does to the map is the terrain domain's `domain/edge-cut/trim-apply.ts:applyTrim`, which the executor receives as its `trims` dependency.

A command carries only what applying it reads, and each kind has one builder in `core/model/command-build.ts` (`paintTerrainCommand`, `eraseTerrainCommand`, `placeObjectCommand`, `removeObjectCommand`, and the three trim builders); production code builds commands only through them. Commands carry no time stamp: the history codec drops the one older saves wrote, so those saves still load and a re-save leaves it out. Undo/redo snapshots are never stored on the command itself: they live on `HistoryEntry` (exported from `command-apply.ts`), which holds the original `cmd`, `before`/`after` arrays of `CellSnapshot`, an optional `objectOps` (the objects the step took off the map and put on it, recorded by `execute` for every command that touches an object and netted across a group by `collapseHistory`), and an optional provenance `taint` delta restored in lockstep with the cells. `CommandExecutor.execute()` captures the before/after cell snapshots via `cloneCell` and pushes the entry. `CellSnapshot` (`types.ts`) is simply `{ coord: MacroCoord; cell: MacroCell }`.

---

### PlacedObject and the Dual Catalog Problem

`PlacedObject` (`types.ts`) is the runtime representation: a unique `id`, `catalogId` reference, `position`, `rotation`, `elevation`, and optionals (`spanLength` for bridges, `corners`/`patchOnly` for road objects, and the self-description fields `width`/`height`/`icon`/`color` plus `locked` that let a landmark such as the central plaza carry its per-map footprint and art itself, so it renders and validates with no special case). It carries no category of its own: `catalogId` determines it, and `state/catalog.ts:categoryOf` is the one way to ask, answering with the item's full category id. That matters because a projection onto fewer members cannot tell a house from a road, a bridge or a ramp, and callers then recover the difference by matching on id strings.

`CatalogItem` carries its category as a `CategoryId` (`types.ts`), a plain string: the game's categories are data in `config/catalog/categories.ts` (`ItemCategory` and the `CATEGORIES` registry), which maps each to an optional `CategoryRole` (`core/model/traits.ts`: `canopy`, `groundcover`, `home`, `amenity`); shared code asks the role (`isPlantRole`, `isStructureRole`) or a trait, never a category id. `CatalogItem` (`types.ts`) is what placement, rules and generation read of the per-object files under `src/config/catalog/<category>/<id>.json`; `config/catalog/catalog-entry.ts:CatalogEntry` extends it with the fields only rendering and search read (`iconColor`, `footprintColor`, `roadMaterial`, `surfacePrint`, `aliases`), and `state/catalog.ts` hands out entries. `PlacedObject` stores only `catalogId` and looks up its dimensional and behavioral metadata from the catalog at runtime.

---

### PlacementTrait Union

`PlacementTrait` (`types.ts`) is a tagged union declared in `types.ts`. Each variant parameterizes a validation strategy: `flat` checks uniform elevation across an extended footprint (W+1 × H+1 to account for the macro/micro grid offset; see "Coordinate duality (macro vs. micro)" below); `noFloat` requires terrain present on every footprint cell; `waterSpan` resolves a bridge by auto-detecting its orientation and snapping a copy of the command's rotation, position, span length and elevation, then validates the snapped deck (`placement.ts`); `heightDrop` similarly resolves and validates position, rotation and elevation for ramps; `surfaceCoating` requires dry terrain and declares a coating layer, with pavement at layer 0 and independent prints at layer 1; `coatingSupport` lets a structure stand above coatings; `plantable` marks a coating an item with `growsOnPlantable` (every flora item) may stand on (the game plants flowers on some path surfaces, so placing flora keeps this coating instead of stripping it, and the pair passes the standing-on-a-road rule); `exclusionRadius` enforces Chebyshev distance between same-category items; `terrainBase` declares the footprint usable as structural support for terrain above it; `halfStep` lets the item anchor on the half-cell grid in both axes (the game's exception for ramps, bridges and the landmarks; tools read the half-cell anchor from `ToolContext.point` through `core/grid/pointer.ts:halfPoint`); `footprintTurn` makes the item turn as a whole footprint about its centre, width and height swapping, while the planet session shapes the map and the item is unlocked (the central plaza, whose art rests upright in every footprint while a spin plays each turn).

Catalog `roadMaterial` (typed by `config/catalog/road-material.ts`) describes connected pavement borders and periodic finishes shared by both renderers. `surfacePrint` describes transparent per-cell vector artwork. Print rotation is stored in the ordinary object's rotation; repainting and erasing affect only the selected coating layer. `core/model/traits.ts` owns coating support and replacement relations, and the injected road lookup exposes all layers for terrain reconciliation.

The mutation-during-validation pattern for `waterSpan` and `heightDrop` is intentional: it allows the placement validation rule to both check and auto-correct object placement geometry in a single pass.

---

### Rule System Interfaces

`PreCommandRule` (`types.ts`) gates individual commands: `appliesTo: CommandType[]` lets `RuleRegistry.validatePreCommand` skip irrelevant rules cheaply. `PostStrokeRule` (`types.ts`) gets the full `GridState` with no command context: it must scan for structural violations globally. Neither mutates the map or the command; a pre-command rule may declare a `resolve` step, which returns the command as it lands (a copy when it changes) before any rule validates. `ValidationError` (`types.ts`) carries a `ruleId`, i18n `message` key with optional `messageParams` interpolation values, evidence `cells`, optional `rects` (the evidence's exact drawn body when the cause is an object rather than a grid cell: an object's footprint can sit on the half grid, so when present the error flash paints these and ignores `cells` for that error; both come out of `core/grid/footprint:bodyEvidence` so the two cannot disagree); any error refuses the command. **`cells` is the evidence contract**: the cells that *cause* the violation; complete (every offender, e.g. every non-flat cell in the `flat` trait's extended sweep, or the intersection region of an overlap), never a bare click anchor; non-spatial rules (max-count, chunk load, locked object) report the whole footprint involved. The required `grid` (a `GridId`: the profile's `PLACEMENT_GRID` or `TERRAIN_GRID`, the latter offset by `TERRAIN_GRID_OFFSET`) says which grid the evidence lies on; nothing falls back to a default grid. The error flash (`OverlayLayer.flashErrors` via the pure `view/shared/overlay/error-flash.ts:resolveErrorFlashCells`) lights exactly these cells, per-error grid, deduped across rules, and the agent bridge's `formatErrors` echoes the same coordinates to the LLM.

---

### Layer Utilities

The `LayerInfo` type (`{ elevation, cellCount }`) and the derivation that produces it live in `state/layer-utils.ts`, since it reads the per-layer counts `state/map-stats.ts` derives from the catalog.

**`getActiveLayers(state, activeLayer)`** (`state/layer-utils.ts`) derives a contiguous `LayerInfo[]` (elevation 0 up to the top) for the layer panel UI from `getMapStats(state)`; the panel names each by the game's numbering (`core/game/profile.ts:layerNumber`, the ground as layer 1). Cell counts are cumulative: a cell at elevation 3 counts in layers 1, 2, and 3; an object counts only at its own elevation, Ground included. `top` is the higher of `activeLayer` and the map's highest occupied layer, clamped to `ELEVATION_MAX`, so a newly selected empty layer still appears and an added intermediate layer stays listed once a higher one is active.

`layer-utils` contains no rule logic: V-MTN-03 (3×3 base support) lives in exactly one place, `rules/base-support.ts`. The renderer's buildable-region overlay is driven by `host.buildableRegion.show(cells)` with externally supplied cells (generation preview), not by a predictor here.

---

### Game Constants

<!-- generated:constants:start -->

Game facts. Source: [src/core/game/profile.ts](../src/core/game/profile.ts).

| Constant | Value |
|---|---|
| `PLACEMENT_GRID` | `"object"` |
| `TERRAIN_GRID` | `"terrain"` |
| `HALF_GRID` | `"half"` |
| `CHUNK_SIZE` | `16` |
| `CHUNK_LOAD_LIMIT` | `10000` |
| `CHUNK_LOAD_ENABLED` | `true` |
| `LOAD_DECIMALS` | `1` |
| `GAME_NAME` | `"Petit Planet"` |
| `ELEVATION_MAX` | `9` |
| `GROUND_SUPPORT_LAYER` | `1` |
| `ZONE_ID_BITS` | `3` |

Game colours. Source: [src/core/model/palette.ts](../src/core/model/palette.ts).

| Constant | Value |
|---|---|
| `WATER_COLOR` | `"#97e1ff"` |

Editor constants. Source: [src/view/shared/viewport/view-constants.ts](../src/view/shared/viewport/view-constants.ts).

| Constant | Value |
|---|---|
| `LOSS_COLOR` | `"#e2574c"` |
| `GHOST_LOSS` | `14833484` |

2D view units and camera bounds. Source: [src/view/map2d/geometry/world.ts](../src/view/map2d/geometry/world.ts).

| Constant | Value |
|---|---|
| `TILE_SIZE` | `64` |
| `QUADRANT_PX` | `32` |
| `ZOOM_MIN` | `0.05` |
| `ZOOM_MAX` | `4` |
| `PAN_KEEP_PX` | `160` |

<!-- generated:constants:end -->

Chunk and elevation rules, grid conversion, and camera bounds read these constants directly. `core/game/profile.ts` also holds the mountain-support thresholds (`BASE_SUPPORT`), the custom-planet facts (`PLANET_PROFILE`), the zone kinds and their traits (`ZONES`) and the terrain colours (`PALETTE`), so porting the editor to another game replaces that module and the data; `view/shared/viewport/view-constants.ts` owns the constants both views share and `view/map2d/geometry/world.ts` the 2D world units and camera bounds, and `core/model/palette.ts` derives the colour tables the renderers read. Per-item parameters such as exclusion radii belong to catalog traits.

---

### Composition with Neighbouring Subsystems

- **Rules** import `PreCommandRule`, `PostStrokeRule`, `Command`, `CommandType`, `GridState`, `ValidationError`, `PlacementTrait`: all from `types.ts`. The type system enforces the purity contract: rules receive only read-only-by-convention values and return `ValidationError[]`.
- **CommandExecutor** (`command-executor.ts`) owns `GridState` and applies mutations; it uses `CellSnapshot` for undo/redo and emits typed `KernelEvents` (`core/commands/events.ts`). The store's `EventBus<EditorEvents>` is parameterized by `state/editing/events.ts:EditorEvents`, the kernel's events plus the editor's own, giving compile-time guarantees that event payloads match listener signatures.
- **Renderer** subscribes to `cells-changed` and `objects-changed`; it reads `MacroCell.terrain.corners` to determine trim shape, `PlacedObject.elevation` for layer visibility, and `ELEVATION_COLORS`/`ZONE_COLORS` from `core/model/palette.ts`.
- **IO** (`save/json-codec.ts`) serializes/deserializes `GridState`.
- **Chunk load** is read from one place, `state/map-stats.ts`'s memoized `chunks` map (`getMapStats(state).chunks`), by both the chunk-load rule (`rules/chunk-load.ts`) and the programmatic API. Chunk load is never stored on `state` itself and no command carries a delta for it directly: map-stats derives and patches it from the same object add/remove deltas every other whole-map count already folds against, so there is one accounting path, not two.

---

## Grid Model, Event Bus & Chunk Tracking

### Responsibility

This subsystem defines the editor's spatial data model, the decoupled notification channel between state mutators and the renderer, and the accounting types for per-chunk object-load budgets. It is the foundation every other subsystem builds on: rules read `GridState`, commands mutate it via `grid-model.ts` helpers, the renderer reacts to `EventBus` notifications, and chunk-load enforcement lives in the pre-command rule, reading the same per-chunk load `state/map-stats.ts` already keeps for the whole map (see below).

---

### Grid Model (`src/core/model/grid-model.ts`)

The grid is a **row-major 2-D array** of `MacroCell` (`core/model/types.ts:MacroCell`), indexed as `cells[y][x]`. Each `MacroCell` holds a `CellZone` (set at template load; only a planet-session ground command changes it), a `TerrainCell | null`, and, on a shore-rim cell of the planet session's canvas, the optional `under`: the ground the rim covers. Null terrain means "bare ground at layer 0"; there is no stored layer-0 entry (Layer 0 = Ground, implicit).

**Grid lifecycle:**

`createGrid` (`grid-model.ts`) is the only constructor. It iterates the `MapTemplate` zone table and produces a fresh cell array with **every** cell starting at `terrain: null`. A landmark is not a terrain exception: every template records grass under its landmarks, and each landmark arrives as an ordinary locked `PlacedObject` built by `core/model/landmarks.ts:landmarkObject`, which `core/model/template.ts:createGridState` seeds into `state.objects` through `templateLandmarkObjects` (a custom planet may have none).

**Access:**

`getCell` (`grid-model.ts`) returns `null` for any out-of-bounds index; it never throws. This is the universal safe-read contract used everywhere (rules, tools, renderers). `setCell` (`grid-model.ts`) has a symmetric no-op contract for out-of-bounds writes. Together they form a boundary layer so callers never guard indices themselves.

**Mutation:**

The grid is intentionally mutable. `applyCommand` directly sets `cell.terrain` or calls `setCell` (`command-apply.ts`). The undo/redo mechanism relies on `cloneCell` (`grid-model.ts`) to capture deep snapshots before and after each command. `cloneCell` copies `zone`, the optional `under`, `terrain.type`, `terrain.elevation`, and the optional `corners` (as a fresh array copy), `patchOnly` and `patchBase` fields (`grid-model.ts`). Terrain `TrimCorners` undo/redo therefore faithfully restores corner geometry, and a ground command's undo restores the zone with the terrain.

***Grids:**

A grid is a lattice of unit cells lying at an offset against the map's own lattice ([grids.ts](../src/core/grid/grids.ts): `GridSpec`, `GridId`, `CellSet`, and the conversions `gridCellAt`, `gridCellRect`, `gridCellCentre`, `gridCellsUnder`, which take a spec and name no grid). Which grids a map has is game data: [game/profile.ts](../src/core/game/profile.ts) declares `GRIDS`, the object grid at offset 0 and the terrain grid half a cell up and left, and names their roles, `PLACEMENT_GRID` for objects, coatings and notes and `TERRAIN_GRID` for terrain and water. Terrain blocks are centred on object-grid intersections, with their top-left at `x * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x`; objects start at `x * TILE_SIZE`. [grid-convert.ts](../src/core/grid/grid-convert.ts) derives the offsets in cells from the profile (`view/shared/viewport/view-constants.ts` gives them in px), and `grid-model.ts:commandGrid` names the grid a command's cells lie on.

Every cell list that crosses a seam names its grid: overlay methods take a `CellSet` (a ghost a `MixedCellSet`, whose cells may name their own grid) or a `GridId` beside a footprint rect, `ValidationError` carries its evidence on the grid it names (`evidenceOn`), and a macro preview cell carries its own `grid`. There is no default grid anywhere on the overlay or flash path.

The seams are branded at the type level: `MapPoint` (a continuous map position), `GridCell<G>` (an integer cell of grid `G`), and `BucketCoord` (a storage chunk) apart from `RegionCoord` (a reference region). A view's `screenToPoint` returns a `MapPoint`, `cellAtPoint` turns one into a `GridCell<G>`, tool pointer methods take `(cell: GridCell<G>, point: MapPoint)`, and a cell set or validation error ties its cells to its grid, so a terrain cell cannot be handed where an object cell is expected. Brands stop at the seams; geometry inside a module is plain `MacroCoord`.

Bridge geometry lives in `core/domain/terrain/bridge-span.ts:detectBridgeSpan`: shared by the `waterSpan` trait rule and the placement ghost, so validation and preview cannot disagree about where a bridge lands.

**Pointer resolution:** a view exposes only the continuous map point under a screen point (`ViewProjection.screenToPoint`). The cell is resolved once, in [pointer.ts](../src/tools/pointer/runtime/pointer.ts): `resolvePointer(view, tool, ctx, sx, sy)` reads the point, asks the tool for its grid (`Tool.grid(ctx)`, read from the armed material, catalog item or `MACROS[id].grid`) and returns the cell on that grid (`core/grid/pointer.ts:cellAtPoint`), writing `ctx.point` and `ctx.cellPixels` beside it. `ToolManager` dispatches through it on pointer down, move and up; the pointer machine's press facts and hover probe call the same function, so the cursor's refusal badge asks exactly what the click asks. Other readers (bands, drags, region brushes, handles) use `core/grid/pointer.ts:cellUnder(projection, sx, sy, grid)`, and a half-step item's anchor reads `halfPoint(point)`. The 2D and 3D views share this rule; `__tests__/tools/pointer/runtime/pointer-resolution.test.ts` pins it per tool for a grid of screen points in both views.

The practical consequence of the `TERRAIN_GRID_OFFSET` terrain offset is captured in the "Flat trait" rule: placement flatness checks extend one extra column and row right/bottom to account for the fact that a macro cell's terrain block bleeds into the adjacent macro-grid region (`grid-model.ts` header comment); this is what prevents micro-block floating at cliff edges due to the macro/micro grid offset difference.

**The landmarks:**

A landmark is no special case in the geometry: `landmarkObject` (`core/model/landmarks.ts`) builds it as an ordinary `PlacedObject` carrying `locked: true`, and the object-collision rules (V-PLACE-BLOCK, V-PLACE-OVERLAP) are what keep terrain and placements off it. V-LOCK-02 refuses modifying it because it is locked. What remains here is the rect math those rules share: `cellOverlapsRect(rect, x, y, cellShift)` asks whether a macro cell's *area* overlaps a rect rather than whether a corner is inside, so any cell the edge cuts through counts. `cellShift` is the cell's lower-bound offset: terrain renders on the micro-grid (``TERRAIN_GRID_OFFSET``) so its cell spans `[x−0.5, x+0.5]`, while objects render unshifted and span `[x, x+1]`.

---

### EventBus (`src/core/commands/event-bus.ts`)

`EventBus<EventMap>` is a generic, synchronous, in-process pub/sub hub. It maintains a `Map<key, Set<Handler>>` (`event-bus.ts`). The generic parameter `EventMap` constrains all `on`, `off`, and `emit` calls to the same event-to-payload mapping at compile time.

The editor instantiates a single `EventBus<EditorEvents>` in the engine slice (`state/slices/engine.ts`) and shares it to both `CommandExecutor` (at executor construction time, `state/executor.ts:createExecutor`) and `MapRenderer` (at renderer construction time, `PixiCanvas.tsx`). This is the **only cross-cutting channel** between the state layer and the rendering layer; the renderer never reads `GridState` directly except when a map is installed and during snapshot operations.

**`EditorEvents` (`state/editing/events.ts`, over `core/commands/events.ts:KernelEvents`):**

| Event | Payload | Who emits | Who handles |
|---|---|---|---|
| `cells-changed` | `{ cells: CellSet[] }`, each set on the grid it names | `CommandExecutor` (execute, undo, redo, commitStroke revert) | `MapRenderer`: selective terrain redraw + layer number refresh over the terrain-grid cells |
| `objects-changed` | `{ added?, removed? }` | `applyCommand` inside `PlaceObject`, `RemoveObject`, `TrimCorners` | `MapRenderer`: object layer sync |
| `validation-failed` | `Refusal` (`{ cmd, errors }`) | `CommandExecutor.execute` on pre-command rejection; callers outside the executor report a refusal through `core/commands/refusal.ts:reportRefusal` | `MapRenderer`: flash error overlay; `Toast.tsx`: auto-show error toast |
| `tool-synced` | `{ tool: ToolType }` | `editor/session/editor-tools.ts`, after the store's tool, shape, surface, floor or brush size changed (or the map was swapped) and the ToolManager activated the bar's tool | `usePointerInteraction`: re-run the cursor's refusal probe; `use-cursor`: push the tool's cursor |
| `catalog-reveal` | `{ catalogId }` | `editor/editing/pick-selection.ts:pickSelection`, after arming the picked object | `ObjectShelf`: open the item's tab and reveal it |
| `ground-clipped` | `{}` | `DrawingTool` through `ToolContext.reportGroundClipped`, which `ToolManager` wires, when a planet-session ground stroke reached past the canvas edge | `editor/session/planet-overlays.ts`: flash the planet frame, the size limit |
| `history-changed` | `{ canUndo, canRedo }` | `CommandExecutor` after every execute/undo/redo | the undo/redo pair's enable/disable |
| `history-applied` | `{ cells: CellSet[], objects? }` | `CommandExecutor.undo()`/`redo()`, with the terrain cells the step restored (and its objects, for an object-anchored flash) | the renderer's reverted/reapplied-region flash (`resolveHistoryFlash`) |
| `viewport-changed` | `{ zoom }` | the viewport, after a pan/zoom transform applies | screen-anchored React overlays (selection handles) re-track |

**Decoupling contract:** `CommandExecutor` emits `cells-changed` after every successful state mutation. The renderer reacts by redrawing only the listed cells (`terrain-layer.ts:redrawCells`). This means the renderer is entirely driven by events and holds no authoritative state: it is a pure projection of the `GridState` via the bus.

For road `TrimCornersCommand`, `applyCommand` emits `objects-changed { removed }` followed immediately by `objects-changed { added }` on the same object (two separate `emit` calls). This causes the object layer to perform a remove-then-add cycle rather than an in-place update: a known rendering trade-off to force a sprite refresh. The executor adds a road-seam re-announce on top: a coating arriving, leaving or changing its cut re-emits `objects-changed { added }` for each road it borders, because a road tile's drawn boundary (`view/shared/road/shape.ts`) depends on its neighbours and both views answer that idiom by redrawing the object in place.

---

### Chunk Load (`rules/chunk-load.ts` reading `state/map-stats.ts`)

Chunk load has no accounting structure of its own: it is one of the whole-map figures `state/map-stats.ts` already derives and memoizes per `GridState` (`chunks: Map<chunkKey, ChunkStat>`, patched from `state.objectsDelta` the same way every other map-stats figure is; see Map Stats below). A chunk key is produced by `chunkKey` (`core/grid/rect.ts`): `"cx,cy"`, with coordinates relative to the template's reference-grid origin through `mapChunkAt`.

**How objects span multiple chunks:**

`chunksOf` (`state/map-stats.ts`, exported for `rules/chunk-load.ts` to reuse against a candidate that is not yet on the map) iterates every `(dx, dy)` offset within an object's `w × h` footprint and collects the distinct chunk keys. For a 2×2 object placed at macro (15, 15), all four cells (15,15), (16,15), (15,16), (16,16) fall in different chunks (chunk 0 and chunk 1 on each axis), so the object contributes its full `loadValue` to all four chunk buckets. This is a per-chunk-cell-coverage model, not a per-object-anchor model.

**The rule reads the memoized figure:** The chunk-load pre-command rule (`rules/chunk-load.ts:chunkLoadViolations`) calls `getMapStats(state).chunks` and, for each chunk key in the *candidate's own footprint*, checks `existing.load + loadValue` against `CHUNK_LOAD_LIMIT`, the one ceiling every chunk shares. One placement check therefore costs the candidate's own footprint, not the map's object count, as long as map-stats itself is patched rather than rebuilt (a mutation that skips or corrupts the object delta forces map-stats to fall back to a full rebuild that touches every object once: a property of map-stats's staleness-never/speed-sometimes contract, not of this rule; see Map Stats below). If `candidate.id` already names an object on the map (a caller validating a replacement before the old copy under the same id has been removed), that prior copy's own contribution is discounted per chunk so a candidate is never charged against itself.

**Enforcement policy:** `isChunkLoadEnforced` combines the game profile's `CHUNK_LOAD_ENABLED` with the live grid's `ignoreChunkLoad` session flag. The Regional load switch persists the user's preference; importing a map above the limit disables enforcement and queues a notice. Copies, worker messages and preview caches retain this policy. Disabling enforcement permits totals above the limit while keeping statistics visible. Catalog `loadUnknown` entries contribute zero and display a question mark; road surfaces are confirmed zero. `roundLoad` keeps addition and removal at the profile's measured decimal precision.

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

`command-executor.ts:CommandExecutor` is the sole mutator of `GridState`. Every change to the map (painting terrain, placing/removing objects, trimming corners) flows through its `execute()` method. It owns the undo/redo stacks and enforces correctness through a two-phase validation model: a pre-command gate that can reject individual operations, and a post-stroke sweep that auto-reverts whole sequences that leave the grid in an illegal state.

### Key Types and Data Structures

- `HistoryEntry` (`command-apply.ts`, exported: the revert/reapply state machinery lives beside it): the unit of undo history. Holds the original `Command`, `before` and `after` arrays of `CellSnapshot` (coord + deep-copied `MacroCell`) captured by the executor around the mutation, an optional `objectOps` (the objects the step removed and added, or a collapsed group's net), and an optional provenance `taint` delta. The `HistoryEntry` is the sole authoritative history record: commands carry no snapshots and no time stamp, and undo/redo snapshots live exclusively on `HistoryEntry`.
- `CellSnapshot` (`types.ts`): a `{ coord: MacroCoord, cell: MacroCell }` pair, produced by `command-executor.ts:snapshot()` via `grid-model.ts:cloneCell()`.
- `RuleRegistry` (`rules/registry.ts`): a dual-list dispatcher. Pre-command rules are filtered by `rule.appliesTo` before invocation; post-stroke rules always run against the full state. On the pre-command side all applicable rules execute to completion: errors accumulate rather than short-circuit. `validatePostStroke` takes an optional `{ firstOnly: true }`, which returns at the first rule that errors: the auto-revert and undo loops re-check with it, since inside a loop the only question is "clean yet?".
- `KernelEvents` (`core/commands/events.ts`): the typed event bus schema the kernel emits, which `state/editing/events.ts:EditorEvents` extends. The executor emits `cells-changed`, `objects-changed`, `validation-failed`, `history-changed`, and `history-applied` (undo/redo only, for the history flash).

### Phase 1: Pre-Command Validation (`execute`)

`execute()` (`command-executor.ts`) runs the full sequence:

1. `registry.resolve(cmd, state)` returns the command as it lands, and `registry.validatePreCommand(resolved, state)` fans out to all registered pre-command rules whose `appliesTo` includes `cmd.type`. History, the events and the stroke policy see the resolved command. Registered pre-command rules (in priority order, `rules/index.ts`): `layerLockRule`, `lockedObjectRule`, `elevationRangeRule`, `mountainFloatingRule`, `waterFloatingRule`, `objectBlocksTerrainRule`, `traitPlacementRule`, `groundLockRule`, `zoneRestrictionRule`, `placementOverlapRule`, `placementMaxCountRule`, `chunkLoadRule`. The planet session's registry drops `groundLockRule` and appends `planetGroundRule` (see Custom Planets below).
2. If any error is returned, `validation-failed` is emitted (picked up by `Toast.tsx` for display) and `ValidationResult { success: false }` is returned with state unchanged.
3. If clean: `getAffectedCells(cmd)` names the cells the command touches as grid-named sets (`grid-model.ts:commandGrid`): the anchor on the placement grid for `PlaceObject`/`RemoveObject` and a road `TrimCorners`, the cell list on the terrain grid for terrain commands and a terrain `TrimCorners`. The terrain-grid cells are snapshotted **before** and **after** mutation (an object edit snapshots none), the map stores copies of the object and corner arrays the command carries, the provenance recorder captures the entry's taint delta, the `HistoryEntry` is pushed to the undo stack, and the redo stack is cleared.
4. `cells-changed` and `history-changed` are emitted unconditionally on success. The executor announces only the edited object: both views rebuild the road regions within reach of a changed tile, so a neighbour's seam redraws without its own event.
5. The stroke policy's `afterCommand` runs before `execute` returns. For a terrain command (`PaintTerrain`/`EraseTerrain`) the terrain policy runs an **inline mid-stroke reconcile**: `reconcileRoads(..., { settleOnly: true })` carries a road whose footprint now stands uniform at a new level, and `reconcileCuts` repairs edge cuts over the command's own cells, so the map is right under the moving pointer, with `commitStroke`'s full passes as the backstop. A re-entrancy guard keeps the repairs (which come back through `execute`) from re-triggering the hook, and the provenance recorder marks them derived.

A subtle contract: `state` is mutated **in place** by `applyCommand`. There is no rollback path within `execute` itself: the contract is that pre-command rules must catch all failures before the mutation runs.

### `applyCommand`: Per-Command Mutations

`applyCommand` (`command-apply.ts`) is a direct switch over `CommandType`, given the map, the bus and a `TrimApplier`:

- **`PaintTerrain`**: iterates `cmd.cells`, writes `createDefaultTerrainCell(terrainType, elevation)` per cell. Special case: `Mountain` at `elevation === 0` is treated as an erase (sets `terrain = null`) rather than a paint.
- **`EraseTerrain`**: sets `terrain = null` on each cell.
- For either terrain command carrying `ground`, each cell's zone is set to that value and its `under` dropped before the terrain effect.
- **`PlaceObject`**: calls `state.objects.set(cmd.object.id, cmd.object)` and emits `objects-changed {added}`.
- **`RemoveObject`**: calls `state.objects.delete(cmd.objectId)` and emits `objects-changed {removed}`.
- **`TrimCorners`**: handed to the `TrimApplier` the caller passes (the game's is `domain/edge-cut/trim-apply.ts:applyTrim`). A terrain trim updates `cell.terrain.corners` in place, or nulls `terrain` if `afterCorners` is all-`'empty'`; a patch replaces the cell's terrain with the cosmetic column; a road trim mutates the `PlacedObject` in place (`afterCorners`, and `afterRotation` if set), or deletes it if `afterCorners` is all-`'empty'`, emitting `objects-changed {removed}` + `objects-changed {added}` to force the renderer to refresh the sprite. `execute()` emits `cells-changed` after `applyCommand` returns, so there is no duplicate emission.

### Phase 2: Post-Stroke Validation (`commitStroke`)

`Stroke.commit(opts?)` runs the executor's protected `commitStroke` from the history depth the stroke began at, which bounds how far back the auto-revert can reach. Tools call it at pointer-up. `opts.reconcile` (default true) lets a corner-only stroke skip both reconcile passes: the edge-cut tool's cuts change only the silhouette, never support, so they cannot invalidate anything.

1. **The policy's `beforeValidate` runs first**: the terrain policy's `road-reconcile.ts:reconcileRoads` over the stroke's changed cells, so a coating carried to a new level is validated (and auto-revertable) with the stroke rather than landing after judgement. It runs when the stroke changed cells or the policy holds pending work (a road parked mid-stroke); the policy's `endStroke` then drops what it held, before the rules run.
2. `registry.validatePostStroke(state)` runs all post-stroke rules (registered: `baseSupportRule`, `waterContainmentRule`, `waterfallAdjacentUniformityRule`, `objectOnCoatingRule`). These are stateful grid scans, not command-gated.
3. If violations exist, the executor enters a revert loop: it pops entries off the undo stack (up to `maxUndos = undoStack.length - strokeStartSize`) and calls the private `revertEntry(entry)` helper for each (which restores `entry.before` cell snapshots **and** undoes the command's object-layer effect; `PlaceObject` deletes the object, `RemoveObject` re-adds it, road `TrimCorners` restores corners and rotation). The popped entries are **deliberately not pushed to the redo stack**. In the code's own words, "an auto-reverted fragment is an illegal partial state: redo would reinstate it unvalidated, and the fragment (sitting below every later stroke's revert window) would then make every future commitStroke fully revert its own stroke. Auto-reverted work is simply gone." After each pop it re-checks with `validatePostStroke(state, { firstOnly: true })` and exits as soon as the state is clean or the entire stroke has been reverted. A single `cells-changed` + `history-changed` pair is emitted after all reverts are batched.
4. `commitStroke` then computes the set of cells actually changed by the surviving stroke history (entries from `strokeStartSize` to the current top), and hands it to the policy's `afterValidate`, which in the terrain policy is `cut-reconcile.ts:reconcileCuts`. That function expands the changed region to its 8-neighbourhood and issues repair `TrimCorners` commands back through `execute()` to square any stale edge cuts and patch-only terrain pieces. These repair commands join the undo stack as first-class entries, extending the stroke's history.
5. `collapseHistory` folds the whole stroke (its commands and the reconcile repairs) into one undo entry, so undo reverts a change and its repair together and can never stop at a reconcile-orphaned (illegal) intermediate.
6. `commitStroke` returns the **initial** violation list (before any revert): callers use this to show a toast message.

The undo-grouping model: all commands executed between two `commitStroke` calls form a logical stroke, and the closing collapse makes the survivors one undo entry. Post-stroke validation drives which commands survive; partial reversal is possible (earliest commands within a stroke can survive if they satisfy rules without the later ones).

Every stroke group starts at `executor.beginStroke()`, which returns a `Stroke` handle over the history above its start: `size` (entries above the start), `commands()` (the commands as applied, read before the commit folds them), `entries()` (the pre-images), `commit(opts?)`, `rollback()` and `collapse()`. The pointer tools reach it through their host (`ToolHost.beginStroke`), and a handle begun inside another acts as a savepoint (the macros take back a refused step through one). The raw steps (`commitStroke`, `rollbackTo`, `collapseHistory`, `commandsSince`) are protected, so no caller hands the executor a depth; `historyDepth()` is a depth to compare, never a start, and `__tests__/core/commands/stroke-doors.test.ts` holds the untyped harness strings to the same rule.

A caller outside the pointer tools runs its stroke group through `executor.transaction(opts, body)` (or `transactionAsync` for a body that awaits). The transaction begins the stroke, pushes the `source` authorship and applies `silent` for the body's duration, and reverts every entry above the start when the body throws. The body's handle is the group's `Stroke`: `tx.commit()` commits it, `tx.commit({ atomic: true })` reverts the whole group when the post-stroke rules report a violation, and `tx.rollback()` reverts it outright.

### Undo Semantics

`undo()` (`command-executor.ts`) pops entries one at a time, calling the private `revertEntry(entry)` helper for each, and re-checks `validatePostStroke(state, { firstOnly: true })` after each pop. It keeps undoing until the state is clean or the stack is empty. This means a single user undo can revert multiple `HistoryEntry` items, skipping through any intermediate state that would itself be illegal. The redo stack receives all popped entries in order (a user undo, unlike the auto-revert loop, produces a legal boundary that redo may safely reinstate), and the step emits `history-applied` with the cells and objects it touched so the renderer can flash the reverted region.

`redo()` (`command-executor.ts`) pops one entry, calls the private `reapplyEntry(entry)` helper (which restores `entry.after` cell snapshots and re-applies the command's object-layer effect: the exact inverse of `revertEntry`), pushes it back to the undo stack, and emits the same `history-applied`. Redo does not validate: it trusts that the after-state was valid when it was originally executed.

**`revertEntry` / `reapplyEntry`:** the shared implementation for undo, redo, and `commitStroke`'s revert loop. On the executor they are one-line wrappers that restore the entry's provenance taint in lockstep and then delegate to `revertEntryState`/`reapplyEntryState` in `command-apply.ts`, which restore the relevant cell snapshots (`before` for revert, `after` for reapply) **and** replay the entry's `objectOps`: revert deletes what it added and restores what it removed, reapply the reverse, so a placement, a removal, a road trim (a road deleted by an all-`'empty'` trim included) and a collapsed group all undo through one path. Each call emits the corresponding `objects-changed` event.

**Batch commits** (`command-executor.ts`): batch operations (generation, Clear, the agent's write tools) commit their stroke the same way to make their whole run one undo step. It collapses the stroke into a single undo entry via `collapseHistory`, which merges the earliest `before` and latest `after` snapshot per cell **and** the net object add/removes across the group (`HistoryEntry.objectOps`), so a batch that mixes terrain edits with object placement/removal (e.g. terrain generation, or the Generate shelf's Clear that wipes tiles + placements) undoes/redoes as one step. A terrain-only batch carries an empty `objectOps` and collapses on its cell snapshots alone. `Stroke.rollback()` is a silent, unconditional revert of everything above the stroke's start (no redo entries, no per-entry validation), for callers that must guarantee "nothing happened" after a mid-operation failure: the agent tool bridge rolls a crashed stroke back to its start with it.

### Stroke Policy

The executor is built as `new CommandExecutor(state, { bus, rules, policy, provenance })`; `provenance` is the `HistoryRecorder` (`core/model/history-recorder.ts`) that records authorship for the executor's map, and every field is required. `core/model/stroke-policy.ts` declares `StrokePolicy`, the hooks above in their fixed order (`afterCommand`, `pending`, `beforeValidate`, `endStroke`, `afterValidate`), and `StrokeKernel` (`state`, `execute`, `validatePre`), the executor as a policy sees it. Every hook is optional, so a policy with no hooks adds nothing; the kernel tests run on one. `endStroke` also runs whenever the open stroke is abandoned by a rollback, an undo, a redo or a restored history. A commit with `{ reconcile: false }` skips `beforeValidate` and `afterValidate`. The policy's commands go through the kernel's `execute`, so a subclass that records commands (the macro scratch executor) records the repairs too.

`core/domain/edge-cut/stroke-policy.ts:terrainStrokePolicy(roadAt)` is the game's policy: it owns the stroke's parked-road pool and runs both reconcile passes. `state/executor.ts:executorDeps` builds the deps with a fresh terrain policy bound to the same map's road lookup, and `createExecutor` is `new CommandExecutor(state, executorDeps(...))`. `reconcileCuts` (`cut-reconcile.ts`) and `reconcileRoads` reach the executor only through the policy's `StrokeKernel` (`reconcileCuts` needs only its `state` and `execute`, `reconcileRoads` also `validatePre`), plus the `roadAt` lookup that answers which cells are paved. These narrow interfaces let both reconcile passes be tested independently and keep them decoupled from full executor semantics. Repair commands are plain commands, meaning they go through pre-command validation and produce their own `HistoryEntry` items. Undo fidelity is complete: `cloneCell` copies corner data, and a road's corners and rotation before and after a trim are recorded in the entry's `objectOps`.

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
- State is only mutated during `execute()` / `undo()` / `redo()` / `commitStroke()`, never by rules or the event bus.
- The executor holds a reference to the same `GridState` instance that the store, renderer, and rules all share; mutations are immediately visible to all readers.

---

## Provenance: the Edit-Source Ledger (`src/core/provenance/`)

Every unit of map content (each terrain cell and each object) carries a taint saying whose work it is. `core/provenance/` holds the machinery (`types.ts`, `policy.ts`, `tracker.ts`, `serialize.ts`), and `core/commands/provenance-recorder.ts`, the `HistoryRecorder` the executor receives in its deps, threads it through the executor: a caller declares who is editing with a transaction's `source` (the UI, the generator, the agent), the recorder captures a `TaintDelta` on every `HistoryEntry`, and `revertEntry`/`reapplyEntry` restore the taint in lockstep with the cells, so undo history and authorship history can never disagree. Work a pass derives from other work (the road and cut reconciles) runs inside `deriveScope`, so a repair inherits its trigger's authorship rather than claiming its own.

The readers: `ProvenanceTracker.cellAuthor(x, y)` and `objectAuthor(id)` answer `'ai' | 'human' | 'procedural' | null` via `policy.ts:dominantAuthor`, and `getSummary()` produces the `MapProvenanceSummary` the share exporter embeds as the map's disclosure. The Generate shelf's Clear is the load-bearing consumer: it takes back a generation while sparing anything a person placed or painted inside the same region (`editor/operations/generate.ts` passes `cellAuthor(x, y) === 'human'` as the spare predicate). The ledger serializes into the save envelope (`SaveFile.provenance`) and survives a round-trip; a map loaded without one has no authorship to read.

---

## Rule Registry & Pre-Command Rules

### Responsibility

The rule system is the editor's contract enforcement layer. Its sole job is to answer two questions at two different points in the editing lifecycle: (1) "Is this individual command legal to apply right now?" (pre-command), and (2) "Is the overall grid state legal after the user finishes a stroke?" (post-stroke). This document focuses on the pre-command half and the registry that hosts both phases.

### RuleRegistry

`rules/registry.ts:RuleRegistry` is a simple dispatcher. It holds two typed arrays (`preCommandRules: PreCommandRule[]` and `postStrokeRules: PostStrokeRule[]`) and exposes validation and introspection methods:

- `register(rule: AnyRule)`: appends to the correct array based on `rule.phase`.
- `resolve(cmd, state)`: runs each applicable rule's `resolve` step in order and returns the command as it lands: `cmd` itself when nothing changes, a copy otherwise. Resolving a resolved command returns it, so a recorded command replays as it landed.
- `validatePreCommand(cmd, state)`: resolves `cmd`, iterates `preCommandRules`, skips any whose `appliesTo` array does not contain `cmd.type`, and accumulates errors from the rest. All applicable rules always run; there is no short-circuit on first error. Neither method writes to the command or the map.
- `validatePostStroke(state)`: iterates `postStrokeRules` unconditionally (post-stroke rules have no `appliesTo` filter) and accumulates errors.

The `appliesTo` field is a `CommandType[]` on `PreCommandRule` (`core/model/types.ts:PreCommandRule`). This means the dispatch cost is O(R × |appliesTo|) per call, where R is the number of registered rules. The registry scans each rule's declared command set; registration and dispatch remain separate from validation behavior.

### createDefaultRegistry

[createRuleRegistry](../src/rules/index.ts) is the sole assembly point: it builds a named rule set (`RuleSetName`, `default` or `planet`) by registering the canonical rule list into each rule's declared phase. `createDefaultRegistry()` and `createPlanetRegistry()` name its two sets, and `ruleSetOf(registry)` reads the set a registry was built as, so the generation worker pool sends it with every job and a worker judges the job by the asking map's rules.

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
| 8 | `V-PLACE-DOOR` | pre-command |
| 9 | `V-GROUND-LOCK` | pre-command |
| 10 | `V-ZONE-01` | pre-command |
| 11 | `V-PLACE-OVERLAP` | pre-command |
| 12 | `V-PLACE-MAX` | pre-command |
| 13 | `V-CHUNK-01` | pre-command |
| 14 | `V-MTN-03` | post-stroke |
| 15 | `V-WTR-02` | post-stroke |
| 16 | `V-WTR-03` | post-stroke |
| 17 | `V-PLACE-COATED` | post-stroke |

<!-- generated:rules:end -->

This order decides only which message wins in the UI, since errors accumulate into one `ValidationError[]` rather than short-circuiting. Every rule judges the resolved command, so zone and overlap see a bridge's or ramp's snapped footprint wherever they are registered.

Rules carry only their own messages. How each policy is explained to the assistant, which names its tools and prompt sections, is `agent/tools/rule-hints.ts:RULE_HINTS`, keyed by rule id; the system prompt and refusal feedback read it there, and a test requires an entry for every registered rule.

A registry is a value object: each installed map gets the instance its caller builds, and the executor holds it (see `command-executor.ts:CommandExecutor`). An ordinary map is installed with `createDefaultRegistry()`; the planet session installs `createPlanetRegistry()`, which registers every default rule except V-GROUND-LOCK and then V-PLANET-01 last. Rules are stateless singletons exported from their files; there is no per-registry rule state.

### How rules plug into the editor lifecycle

`command-executor.ts:CommandExecutor.execute()` resolves the command and calls `registry.validatePreCommand(resolved, state)` before touching state. If any errors are returned, it emits a `validation-failed` event (which `Toast.tsx` handles automatically) and returns `{ success: false }`: state is never mutated. If all rules pass, the command is applied and snapshotted for undo/redo.

`CommandExecutor.commitStroke()` calls `registry.validatePostStroke(state)` after the stroke's last command. On violations it incrementally undoes commands until the state is clean again. Rules never mutate state and never interact with undo/redo directly.

### GridState contract that rules read

Every rule receives `state: GridState` (`core/model/types.ts:GridState`), which contains:
- `cells: MacroCell[][]`: row-major `cells[y][x]`, accessed via `grid-model.ts:getCell` (returns `null` for out-of-bounds). A cell with `terrain: null` is grass at elevation 0.
- `objects: Map<string, PlacedObject>`: keyed by object ID.
- `lockedLayers: Set<number>`: the buildable layers that the user has locked.
- `template: MapTemplate`: static map geometry including its `landmarks`.

Rules read this state and the command purely; the `waterSpan` and `heightDrop` traits snap a copy of the command in V-PLACE-TRAIT's resolve step (described below).

### Pre-command rules in detail

**V-LOCK-01 (`layer-lock.ts`)**: Applies to `PaintTerrain` and `EraseTerrain`. Fast-paths on an empty `lockedLayers`. For `PaintTerrain`, it first checks whether the *target* elevation is locked (blocking entire command immediately), then checks existing terrain at each cell. For `EraseTerrain` it only checks existing terrain. The helper `isOccupyingLockedLayer` walks layers 1..cell.terrain.elevation for each cell. This reflects the cumulative-layer model: a cell at elevation 3 occupies layers 1, 2, and 3, so locking any of those blocks the cell.

**V-ZONE-01 (`zone-restriction.ts`)**: Rejects any edit on a non-Grass zone (`isBuildableZone`). For `PlaceObject` it walks the rotated footprint from `getPlacedObjectSize` and reads the item's ground zones (`core/model/traits.ts:groundZonesOf`, the `groundZones` trait: wholly on grass, wholly on sand, across the boundary; grass alone by default), refusing a footprint across grass and sand with `error.across_zone_boundary` unless the item allows it; for terrain edits it walks the command's own cells. Out-of-bounds differs by command on purpose: an object may not hang over the void, so a null cell is an error there, while a terrain edit off-map is simply skipped. It does not apply to `RemoveObject`: removal must always succeed, or an object that somehow reached a non-grass cell could never be cleared. The plaza needs no clause of its own here: it is a locked object, and the object rules cover it. One error per invalid cell. A planet-session ground command rewrites the zone itself, so it is checked only for the half-cell bleed: a ground command that leaves a cell non-grass while its right, lower or lower-right neighbour holds terrain is refused with `error.ground_under_block`.

**V-GROUND-LOCK (`ground-lock.ts`)**: Applies to `PaintTerrain` and `EraseTerrain`, in the default registry only. It refuses any terrain command that carries `ground`, so the ordinary editor never edits layer 0; the ground shape belongs to the planet session.

**V-PLANET-01 (`planet-ground.ts`)**: Applies to `PaintTerrain` and `EraseTerrain`, in the planet registry only. It refuses a ground edit under any placed object's footprint, reading `object-index` rather than scanning the objects, which keeps every landmark on its ground. Neither ground rule reads the shore rim: a ground command sets the zone outright, and the session re-derives the rim after the command.

**V-MTN-01 (`elevation-range.ts`)**: Applies to `PaintTerrain`. Guards only `TerrainType.Mountain` commands. Returns a single error for the whole command (not per-cell) if `cmd.elevation` is outside `[0, ELEVATION_MAX]`. Elevation 0 is valid because it is the clear-terrain sentinel in `applyCommand()`.

**V-MTN-02 / V-WTR-01 (`floating-block.ts`)**: Both rules come from one `floatingBlockRule` check. Applies to `PaintTerrain`. Skips elevations ≤ 1 (layer 1 is always supported by the implicit ground). For each cell in `cmd.cells`, reads existing terrain and rejects if `cell.terrain.elevation < cmd.elevation - 1` (or if no terrain at all). Water counts as valid support for floating purposes; the rule checks only structural adjacency, not terrain type. Two distinct rule instances (`mountainFloatingRule`, `waterFloatingRule`) are registered separately and both appear in `appliesTo: [CommandType.PaintTerrain]`.

**V-PLACE-BLOCK (`object-blocks-terrain.ts`)**: Applies to `PaintTerrain` and `EraseTerrain`. For each edited cell it asks `object-index`'s `entriesNear` what is there rather than scanning `state.objects`: a stroke issues one command per cell, so a scan here would cost cells × objects. Each blocker is reported once, with its whole footprint as the error's evidence cells. Footprints come from `getPlacedObjectSize`, which accounts for rotation and bridge `spanLength`.

**V-PLACE-OVERLAP (`placement-overlap.ts`)**: Applies to `PlaceObject`. Checks the incoming footprint against the objects already there, and returns on the first conflict. It sees the **snapped** footprint: `traitPlacementRule` runs before it, so a bridge or ramp that auto-oriented during trait validation is judged where it will actually land. A `surfaceCoating` (road) is exempt: a road is coated over, not collided with, and the placer strips the overlapped coatings itself.

**V-PLACE-TRAIT (`placement.ts:traitPlacementRule`)**: The richest pre-command rule. Applies to `PlaceObject`. Dispatches each trait in `item.traits` to its validator in `placement.ts:TRAIT_VALIDATORS`, which names one for every trait type. Traits are processed sequentially and errors are accumulated.

The trait validators cover these trait types:

- `flat`: Iterates `dx` 0..w and `dy` 0..h (i.e., `(w+1) × (h+1)` cells, expanding the nominal footprint by one column right and one row down). Rejects if any cell has water or a different elevation from the footprint's first cell. This +1 extension compensates for the macro/micro grid offset where micro-blocks sit at `x * TILE_SIZE + TERRAIN_GRID_OFFSET_PX`, causing the rightmost/bottom column of a multi-cell object's visual footprint to overlap the next macro column.

- `noFloat`: Checks every cell in the standard footprint has non-null terrain. Any missing terrain (grass at ground level) causes rejection.

- `waterSpan`: The most complex trait. Handles bridge placement, delegating the geometry to `detectBridgeSpan` (`core/domain/terrain/bridge-span.ts`), which is shared with the placement ghost so preview and validation can't drift. A bridge spans any *below-deck* gap: water, off-map void, or lower terrain. Using an "effective level" (water/off-map read as below everything), it scans both orientations out from the clicked gap cell to the two raised, **flat, equal-height** ends, validates the full-width gap (below deck) + flat ends, and checks the gap length against `trait.min..max` (3–6, unchanged). On success the resolve step snaps a copy's rotation, position (the near end), span length and elevation (the deck height), so the bridge auto-snaps rather than requiring precise placement; a deck that already stands as snapped (`bridgeSpanHolds`) resolves to itself. Validation refuses a deck that does not stand with `error.bridge_invalid`.

- `heightDrop`: The ramp placement handler. Ramp lengths come from the catalog and reserve 0.5 cell on the upper tier and the remaining length on the lower tier. Scans all four cardinal neighbors for an elevation difference exactly equal to `trait.layers`. For each valid neighbor it determines rotation (0/90/180/270 based on slope direction), computes a footprint that spans from the high side, then validates at micro-block resolution that all cells have the expected elevation. Also validates that the high-side terrain provides full-width support. On success the resolve step snaps a copy's rotation, position and elevation; a ramp that already stands as snapped (`rampSpanHolds`) resolves to itself. Validation returns `error.ramp_wrong_height` for a ramp that does not stand.

- `surfaceCoating`: Checks every cell in the footprint has non-null, non-water terrain. Roads must be placed on land. Simple rejection with `error.road_needs_terrain`.

- `exclusionRadius`: Two items that both carry the trait keep the larger of their radii as open cells between their footprints, diagonals included (`spacingClash`, which generators ask before planting). Trees and houses carry it, so two houses, a house and a tree, and two trees each keep a cell apart, refused with `error.house_too_close`, `error.house_tree_too_close` or `error.too_close_same_kind`.

- `terrainBase`: Not a placement check but a declaration: this object's footprint counts as solid structural support at its own elevation, so terrain may use it as the 3×3 base V-MTN-03 asks for. The central plaza is the only carrier today, and its `CatalogItem` body lives in `config/catalog/landmark.json`, listed with the other landmarks in `config/catalog/landmarks.ts` outside every category barrel, so it never appears in a placement list.

- `plantable` and `growsOnPlantable`: Passive markers: an item with `growsOnPlantable` (every flora item) may stand on a `plantable` coating. Placing flora keeps the coating instead of stripping it, and the pair passes the standing-on-a-road rule (V-PLACE-COATED reads it).

- `halfStep`: Passive: grants the item a half-cell anchor on both axes (`state/object-geometry:hasHalfStep`). An item without it is what the fractional-position guard rejects, so ramps, bridges and the landmarks may sit flush with the terrain grid while everything else stays whole-celled.

- `footprintTurn`: Passive: the item turns as a whole footprint about its centre (width and height swap) instead of by its own rotation, and only while the planet session shapes the map and the item is unlocked (`editor/operations/planet-session.ts:turnsInSession` is the one test every rotate entry point asks). The central plaza is the only carrier; on a finished map it is locked, so it never turns there.

**V-PLACE-DOOR (`door-ground.ts`)**: Applies to `PlaceObject`, `PaintTerrain` and `EraseTerrain`. A house with a door (`state/object-geometry.ts:hasGate`) needs the ground in front of its whole door side (`doorGroundRect`, with the depths in `core/game/profile.ts:DOOR`) to be land no lower than the house to the drop depth, and neither higher than the house nor water to the rise depth. A placement is refused where the strip fails; a terrain or ground edit is refused only where it breaks a strip that held before it, so a map saved with a broken doorstep still opens and edits. Evidence is the strip itself.

**V-CHUNK-01 (`chunk-load.ts`)**: Applies to `PlaceObject` when `isChunkLoadEnforced(state)` is true. The rule prices objects from the catalog and compares each touched region's resulting load with `CHUNK_LOAD_LIMIT`; exactly the limit is permitted. Cosmetic patches do not contribute load. A replacement subtracts its prior contribution in each region it already touched. On an overloaded map where the user re-enables enforcement, neutral and cheaper replacements remain possible, while placements that increase an overloaded region's load are refused.

### Composition with neighbouring subsystems

The registry is the seam between tools (which produce commands) and the executor (which applies them). Tools construct commands and call `executor.execute()`; the executor populates `HistoryEntry.before`/`after` from cell snapshots: commands carry no snapshot data. The executor never consults rules independently of the registry. The registry itself has no knowledge of tools, rendering, or state storage.

The `waterSpan` and `heightDrop` traits transform the command in the resolve step, never in validation: the executor resolves, validates the resolved command and applies it, so the placed object carries the auto-snapped position, rotation and span while the caller's command is left as it was.

`object-blocks-terrain.ts` and `placement-overlap.ts` both import the span-aware footprint geometry (`getPlacedObjectSize` / `objectRect`) from `state/object-geometry.ts`: a clean *downward* dependency (`rules/` → `state/`). It sits in `state/` (it only needs the catalog) so the rules, the tools, and both editing views under `view/` all import it downward instead of reaching up into a tool.

---

## Post-Stroke Rules & Waterfall Detection

### Responsibility and Position in the Pipeline

Post-stroke rules are the second validation phase in the two-phase rule system. Unlike pre-command rules (which gate individual `Command` objects before they mutate state), post-stroke rules receive no command context at all: they are passed only the full `GridState` and are expected to scan it for structural invariant violations. The post-stroke policies are:

- **`base-support.ts`**: rule `V-MTN-03`, checks 3x3 structural base requirements for high mountains
- **`water-containment.ts`**: rule `V-WTR-02`, checks that every water cell's open faces are perpendicularly capped by mountains
- **`waterfall-uniformity.ts`**: rule `V-WTR-03`, checks that the row immediately downstream of every capped waterfall face has uniform elevation
- **`object-on-coating.ts`**: rule `V-PLACE-COATED`, checks that nothing stands on a road. It is post-stroke by necessity: the overlap rule exempts coatings so the placement ghost stays green over a road the click will strip, so only the finished stroke can tell "coated over" from "left standing on" (bridges and ramps are exempt; a crossing deck is paved across on purpose)

The canonical waterfall geometry primitives both water rules share live in **`core/domain/terrain/waterfall-geometry.ts`** (pure geometry over the grid, not a rule). It belongs on the primitives floor rather than in `rules/` because the edge-cut kernel (`core/domain/edge-cut/trim-lock`) needs it too, and a copy in `rules/` would force a `core/` → `rules/` upward import. From `core/domain/terrain`, every importer (the two water rules, the edge-cut kernel, the 2D terrain layer and the 3D scene) depends on it downward.

The design motivation for post-stroke (vs. per-command) validation is that these invariants are fundamentally relational: whether a water cell is properly capped depends on what its neighbours are, and a single brush stroke may legally remove a capping mountain only if the water cell is simultaneously removed in the same stroke. Evaluating these constraints per-command (one `PaintTerrain` at a time) would reject intermediate states that are legal in aggregate. Post-stroke validation defers judgement until the user lifts the mouse.

### Integration with CommandExecutor

The entry point is `command-executor.ts:commitStroke`, reached through `Stroke.commit`. Tools commit the stroke they began at `pointerdown` when a brush stroke ends. `commitStroke` delegates to `rules/registry.ts:validatePostStroke`, which iterates all registered `PostStrokeRule` instances in registration order (base-support → water-containment → waterfall-adjacent-uniformity → object-on-coating, as declared in `index.ts`'s `ALL_RULES`).

If `validatePostStroke` returns violations, `commitStroke` auto-reverts: it pops entries from the undo stack one at a time (up to `maxUndos = undoStack.length - strokeStartSize`), restoring the `before` snapshot for each command, and re-runs `validatePostStroke` after every pop. It stops as soon as the state is clean or the entire stroke has been unwound (`command-executor.ts`). The initial violation list (from the first check, before any undo) is what `commitStroke` returns to the tool; the tool is responsible for showing a toast. This asymmetry (`validation-failed` event for pre-command failures, direct return value for post-stroke) is a deliberate design choice.

The road reconcile (`reconcileRoads`) runs before the post-stroke validation, so a coating it re-seats is judged and auto-revertable with the stroke. After any auto-revert (and after recording the final clean set of commands), `commitStroke` calls `reconcileCuts` to repair edge-cut corners invalidated by the stroke. The post-stroke rules therefore run between the two reconcile passes, and the geometry the cuts are reconciled against is already in the clean, rule-satisfying state.

The same `validatePostStroke` call also drives undo behaviour (`command-executor.ts`): when the user presses Undo, the executor pops commands one at a time until the undo-ed state also satisfies all post-stroke rules, skipping intermediate states that would be invalid.

### core/domain/terrain/waterfall-geometry.ts: Shared Geometry Primitives

The module keeps two face types to itself:

- `WaterfallFace` (`{ x, y, flowDirection: Direction }`): a single flow-direction on a single water cell
- `WaterfallInfo` (`{ cells: MacroCoord[], faces: WaterfallFace[] }`): aggregated per water cell (the `cells` array is always a singleton)

The primitive helpers are:

- `cellElevation(state, x, y)`: returns `-1` for out-of-bounds (treats the map edge as a lower-elevation drain), `0` for `terrain: null` (implicit ground), or `terrain.elevation` otherwise.
- `isWaterAtElev`: the typed cell-type predicate `waterfall-uniformity.ts` walks a strip with.
- `traceToMountain(state, x, y, elev, dx, dy)`: walks in direction `(dx,dy)` from one step past `(x,y)`, passing through cells that are water at exactly `elev`. Returns `true` if and only if the first non-matching cell is a mountain at exactly `elev`. Returns `false` for ground, map edge, or a mountain at a different elevation. The "exactly equal" constraint for the capping mountain's elevation (not `>=`) is the capping rule itself: only a mountain at the water's own elevation caps it, and one standing higher does not.

`detectWaterfalls(state)` is a full O(width × height × 4) grid scan. For every water cell, it tests each cardinal direction for a height drop; for each such face, it calls `traceToMountain` in both perpendicular directions. Only faces with both perpendicular traces returning `true` (i.e., fully capped faces) are included. A deduplication set (`processed`) ensures each water cell appears at most once in the output even if it has multiple capped faces. The function is called both by the two water rules and by `terrain-layer.ts:drawWaterfallIndicators` for rendering the directional arrow overlays: the renderer only uses `info.faces`.

Because `cells-changed` fires once per command (a brush stroke issues dozens), the renderer does not re-run this full-grid scan per event. `touchesWaterfallDependency(state, x, y)` (same module) answers whether an edit at a cell could possibly alter the face set: every cell a face depends on (the water cell itself, its 4-neighbours (the height-drop elevations), the same-elevation trace cells, and both cap terminators) is water or cardinally adjacent to water in any state where the face exists. `TerrainLayer.redrawCells` recomputes arrows only when a changed cell passes that test or carried a face at the last draw (the erase-a-whole-body-in-one-command case, checked against the layer's memoized last face set); `drawFull` always recomputes.

### base-support.ts (V-MTN-03)

The thresholds come from `core/game/profile.ts:BASE_SUPPORT` (`fromLayer` 4, `reach` 3, `window` 3), the same values the macros, generators and assistant tools read. The rule iterates all cells, filters for `TerrainType.Mountain` whose standable surface (`surfaceElevation`: a Γ patch counts as its `patchBase`, not its cosmetic tier) is at least `BASE_SUPPORT.fromLayer`, and for each invokes `has3x3Base`. Mountains below that layer are exempt because ground (elevation 0) always provides a valid base and the check would be redundant. Object footprints tagged `terrainBase` (the plaza) are collected once up front and act as solid support at their own elevation.

`has3x3Base` needs some elevation `E` in `[max(1, targetElev - 3), targetElev - 1]` at which the full centered 3×3 is solid. Per-cell support ("surface/base reaches `>= E`") is monotone decreasing in `E`, so such an `E` exists iff the lowest candidate works: the implementation makes one pass over the 9 cells at `E = max(1, targetElev - 3)`: each cell must exist and have solid mass reaching `>= E`: a Mountain surface counts at its own `surfaceElevation`, a Water surface one tier below its own `surfaceElevation` (the riverbed under the depth-1 water block, never the water block itself), or a covering `terrainBase` footprint with `elevation >= E`. The base is strictly below the cell by construction, only elevations `< targetElev` are candidates.

### water-containment.ts (V-WTR-02)

This rule ensures every water cell is fully contained: every face with a lower-elevation neighbour must have mountain caps on both perpendicular ends. It mirrors the geometry of `detectWaterfalls` but reports violations instead of detecting valid waterfalls.

The scan is also O(width × height × 4). For each water cell, it checks four cardinal faces. If a neighbour is out-of-bounds (`!neighborCell`), the face is immediately reported as uncapped and the inner loop breaks (one error per cell, not per face). If the neighbour exists and is lower, `traceToMountain` is called in both perpendicular directions (imported from `core/domain/terrain/waterfall-geometry.ts`). If either returns false, an error is pushed and the inner loop breaks.

`DIR_OFFSETS` and `PERP_DIRS` come from `core/grid/directions.ts`, and `cellElevation` and `traceToMountain` from `core/domain/terrain/waterfall-geometry.ts`; the rule holds no geometry of its own.

### waterfall-uniformity.ts (V-WTR-03)

This rule validates the "adjacent row uniformity" constraint: for every capped waterfall face, the full-width row of cells one step downstream (including the capping mountains at both ends) must all share the same elevation.

The outer loop is the same water-cell-and-direction scan as `detectWaterfalls` and `water-containment`. When it finds a water cell with a lower-elevation neighbour, it calls `traceToMountain` in both perpendicular directions to confirm the face is capped (importing `traceToMountain` and `cellElevation` from `core/domain/terrain/waterfall-geometry.ts`).

For each confirmed capped face, it:

1. Calls the private `fullStrip` to build the ordered strip of cells as a `MacroCoord[]`: `[capA, ...waterCells..., capB]` along the perpendicular axis. `fullStrip` walks outward in both directions through same-elevation water cells, then appends the bounding mountain cell at each end.
2. Constructs a `faceKey = "${strip[0].x},${strip[0].y},${flowDir}"` for deduplication, anchored to the first cap mountain. This correctly collapses multiple water cells in the same strip: all of them discover the same strip and produce the same key.
3. Calls `checkAdjacentRowUniformity`, which reads the elevation of each cell in the strip shifted one step in the flow direction, checks if they are all equal to the first element's elevation, and pushes an error for each non-equal cell. Out-of-bounds adjacent cells receive elevation `-1` (via `cellElevation`); if the entire adjacent row is off-map, they are all `-1` and therefore uniformly equal: no violation, as confirmed by the test at `waterfall-uniformity.test.ts`.

Like `water-containment.ts`, it takes its direction tables and cell-elevation reads from the shared `core/domain/terrain/waterfall-geometry.ts` rather than restating them.

### Invariants Maintained

After every committed stroke:

- No mountain at elevation >= 4 lacks a valid 3×3 support block at some elevation in the range `[targetElev-3, targetElev-1]`.
- No water cell has an open face (lower-elevation cardinal neighbour) without mountain caps on both ends of the perpendicular axis at exactly the water cell's elevation.
- No capped waterfall face has a non-uniform elevation profile in the immediately downstream row.

These invariants are guaranteed by auto-revert in `commitStroke`: if the post-stroke check fails, the stroke is wound back until the state is clean again. The same invariants are re-checked on every Undo step.

---

## Edge-Cut System: Validation, Locking & Reconciliation

### Responsibility

This subsystem owns the geometry of edge-cut corners: both the rules about which corner shapes are legal in a given context, and the repair pass that keeps existing cuts consistent after the grid changes under them. Its core files: `silhouette.ts` (the layer-occupancy kernel every other module sits on, over the per-cell stack reads of `core/domain/terrain/terrain-surface.ts`), `cut-validator.ts` (edge-coverage geometry + cut legality), `trim-lock.ts` (which corners are frozen by neighbourhood), `road-cut-states.ts` (canonical road-cut states + rotation/connection helpers), and `cut-reconcile.ts` (the driven-to-fixpoint repair pass). Beside them: `patch-corners.ts` (the quadrants a Γ patch's corners stand in), with the corner and quadrant index helpers in `core/model/corners.ts`. The geometry only the renderers draw lives in `view/shared/`: `terrain/cut-backing.ts` (the pure per-corner backing-fill derivation both renderers draw a cut's revealed surface from, with the reveal tiers), `terrain/patch-split.ts` (the per-corner Γ-patch base and fillet split), `road/shape.ts` (a road tile's drawn outline, for ghosts and stand-ins), and `road/region.ts` (a connected same-material road surface as one region; the feather geometry both renderers share). The subsystem plugs into `command-executor.ts:commitStroke` and, mid-stroke, into `execute()`'s inline reconcile.

### Key Data Structures

A `Corners` tuple (`types.ts`) holds four `CornerTrim` values: one per sub-block corner in TL/TR/BL/BR order. Each value is one of `square | fan | tri-NW | tri-NE | tri-SW | tri-SE | empty`. Terrain cuts live on `TerrainCell.corners` (`types.ts`); road cuts live on `PlacedObject.corners` (`types.ts`). `undefined` corners and an all-`square` corners array are treated identically by the executor (both normalize to `undefined` on write: `command-executor.ts`). Gamma-patches (`patchOnly: true`) are a special terrain cell variant whose sole purpose is to fill the concave inner corner left by three abutting filled cells; they carry exactly one non-`empty` corner.

The `TrimCornersCommand` (`types.ts`) is the only mutating unit this subsystem issues. It records the cell, the layer, an optional `objectId` for roads, `afterCorners`, and an optional `afterRotation` for road rotation changes; the state before is the history entry's. `applyTrim` lands it on terrain or road, including the special case of all-`'empty'` `afterCorners`, which clears the terrain cell or deletes the road.

### Edge-Coverage Model (`cut-validator.ts`)

The geometric core models each macro-cell edge as a unit interval [0, 1] and asks: which sub-intervals does a given `Corners` configuration cover on a given side?

`SIDE_CONTRIBUTIONS` (`cut-validator.ts`) maps each side (N/S/W/E) to the two corner positions that contribute to it, each owning one half of the interval. `shapeProvidesCoverage` (`cut-validator.ts`) decides whether a corner's shape actually covers its half: `square` and `fan` always cover; a triangle covers only the two sides matching its compass label (encoded in `TRI_SIDES`); `empty` covers nothing.

`computeCellEdgeCoverage` (`cut-validator.ts`) assembles the raw half-intervals from both contributing corners, sorts and merges them (with `EPSILON = 1e-6` tolerance), and returns a list of `EdgeInterval` segments. When `corners` is `undefined` the whole edge [0, 1] is returned: meaning a plain square cell fully covers every side.

`hasPositiveEdgeContact` (`cut-validator.ts`) checks whether two cells share physical geometry along their shared edge. It computes coverage on each side independently, then **flips** the neighbour's interval list (`flipIntervals`, `cut-validator.ts`) before calling `intervalsOverlap`. The flip is necessary because position 0 on the N side of cell A corresponds to position 1 on the S side of cell B (left-to-right on A is right-to-left viewed from B).

### Cut Validation (`cut-validator.ts:validateCut`)

`validateCut` (`cut-validator.ts`) is the single gate that decides whether a proposed `candidateCorners` is legal at (x, y) on a given layer. It iterates the four cardinal neighbours and, for each that counts as a "connected neighbour" in the current layer, asserts that `hasPositiveEdgeContact` holds between the candidate and that neighbour's current corners. A single failing side is enough to reject.

The definition of "connected neighbour" differs by layer:

- **Terrain**: the neighbour must have the same `TerrainType` and same `elevation`, and must not be a patch-only cell (`cut-validator.ts`).
- **Road**: the neighbour just needs to carry a coating, which the injected `RoadLookup` reports (`cut-validator.ts`).

After edge connectivity, a road-specific structural check follows (`cut-validator.ts`): if a road cell connects to two or more neighbours, the candidate corners must be all-`square` when the connections are opposite (N+S or E+W) or when there are 3+ connections. For exactly two adjacent (L-shaped) connections, fans at any corner that is adjacent to a connected side are forbidden, only triangles or `square` are acceptable there.

### The Layer-Silhouette Kernel (`edge-cut/silhouette.ts`, `terrain/terrain-surface.ts`)

A cell at elevation N is a vertical **stack** of layers, so every trim question is really a question about the silhouette of solid terrain at a specific layer e. The kernel's exports sort into four families:

- **Solidity**: `terrainSolidAt(cell, type, e)`; does the cell hold solid mass of `type` at layer e? Mountain at N fills layers 1..N; water at N fills 0..N (a lake sits at ground level; a waterfall is a column). Γ patches are fillets, not mass, never solid. `solidTopOf` is its top-of-stack read.
- **Structural reads** (`core/domain/terrain/terrain-surface.ts`, with `terrainSolidAt` and `solidTopOf`): `structuralTop`, `surfaceElevation` and `realSurface`; the only correct way to read a cell's standable surface, since a raw `elevation` read sees a Γ fillet as a full block. Every placement, support and bridge question goes through these.
- **Adjacency + corner tests**: `CORNER_NEIGHBORS` (corner i is met by its two edge-sharing neighbours plus the diagonal) and `EDGE_NEIGHBORS` (the two edge neighbours alone; the convex test's inputs, since a diagonal touch never pins); `cornerWrappedAt`/`cornerWrappedBy` (the Γ-notch wrap tests); `enclosedGap` (a bare cell walled on all four edges is a pit, refused outright); `groundConvexCornerInWater` (the ground-islet figure test).
- **Reveal tiers**: `cornerRevealTier` (what surface a cut opens onto) and `cornerEdgeCoverTier` (the taller mountain flanking both edges of a cut corner, which the reveal opens onto instead of the buried ground), which only the renderers read and so live with the cut backing in `view/shared/terrain/cut-backing.ts`; `highestNeighborTerrain` (the reference tier a Γ corner is rounded toward).

Everything in the kernel is geometry, governed by one generic rule (no per-type special cases): a corner is a free convex corner unless a same-type **edge** neighbour covers it, and a cut reveals the lower surface behind it. The convex test uses only the two edge neighbours (`EDGE_NEIGHBORS`): a diagonal touches at a single point and never pins, so a diagonal pinch is cuttable; the concave Γ-wrap test (notch-fill) uses all three (`cornerWrappedAt`). The genuine **design policies** on top, named:

- **ISLET-ROUNDS-REVEALING-WATER** (the generic figure rule): any islet in water rounds its convex corner and reveals the water, regardless of elevation or type: a mountain@E rock (real corners, a cut with no lower step reveals its edge water) or a ground@0 islet (`groundConvexCornerInWater`; materialised as a `type: None` cell with corners, which reads as ground via `realSurface` and renders grass kept-shape + water backing). There is **no** "mountain never cuts toward water" lock; the renderer backs a cut water corner with its mountain rim and a cut mountain corner with its lake, symmetrically (`cornerRevealTier` is edge-only and layer-gated: water@e reveals a mountain solid at layer e; a river@0 reveals its ground bank, except, for a river and an elevated pool alike, where a mountain taller than the water flanks both edges of the cut corner (`cornerEdgeCoverTier`): the mountain turns a corner over that cell, so the cut opens onto it at the lower of the two flanking tiers and the junction reads as one straight line, down the steps of a Γ notch and at the point where two diagonally-attached shores meet alike. That test is diagonal-blind, unlike the fillet's: the diagonal governs whether mass may be added at a corner (an open one is a pinch, still refused by `cornerWrappedBy`), and a backing adds none. One mountain edge is a river running along a cliff and keeps its ground bank.)
- **WATERFALL-LIP** (elevated water never cuts toward a drop: open ground/void or lower terrain), **CYCLE-OFF-KEEPS-BASE** (removing a fillet restores the N-1 base block, never nulls the cell), **AUTO-TRIM-IS-COSMETIC** (auto-trim only trims corners + fills empty Γ notches; raising a real block is a manual action, but cuttability is elevation-independent, identical to the manual tool: a convex corner rounds at any height, and the renderer draws the lower step / surrounding ground behind it; there is no height gate in the automatic paths), **no notch fills beside elevated water** (`auto-edge-cut.ts:nearElevatedWater` skips Γ candidates within the 8-neighbourhood of water at elevation ≥ 1: both fill kinds change what raw elevation reads see at the cell; `raiseToTier` adds real mass, a `patchOnly` trim stores the wrapping tier, and inside a waterfall's uniform downstream row that flips a legal fall illegal (V-WTR-03) and auto-reverts the whole stroke/generation), **WATERFALL-FRAME** (cap mountains keep their flow-side corners square).

Auto-trim symmetry between the layers: the post-stroke pass (`applyAutoEdgeCut`) sweeps the stroke **plus its 8-neighbour border** for both terrain and roads (`withBorder`; a stroke can make a neighbour's corner newly convex, or a neighbour road newly an end-cap). A generated picture cuts the same way: the stencil algorithm calls `edgeCutGeneratedTerrain`/`edgeCutTerrainWith` over the cells it laid, so a letter's diagonal stroke and a picture's edge recover the diagonal whole cells cannot draw. The planet generator lays no cuts of its own: its terraces are rectilinear by design, the way the reference maps are built.
- **atomic undo**: `commitStroke` folds the whole stroke and its auto-reconcile (`reconcileCuts`) into one undo entry via `collapseHistory`, so undo reverts a change and its repair together and can never stop at a reconcile-orphaned (illegal) intermediate.

### Corner Locking (`trim-lock.ts:computeLockedCorners`)

`computeLockedCorners` answers: which corners of cell (x, y) **must** be `square` because the neighbourhood demands it?

**Terrain**: a corner is locked when it is *not a free corner of the terrain's silhouette at the cell's top layer*, that is, when a same-type **edge** neighbour holds solid mass at that layer (`terrainSolidAt` over the two `EDGE_NEIGHBORS`; a diagonal-only touch does not lock, which is what makes a pinch cuttable). A same-type **taller** neighbour locks (its stack covers this layer); a same-type **lower** step does not (the bevel down to it is intended). On top of the geometry, three things lock extra corners: **WATERFALL-LIP** (an elevated-water corner facing a drop), **WATERFALL-FRAME** (a cap mountain's flow side), and **mountain bank**: a mountain meeting water on exactly one edge of a corner is the water's bank there, so that corner is locked (cutting it would peel the mountain off the water, leaving the pond unbanked on the rendered map). A mountain fronted by water on both of a corner's edges is an islet or peninsula tip and still rounds (revealing the water); a ground islet in water is unaffected (it rounds via `groundConvexCornerInWater`).

**Road**: road locking uses a count-based policy rather than per-corner geometry. Zero neighbours → nothing locked. Three or more neighbours, or two opposite neighbours → all four corners locked. Exactly one neighbour → the two corners on that side locked (same as terrain Rule A for one edge). Two adjacent neighbours → all four corners locked **except** the one in the "free" quadrant: the corner diagonally opposite to the connecting pair (`trim-lock.ts`).

This asymmetry between terrain and road locking reflects that terrain cuts are per-corner shape choices whereas road cuts use a small canonical vocabulary where the only valid cut is at a single free corner.

### Gamma-Patch Detection (`cut-validator.ts:isInnerCorner`)

`isInnerCorner` (`cut-validator.ts`) determines whether a patch-only cell at (x, y) with a given corner index is still in a valid concave-corner context. The target cell must itself be empty of real terrain. For each corner index the function checks three specific neighbours: the two orthogonally adjacent cells and the diagonal cell in the corner's quadrant (`maps` array, `cut-validator.ts`). All three must be non-patch cells of the matching type and elevation for the patch to be considered "intact". This is used exclusively in reconciliation to prune stale patches.

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

`reconcileCuts` (`cut-reconcile.ts`) is the entry point the terrain stroke policy calls from `commitStroke` after the stroke's terrain/object changes have settled. It:

1. **Seeds the working region**: takes the set of changed `MacroCoord`s from the stroke and inflates it by one cell in every direction (8-neighbourhood) via `expandRegion` (`cut-reconcile.ts`), storing the result in a `Set<string>`.

2. **Iterates to fixpoint with cascading growth**: runs up to `MAX_RECONCILE_PASSES` passes over the current region. Each pass visits every cell in the region and applies the reconcilers below. When a cell is repaired, its 8-neighbourhood is immediately folded into the region `Set`, so that cascading road repairs beyond the initial ring are picked up in subsequent passes. The loop exits early as soon as a pass makes no changes.

The four reconcilers:

- **`reconcileTerrainCell`** (`cut-reconcile.ts`): for real (non-patch) terrain cells with non-square corners, recomputes `computeLockedCorners` against the current state and rewrites any locked corner that is not already `square` to `square`. Issues a `TrimCornersCommand` via the target executor.

- **`reconcileGroundIsland`** (`cut-reconcile.ts`): the repair half of the ISLET-ROUNDS-REVEALING-WATER policy; a ground islet-cut cell (`type: None` + corners) whose corner no longer pokes into water (the surrounding water was filled or moved) has that corner squared, and squaring the last one drops the cell back to plain ground.

- **`reconcilePatchTerrain`** (`cut-reconcile.ts`): for `patchOnly` cells, calls `isInnerCorner` on the active non-`empty` corner. If the inner-corner context is broken, issues a `TrimCornersCommand` with all-`empty` afterCorners, which the executor converts to `cell.terrain = null`.

- **`reconcileRoadAt`** (`cut-reconcile.ts`): for roads with non-square corners, recomputes `detectRoadConn` + `canonicalToActual` and feeds the result to `validateCut`. If still valid, no action. If invalid, it attempts to find a **same-kind** canonical state that does validate by iterating `CANONICAL_ROAD_STATES[1..]` (skipping index 0). For isolated roads every canonical state is tried at all four rotations; for connected roads only the current connection direction is used. If a replacement is found, it issues a `TrimCornersCommand` with the replacement canonical corners, carrying `afterRotation` on the command when a rotation change is needed (`road.rotation` is not mutated directly; the entry's `objectOps` restore it on undo). If no same-kind replacement validates, the road is reset to all-`square`.

All repairs are issued through the `StrokeKernel`'s `execute(cmd)`, the executor as the terrain stroke policy sees it. This means reconciliation repairs enter the undo stack as `TrimCornersCommand` entries within the same stroke, participating in history.

### Composition with `commitStroke`

`commitStroke` (`command-executor.ts`) proceeds in this order:

1. Run the policy's `beforeValidate`, the terrain policy's `reconcileRoads`, over the stroke's changed cells (before validation, so its re-places are judged with the stroke), then its `endStroke`.
2. Run post-stroke rule validation. If violations exist, auto-revert the stroke's commands one by one until the state is clean (never onto the redo stack).
3. Collect the set of macro coordinates affected by whichever stroke commands remain on the undo stack (i.e. after any auto-revert).
4. Hand the set to the policy's `afterValidate`, the terrain policy's `reconcileCuts`, if it is non-empty, then `collapseHistory(strokeStartSize)` to fold the stroke and its repairs into one undo entry.

Reconciliation therefore sees the **post-revert state**, not the raw stroke state. Any repairs `reconcileCuts` issues are appended to the undo stack beyond `strokeStartSize`, so they are included in the stroke's logical commit. Undoing the triggering stroke also undoes the repairs: terrain `TrimCorners` undo restores corner geometry faithfully (because `cloneCell` copies `corners`/`patchOnly`), and a road's rotation change is restored from the entry's `objectOps`.

### Invariants Maintained

- **Edge-connectivity**: every pair of same-layer, same-type/elevation adjacent cells always shares positive-length geometry along their boundary after any stroke commit.
- **Lock-respected corners**: no corner of a terrain cell is non-`square` when `computeLockedCorners` would mark it locked.
- **Patch integrity**: a `patchOnly` terrain cell exists only when `isInnerCorner` holds for its active corner; otherwise it is removed.
- **Road shape validity**: every road with non-`square` corners satisfies `validateCut` in its deployed orientation, or the corners are all-`square`.
- **Convergence**: every reconciliation pass moves at least one value strictly toward `square`/`empty`, which is always a valid state, so the fixpoint loop cannot cycle.

---

## Tools & Tool Context

### Responsibility

The tools subsystem is the single entry point for all user gestures. It translates raw pointer events (resolved to a cell on each tool's own grid by `tools/pointer/runtime/pointer.ts`) into sequences of `Command` objects, mediates the stroke lifecycle that wraps those commands in a post-validation boundary, and owns the ghost-overlay feedback loop. Nothing in this layer mutates `GridState` directly; every mutation goes through `CommandExecutor` via the `ToolContext` façade.

The layer has two halves. `src/tools/pointer/` holds the pointer tools and their runtime (the tool contract and manager, the brushes and eraser, the object placer and drag session, the corner tool, plan notes, the region brush and Smart Build's gestures). The rest of `src/tools/` is libraries with no pointer in them, shared with generation and the assistant: placement, object and group edits, auto-trim, Smart Build's builders, map readings and the generators. A library never imports a pointer tool (`src/__tests__/tools/doors.test.ts`).

The editor renders through one of two live views over this same pipeline (the 2D PixiJS map or the 3D editor (`src/view/map2d`, `src/view/map3d`)) and the tool layer is view-agnostic by construction: `ToolContext.viewport`/`overlay` are the `ViewProjection`/`ToolOverlay` interfaces (`src/tools/pointer/runtime/view-seam.ts`), the pointer state machine drives camera verbs (`pan`/`zoomStep`/`zoomBy`/`endGesture`, plus 3D-only `orbit`/`orbitTwist`/`tilt`), and the active-view registry (`src/view/active-view.ts`) re-points everything when the persisted `viewMode` toggles. In 3D, the projection resolves the pointer by ray-marching the terrain heightfield to the first visible surface, so a stroke lands on the cell under the cursor exactly as the eye reads it.

### Key Types

The [Tool contract](../src/tools/pointer/runtime/types.ts) declares pointer callbacks, cursor/refusal probes, the tool's grid and pending-gesture hooks. Concrete tools keep gesture state; `ToolManager` supplies the current context and resolves the pointer before dispatch.

<!-- generated:tool:start -->

Source: [src/tools/pointer/runtime/types.ts](../src/tools/pointer/runtime/types.ts).

```ts
export interface Tool<G extends GridId = GridId, C extends ToolContext = ToolContext> {
    id: ToolType;
    grid(ctx: Pick<C, 'arming'>): G;
    cursor(ctx: C): CursorId;
    canActAt?(cell: GridCell<G>, ctx: C): boolean;
    cancelPending?(ctx: C): boolean;
    undoPendingStep?(ctx: C): boolean;
    hasPending?(ctx: C): boolean;
    grabAt?(coord: MacroCoord, ctx: C): boolean;
    selects?(ctx: C): boolean;
    selectHit?(coord: MacroCoord, ctx: C): {
        id: string;
        selected: boolean;
    } | null;
    bandSelect?(rect: Rect, ctx: C): void;
    selectMode?(arming: ToolArming): boolean;
    clickOnly?(coord: MacroCoord, ctx: C): boolean;
    onPointerDown(cell: GridCell<G>, point: MapPoint, ctx: C): void;
    onPointerMove(cell: GridCell<G>, point: MapPoint, ctx: C): void;
    onPointerUp(cell: GridCell<G>, point: MapPoint, ctx: C): void;
    onPointerCancel?(ctx: C): void;
    onActivate(ctx: C): void;
    onDeactivate(ctx: C): void;
}
```

<!-- generated:tool:end -->

**`ToolContext`** (`types.ts`) is the [`ToolHost`](../src/tools/pointer/runtime/host.ts) plus the arming, assembled by `ToolManager` and refreshed before each pointer dispatch. `createToolHost` builds the host for the tool manager, the Help figures' pictured editor and the tests' contexts alike:
- `state`: read-only reference to the live `GridState` (cells, objects, lockedLayers).
- `viewport` / `overlay`: the view on screen's `ViewProjection`/`ToolOverlay`, read at each access so a tool holding the context draws in the view a 2D/3D switch brings up; plus `point` (the continuous map point the cell was resolved from; a `halfStep` item's ghost and click read its nearest half-cell point) and `cellPixels`.
- `execute` / `beginStroke` / `validateCommand` / `registry` / `historyDepth`: forwarding closures to `CommandExecutor` and the rule dispatcher. `beginStroke` hands the tool its gesture's `Stroke`: `stroke.collapse()` is how a tool folds follow-up commands (auto-trim, a gamma click's raise+trim) into the user-visible step they belong to, `stroke.rollback()` is the all-or-nothing revert for a stroke that rewrites a shape, and `stroke.entries()` holds the pre-images a curve adjustment restores from.
- `t(key)` (reads the active locale at call time), `notify` (the toast a tool posts) and `modifiers` (whether constrain and multi-select are held), so no tool imports the toast channel or the key tracker; plus the feedback hooks `setDisplayLayer`, `plopObject` and `reportGroundClipped`.
- The feature channels, which the base contract does not name: `macroContext` (the `MacroContext` the macro layer runs on, shared by the shell, the agent's director tools and tests; `macros/context.ts:MacroChannel`), the annotation slice's verbs and tag labels (`annotate/channel.ts:AnnotationChannels`) and the editor's curve sessions (`paint/curve-session.ts:CurveChannel`). A tool implements `Tool<G, C>` over the context with the channels it reads; `host.ts:HostedToolContext` carries them all.
- `arming`: the editor's arming (`state/editing/arming.ts:armingOf`), one snapshot per store state so tools never reach into the store: the tool and the terrain brush's `shape`, `contentType`, the build `floor` and `layerPinned`, `brushSize`, `layerVisibility`, `autoEdgeCut`, `eraserShape`, `tileMaterial` + `tileMaterialPicked`, `armedItem`, `placementRotation`, `armedMacro` + `armingEpoch`, the painted `region`, the planet session's `groundEditable` and `planetMaterial`, the plan-notes arming, and the notes' document state grouped as `notes` (selection, draft, history epoch, pending discard). No tool keeps a copy, so a manager built for a map that arrives mid-session draws with the bar the shell shows.

The context is a single long-lived object whose `arming` is replaced by `refreshCtx()` before each dispatch rather than being re-constructed, so the same object reference is passed to all invocations: a tool must not cache `ctx` across frames. A held gesture (a curve's adjust phase, a spray hold) keeps `curve-session.ts:adjustContext(ctx)`, which keeps the press's arming while the host stays live, and the session closes when `curveArmingKey` (tool, shape, surface, eraser footprint, armed macro) changes.

### ToolManager: Registration and Dispatch

`ToolManager` (`tool-manager.ts`) holds a `Map<ToolType, Tool>` and an `activeTool` pointer. The constructor fills it from `tool-set.ts:createTools()`, `HandTool` first as the default, then `DrawingTool`, `EraserTool`, `ObjectPlacerTool`, `EdgeCutTool`, `MacroTool` and `AnnotateTool`, so a caller only constructs the manager. The caller also hands it `ToolManagerDeps`: the arming source it reads before every call and the host channels (locale, toasts, held keys, the annotation slice); the editor's are `editor/session/tool-wiring.ts:editorToolWiring`, so nothing under `tools/` knows the store. Every `ToolType` names a tool the manager registers, which `tool-cursors.test.ts` pins: scattering is the generation populator's job and roads are painted by `DrawingTool` in tile mode, so neither has a ToolType of its own.

`setView` swaps the active view (2D map ↔ 3D editor); the host reads the view at each access, which is how the whole tool layer follows a mode switch without any tool knowing a switch happened.

`setActiveTool` calls `onDeactivate` on the outgoing tool and `onActivate` on the incoming one, both with a freshly refreshed context. On each of `handlePointerDown`, `handlePointerMove`, and `handlePointerUp`, `ToolManager` calls `refreshCtx()` then delegates to the active tool. `editor/session/editor-tools.ts` calls `syncArming()` (activate the bar's tool) on every arming change in the store, and on a manager built for a new map.

`HandTool` edits nothing: a left drag in its mode pans the map, and the pointer machine applies that pan in both views through the camera verbs, so every tool, the Hand tool included, sees only resolved cells.

`editor/session/editor-tools.ts` owns the manager's lifecycle for the editor session, independent of which map view is mounted: it subscribes to the store, constructs one manager per live map and executor (a new map, an import, a planet session) and publishes it through `registerToolManager`, so the editor has exactly one at a time. A map swap is one ordered step: the outgoing manager's `retire()` deactivates its tool against the map it was built for, taking its ghost down, before the incoming manager is built and armed. Views are symmetric clients: each registers itself with the active-view registry when it is on screen and releases itself when it goes away, and the registry re-points the manager, which takes its ghost off the overlay it leaves; with no view attached the tools draw nowhere.

### Stroke Lifecycle

Every brush stroke follows a two-phase lifecycle, with the tool owning both phases.

**Phase 1: command accumulation.** On `onPointerDown` (or, for shape modes, on `onPointerUp`), the tool begins its stroke (`this.stroke = ctx.beginStroke()`). As the user drags, it calls `ctx.executeCommand(cmd)` for each cell group. Each `execute` call runs all applicable pre-command rules synchronously; a failure is silently skipped (the cell is not painted) and a `validation-failed` event fires, which `MapRenderer` converts into a red error flash on the overlay.

**Phase 2: stroke commit.** When the gesture ends, the tool calls `stroke.commit()` (`command-executor.ts:commitStroke`). The executor runs all post-stroke rules against the final state. If any rule reports a violation, the executor unwinds entries from the undo stack one at a time (applying `before` snapshots back to `GridState`) until no violations remain or the entire stroke is reverted. The first violation array (the one that triggered revert) is returned; the tool is responsible for showing a toast from this return value. After revert, `commitStroke` runs `reconcileCuts` over the cells that survived, repairing any edge-cut corners that became geometrically invalid.

Where the stroke begins is critical: it tells the commit exactly which undo entries belong to the current stroke. Tools must begin it **before** issuing any commands for the stroke. `DrawingTool` begins it at `onPointerDown`; no command runs between a curve's clicks, so the stroke begun at its last click holds the whole curve.

The curve is a multi-click anchor chain, not a fixed three-click quadratic: `DrawingTool` collects `curveAnchors` across clicks, paints through `splineCells` (`core/grid/shapes.ts`) over the anchors' spline, and holds an adjust session (`curve-session.ts:CurveSessions`, reached through `ToolContext.curve`; the editor's one is `editor/session/tool-wiring.ts:editorCurves`, which the tool owns and React only reads, with drag handles rendered by the chrome's `CurveHandles`). A host built without one keeps its own, so a Help figure's curve never touches the editor's. A tweak is restore-then-relay: it restores every cell to the baseline captured before the curve and lays the curve again, because a mountain curve stacks and painting over the old path would raise it twice; a refused tweak reverts whole through its stroke's `rollback()`. The pending-gesture members (`cancelPending`/`undoPendingStep`/`hasPending`) are how Escape, Delete and a nav tap reach a chain that has painted nothing yet.

`EdgeCutTool` uses the shortest possible stroke window: it begins the stroke, issues one or two commands, and commits it all within `onPointerDown`; with `{ reconcile: false }`, since a silhouette-only cut cannot invalidate any cut and the neighbourhood repair pass could only mis-touch a neighbour's. There is no drag phase.

`ObjectPlacerTool` never commits its press: object placement commands are individually pre-validated with sufficient pre-command rules that post-stroke rules do not apply to them. It begins a stroke at the press only so a cancelled press (a second finger landing, the browser taking the pointer) rolls back what it placed.

### DrawingTool: the Multi-Mode Brush

`DrawingTool` (`drawing-tool.ts`) handles five drawing modes under a single `ToolType.TerrainBrush` id: `brush`, `line`, `rect`, `circle`, and `curve`. This consolidation means the tool reads its mode and content from `ctx.arming` at every call rather than the manager switching between registered tools.

What a paint click issues is planned in `paint-plan.ts:planPaint` (with `water-layers.ts` beside it for the water brush's layer questions), and the tool's `canActAt` probe reads the same `planPaint`, so the cursor's forbidden badge and the click cannot disagree. The plan has a significant asymmetry between mountain and water content: mountains group cells by their **target elevation** (one `PaintTerrain` command per distinct level, starting from the cell's structural surface via `surfaceElevation`, producing correct incremental stacking), while water paints at the pinned layer when a hand chose one (`layerPinned`) and at each cell's own surface when it did not. A `strokeCells: Set<string>` guard prevents re-painting the same macro cell twice within a brush stroke: important for brush mode where the pointer can revisit a cell.

Ghost preview uses `ctx.overlay.showGhost(cells, paint, grid)`. The grid is the tool's own (`Tool.grid`): terrain ghosts lie on the terrain grid where terrain tiles are drawn, road ghosts on the placement grid.

### EraserTool

`EraserTool` (`eraser.ts`) delegates single-cell peel to `peelCommand` (`terrain-peel.ts`). Water erases to ground; mountain at elevation N lowers to N−1, with elevation zero clearing terrain. The eraser reads current layer visibility and content selection from `ToolContext`; `ToolManager` refreshes those values from the store before each event.

### ObjectPlacerTool

`ObjectPlacerTool` (`object-placer.ts`) has two behavioural modes gated by whether an item is armed (`ToolContext.arming.armedItem`). With an item selected it places on pointer-down; with no item selected it is passive (drag-to-move lives in the shared pointer machine, outside the tool).

Bridge ghost computation delegates to `core/domain/terrain/bridge-span.ts:detectBridgeSpan`: the same function the `waterSpan` trait rule validates with, so the ghost shows exactly the span the click will produce. Ramp ghost computation (`computeRampGhost`, `object-placer.ts`) scans the four cardinal neighbours for an elevation difference matching the ramp's `layers` field and derives the footprint orientation from that.

`removeOverlappingCoatings` removes any `surfaceCoating` objects whose footprint overlaps the incoming footprint before placement: invoked by both `ObjectPlacerTool.onPointerDown` and the tile brush. This keeps road replacement atomic: erase-then-place instead of overlap-validation-fail.

### Tile coating (the road/tile brush)

There is no separate road tool. `DrawingTool` on the road surface (`contentType: 'road'`) drives the same shape vocabulary as terrain and delegates each cell to `tools/pointer/paint/tile-coating.ts`: `placeTileCell` calls `removeOverlappingCoatings` and then issues the `PlaceObject`, so dragging over an existing road replaces it, and `eraseTileCells` is the inverse. A per-stroke `painted` set guards against double-placement, the same way `strokeCells` does for terrain. Tiles are ordinary `surfaceCoating` objects, which is why the overlap rule exempts them rather than the brush working around it.

### EdgeCutTool

`EdgeCutTool` (`edge-cut-tool.ts`) operates at micro-grid intersection points. A single macro-coord click maps to four `TerrainSlot`s (the four cells sharing the micro-corner at that intersection, via `getTerrainSlots`). For each slot it cycles the corner through `square → fan → tri-* → square` for outer corners, and `empty → fan → tri-* → empty` for inner (Γ-patch) corners. Road corners cycle through `CANONICAL_ROAD_STATES` with orientation derived from detected road connectivity. All commands are `TrimCorners`; no terrain elevation is changed. Because the tool commits its stroke in `onPointerDown`, `cut-reconcile` (called from `commitStroke` inside the executor) repairs any cuts that became geometrically invalid due to the just-applied corner change.

### Smart Build Macros (`tools/macros/`)

`MacroTool`, registered under `ToolType.Macro`, routes editor gestures through [`macros/index.ts`](../src/tools/macros/index.ts). The shell and the agent's director tools reach the same operation bodies. The pointer tools live in `tools/pointer/macros/`, scratch execution and previews in `runtime/`, and the builders by surface in `terrain/`, `roads/` and `planting/`. The [macro registry](../src/tools/macros/run.ts) owns available operations, and the [surface menu](../src/ui/shell/bars/smart-menu.ts) selects their interface entries. Whole-map road networks remain available to programmatic callers.

[Road and river gestures](../src/tools/pointer/macros/drag-tool.ts) use the shared line geometry, preview on detached maps, and build on release. [Mountain spray](../src/tools/pointer/macros/spray-tool.ts) queues local mounds in input order: a tap builds a mound, held bursts raise nested terraces, and dragging extends a ridge. Each stroke retains its original terrain and seed, includes any supporting terraces, and forms one undo entry. Held planting also groups its bursts into one undo entry. Rivers connect selected endpoints and construct legal channels, pools and waterfall frames through [terrain drafts](../src/tools/macros/terrain/terrain-draft.ts).

Each operation builds on a detached map with live rules before replaying accepted commands. The worker runner the editor hands the macro context (`MacroContext.offThread`) shares the candidate-generation pool; validated replay and commit run on the main thread. Each job names the rule set of the map that asked (`rules/index.ts:ruleSetOf`), so a planet session's preview and build run its own rules in the worker; a registry with no named set runs in-process. [Previews](../src/tools/macros/runtime/preview.ts) use the same builders and include the complete changed footprint. Road and river results replay atomically. Their adjustments share the [curve session](../src/tools/pointer/paint/curve-session.ts), retaining a baseline for restore-and-replay while the current result stays visible. Each adjustment is its own undo step. Map identity, arming epochs and fingerprints prevent cancelled or stale worker results from landing. Preview caches belong to individual maps and include layer locks as well as edit versions. Legacy point operations remain available to programmatic callers.

### Shared Shape Utilities

[`core/grid/shapes.ts`](../src/core/grid/shapes.ts) is the one home for pure coordinate generation, and its export surface sorts into three families: the brush footprint and line primitives (`brushCells`, `line4`, `expandLine` (the brush footprint swept along a path) and the composed `lineCells`), the filled figures (`rectCells`/`rectSpans`, `circleCells`/`circleSpans`, plus `dragShapeCells`/`dragShapeSpans`/`snapShapeEnd`, which the shape drags and the region brush share), and the anchor-chain spline family the brushes and the region curve draw with (`splinePath`, `splineCells`, over `core/base/spline.ts:anchorHandles`). Rounded curve samples share one 4-connected stitch.

`DrawingTool`, the eraser's shapes, the plan-note brush, the region brush, the generators and the Help figures all import from `shapes.ts`, so each of these implementations exists in exactly one copy.

### terrain-peel

[`placement/terrain-peel.ts`](../src/tools/placement/terrain-peel.ts) exports a single function `peelCommand(x, y, cell, convertWater = false)` that constructs the correct `Command` to remove one layer from a cell without touching the tool's stroke state; `convertWater` is the water eraser's variant, where erased water becomes the layer's mountain instead of vanishing. Its two live callers are the eraser and the single-block delete in `tools/objects/actions.ts` (a selected terrain block's Delete peels one layer, the same behaviour), so the water-vs-mountain branching logic exists once.

### road-reconcile

`core/domain/edge-cut/road-reconcile.ts` exports `reconcileRoads(changedCells, state, target)`, run by the terrain stroke policy inside `commitStroke` over whatever a stroke changed: before post-stroke validation, so its repairs are validated (and auto-revertable) with the stroke. Living in the commit pipeline rather than in a tool is what binds every terrain-editing path at once: the brush, the eraser, the macros and the agent's tools all keep the invariant without knowing about it. The pass:
1. Identifies every `surfaceCoating` object whose 2×2 footprint intersects any changed cell (through the policy's `RoadLookup`).
2. For each affected road, if its footprint elevation is no longer uniform (mountain raised under part of it, ground erased from under it, or water appeared), removes it via `RemoveObject` and tries to re-place it at the new elevation via `PlaceObject` (quietly pre-validated). A footprint uniform again at some level carries the road there, up under a paint and down under an erase; if the placement is invalid (a cliff edge, water), the road stays removed, by the game's no-floating rule.

The remove/replace commands become part of the stroke's history, so a single Ctrl+Z undoes both the terrain change and the road adjustment. The paved-cell question the pass needs arrives as the policy's injected `RoadLookup`, the same move as `RuleDispatcher`. V-PLACE-BLOCK admits mountain paint and erase over coating cells for exactly this reason; water paint on a road cell stays blocked.

### Invariants

- A tool never writes to `GridState` except through `ctx.executeCommand`.
- The stroke is always committed exactly once per user gesture that issued at least one command (brush tools on `onPointerUp`, shape tools on the gesture-completion event, edge-cut on `onPointerDown`). Omitting it leaves the undo stack in an unchecked state.
- The stroke must begin **before** the first `executeCommand` of a gesture; a tool begins a new one only when starting a new logical stroke.
- `peelCommand` returns `null` for ground cells (no terrain); callers must guard.
- Ghost overlay state is owned by the tool: each tool clears the overlay in `onDeactivate` and manages its own `showGhost`/`clearGhost` calls during the gesture.

### Composition with Neighbouring Subsystems

- **CommandExecutor / RuleRegistry**: Tools receive both via closures in `ToolContext`. Pre-command validation is transparent (execute returns a `ValidationResult`); post-stroke validation is triggered explicitly by `stroke.commit()`.
- **The pointer machine (`view/interaction/pointer/machine.ts`)**: one state machine shared by both canvases, which mount it through `view/interaction/use-pointer-interaction.ts` and register themselves as the active view. Raw DOM `PointerEvent`s are partially intercepted there (camera pan/orbit, drag-to-move, selection and the rubber band) before reaching `ToolManager.handlePointer*`. The tool system therefore only sees left-click events that are not handled by those higher-priority paths, and it never learns which view is live.
- **The camera gestures (`view/interaction/camera-gestures.ts`)**: the mapping from a drag to a camera move, factored out of the machine so a surface with no tools runs the same one. Right or middle drag calls `orbit ?? pan`, an armed drag pans, the wheel routes by intent, touch pinches. It speaks `ViewCamera` rather than a view, and it deliberately does not decide when a left drag pans: in the editor that depends on the tool and the selection, so `view/interaction/press/press-plan.ts:resolvePress` decides and the module does everything downstream. `view/interaction/use-camera-only.ts` binds it (plus the cursor) for a camera-only overlay; the export shot editor is the one such surface, which is what keeps its buttons and its cursors identical to the 3D editor's.
- **Zustand store**: `ToolManager.refreshCtx` hands the tools `armingOf(store state)`; no other file under `tools/` imports the store. The `t()` helper reads the locale at invocation time.
- **The overlay**: Tools write to `ctx.overlay.showGhost` / `clearGhost` for cursor feedback. The pointer machine writes to the same overlay for drag-to-move previews and selection rings, creating a shared resource with no explicit ownership protocol.

---

## Procedural Generation

### Responsibility

The generation subsystem produces rule-valid maps from three algorithms (the planet generator (`src/tools/generation/designer/`, the default `'designed'`), a recursive-backtracker maze (`maze/`), and the stencil that reads a picture or a phrase as terrain (`stencil/`)) and deposits their results into `GridState` through the standard command/validation pipeline. The Generate shelf fronts them as four kinds (`ui/shell/bars/generate/generate-shelf.ts:GenerateKind = 'island' | 'maze' | 'text' | 'image'`), with `algorithmFor()` mapping the two picture kinds onto `'stencil'`. Generation runs inside `editor/operations/generate.ts:generateMap`, an async function that `await`s `yieldFrame()` before its first synchronous chunk so a caller's loading-spinner state can paint first (`ui/shell/bars/generate/GenerateShelf.tsx` holds that flag).

Generation algorithms operate on supplied map state. All persistent output goes through `executeCommand`, which is `CommandExecutor.execute` bound at call time.

Stencil input floors are declared in `stencil/stencil.ts:STENCIL_MIN_SIDE`; the shelf gate and localized minimum-size message read that same source. Text uses font-derived grid fitting while strokes are small, then native outlines with component and counter checks. Image sampling has a separate compact-region boundary, `COMPACT_IMAGE_LIMIT`: smaller pictures preserve subcell color detail, while larger pictures retain standard sampling and material allocation. Text outline cleanup does not run on image stencils. Browser decoding, font readiness and bounded raster/plan caches belong to `stencil/stencil-raster.ts` and `stencil-plan.ts`, which draw through the `StencilBrowser` the editor installs (`stencil-browser.ts`); engine placement still goes through ordinary commands and validation.

---

### Entry Points

`generate.ts:generateTerrain` is the single public dispatch function, reached through the module door `generation/index.ts` beside the recipe vocabulary `recipe.ts`. It reads `config.algorithm` and routes to `generateMaze` (`maze/`), `generateStencil` (`stencil/run.ts`, which lays the plan through `stencil-generator.ts:runStencilPlan` and trims its outline; the stencil's `index.ts` deliberately keeps the run entry off its door, as its header says) or `generateDesigned` (`designer/`), in an exhaustive switch: an unrecognised algorithm throws. Each of the three is a module, and all three stand on `generation/terrain-plan/`: the floor: `types.ts` (what a terrain plan is), `repair.ts` (the decrease-only fixpoint that certifies one, plus the per-template scratch state it validates against) and `commit.ts` (plan → bottom-up `PaintTerrain` commands). Nothing else: the cell-set helpers went down to `core/grid/cell-sets.ts` and the tuning table across to `tools/placement/`, both to their readers. `GenerateConfig` (`tools/generation/recipe.ts`) is a union keyed on `algorithm` (`'designed' | 'maze' | 'stencil'`), each variant carrying only the settings its generator reads; a map records it without the stencil's picture as `RecordedRecipe` (stored as the opaque core `GenerationRecord`), and `defaultConfig(algorithm, settings)` with `RECIPE_RANGES` is what callers build one from. Every variant has `maxElevation`, `seed` and `region: MacroCoord[] | null`; the maze adds `corridorWidth` and `mazeGates`, the stencil `stencilPlan`, and the designed planet `mode` (`PlanetKind`, `'earth' | 'water' | 'mixed'`, a multiplier on the water a planet holds; the shelf offers one planet kind and always sends `mixed`, so this moves only for a recipe saved before the kinds collapsed, or for the agent's own call) and `richness`, the one 0..1 style knob (0 a flat garden town, 1 a terraced planet with water on every layer), which scales the terrain drama, the water, the theme count and the decoration together.

Every generator builds through one `GenerationContext` (`generation/terrain-plan/types.ts`): the map, the executor that applies each command, and the caller'S registry (`reg`, a `RuleDispatcher`) rather than a fresh one, so a run is judged by exactly the rules the map is otherwise edited under. Only `'designed'` reads the registry directly; the maze, the stencil run and the clears take its `MapWriter` part, the map and the executor.

`generation/terrain-plan/clear.ts:clearAllTerrain` issues a single `EraseTerrain` command covering every grass cell that has terrain; `clearAllObjects` is its object-side twin and skips `locked` objects, so a Clear never takes the plaza. Both take an optional cell list to restrict the sweep to, and an optional `spare` predicate for what to leave standing inside it: Generate passes the region it is about to rewrite, and the shelf's Clear passes the last run's region plus the map's own authorship, so taking back a generation never takes a placement the person made alongside it. `generate.ts:clearForRun` is the clearing a run stands on: objects, then terrain, sparing only the base pavement a connected print keeps (`stencil/print-clear.ts`).

`generation/terrain-plan/seam.ts` handles a bounded operation's effects on terrain outside its region. A mountain just beyond the boundary can depend on lower support inside it (V-MTN-03), and an elevated water body can depend on a same-height cap inside it (V-WTR-02). `readRegionBase` records the region's legal starting ground before clearing, and `repairRegionSeam` validates through the live registry before commit. A flagged editable cell steps down one tier; when the violation sits outside the region or under an authorship-spared object, the relevant inside cell steps one tier toward its recorded ground. Each move converges toward a known legal state without restoring more height than the seam needs. `runGeneration` records these commands with the generation stroke, so cached candidates replay the same settled seam.

---

### Randomness primitives (`src/core/base/`)

Every generator draws from the same two primitives on the engine floor, not from anything under `generation/`: `core/base/rng.ts` (`makeRng`, mulberry32) and `core/base/noise.ts` (`valueNoise01`, seeded value noise). The maze, the stencil, each stage of the planet pipeline and the agent's terraform/director tools all seed their own stream from `makeRng`, which is what keeps a `(seed, config)` pair reproducible across them. `makeRng`'s first draw off neighbouring seeds is itself neighbouring, so a planner whose first decision is a weighted choice avalanches the seed first (`mix`): otherwise a batch of seeds counting up makes the same choice over and over.

---

### The planet generator (`src/tools/generation/designer/`)

A deterministic, seeded pipeline that plans a map before it touches one, the way a player lays a planet out, and commits the plan through the shared machinery. It works at three scales, and `pipeline.ts:generateDesigned` is the orchestrator that runs them in order.

Every stage is a directory, so the tree reads in the order the run does: `composition/` → `streets/` → `places/` → `terrain/` + `water/` → `build/` → `dressing/`, with `types.ts` beside them as the plan model they all speak. The evaluation that scores a finished map is test support in `src/__tests__/_support/design-eval/`, which no shipped module imports. `designer/index.ts` is the door: the app takes `generateDesigned` through it, the evaluation harness takes the two plans it re-derives a map's story from, and a reach past it into a stage would mean the stage boundary is in the wrong place.

1. **The composition and the walk** (`composition/`): `composition/composition.ts:planComposition` picks a per-seed archetype (which side of the planet the mass sits on: a wall, a corner highland, a rim, distributed massifs, or low relief), then covers the whole buildable planet in continuous terrace plates, every cell on one, tiers rising along the archetype's own axis with the step the base-support rule allows. `movement-line.ts:planMovementLine` lays the walk out of the plaza that the districts are sequenced along and the water is composed at.
2. **The streets as the partition** (`streets/`): `streets/streets.ts:planStreets` lays few, long, straight hierarchical streets on the plates: trunks spanning the planet, branches subdividing. Streets plus plate edges are what cut the planet into districts, so the partition is the road network rather than a separate pass. A street crossing a tier step takes a ramp inline, replacing pavement cells rather than overlapping them; ramps exist only there and at place entries. Widths come from one source (`TRUNK_W`/`BRANCH_W`), and the skeleton is measured so no street is one cell wide. Each step of the plan has its own file over the shared board (`board.ts`) and vocabulary (`model.ts`): `lines.ts` lays the skeleton, `flights.ts` the ramp flights, `settle.ts` the pruning, `crossings.ts` the channels, `materials.ts` the materials and `blocks.ts` the districts.
3. **The places** (`places/`, then `terrain/` and `dressing/`): `places/districts.ts:planDistricts` hands every district a treatment and cuts it into composed places at the reference maps' own scale; `anchors.ts:planAnchors` seats every distinct Building and Facility exactly once, gate-aware, so each door faces its look-out; `terrain/terrain-sculpt.ts:sculptTerrain` cuts the ground the places stand on (per-region backing, terraced floors, the water below) and `dressing/` fills each place from its theme, under the symmetry (`symmetry.ts`) and single-colour-family (`palette.ts`) operators.

Water (`water/`) is composed as one story rather than as independent bodies: `water-story.ts` runs a source to a destination, `water-forms.ts` cuts the large composed figures, `fountain.ts` draws the regular nested court, and `cascade-stair.ts` steps a fall down a terrace as one body. All of them share `water-cut.ts`, whose two tests are the whole legality argument: a body whose every surrounding cell stands at or above its own level shows no face, so the containment rule asks it for no caps; a body that does show one needs mountain at exactly its own tier at each perpendicular end and a uniform row downstream. `terrain/landmark.ts` writes the text or pattern figure into the far wall.

`build/` is the only stage that touches a map, which is why it is the last one and a directory of its own: `scope.ts` is the painted region as a predicate, `terrain-commit.ts` the one place terrain is written, `paving.ts` the course every doorstep, plaza ring, bridge bank and figure frame reaches the streets by, and `crossings.ts` the decks and flights (each anchored rather than positioned; the `heightDrop` and `waterSpan` traits snap the object themselves, so every one is placed and then read back).

The plan reaches the map through the same three doors every other generator uses: `commit.ts:planToCommands` turns a `TerrainPlan` into `PaintTerrain` commands built bottom-up (layer L carries every cell whose final elevation is ≥ L, so no cell ever floats), `repair.ts:repairPlan` certifies a plan against the live rule set by a rule-agnostic **decrease-only** fixpoint, and `placement/object.ts:tryPlace`/`tryDecorate` place every object with reject-and-skip. `repair.ts` validates on one cached scratch `GridState` per template (`applyPlanToScratch` rewrites and returns it per call, valid only until the next one) because a run validates plans hundreds of times and a fresh W×H grid per candidate was the dominant allocation.

The design evaluation (`src/__tests__/_support/design-eval/`) is the scoring surface the offline evaluation loop and the tests share, and no stage of the pipeline reads it: a generator that scored itself while building would be tuning to its own scorer. `evaluateMap` (`design-eval/scorecard.ts`) reads a finished `GridState` and produces the hard-rule ledger (every anchor once, the plaza reaches the network, no dead end, no one-wide road, every street end arriving somewhere, every body of water accounted for), the soft methodology scores, and the map's distance to the decoded reference; the readings it gathers are one file per subject (`streets`, `districts`, `arrivals`, `junctions`, `terraces`, `climb`, `water-bodies`, `water`, `figure`, `decor`, `reference`, and `composition`, which judges a batch rather than a map), all taken over the masks `grid.ts` reads once. `design-eval/index.ts` is the door both callers come through. `design-quality.test.ts` pins those as tests.

### The placement machinery (`src/tools/placement/`)

A module of its own beside `macros/`, not a stage of generation: it puts objects on ground that already exists, whoever made the ground. This is the layer where "how do you put a thing on a map legally" lives:

- `object.ts`: `makeCtx` builds the placement context (state, execute, rules, seed, road style, clearance set); `tryPlace`/`tryDecorate` validate and place; `buildingGate` derives a house's door and the strip in front of it; `sweepClearanceCells` keeps gates and crossing ends walkable.
- `analysis.ts`: `analyzeTerrain` reads the map once into the placeable mask, the elevation-aware regions and the distance-to-water field every later pass asks questions of.
- `crossings.ts`: the crossing pool, bridge spans and crossing ends every crossing placement reads.

Its live callers are the planet generator, the smart-build macros in `tools/macros/` and the assistant's tools, which come through `index.ts` because they sit outside `tools/`.

Smart Build's road router lives with the roads macro (`src/tools/macros/roads/`):

- `network.ts`, `portals.ts` and `network-variation.ts` build road networks. `scanPortals` uses sparse candidates and dry-run validation to find bridge and ramp crossings; `connectRoadNetwork` connects the network nodes through them.
- `route.ts`, `route-search.ts`, `route-offers.ts` and `route-portals.ts` plan aimed roads. Direction-aware search compares land paths with validated bridges and ramps. Crossing discovery includes dry ravines, half-grid placements and narrower catalog geometry; `placement/object.ts:probePlacement` validates the snapped command without applying temporary objects. Candidates retain their catalog geometry and deck exits so pavement can join the crossing within the available approach space.
- `road-style.ts`: what kind of roads the map already has, measured rather than assumed. `bendDensity` reads the fraction of paved cells that turn (a grid near 0, a ramble near 1) and `turnPenaltyFor` maps that to the A* per-turn cost, so a new lane matches the streets it grows out of.
- `tuning.ts`: every router knob the files above read.

The planting macro's `macros/planting/nature.ts:placeNature` is the layered ecology: forest stands with glades and soft edges, biome bands by elevation and moisture, waterside and ecotone flora in drifts rather than confetti.

### Maze Generator (`maze/maze-generator.ts:generateMaze`)

The maze uses a randomized DFS (recursive backtracker) on a logical cell-wall grid, but physically maps cells to `step = corridorWidth + 1` macro-coordinate strides. The algorithm:

1. Computes the bounding box of the region (or full Grass extent if no region).
2. Derives `cellsW = floor((maxX - minX) / step)` and `cellsH = floor((maxY - minY) / step)`: the dimensions of the logical maze in cell units.
3. Initializes a `mazeH × mazeW` boolean grid, all `false` (wall).
4. Carves using iterative DFS with a stack, starting from the lattice cell nearest the requested entrance gate, or from `(1,1)` when no gates are set. On each step, picks a random unvisited neighbor (2 steps away). Carving a passage marks the wall midpoint plus the destination room as `true`. Corridor and room widths are both `corridorWidth × corridorWidth` cells.
5. All `false` cells in the maze grid that map to valid in-region Grass cells become Mountains, painted bottom-up from elevation 1 to `min(maxElevation, BASE_SUPPORT.fromLayer - 1)`.

The elevation cap (3 today) reads `BASE_SUPPORT` because the base-support rule (V-MTN-03) exempts the layers below `fromLayer`, and a one-cell wall above them would need width it cannot have. This avoids any base-support violations with no support planning at all.

The wall-midpoint carving in `generateMaze` covers the rectangle from `min(cx,nx)` to `max(cx,nx)+cw-1` in both axes. For `corridorWidth=1` this is correct: both the single-cell wall midpoint and the corner cells of the 1×1 rooms are included. For `corridorWidth > 1`, the rectangle over-carves slightly: walls that are `cw` cells wide between rooms are cleared as a block rather than as individual cells, but this is acceptable because the maze only places Mountains on `false` cells.

Region filtering (`regionSet`) is applied after the logical maze is computed. The maze is generated in the bounding rectangle of the region, then cells outside the region's actual shape are skipped. This means a non-rectangular region (e.g. L-shaped) will silently lose some maze arms: the bounding box is generated but only the intersection with the region is painted.

Painting uses a bulk-command-then-per-cell fallback: one `PaintTerrain` command per elevation covering all cells, and on a batch failure each cell is painted individually, with only the cells that took a layer advancing to the next one.

---

### Integration with Command/Validation Pipeline

All three generators receive `executeCommand: (cmd: Command) => ValidationResult` as a plain callback, not a direct `CommandExecutor` reference. In production (`tools/generation/run/generation-run.ts:runGeneration`), this is `executor.execute` on the map the run builds on, so every generation command passes through the full pre-command rule set of the registry that map is edited under. The generators observe the `ValidationResult` and skip or retry cells on failure.

`editor/operations/generate.ts:generateMap` lands the run inside `executor.transactionAsync` and commits it with `tx.commit()`, which is `commitStroke` over the group, once the run has finished. This runs post-stroke validation and cut-reconciliation once at the end, then collapses the entire generation into a **single undo entry** so the user undoes the whole generation in one Ctrl+Z rather than command-by-command. Generators are designed to produce rule-valid output structurally, so post-stroke revert should never fire in practice; the headless generation tests verify this by running post-stroke rules directly against the state after generation.

`CommandExecutor.execute` captures `before`/`after` cell snapshots for each generated command; `commitStroke` then collapses all those individual entries into one, so undo works correctly as a single operation.

---

### Region Selection

The region selection system is the `tools/pointer/region/region-brush.ts` brush, mounted by `editor/editing/region-brush.ts` while region selection is on; it registers a `RegionBrushHandler` on `tools/pointer/region/channel.ts` (`setRegionBrushHandler`) to receive cells the pointer machine reports via `paintRegionCell`/`finishRegionStroke`. Brush, eraser, rect, circle, line, and curve modes are supported via `shapes.ts` utilities, accumulating buildable cells into a mutable buffer during the drag and committing on pointer-up (the curve on the double-click that finishes the brushes' anchor chain, `paint/gestures.ts:AnchorChain`) as one entry of the region's own history lane (`commitRegion`, `undoRegion`, `redoRegion`), a capped `state/history-lane.ts` lane like the plan notes' own. The selected region is the store's own fact (`region: MacroCoord[]` in `state/slices/edit.ts`, written through `setRegion` (`[]` is the one representation of "no region painted")) and it reaches `generateTerrain` via `config.region`. Each generator converts this to a `Set<string>` (`"x,y"` keys) for O(1) membership tests.

The region's history lane is separate from the map's command history: a painted region is a scope for a future generate, not a map edit, so it must never share the executor's stack. While `selectingRegion` is on, the keyboard command routes Ctrl+Z/Ctrl+Y to the lane instead of to the executor. It takes one snapshot per perceived action (a brush drag, a shape drag, a whole curve sequence, a Clear tap), never per cell.

---

### Invariants Maintained

- All generated terrain lands only on `CellZone.Grass` cells not colliding with landmarks.
- **Rule-valid by construction**: terrain certifies through `repairPlan` against the live `RuleRegistry` (decrease-only fixpoint); every object goes through `tryPlace` (reject-and-skip). The real-map tests assert zero post-stroke violations and no object on a non-grass cell, on both shipped templates and every planet kind.
- The plate tiers satisfy V-MTN-03 (3×3 base) and no-floating by construction: a plate steps by at most the rule's own window and `planToCommands` builds every column bottom-up, so tall ground requires width.
- Elevated water is validated as a whole-plan candidate against the live registry before commit (`water-cut.ts`'s face/cap tests), satisfying V-WTR-02/03 with no post-stroke revert.
- Every district the streets reach is walkable from the plaza, and the eval ledger fails a run that strands one.
- The maze elevation cap (`BASE_SUPPORT.fromLayer - 1`) ensures `V-MTN-03` never fires for maze output.

---

## The Verb Seam (`src/editor/`)

`editor/` is the layer where "an editor operation" is one function with three interchangeable callers: the UI, the agent, and a test's by-hand context. `operations/` holds the verbs (`newMap`, `loadMap`, `generateMap`, `clearGenerated`, `transferMap`): each is a plain function over an `EditContext` (`core/commands/edit-context.ts`), and a verb that opens a map or a planet session takes the editor as a port (`context.ts:MapPort` and `SessionPort`; the shell passes the store-backed `editorPort`, a test its own); `operations/` imports neither the store nor `context.ts`'s values, runs as one stroke group with provenance pushed and popped, and returns its outcome as data (`tools/generation/run/outcome.ts` for a generation) so the UI and the agent narrate it separately. Beside the verbs: `host.ts` (the typed surface for camera, feedback, buildable-region overlay, capture and resync on the active view), `commands.ts` (the keyboard-command run bodies, zipped with the identity metadata in `state/keymap/registry.ts`), `actions.ts`, and `group-edit.ts` (the shared toast/animation side of single and group object actions).

The planet verbs sit beside them. `tools/generation/transfer/transfer.ts:buildTransfer` carries a build onto another planet on a detached map (plaza centres aligned, the destination's own terrain cleared under the carry, everything replayed through live rules) and `transfer-map.ts:transferMap` installs the result, so Change a planet's switch and its preview run the same replay; `tools/generation/run/planet-preview.ts:requestTransferPreview` runs that preview in the candidate worker pool, on the main thread only where the pool is unavailable. `planet-session.ts` is the planet editor (see Custom Planets below). `pick-selection.ts:pickSelection` arms the selected block's own material or item as the brush. A verb that builds without touching the live map takes `tools/macros/runtime/scratch.ts:detachedContext(state, registry)`: its own executor, an unheard bus and the given rules over the caller's copy.

Candidate generation leaves the main thread: generation's run (`tools/generation/run/`: `generation-run.ts`, the candidate cache `candidates.ts`) builds a candidate on a detached map, and `candidate-pool.ts` + `candidate.worker.ts` run planet builds in a small worker pool (`min(3, cores - 2)` workers; the main thread still has the map to draw and each worker holds a whole grid), each slot a `platform/async/worker-client.ts` client serving one job at a time, with queueing, cancellation of waiting jobs through their `AbortSignal`, and a main-thread fallback where a worker cannot boot, gated on `typeof Worker` so headless runs never construct one. Jobs cross the boundary as `core/model/grid-wire` buffers in both directions, because a structured clone of a raw grid costs tens of milliseconds on the main thread. The Smart Build macros' ghost preview and press share the same pool at queue-front priority.

---

## Custom Planets

A custom planet is a map template a person draws: its ground shape (grass, sand and sea), the landmarks the planet editor places (at most one of each), and the terrain and water it starts with. Its game facts come from `core/game/profile.ts:PLANET_PROFILE`: the size cap in chunks (`maxChunks`, from which `core/model/planet.ts` derives `PLANET_MAX_CELLS`), the shore radius, the custom template id prefix, the footprint turns a landmark may take, and `maxLayer`, the highest mountain layer ground may take while it is shaped (0, so the ground stays flat). The landmarks' footprints come from `core/game/profile.ts:LANDMARKS`, and a landmark carries no elevation. The model, the validator, the codecs, the session and the interface read these values there.

### The planet model (`core/model/planet.ts`, `shore.ts`, `template.ts`, `landmarks.ts`)

- **Content-addressed ids.** `planetTemplateId` hashes size, zones, the anchor landmark's position in half cells, size and rotation, every other landmark present, nonzero terrain and loadable water. The name and the chunk frame are outside the id, so one shape has one id in saves, share codes and the library, and any edit makes a new one.
- **A derived shore.** `shore.ts:deriveBoundary` marks sea and sand within the shore radius of grass as `Boundary`, the one-cell shore rim. On the session canvas a rim cell keeps the ground it covers in `MacroCell.under`, read through `core/game/zones.ts:groundZone`, and `refreshBoundary` re-derives only the cells near a change until the change is large enough for one full pass. Only ground commands change `under`, and `cloneCell` copies it, so undo and redo restore the rim with the zone.
- **A fresh map.** `template.ts:createGridState(template)` lays the zones through `createGrid`, seeds the template's terrain and water (`seedPlanetTerrain`) and lays the template's landmarks. Every new map, built-in or custom, opens through it.
- **Session canvas ids.** The planet editor's canvas takes a fresh `PLANET_CANVAS_ID_PREFIX` id per session, so a cache keyed by template id, such as a worker's template store, never serves one session's canvas to the next.

### One gate for untrusted planets

`core/model/planet-validate.ts:isTrustedPlanet` is the one gate for a template from a planet file, a save, a share code or the library. `validatePlanetTemplate` checks the structure (the id prefix, a size within the cap, valid zone values, each landmark at most once, inside the map on the ground it stands on, with an allowed rotation, terrain and water planes of the right length and range), and the id must equal the one the content hashes to. A planet that fails is never installed.

### The planet session

`editor/operations/planet-session.ts` runs the planet editor as a session over the live map, and `state/slices/planet-session.ts` holds its state. Its verbs take the editor's `SessionPort`. `enterPlanetSession` parks the live map by identity (grid, executor and undo stack, selection, layers, edit mode, view mode and the cameras the caller read) and installs an all-sea canvas at the size cap under `createPlanetRegistry()`, with a planet being edited embedded at a chunk-aligned offset. `leavePlanetSession` hands the parked map back unchanged through `restoreParkedEditor` and returns its cameras. Neither saves anything: persistence and cameras belong to the caller.

Ground is shaped with the ordinary tools. Terrain commands carry `ground`, so a cell's zone becomes `Void`, `Beach` or `Grass` before the terrain effect, and only the planet registry admits such commands (V-GROUND-LOCK refuses them everywhere else). While the session runs (`ToolContext.groundEditable`), a mountain stroke over sea or sand turns it into grass, and later strokes stack only up to `tools/pointer/paint/paint-plan.ts:mountainCeiling`, which reads `PLANET_PROFILE.maxLayer`; the sand material lays `ground: Beach`. The water brush lays a pond on layer-0 grass through the ordinary water path and leaves the zone unchanged, so no rim forms around it. The session follows `cells-changed` and re-derives the rim after every change. The landmarks are optional: the session's object shelf offers the ones the planet editor places, each placement, turn or removal is one undo step, V-PLACE-MAX refuses a second of one, `rotateSessionLandmark` turns one as a whole footprint through the `footprintTurn` trait while it is unlocked in the session, and V-PLANET-01 keeps ground edits out from under them. `finishPlanetSession` cuts the planet out of the canvas (`sessionPlanet`: the ground and landmarks cropped to whole chunks, the rim derived, terrain and water carried) and reports an empty canvas instead of a planet.

Customizing a planet never migrates a map. Moving a build onto another planet is Change a planet's carry (`tools/generation/transfer/transfer.ts`, described with the verbs above).

### Planets read from a video

`pipelines/planet-scan/` reads a planet's ground from a recording of the game's map view, on the device, in two workers: a decode worker demuxes an MP4, QuickTime, Matroska or WebM file and decodes it with WebCodecs (other files play through a video element on the page), and the scan worker tracks the camera, fits the chunk lattice from the region load lines, reads each cell's ground and finds the landmarks, laying each where it was read or leaving it for the person to place. `frame/framing.ts` places any picture so the game's view lands where the calibration expects it. `to-template.ts` cuts the result out with the same `core/model/planet.ts:cropPlanet` (and its `groundFrame` chunk frame) the planet session saves through, and the template must pass `isTrustedPlanet` before it leaves the worker. The import opens it as a `PlanetDraft` (`editor/operations/planet-session.ts`): a new, unsaved planet session whose review lists the inferred cells near the coast, whether the central plaza was placed rather than read, and the landmarks left to place, so Done, Back and the name check behave as for a drawn planet. Failures carry a `ScanFailure` reason that the import window shows with its own copy.

### Planet files, the library and embedding

- `io/save/planet-codec.ts` serializes a template (`serializeTemplate`, and `parseTemplate`, which ends at `isTrustedPlanet`) and owns the standalone planet file `{ format: 'petitmaker.planet', version: 2, name, template }` (version 2 carries the landmark list; version 1, with the plaza alone, still reads), written by `writePlanetFile` and read by `readPlanetFile`, with names clamped to `PLANET_NAME_MAX`.
- `io/storage/planet-library.ts` keeps My planets as one record under `PREFS.customPlanets`, deduplicated by template id; unreadable entries are dropped on read. A custom planet joins the library when a map on it is installed (`adoptInstalledPlanet`), never on decoding or inspection alone. `editor/session/planet-names.ts:shownPlanetName` is the one reader of a planet's name for display and export, reading the library's `planetNameVerdict`, and a name that has not passed the text check reads as the locale's default name.
- A save on a custom planet embeds its template in `SaveFile.template`; a built-in map writes only `templateId`. Readers resolve through `io/save/parse.ts:templateOfSave`, which parses the embedded template and hands it to `config/maps/resolve.ts:resolveTemplate`: the embedded template when its id matches the save's, otherwise a built-in, and `UnknownTemplateError` for an id that resolves nowhere.
- A share code carries a custom planet in payload frame 6 (see The Share Pipeline below).

---

## Editor Store & Item Catalog

### Responsibility

The Zustand store (`src/state/store.ts`) is the composition root of the entire editor. It holds (and is the single authoritative owner of) the live `GridState`, the `CommandExecutor` that mutates it, the `EventBus` that broadcasts mutations, and every piece of editor UI state (active tool, layer, selection, overlays). The catalog module (`src/state/catalog.ts`) is a purely static lookup table assembled at module-load time from the per-category barrels under `src/config/catalog/`; it has no runtime lifecycle and no dependency on the store.

---

### Store Shape

`EditorStore` (`store.ts`) is six independently-typed slices composed at one `create()` call: `PrefsSlice & ShellSlice & EditSlice & EngineSlice & AnnotationsSlice & PlanetSessionSlice` (`state/slices/{prefs,shell,edit,engine,annotations,planet-session}.ts`). Each slice factory types its own `set`/`get` no wider than the fields it actually touches, so a slice naming a field outside its declared type is a compile error rather than a convention, and `shell` declares no engine field at all, which is the boundary a shell replaces. Roughly:

**The engine slice**: the "engine bundle" components reach into:
- `gridState: GridState | null`: the row-major cell grid, object map, locked layers, and map template. `null` until a map is installed.
- `commandExecutor: CommandExecutor | null`: the command pipeline; `null` until a map is initialised.
- `eventBus: EventBus<EditorEvents>`: created once at store construction and **never replaced**. This is intentional: PixiCanvas subscribes to it on mount and the subscription lives for the component's lifetime. The event bus is the only member that survives a map install unchanged.
- the selection cluster: `selection: BlockRef[]`, `contextMenu`, `deletePopover`.

**The edit slice**: the arming: `editMode: EditModeInputs` is the one stored input, and the active tool, drawing mode, content, armed item and macro and brush size are selectors over it (`state/editing/edit-mode.ts`: `activeToolOf`, `designModeOf`, `contentTypeOf`, `armedItemOf`, `armedMacroOf`, `brushSizeOf`), so they cannot disagree. Beside it: `placementRotation`, `tileMaterial` + `tileMaterialPicked`, `autoEdgeCut`, `eraserShape`, `activeLayer`, `displayLayer`, `layerVisibility`, `drawingBrushSize` + `eraserBrushSize`, and the region cluster (`region`, `selectingRegion`, `regionTool`, `regionBrushSize`). Layer locks live on the map itself (`GridState.lockedLayers`), which the rules, copies and the save read. Tools read these through `ToolContext.arming` (`state/editing/arming.ts:armingOf`), one snapshot per store state.

**The prefs and shell slices**: persisted preferences (`locale`, `viewMode`, `gridMode`, `showChunkBounds`, motion, UI zoom and the rest, all through `platform/storage/prefs.ts`'s one key table) and the interface's open-surface state (`modals`, the mode row, panel flags). Every persisted key is declared once in `PREFS` and read and written only through that module's `readPref`, `writePref`, `readStoredPref` (the raw stored value, or that storage is unavailable) and `removePref`.

**The annotations and planet-session slices**: the planning-note tool, its options, selection, draft and its own undo lanes (`annotations.ts`, stepped through `state/history-lane.ts`), and the planet editor's state (`planet-session.ts`: `planetSession`, which is null outside the session and otherwise holds the entry being edited and the parked editor, `planetMaterial`, and `planetReturn`, the planet the Change a planet window shows selected after a session ends).

---

### initMap and loadMap as Wiring Points

`loadMap(state, registry)` (`state/slices/engine.ts`) is the one wiring point for an editing session; `initMap(template, registry)` is `loadMap(createGridState(template), registry)`.
1. `core/model/template.ts:createGridState(template)` builds a fresh map: `createGrid` lays the zones, the template's own terrain and water are seeded (`seedPlanetTerrain`; a custom planet may carry them), and the template's landmarks are added (`core/model/landmarks.ts:templateLandmarkObjects`, locked objects standing on the grass the template records under them). A map from the JSON codec or a share import arrives as a `GridState` already.
2. `state/executor.ts:createExecutor(state, registry, eventBus)` binds the executor: it constructs `CommandExecutor(state, executorDeps(state, registry, eventBus))`, whose terrain stroke policy holds the road lookup for that same map, which is how `core` asks its questions about coatings without importing up. It is the one app construction of an executor, the macro scratch executor's included.
3. `gridState` and `commandExecutor` are written into the store in one `set()`, along with the per-map layer state reset (active layer to Ground, no pin, visibility and locks cleared) and a fresh annotation session.

In every case the **existing `eventBus` instance is reused**; only `gridState` and `commandExecutor` are replaced. The planet session is the one caller that keeps a map aside: entering it parks the live map, its executor and undo stack, selection, layers and annotation lanes by identity, and leaving hands them back through `restoreParkedEditor`, which reinstates the parked editor and constructs nothing.

The caller is responsible for supplying the `RuleRegistry`. An ordinary map gets `createDefaultRegistry()` (from `src/rules/index.ts`), which registers all sixteen rules in the canonical phase order, called from `editor/operations/map.ts` (`newMap`/`loadMap`), which the app's cold-start map also goes through (`ui/app/boot.tsx`). The planet session installs `createPlanetRegistry()` from `editor/operations/planet-session.ts`: every default rule except V-GROUND-LOCK, plus V-PLANET-01 last. Rule configuration is therefore opaque to the store, which binds the executor to whatever registry it receives with no knowledge of which rules are active.

`PixiCanvas.tsx` reacts to `gridState` changing by re-initialising the renderer; `editor/session/editor-tools.ts` has already built a fresh `ToolManager` with the new executor and grid state from the same store change, completing the wiring from store update to renderer.

---

### CommandExecutor and Two-Phase Validation

`CommandExecutor` (`src/core/commands/command-executor.ts`) owns the undo/redo stacks and is the only entity that mutates `GridState`. Its API surface, grouped:
- `execute(cmd)`: pre-command validation via `RuleRegistry.validatePreCommand`, then `applyCommand`, then snapshot bookkeeping, event emission, and the stroke policy's `afterCommand` (the terrain policy's inline mid-stroke reconcile).
- `beginStroke()`: the `Stroke` handle every stroke group starts from; `historyDepth()` is the plain depth read.
- `Stroke.commit(opts?)`: the full commit pipeline described in the executor chapter: the policy's pass before validation (roads reconciled), post-stroke validated, offenders reverted, the policy's pass after validation (cuts reconciled), history collapsed.
- `undo()` / `redo()`: restore cell snapshots and, for undo, skip intermediate states that would violate post-stroke rules (the same iterative clean-up loop as `commitStroke`).
- `validatePre(cmd)`: pre-command validation with no execution and no `validation-failed` event, for probes whose refusals are outcomes rather than errors.
- `transaction(opts, body)` / `transactionAsync(opts, body)`: run a stroke group outside the pointer tools, owning the start, the authorship push (`source`), silence (`silent`, for bulk generation, which rejects and skips many candidates by design) and the rollback on a throw; the body commits through `tx.commit()` (see the executor chapter). They are the only door for authorship and silence.
- `Stroke.rollback()` / `Stroke.collapse()`: the all-or-nothing revert and the atomic-undo fold.
- `getUndoEntries()` / `Stroke.commands()` / `restoreHistory(entries)`: the history read/replay surface (the exported step history, and the agent's region lock reading commands as applied).
- `getProvenanceSummary()` / `getAuthorship()`: the provenance surface (its own section above): `getAuthorship()` answers whose work a cell or object is and carries authorship across a transfer.
- `getRegistry()`: exposes the registry so callers (notably `EditorAPI`) can perform dry-run validation without executing.

On `execute`, the executor captures `before` snapshots of affected cells, applies the command, captures `after` snapshots, pushes a `HistoryEntry`, clears the redo stack, and emits `cells-changed` / `history-changed`. For `PlaceObject` and `RemoveObject` the `applyCommand` path also emits `objects-changed` (and for `TrimCorners` on a road object it emits remove + add to force a renderer refresh).

The `EventBus<EditorEvents>` (`src/core/commands/event-bus.ts`) is a simple typed pub/sub with `on`/`off`/`emit`. There is no wildcard, no ordering guarantee beyond insertion order, and no async batching: every `emit` is synchronous. The renderer subscribes to `cells-changed` and `objects-changed` to trigger incremental redraws; `Toast.tsx` subscribes to `validation-failed` to auto-show error messages for pre-command rejections.

The `RuleRegistry` (`src/rules/registry.ts`) splits rules into two lists by phase. `validatePreCommand` filters the pre-command list by `appliesTo` and accumulates all errors (no short-circuit). `validatePostStroke` runs all post-stroke rules unconditionally. Registration order determines priority for pre-command rules; `rules/index.ts` owns the canonical order: locks, elevation, floating, block, trait placement, ground lock, zone, overlap, max-count, then chunk load.

---

### BlockRef / Selection Model

`BlockRef` (`state/selection.ts`) is a discriminated union:
```
{ kind: 'object'; id: string }
| { kind: 'terrain'; x: number; y: number }
```
A `BlockRef` is used for three distinct but related purposes:
- `selection: BlockRef[]` (`state/slices/engine.ts`): the selected blocks, in the order they were added, drawn as selection rings by the renderer. `[]` is the one representation of "nothing selected"; there is deliberately no scalar beside the list, because a scalar and a list are two sources for one fact and drift. Mutated only through `setSelection` / `toggleSelection` / `clearSelection`. Consumers that can express only one member (the corner handles, the delete popover, the keyboard rotate/delete, the agent's tool surface) read the pure derivation `singleSelection(selection)` from `state/selection.ts`, which returns null for a plural selection rather than an arbitrary member. `sameRef` there compares by value, since a `BlockRef` is rebuilt on every hover.
- `contextMenu: { x: number; y: number; target: BlockRef } | null`: right-click menu anchored to a position with its target. The `target` is always a `BlockRef` because the menu is always triggered on a real block.
- `deletePopover: BlockRef | null`: the keyboard-delete confirmation popover; non-null exactly while the popover is visible.

`ContextMenu.tsx` and `DeletePopover.tsx` both pull `commandExecutor` and `gridState` directly from the store, but the operations themselves run through shared call paths rather than being built inline: single-object rotate/peel through `tools/objects/actions.ts` (rotate is a remove plus a place of the same id, collapsed into one undo step), and delete/rotate's toast + animation side through `editor/editing/group-edit.ts:deleteSelection`/`rotateObjectAction`/`rotateGroupAction`; the same functions `SelectionCard.tsx` and the keyboard shortcuts (`editor/commands/commands.ts`) call, so the three surfaces cannot answer the same action differently.

The armed catalog item is `armedItemOf(store)`, a selector over `editMode`. `ToolManager` resolves it into `ToolContext.arming.armedItem` and supplies `placementRotation` alongside it. The object placer reads that context, keeping the toolbar, rotation shortcut, placement command and ghost synchronized without reaching into Zustand itself.

---

### Catalog Loader/Indexer

`catalog.ts` is a module-level singleton built immediately at import time. It assembles the per-category barrels under `src/config/catalog/` in the order of the category registry `config/catalog/categories.ts:CATEGORIES`, with one JSON file per object, and builds two `Map` indexes:
- `byId: Map<string, CatalogEntry>`: O(1) lookup by `item.id` string (e.g. `"building-forest-cabin"`).
- `byCategory: Map<string, CatalogEntry[]>`: ordered list per category id, holding only items still offered for placement; an item marked `disabled` stays in `byId` so saved maps load and render.

The Road family comes from the in-game path entries (`path-*`); each icon is also the tile texture drawn in both views. Retired road ids remain exact-match migrations in `config/catalog/retired-ids.ts`, so persisted maps convert them to their current replacements instead of dropping them.

The exported surface is a set of pure reads on these maps: the lookups (`getCatalogItem`, `getOfferedItem`, `getCatalogByCategory`, `getPlaceableByCategory`, `getAllItems`, `getKnownItems`), the per-object questions (`categoryOf`, `isDecoration`), `getRoadMaterials` (the tile brush's surface list), and `catalogLoadValue` (the `LoadValueLookup` every `CommandExecutor` construction injects). There is no lazy loading and no hot-reload path; the one mutation door, `__setCatalogItem`, is test support (rule unit tests register controlled footprints). `getAllItems` returns the same array until the catalog changes, so a higher-layer memo cache keys on its identity.

The category registry holds each category's facts once: its items, its search-term locale key, its effect tint, its stylize word, and, for categories placed item by item, the icon, Place menu action, shelf tab and menu keys, and its position on the Place menu, the shelf and the build checklist. `state/catalog-search.ts:searchCatalog` scores the offered items and takes the category words from its caller (`i18n/terms/category-terms.ts:categorySearchTerms` gathers every locale's search words and shelf tab and Place menu names, the active locale's first, then English), so the store holds no copy.

`CatalogItem` (`types.ts`) carries the `PlacementTrait[]` array that drives `V-PLACE-TRAIT` (`rules/placement.ts`). Each trait is a tagged union variant; the rule iterates the trait list and dispatches to per-trait validation logic. Adding a new trait type therefore needs no change to the registry or executor: add it to the union in `types.ts`, handle it in `placement.ts`, and give any other module that asks about it a predicate in `core/model/traits.ts`, the one home for trait questions (`hasTrait`, `findTrait`, `isCoating`, `isBridge`, `isRamp`, `isCrossing`, `standsOnCoating` and the like), so no higher layer open-codes a trait scan or matches item ids. A new category is one entry in `config/catalog/categories.ts`, which holds its items and the facts the menus, shelf and checklist read.

`CatalogItem` is entirely disjoint from `PlacedObject`. A `PlacedObject` stores only `catalogId`, `position`, `rotation`, `elevation`, and optionally `spanLength` and `corners`: it looks up its dimensional and behavioral metadata from the catalog at runtime via `getCatalogItem(obj.catalogId)`. The catalog is therefore the authoritative schema for object rules; `PlacedObject` is the minimal persistent payload.

---

### Map Stats (`src/state/map-stats.ts`)

`getMapStats(state)` derives every whole-map count the editor reads: per-layer cell/object counts (`cellsByLayer`, `objectsByLayer`, `maxElevation`: the layer panel's question, via `state/layer-utils.ts:getActiveLayers`) and per-chunk object load (`chunks: Map<string, ChunkStat>`: the chunk-load rule's question, and the programmatic API's `EditorAPI.getChunkLoad`). Per-catalogId tallies are a separate question answered by `state/object-index.ts:countByCatalog` instead, so this module does not keep a second, differently-scoped count of the same fact.

The result is memoized per `GridState` and, like `state/object-index.ts`, **patched rather than rebuilt**: an object mutation folds its `state.objectsDelta` into the cached counts instead of re-deriving them from every object, while the terrain half rebuilds on `state.cellsVersion` changing (one grid walk per frame in which cells actually moved). Anything the cache cannot trust (a missing delta, a skipped version, a post-patch count that disagrees with `state.objects`) falls back to a full rebuild, so it can be slow but never stale.

The returned `MapStats` is a **live view, not a snapshot**: it is the same object instance on every call for a given `GridState`, mutated in place by the delta-patch path. A consumer that memoizes on the object's *identity* rather than its field values will not see later updates; React consumers should read the fields they need at render time rather than caching the `MapStats` reference itself. `subscribeMapStats` is the rAF-coalesced subscription React surfaces read through, so a brush stroke recomputes at most once per frame.

---

### Invariants

1. The `eventBus` instance is immutable for the lifetime of the application. Subscribers attach to it once; a map install keeps the bus, so subscriptions survive every map swap.
2. `commandExecutor` and `gridState` change together in one `set()` call. Any code that reads one should always check the other (both are nullable for the same reason).
3. `GridState.lockedLayers` is written directly by the store's layer-lock setters (`setLayerLocked`, `loadMap`, `restoreParkedEditor`); it is not mediated through a command. Rules read it but never write it.
4. Rule purity: neither `PreCommandRule.validate` nor `PostStrokeRule.validate` may mutate state. The registry enforces this only by convention: TypeScript does not prevent mutations.
5. Commands carry no snapshot data, only what applying them reads. `CommandExecutor.execute` captures `before`/`after` cell snapshots and stores them on the `HistoryEntry`.

---

### Composition with Neighbouring Subsystems

- **Tools**: `ToolManager` receives `executor` and `gridState` at construction time (from the store) and never re-reads them from the store. When `gridState` changes (new project), `editor/session/editor-tools.ts` retires the old `ToolManager` and builds a new one. Tools call `ctx.executeCommand` and `ctx.beginStroke()` (closing the returned `Stroke`), which delegate to the executor.
- **Renderer**: Subscribes to `eventBus` events for incremental redraws. The renderer's `initMap` is called reactively on `gridState` change. It never touches the store directly except through the event bus.
- **Rules**: Created externally (`createDefaultRegistry()`, or `createPlanetRegistry()` in the planet session), passed into `loadMap`, held by the executor. Rules read `GridState` but have no reference to the store.
- **IO**: `json-codec` serialises/deserialises `GridState` only. Chunk loads are not persisted: they are derived from the objects.
- **EditorAPI** (`src/editor/dev/editor-api.ts`): Installed on `window.__PETIT_API` at mount **in DEV builds only** (`App.tsx` imports the module behind `import.meta.env.DEV`, so a production build ships neither the module nor the global). Accesses `gridState` and `commandExecutor` via getters that call `useEditorStore.getState()`: this avoids capturing stale references while still being synchronous.

---

## IO Codec & Programmatic API

### Responsibility

This subsystem has three loosely related jobs that share the `GridState` type as their interface surface:

1. **Persistence** (`src/io/`): Serialise and deserialise `GridState` to/from a versioned JSON envelope, compress the cell grid with run-length encoding, and provide the transport helpers: file download, clipboard copy, and a debounced localStorage autosave. Around the codec in `save/`: `sections.ts` (the optional save sections, which `import/sections-restore.ts` installs), `admission.ts` (object admission), `history-codec.ts` (an exported undo stack, validated before replay) and `planet-codec.ts` (custom planet templates and planet files; see Custom Planets above); `config/catalog/retired-ids.ts` holds the retired-id renames. `import/file.ts` is the one entry for a picked/dropped/pasted file, JSON or image, that never throws. `storage/` holds what stays in the browser: `autosave.ts`, the compressed record envelope (`record-codec.ts`, compressed off the main thread by `record-compress.ts`), `planet-library.ts` (My planets) and `local-reset.ts` (the Settings "Local data" wipe).
2. **The share pipeline** (`src/io/share/`): the map as an importable picture; its own section below.
3. **Programmatic API** (`src/editor/dev/editor-api.ts`): Expose the live editor as a typed object on `window.__PETIT_API` (**DEV builds only**) so browser-console scripts and automation harnesses can read grid state, issue commands, and round-trip JSON without touching the React/Zustand layer.

### JSON Codec (`src/io/save/json-codec.ts`)

#### SaveFile schema

The save envelope and its current version come from [save/format/types.ts](../src/io/save/format/types.ts). The codec writes declared fields directly. Optional domain sections stay `unknown` at this boundary and are parsed by their owners.

<!-- generated:save:start -->

Source: [src/io/save/format/types.ts](../src/io/save/format/types.ts).

```ts
export const CURRENT_VERSION = 3;

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
    template?: SerializedTemplate;
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

**Versioning** (`io/save/format/`): `migrate.ts` runs an append-only chain of version-to-version transformations before decoding, and rejects future versions with `ImportError('future-version')`. A breaking change adds a migration, advances `CURRENT_VERSION`, and freezes a fixture. Additive optional sections require no version bump. `metadata.savedAt` is informational; `cells` contains packed row-major terrain tokens.

#### Cell encoding pipeline

`serialize` (`json-codec.ts`) iterates cells in row-major order (`y` outer, `x` inner) and converts each `MacroCell` to a short text token:

- Empty cell (`terrain: null`) → `"_"`.
- Terrain cell → `terrainToken` (`save/terrain-token.ts`), which produces `t<type>:<elevation>` plus an optional corner suffix and optional `:P` patch-only flag. The corner suffix encodes the four `CornerTrim` values using a single-char map (`S/F/1/2/3/4/E`); if all four corners are `'square'` the suffix is omitted entirely, saving space for the most common case.

The token array is then RLE-compressed by `rleEncode` (`save/rle.ts`): consecutive identical tokens become `<count>*<token>`. For a fresh map this collapses all empty cells to a single `400*_`-style run. On `decodeSave` (`json-codec.ts`), `rleDecode` (`save/rle.ts`) expands the RLE, then `tokenToCell` (`save/terrain-token.ts`) reconstructs each `MacroCell`: restoring `zone` from the live template rather than persisting it (zone data is the template's responsibility, not the save file's).

`tokenToCell` handles legacy saves: tokens may contain `+`-joined parts with `c` (old corner) or `r` (old road) prefixes which are silently ignored. Only `t`-prefixed parts are read.

#### Object encoding

`SaveObject` (`io/save/format/types.ts`) flattens `PlacedObject` to scalar fields. Notable details:

- Objects carrying `locked` are not written. The landmarks are the only ones, and they are rebuilt from the template on load, so a save never carries a copy that could drift from the template's.

- `spanLength` and `corners` are only written when present (bridges only have `spanLength`; road patches may have `corners`).
- A corner-suffix omission optimisation mirrors the terrain case: if all four corners encode to `"SSSS"`, `corners` is omitted from the saved object entirely.
- `patchOnly` is a declared optional `SaveObject` field and round-trips directly through the codec.
- Object rotation, coordinates, elevation and span are validated before constructing a placement. Unknown catalog items and invalid placements are skipped; object identifiers are normalized before they reach tool output.

#### Deserialization invariants

`decodeSave` (`json-codec.ts`) rejects a declared template mismatch and cell data that does not cover the template. It reconstructs zones and the locked landmarks from the template, validates imported objects and removes fully covered duplicate coatings. The returned state starts with an empty `lockedLayers` set; layer locks are not persisted.

`parseTerrain` (`save/terrain-token.ts`) includes a legacy entry in its decode map: `T: 'tri-NW'` alongside `'1': 'tri-NW'`. The encoder only ever writes numeric codes, so `T` is a dead read path for forward-compat with an older encoding.

#### Autosave (`src/io/storage/autosave.ts`)

The writer `createAutosave` builds in [autosave.ts](../src/io/storage/autosave.ts) uses `AUTOSAVE_DEBOUNCE_MS` ([facts.ts](../src/io/storage/facts.ts), beside `autosaveWorthy` and `hasAutosave`) to coalesce edits and reads the cameras and undo stack it is given at write time; the app's instance is `editor/session/autosave.ts`. Only content-bearing maps are written. If storage fails, it retries without provenance; undo history is retained only when the full map and its provenance were saved together. `readAutosave` returns null on decoding failure, and `readRestorableAutosave` additionally applies the shared `autosaveWorthy` content predicate.

#### Image export (`src/io/export/download.ts`)

`export/download.ts` provides `downloadBlob` and `downloadJSON` as pure DOM utilities, and `platform/remote/data-url.ts:dataUrlToBlob` decodes a `data:` URL. It exists because `fetch()` of a `data:` URL is blocked by the CSP's `connect-src`, which is the obvious way to convert one and does not work here. Full-map image export goes through `editor/host/host.ts`'s `capture2dImage()`, which takes one `view/map-capture.ts:MapCaptureOptions` and calls the live `MapRenderer.captureImage()` via `view/map2d/scene/renderer-registry.ts`'s `getMapRenderer()`, not through this module. The composed share-image shot (header, grid, layer strip, 3D cards, footer) is `io/export/`'s job.

### The Share Pipeline (`src/io/share/`)

The share image is not only a picture of the map; it carries the map. `export.ts:buildShareCode` encodes the whole `GridState` into the visible, fixed-footprint PetitGlyph band. `codec/` packs the map into a payload (`bitio.ts` bit-level IO, `map-coder.ts` and `payload.ts` the format, `grid-io.ts` the cell stream). `glyph/` selects a payload-sized color and module-density profile, protects shortened blocks with Reed-Solomon parity over gf(256), interleaves them, and places their modules in a centered capsule; its decoder retains the released version 1 and 2 transports. `raster/` reads and writes PNG without a browser API (`png-chunks.ts`, `zlib.ts`), so the same import path runs in Node tests.

Two laws hold the format together. The payload always carries the complete canonical map and ends in its SHA-256 (`io/save/canonical.ts`, `core/base/sha256.ts`); import (`import.ts:importFromBytes`/`importFromRaster`) decodes, rebuilds and compares, so a share image imports exactly or fails rather than returning a partial map. An optional generation-recipe note records how a generated map was made, but import never depends on replaying the generator. Each object travels as an index into append-only `codec/catalog-order.ts`: the position is part of the wire format, so new items go at the end and retired ids keep their slots before migration to current ids.

A map on a custom planet carries its planet. Payload frame 6 adds, after the notes record (always written, empty when there are none), a length-prefixed `codec/template-record.ts` record: the size, the plaza in half cells with its rotation, a layer byte written as 0 (landmarks carry no height), the chunk frame and the name as fixed fields, then the other landmarks, the zones range-coded by neighbourhood context and the optional terrain and water planes, all covered by the content hash. Terrain and water travel because they are part of the planet's content id. Built-in maps never write frame 6, so their bytes and hashes are unchanged. The decoder bounds the dimensions by `PLANET_MAX_CELLS` before allocating, rebuilds the id from the content, validates the record and requires its id to match the frame's template id; anything else is a corrupt code.

### Programmatic API (`src/editor/dev/editor-api.ts`)

#### Installation

`installDevAPI` (`editor-api.ts`) is called once from `App.tsx`, which loads it only in DEV builds. It publishes an `EditorAPI` on `window.__PETIT_API` with two thunks, `getState` and `getExecutor`; its JSON methods call the save codec (`serialize`, `openSave`) directly. The thunks call `useEditorStore.getState()` at invocation time, so the API always reflects the latest `GridState` and `CommandExecutor` even after `initMap`/`loadMap` replace them in the store; a call before a map is loaded throws `EditorAPI: no map is loaded`. Production builds install nothing.

#### Read surface

`getCell`, `getRegion`, `getObjects`, `getChunkLoad`, `getMapDimensions` are thin wrappers around `grid-model:getCell` and direct `GridState` field reads. They return live references (not clones), so a script that mutates the returned `MacroCell` would corrupt state without going through the command pipeline.

#### Command surface

`paintTerrain`, `eraseTerrain`, `placeObject`, `removeObject` each manually construct a `Command` with the correct `CommandType` and pass it to `executor.execute()`. This is **exactly the same path** the UI tools use: `execute` runs pre-command rules via `RuleRegistry.validatePreCommand`, applies the command only on success, pushes to the undo stack, and emits `cells-changed` and `history-changed` events. The renderer reacts to those events identically whether the change came from mouse drag or console script.

Two construction details stand out:

- Each method builds a typed command literal, so a field added to a command type surfaces here as a compile error rather than being silently dropped.
- `placeObject` (`editor-api.ts`) builds its command through `placeObjectCommand` (`core/model/command-build.ts`), the same builder the placer tool uses, and sets `elevation` from the terrain at the target cell. A bridge placed via the API will not have `spanLength` set, making it semantically incomplete (a bridge without `spanLength` would fail `waterSpan` trait validation in a pre-command rule before it even reaches placement).

#### Validation surface

`validate` (`editor-api.ts`) calls `executor.getRegistry().validatePreCommand(cmd, state)` and wraps the result in a `ValidationResult`. This lets scripts dry-run commands, but it only covers pre-command rules: the full two-phase picture (including post-stroke rules that might revert the command) is not exposed.

#### I/O surface

`exportJSON` delegates to the codec's `serialize(getState())`. `importJSON` delegates to the codec's `openSave(data, getState().template)` but does **not** install the result: it returns the `GridState` without calling `store.loadMap`. A caller that wants to actually load the imported state must call `store.loadMap` separately.

#### History

`undo` and `redo` are direct delegates to `CommandExecutor`. They participate in the same undo stack that UI operations use, so console-issued commands are undoable with Ctrl+Z in the browser.

### Composition with neighbouring subsystems

- **Command Executor / Rules**: The API reuses `CommandExecutor.execute` verbatim, receiving the same pre-command validation and event emission as UI tools. Post-stroke validation (`Stroke.commit`) is **not** called by the API: committing a stroke is the tool's responsibility and the API provides no stroke-level grouping.
- **Zustand store**: The API reads state via late-bound thunks (`getState`/`getExecutor`) so it is transparent to `initMap`/`loadMap` replacing the live objects in the store.
- **Renderer**: Because the API routes through `execute`, all renderer event subscriptions (`cells-changed`, `objects-changed`) fire normally.
- **Autosave**: The codec's `serialize`/`deserialize` are used by both the autosave module and the API's `exportJSON`/`importJSON`.

---

## The 3D View (`src/view/map3d/`)

The 3D editor is the second live view over the same command pipeline, not a preview: the whole 2D tool set works on its surface unchanged, because editing goes through `geometry/pick.ts` (a pure heightfield ray-march to the first visible surface) and `camera/projection.ts` (the 3D `ViewProjection`), with tool overlays drawn as surface-draped decals. The scene is live-synced to the event bus (`cells-changed` remeshes the dirty chunk ring, `objects-changed` updates slot-managed instanced meshes) and the chunk is lazy, so three.js stays out of the startup bundle; the startup warm schedule loads the scene and its model table after the first paint, and a session that opens in 3D loads them at once. Within: `geometry/` (coordinates, contracts, picking and the pure, unit-tested geometry builders, honouring the edge-cut trims), `draw/` (palette, the proximity-fade shader and edge materials), `models/` (the declarative per-item `ModelSpec` system, each model read from `config/catalog/models.ts`, which only this registry and the procedural stylize renderer import so the model table rides in their lazy chunks, and the category fallback archetypes), `layers/` (tool overlay, annotations and move origins), `camera/` (controls, glide, rest, the projection and the camera registry `io/storage/autosave` round-trips the 3D orbit through), `capture/` (export stills and the shot list), and `scene/` (the one GPU file, its frame budget and preload). The 2D canvas stays mounted as the capture/export engine.

## The Interface Layer (`src/ui/`)

One interface, mounted by `ui/app/EditorRoot` as `ui/shell/Shell`: two shared layers below (`design/` for tokens, the UI-scaling factor and cursors; `primitives/` for generic parts), and three owning surfaces above. `shell/` is the game-style frame around the map: its mode is the store's `editMode.mode`, so the visible bottom bar and the armed map action are one fact; `bars/` contains the per-mode shelves and `windows/` the layer panel and related surfaces. `chrome/` owns modals, floating overlays, guards and the first-launch tour. `agent/` is the assistant panel, loaded separately so its tool layer and provider SDKs stay out of the eager graph. Every user-facing string goes through `i18n/`, and every shell motion is declared in `design/motion/registry.ts`.

`design/scale.tsx:fittedUiScale` owns the shared fit for the frame and chrome, including the remaining workspace beside a docked assistant. The frame layout plan coordinates corner actions and rail folding, keeping history on the right and fitting expanded layers above the lower controls when space permits. Each bottom row reserves only the rail cells intersecting its height; crowded rows scroll horizontally. Fitting changes the displayed size while retaining the saved scale preference. Layout transitions use the shared motion registry and reduced-motion gates.

`assets/fonts/family.ts` declares the common interface and map-label font stack. `ui/design/text-weight.ts` adapts text weight to visible text size, a bounded allowance for display density and script density. Small text becomes lighter while normal body text and larger headings retain their emphasis. Native controls inherit their surface's font; portalled slider readings carry the font explicitly and use the same weight adaptation.

`GenerateShelf` owns generation settings and applying a chosen result. Its preview hook owns detached candidate/custom previews, caches and cancellation; font readiness and strip controls have their own modules. Help renders text immediately and admits illustration work after the modal entrance and near the reading viewport. Preview frames retain their dimensions while unseen map generation, captures and renderer setup wait; examples still use the live components and editor operations.

## The Agent Harness (`src/agent/`)

The LLM assistant edits the map by tool call, and its architecture is one sentence: the log is the state, and everything else is a projection of it. `core/log.ts` is an append-only `SessionEvent` list; `core/project-view.ts` folds it into what the panel renders and `core/project-messages.ts` folds the same log into provider messages, so the UI and the wire can never tell two different stories. `core/loop.ts:runJob` drives adapter turns from the log and back into it: its only state is the log, so a fresh call over the same log resumes exactly where the last one stopped (an unanswered gate is re-entered rather than re-asked), with the governor's dampers (turn budget, verbatim-retry and repeated-revert escalations, the repeat refusal) reading their counters back off the log too.

`providers/` is BYOK in-browser. `defaults.ts:PROVIDER_IDS` is the provider roster, including the custom OpenAI-compatible endpoint; `detect.ts` suggests a provider from a pasted key's format alone, without a network request. `connect.ts` turns a connection into an adapter and loads the provider's SDK on the first request, so the assistant panel carries neither SDK. `exec/` is the seam to the app: `executor.ts` adapts the tool layer to the loop, and `runner.ts` owns the in-flight job. `session/` bridges to Zustand and persists the log. `tools/` declares each tool once as a `ToolSpec` (description, typed argument schema, access, handler), and `tools/registry.ts` derives the wire schemas, the approval sets and dispatch from those specs, checking every call's arguments before it runs; the harness core reads tools only through `core/tool-facts.ts`. `prompts/` is markdown, with the system prompt rebuilt from the live `RuleRegistry.getRules()` and catalog so those runtime facts cannot drift from the model's instructions, and the game's build playbooks are markdown under `skills/`, data the tools serve to the model.

The tool sandbox (`tools/**` and `exec/executor.ts`) exposes map operations without storage, DOM or network access. A write call groups its accepted edits into one undo step. Pre-command refusals return rule evidence; post-stroke validation rolls back only as far as legality requires, so a valid prefix may remain. Tool feedback and the panel report the retained cell/object edits explicitly. Crashes and region-lock violations roll back the whole call; the region boundary is checked against commands as applied, including snapped placements. The key vault uses AES-GCM with a non-extractable IndexedDB key, transcript redaction and HTTPS-only custom endpoints with a loopback exception. See [THREAT_MODEL.md](THREAT_MODEL.md).

Cancellation and pause are checked again after approval and write waits, before execution. Stream waits and compaction observe cancellation even when a provider does not. Runner callbacks are scoped to their active log so late completion cannot replace a newer job. `session/validate-log.ts` validates persisted event structure and sequence before projection; unanswered gates from earlier jobs cannot block a current pause. An oversized context that cannot be shortened becomes a reported incident instead of a retry loop.

---

## Editor Interaction: Block Selection

Selection is editor-interaction state rather than map data, but it drives several command paths, so it belongs here. Any block can be selected (a placed object or a terrain cell (mountain, water, or bare ground)) and there is no separate object-only selection path. The selection is a set: `selection: BlockRef[]` in `state/store.ts`, ordered as the user built it, holding object references (by id) and terrain references (by coordinate). Only objects can be selected plurally; terrain is always a selection of one (see "Group operations" below).

**When selection is active.** An unmodified click selects in drag mode: the Hand tool, or the Object Placer with no item chosen (each tool's own `Tool.selectMode`, which the press path reads through `tools/pointer/runtime/tool-set.ts:toolDeclares`). During creation modes (brushing, painting, road brush, edge cutting) a click means "draw here", so selection is disabled to avoid ambiguity, and switching to one of them drops the selection in the same store update (`state/editing/edit-mode.ts:holdsSelection`). A selection written while a terrain brush is up (a Ctrl+click or a band) puts the brush away for the Hand tool in that same update.

With an item armed the placer is a special case, because a selection is still reachable there (`holdsSelection`, the wider gate that keeps the selection alive) in two ways. Holding the multi-select modifier routes the press to the ordinary toggle / rubber-band path instead of placing, and once that gesture leaves something selected the armed item is dropped, so the pointer lands in plain select/drag mode; a gesture that selected nothing keeps the item. An unmodified press on an existing object where the placement would be refused selects that object instead of raising the refusal, and keeps the item armed so placing continues afterwards (`armedPressSelects`, gated on the placer's own `canActAt` so a legal placement always still places: coating over a road, or a bridge/ramp snapping from an anchor cell that carries a decoration).

**What you can do with a selection:**

| Action | Object | Terrain |
|--------|--------|---------|
| Select (left-click) | ✔ | ✔ |
| Show layer number | ✔ (forced) | ✔ (forced) |
| Drag to move | ✔ | no |
| Right-click rotate | ✔ (if rotatable) | no |
| Delete | removes object | peels one layer (eraser behavior) |

A selected block shows its layer number as a fallback for when the global show-numbers toggle is off; when that toggle is on, the terrain/object layers already draw the number, so the selection suppresses its own label to avoid drawing it twice.

**Delete semantics.** Deleting a terrain block peels exactly one layer (mountain N → N−1, water → cleared to ground): the same peel the eraser uses. Deleting an object removes it. Right-click → context menu deletes instantly; keyboard Delete/Backspace opens a confirm popover (Enter confirms, Esc cancels). Ground is undeletable: for a ground cell the context-menu Delete is greyed out and the Delete key does nothing (ground *water* is not ground; it peels to ground like any other water).

Deselecting (including the implicit deselect after a delete, or leaving drag mode) clears the selection outline through a single subscription on the selection state, the inverse of drawing it.

### Group operations

Ctrl is a selection modifier and nothing else: Ctrl+click toggles a member, Ctrl+drag rubber-bands, Ctrl+A takes every object on the map. Moving is unmodified and does not care how many members there are: a drag arms only on a press over an already-selected object, which is the same rule single selection has always used, so extending it to N needs no new gesture. The band is a macro rectangle (`view/interaction/marquee.ts`): the drag's endpoints resolve to placement-grid cells through `core/grid/pointer.ts:cellUnder` and the resulting rect is both what is drawn and what selects, so the 2D and 3D behaviours are identical by construction and the rule is testable without a camera. An object is covered when its footprint intersects the rect, and candidates come from `object-index`'s `entriesNear`, never a scan of `state.objects`.

Terrain is never multi-selected. Ctrl over bare ground begins a band instead of selecting the cell, and a band collects objects only; a set of terrain cells has no group operation the brushes do not already do better.

`PlacedObject.locked` is a tag, not an object kind. Locked objects remain hit-testable, selectable, and eligible for group membership; V-LOCK-02 rejects any attempted mutation. Both views therefore resolve the same object under the pointer before the rule layer decides whether an action is allowed.

Whether a group operation refuses wholly or applies partially follows from whether a partial result is coherent, and has nothing to do with which member is locked. **Move and rotate are geometric**, so a partial application would silently deform the arrangement being manipulated and leave an undo restoring something the user never saw: if any member's destination is illegal, or any member is locked or cannot turn, the whole operation is refused and the blocker is named. For a move the refusal is visible before release, as the drag ghost tints invalid. **Delete applies to what it can and reports the rest**, since the survivors are exactly where they were: Ctrl+A then Delete clears the map and keeps the landmarks, with a message saying so. Both run through `tools/objects/group-actions.ts` (the plural sibling of `tools/objects/actions.ts`) as one stroke group and one undo entry, so the context menu, the delete popover and the keyboard command (via `editor/commands/commands.ts`/`editor/editing/group-edit.ts`) share one implementation. Membership is re-resolved from ids on every operation (`groupMembers`), because nothing validates a selection centrally and another path may have removed a member since.

A group rotation is one rigid body turning about one point: every member's position rotates about the selection's macro bounding-box centre, and each rotatable member's own facing advances by the same quarter turn. A member that cannot turn but is square is carried (its position travels, its facing does not) because `rotatable: false` marks an item with no meaningful facing, and refusing on that flag would let one flower kill nearly every real selection while protecting nothing. A member that cannot turn and is not square refuses the whole rotation: it cannot swap its extent, so the bounding box changes shape from turn to turn and the arrangement walks away from where it started. The animation contract lives in `view/shared/motion/group-arc.ts` and is shared by both views: what eases is the angle about the pivot with the radius held (a straight line cuts the chord, visibly contracting the arrangement mid-turn), the whole turn is one spec on one clock rather than a signal per member, and offsets are measured from the already-committed rest pose, since the commands apply instantly and a tween can only land where the map already put the object.
