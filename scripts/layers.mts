/**
 * The layer order of `src/`, bottom to top. A module may import from its own layer, a layer of its
 * group, or any layer earlier in this list; the layer guard, the generated layer table and stack
 * diagram in `docs/ARCHITECTURE.md` and every other reader take the order from here. Every
 * top-level folder of `src/` is one of these layers, except `lite/` and `__tests__/`.
 *
 * `platform` is the browser and build boundary every layer above may reach. `config` and `assets`
 * are data typed by `core`. `i18n` reads the store, so it follows `state`; its key schema and locale
 * tables rank with `config` (`LEAF_RANKS`). `tools` edit and read the map over `state` and `rules`.
 * `pipelines` compute over `state` and the data below it and never draw. No tool or view imports a
 * pipeline or is imported by one (`APART_LAYERS`), so their place between `tools` and `view` is a
 * choice; they rank below `io`, which reads their facts (the review rule, the recording formats, the stylize
 * settings), and `agent` and `ui`, which run them; no `editor` verb does. `view` draws over the
 * contract in `tools/pointer/runtime/`. `io` saves, shares and exports, reading views to draw an image;
 * `editor` sits above them because a verb needs generation, a view and the save codec together,
 * and `agent` drives `editor`. `legal` ranks above `agent` because its disclosure lists read the
 * assistant's and the illustration studio's provider tables. `entry` is the root files of `src/` and
 * `src/lite/`, which compose the app and which nothing imports.
 */
export const LAYERS = [
  ['core'],
  ['platform'],
  ['config', 'assets'],
  ['state'],
  ['rules'],
  ['i18n'],
  ['tools'],
  ['pipelines'],
  ['view'],
  ['io'],
  ['editor'],
  ['agent'],
  ['legal'],
  ['ui'],
  ['entry'],
] as const;

export type Layer = (typeof LAYERS)[number][number];

/** Layer pairs no import joins in either direction, type-only imports included, so their order in
 *  `LAYERS` is a choice: the tools and the views each stand apart from the pipelines. */
export const APART_LAYERS: readonly (readonly [Layer, Layer])[] = [['tools', 'pipelines'], ['view', 'pipelines']];

/** Each layer's rank: its index in `LAYERS`. Layers of one group share a rank. */
export const LAYER_RANK: ReadonlyMap<Layer, number> = new Map<Layer, number>(
  LAYERS.flatMap((group, i) => group.map((layer): [Layer, number] => [layer, i])),
);

/**
 * Paths inside a layer that rank with a lower one, keyed by src-relative prefix (a module without
 * its extension, or a folder ending in `/`). The i18n key schema and the English tables it derives
 * from import only `core` types, so the layers below `i18n` may name an `I18nKey` as data does; the
 * layer namer reads only the key schema and the profile, so a state derivation names a layer as the
 * interface does.
 */
export const LEAF_RANKS: Readonly<Record<string, Layer>> = {
  'i18n/keys': 'config',
  'i18n/terms/layer-name': 'config',
  'i18n/locales/': 'config',
};

/** The layer a src-relative path ranks with: `layer`, the folder it sits in, unless a
 *  `LEAF_RANKS` prefix covers the path. */
export function rankedLayer(srcRel: string, layer: Layer): Layer {
  const bare = srcRel.replace(/\.(?:tsx?|m?js)$/, '');
  const leaf = Object.entries(LEAF_RANKS).find(([prefix]) => (prefix.endsWith('/') ? bare.startsWith(prefix) : bare === prefix));
  return leaf ? leaf[1] : layer;
}

/**
 * The folder order inside `src/core`, bottom to top: the kernel, then the game's terrain domain,
 * which no kernel folder names. A folder may import from itself and anything earlier.
 */
export const CORE_FOLDERS = [
  ['base'], ['game'], ['grid'], ['provenance'], ['model'], ['commands'], ['domain/terrain'], ['domain/edge-cut'],
] as const;

/** What each layer is, for the architecture reference: `summary` fills its box in the stack
 *  diagram and `owns` its row in the layer table. */
