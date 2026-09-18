/** Smart Build actions offered by each surface. */
import type { MacroId } from '../../../tools/macros';
import type { Glyph } from '../frame';
import type { TerrainSurface } from './terrain-cells';

/** The shelves that offer smart build: the three terrain surfaces, and the object shelf. */
export type SmartSurface = TerrainSurface | 'object';

import smartGlyph from '../../../assets/shell/shelf-mountain/tools/smart-build/polygon.svg';

export interface SmartAction {
  id: MacroId;
  /** Localized action name. */
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
  // Object categories share a caption; the shelf chooses the matching planting action.
  object: [
    { id: 'patch-tree', labelKey: 'smart.patch' },
    { id: 'patch-flora', labelKey: 'smart.patch' },
  ],
};

/** The smart-build mark and the command that reaches it. */
export const SMART = {
  commandId: 'tool.smart',
  /** Measured ink bounds keep the star optically aligned with the other glyphs. */
  cellGlyph: {
    w: 93, h: 67,
    ink: { x: 3.04, y: 6.04, w: 85.87, h: 54.94, gx: 45.39, gy: 34.06, area: 2020.7 },
    parts: [{ src: smartGlyph, x: 0, y: 0, w: 93, h: 67 }],
  } as Glyph,
} as const;
