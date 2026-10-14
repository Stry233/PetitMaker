/**
 * The sites each presentation guard (`presentation-guard.test.ts`) still tolerates, per file or per
folder (a key ending in `/` counts every file under it); each entry is a `motion` or `system` site
 * and says why. Counts are exact: the test fails when a path holds more sites than listed, and when
 * it holds fewer.
 */
export type GuardId = 'lowerImport' | 'storeSetState' | 'multiAction' | 'storeSubscribe' | 'executorCall' | 'mapEditListen' | 'mapRevision' | 'moduleSideEffect' | 'factPurity';
export interface PresentationEntry { count: number; owner: 'motion' | 'system'; reason: string }

/** Pure display helpers of `tools/`, `io/` or `pipelines/` a ui file may import by name
 *  (`module:binding`), each with why it is presentation. */
export const NAMED: Readonly<Record<string, string>> = {
  'src/tools/generation/stencil/index.ts:limitTextGraphemes': 'caps typed text at the graphemes the stencil draws, as the field is typed',
  'src/tools/generation/stencil/index.ts:tilesAShape': 'whether an item can tile a picture, which the pick screen marks',
  'src/tools/generation/stencil/index.ts:ensureGlyphFonts': 'loads the glyph fonts the text field previews in',
  'src/tools/generation/stencil/index.ts:glyphFontsReady': 'whether the glyph fonts the text field previews in have loaded',
  'src/tools/macros/index.ts:SHELF_MACRO_IDS': 'the macros the shelf lists, in its order',
  'src/tools/macros/index.ts:macroForShelfCategory': 'the macro a shelf category offers',
};

export const PRESENTATION_ALLOWLIST: Record<GuardId, Record<string, PresentationEntry>> = {
  lowerImport: {
  },
  storeSetState: {
  },
  multiAction: {
  },
  storeSubscribe: {
    'src/ui/design/ui-zoom-anim.ts': { count: 1, owner: 'motion', reason: "drives the UI-scale animation from the zoom pref; motion, not logic" },
    'src/ui/shell/planet/use-planet-session-fade.ts': { count: 1, owner: 'motion', reason: "fades the shell as a planet session opens or closes; motion, not logic" },
  },
  executorCall: {
  },
  mapEditListen: {
  },
  mapRevision: {
  },
  moduleSideEffect: {
  },
  factPurity: {
  },
};