export const LAYER_DOCS: Readonly<Record<Layer, { summary: string; owns: string }>> = {
  core: {
    summary: 'the engine floor: pure primitives, the game profile, grids, the edit-source ledger, the kernel model and the command executor, then the terrain domain',
    owns: 'the **engine floor**, in folders that import downward in the order shown above: `base/` (pure primitives: coordinates and turns, math, hashes, RNG, noise, fields, splines, colour arithmetic, guards, text, the listener signal), `game/` (the game profile and its zones), `grid/` (grids, cell conversions, rects, footprints, directions, cell sets), `provenance/` (the edit-source ledger), `model/` (the kernel types, the grid state, landmarks, planets and templates, notes, traits), `commands/` (the executor and two-phase validation, the event bus and its `KernelEvents`), then the game\'s terrain domain, which no kernel folder names: `domain/terrain/` (the cell stack, bridges, waterfalls) and `domain/edge-cut/` (the silhouette kernel, cut validation, locks, reconciliation, the terrain stroke policy the executor receives). It depends on `rules/` only through `model/rule-dispatcher.ts` (the validate-only interface the concrete `RuleRegistry` implements) and on the catalog only through `model/road-lookup.ts` (the paved-cell lookup `state/object-index.ts` supplies)',
  },
  platform: {
    summary: 'the browser and build boundary: build identity and edition, storage, device, input, async scheduling, remote helpers, app-wide channels',
    owns: 'the browser and build boundary: build identity, the edition profile and the deployment target (`build/`), the one persisted-key table and the key vault (`storage/`), device and viewport signals (`device/`), key tokens and text entry (`input/`), frame scheduling and the module-worker client (`async/`), endpoint and prompt helpers (`remote/`), and the toast, overlay and reduced-motion channels (`channels/`)',
  },
  config: {
    summary: 'game data: the catalog, its 3D model sidecars, built-in maps',
    owns: 'static data typed by `core`: the catalog (one item file per object, its 3D model in a `<id>.model.json` sidecar collected by `catalog/models.ts`), the category table and roles, plant species, built-in map templates and the other game data',
  },
  assets: {
    summary: 'icons, fonts, team art, the cursor catalogue, the brand palette',
    owns: 'static icons, fonts and team art (resolved by `icon-urls.ts`), the cursor catalogue and the brand palette',
  },
  state: {
    summary: 'the Zustand store, the catalog, object geometry, whole-map derivations, selection, editing vocabulary, keymap',
    owns: 'the Zustand store (wires executor, registry and bus), the item catalog, object-footprint geometry, the memoized whole-map derivations (`map-stats`, `layer-utils`), the pure selection derivations and `BlockRef` (`selection`), the editor\'s vocabulary above the kernel (`editing/`: tool types and modes, the edit-mode selectors, `EditorEvents`), the per-view camera pose (`view-camera`), the keymap and the fuzzy scorer (`fuzzy`)',
  },
  rules: {
    summary: 'two-phase validators, one rule family per file, in a RuleRegistry',
    owns: 'two-phase validators (pre-command and post-stroke), one rule family per file',
  },
  i18n: {
    summary: 'the seven locale tables, localizedName and the brand name',
    owns: 'the seven-locale translation tables, the `localizedName` and `translate` helpers, and the brand name (`terms/brand.ts`)',
  },
  tools: {
    summary: 'the pointer tools and their Tool/ToolContext contract in `pointer/`, and the map-edit libraries and generation they share, each behind an index.ts door',
    owns: 'interaction handlers (gesture to `Command`) behind the `pointer/runtime/` contract, and the libraries, which import no pointer tool: shared placement and object edits, Smart Build macros, map readings and `generation/` (designed planets, mazes, stencil pictures, the carry between planets, and the run that builds candidates in a worker pool)',
  },
  view: {
    summary: 'the active view, the shared pointer machine, view-neutral parts, and the two live editing views: map2d (PixiJS) and map3d (three.js)',
    owns: 'the view side of the seam (`active-view.ts`, implementing `tools/pointer/runtime/view-seam.ts`), the shared `interaction/` pointer machine, which executes the plan the pointer-semantics floor in `interaction/press/` resolves (the button constants, the camera-verb catalogue and `resolvePress`, the one function that answers what a press, a tap and a drag each mean) and drives the active view, and the two live editing views: `map2d/` (PixiJS) and `map3d/` (three.js)',
  },
  pipelines: {
    summary: 'self-contained feature pipelines: planet-scan, stylize, moderation',
    owns: 'self-contained feature pipelines, one folder each behind its own door: `planet-scan/` (ground from a game recording), `stylize/` (the export illustration), `moderation/` (text and picture checks); pipelines never import one another, and what one needs from a higher layer arrives as an argument',
  },
  editor: {
    summary: 'the live editor: the session, its verbs, the host, command bodies, interactive helpers, the development console API',
    owns: 'the live editor: `session/` (`currentEditor`, map installs, the session\'s tools), the editor\'s verbs in `operations/` (`newMap`, `loadMap`, `generateMap`, each a plain function taking an `EditContext` or a port), what a shell asks of the view (`host/host.ts`), the keyboard and tap command bodies (`commands/`), the interactive helpers around an operation (`editing/`) and the development-only programmatic API (`dev/`). A tool computes, `editor/` runs it against the live editor, `ui/` presents it; a pipeline is run by the surface that needs it',
  },
  agent: {
    summary: 'the LLM assistant harness',
    owns: 'the LLM assistant harness (its own section below)',
  },
  io: {
    summary: 'save and load, the share pipeline, image export',
    owns: 'save and load, the share pipeline and image export',
  },
  legal: {
    summary: 'policy documents: facts, markdown sources, parser, static HTML',
    owns: 'policy-document source: the legal facts (`config.ts`), the constrained markdown and its parser, and the static-HTML emitter; `ui/` renders the documents',
  },
  ui: {
    summary: 'the app roots and the owning surfaces (shell, chrome, agent), over the shared design layer and primitives',
    owns: 'the app roots in `app/` and the owning surfaces: `shell/` (the frame around the map: mode blocks, bars, windows), `chrome/` (modals, floating overlays, the tour, guards), `agent/` (the assistant\'s panel), over two shared layers: `design/` (tokens, the scaling factors, the motion registry, the cursor CSS) and `primitives/` (the generic parts and behaviour hooks any surface could reach for)',
  },
  entry: {
    summary: 'the root files of src/ and src/lite/, which compose the app',
    owns: 'the root files of `src/` and `src/lite/`, which compose the app; nothing imports them',
  },
};
