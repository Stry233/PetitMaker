/** Smart Build actions offered by each surface. */
import type { MacroId } from '../../../tools/macros';
import type { Glyph } from '../frame';
import type { TerrainSurface } from './terrain-cells';

/** The shelves that offer smart build: the three terrain surfaces, and the object shelf. */
export type SmartSurface = TerrainSurface | 'object';

import smartGlyph from '../../../assets/shell/shelf-mountain/tools/smart-build/polygon.svg';

export interface SmartAction {
  id: MacroId;
  /** What the open cell names it. */
  labelKey: string;
}

export const SMART_MENU: Record<SmartSurface, readonly SmartAction[]> = {
  mountain: [
    { id: 'raise', labelKey: 'smart.raise' },
  ],
  water: [
    { id: 'stream', labelKey: 'smart.stream' },
  ],
  road: [
    { id: 'road-link', labelKey: 'smart.road_link' },
  ],
  // Coverage-test data only: `SmartBuild` (the segment row that would show both labels at once)
  // never mounts on this surface, since `surface` there is typed `TerrainSurface`, which excludes
  // 'object'. The object shelf's own card (`ItemCard.tsx:SmartCard`) is one card per category tab
  // and hardcodes `smart.patch` directly, never reading `labelKey` from here. The duplicate below
  // would collide if either of those ever changed to render this list as segments.
  object: [
    { id: 'patch-tree', labelKey: 'smart.patch' },
    { id: 'patch-flora', labelKey: 'smart.patch' },
  ],
};

/** The smart-build mark and the command that reaches it. */
export const SMART = {
  /** The keyboard command that arms smart build, so the cell wears a badge like the seven tools
   *  beside it. The binding itself is the keymap's (`core/runtime/keybindings`), read live: this
   *  names which command the control is, and `terrain-bar.test.tsx` holds the two ends together. */
  commandId: 'tool.smart',
  /** The star as a `Glyph`, so the cell can be a `ToolCell` like the seven beside it — and so the
   *  object shelf's card can draw the same mark. The ink is MEASURED off the drawing's own paths
   *  (bbox, filled area, centroid), the way every sibling glyph's is: claiming the whole box as
   *  ink over-weights `apparentSize` and draws the star a quarter smaller than the row it stands
   *  in. */
  cellGlyph: {
    w: 93, h: 67,
    ink: { x: 3.04, y: 6.04, w: 85.87, h: 54.94, gx: 45.39, gy: 34.06, area: 2020.7 },
    parts: [{ src: smartGlyph, x: 0, y: 0, w: 93, h: 67 }],
  } as Glyph,
} as const;
