/** Smart Build actions offered by each surface. */
import { SHELF_MACRO_IDS, type MacroId } from '../../../tools/macros';
import type { Glyph } from '../frame';
import type { ContentType } from '../../../state/editing/edit-mode';

/** The shelves that offer smart build: the three terrain surfaces, and the object shelf. */
type SmartSurface = ContentType | 'object';

import smartGlyph from '../../../assets/shell/shelf-mountain/tools/smart-build/polygon.svg';
import type { I18nKey } from '../../../i18n/keys';

interface SmartAction {
  id: MacroId;
  /** Localized action name. */
  labelKey: I18nKey;
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
  // The planting cards share a caption; each stands in its own shelf tab.
  object: SHELF_MACRO_IDS.map((id) => ({ id, labelKey: 'smart.patch' })),
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
