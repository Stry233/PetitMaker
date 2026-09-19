/*
 * inline-art.ts — what a `[[name]]` in help prose resolves to.
 *
 * ONE POINTER PER CONTROL: every entry reads the art off the record the OWNING module already
 * exports and draws from (`shell/frame.ts`'s MODES / TOP_RIGHT / GLYPHS / ASSISTANT_BLOCK,
 * `terrain-cells`' tool glyphs, `smart-menu`'s star), so re-pointing a control's art in its owner
 * re-draws the help with it, with no second edit here. A composed control arrives as its `Glyph`
 * (the same layered parts the rail draws); the load disc is drawn by the meter's own SVG; only
 * catalog/UI icons with no richer owner fall through to the icon glob.
 */
import { ASSISTANT_BLOCK, GLYPHS, LAYERS_STACK_SRC, MODES, TOP_RIGHT, type Glyph } from '../../../shell/frame';
import { TOOL_CELLS } from '../../../shell/bars/terrain-cells';
import { SMART } from '../../../shell/bars/smart-menu';
import { iconUrl } from '../../../../assets/icon-urls';

export type InlineArt =
  /** `plate` asks the renderer for a soft backing: cream art (the menu and share discs, the pale
   *  UI-icon set) disappears against the page without one. */
  | { kind: 'img'; src: string; plate?: true }
  /** A composed drawing: the owner's own layered parts, drawn in place (`PageView`'s renderer). */
  | { kind: 'glyph'; glyph: Glyph; flip?: true }
  /** The load meter's disc, which has no file: the meter draws it, and so does the help. */
  | { kind: 'disc' };

const img = (src: string | undefined): InlineArt | undefined => (src ? { kind: 'img', src } : undefined);
const plated = (src: string | undefined): InlineArt | undefined => (src ? { kind: 'img', src, plate: true } : undefined);

const modeArt = (id: string) => img(MODES.find((m) => m.id === id)?.src);
const topRightArt = (id: string) => plated(TOP_RIGHT.find((a) => a.id === id)?.src);
const toolArt = (id: string): InlineArt | undefined => {
  const glyph = TOOL_CELLS.find((c) => c.id === id)?.glyph.mountain;
  return glyph ? { kind: 'glyph', glyph } : undefined;
};

/** The controls, each read from its owner. Thunked so a missing record answers undefined rather
 *  than throwing at module load. */
const CONTROL_ART: Record<string, () => InlineArt | undefined> = {
  'mode-object': () => modeArt('object'),
  'mode-road': () => modeArt('road'),
  'mode-mountain': () => modeArt('mountain'),
  'mode-water': () => modeArt('water'),
  'mode-generate': () => modeArt('generate'),
  assistant: () => img(ASSISTANT_BLOCK.src),
  'share-btn': () => topRightArt('share'),
  menu: () => topRightArt('menu'),
  'load-disc': () => ({ kind: 'disc' }),
  'rail-undo': () => ({ kind: 'glyph', glyph: GLYPHS.undo }),
  // Redo is the rail's own reading of the same drawing: undo, mirrored.
  'rail-redo': () => ({ kind: 'glyph', glyph: GLYPHS.undo, flip: true }),
  'rail-rotate': () => ({ kind: 'glyph', glyph: GLYPHS.rotate }),
  'rail-zoom-in': () => ({ kind: 'glyph', glyph: GLYPHS.zoomIn }),
  'rail-zoom-out': () => ({ kind: 'glyph', glyph: GLYPHS.zoomOut }),
  'rail-hide': () => ({ kind: 'glyph', glyph: GLYPHS.hideUi }),
  'rail-layers': () => plated(LAYERS_STACK_SRC),
  settings: () => plated(iconUrl('settings')),
  help: () => plated(iconUrl('help')),
  // The smart-build cell's own star (`icons/ui/splat.png` is the mode row's selection blob).
  'smart-build': () => ({ kind: 'glyph', glyph: SMART.cellGlyph }),
  'brush-free': () => toolArt('draw'),
  eraser: () => toolArt('erase'),
  'edge-cut': () => toolArt('trim'),
  'brush-line': () => toolArt('line'),
  'brush-curve': () => toolArt('curve'),
  'brush-rect': () => toolArt('rect'),
  'brush-circle': () => toolArt('circle'),
};

/** The marks allowed to read the ICON GLOB directly: art whose live control draws the same file
 *  (the layer panel's eye and lock, the planet cards). Everything else must name an owner record
 *  above — an icon FILE that outlives its control must not keep a help mark alive. */
const GLOB_MARKS = new Set([
  'planet-hexia', 'planet-tafa',
  'eye-open-selected', 'eye-closed-selected', 'lock', 'lock-selected',
]);

export function inlineArt(name: string): InlineArt | undefined {
  const owned = CONTROL_ART[name]?.();
  if (owned) return owned;
  return GLOB_MARKS.has(name) ? img(iconUrl(name)) : undefined;
}
