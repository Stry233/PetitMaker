/** The smart-build mark and the command that reaches it. */
import smartGlyph from '../../../assets/shell/shelf-mountain/tools/smart-build/polygon.svg';
import type { Glyph } from '../frame';

export const SMART = {
  commandId: 'tool.smart',
  /** Measured ink bounds keep the star optically aligned with the other glyphs. */
  cellGlyph: {
    w: 93, h: 67,
    ink: { x: 3.04, y: 6.04, w: 85.87, h: 54.94, gx: 45.39, gy: 34.06, area: 2020.7 },
    parts: [{ src: smartGlyph, x: 0, y: 0, w: 93, h: 67 }],
  } as Glyph,
} as const;
