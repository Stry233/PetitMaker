/**
 * The preview cell's art, as geometry — generated from the project's design source, never edited by
 * hand (regenerate it with the design-extraction script and its `--check` guards the file).
 *
 * The design draws one 1x1 demonstration cell per tool; every number here is normalised so that one
 * map cell is 1.0, because the composition is not a tile: a preview over an N-cell footprint keeps
 * the dot inset and the icon at the size below and only the background grows (see `preview-cell.ts`).
 * Icon outlines are SVG path data centred on (0, 0), in the same unit-cell fractions.
 */

import type { PreviewIcon } from '../../../tools/pointer/runtime';

/** One filled (or subtracted) outline of an icon, in draw order. */
interface PreviewIconPart {
  /** SVG path data, unit-cell fractions, centred on the icon's own bounds. */
  d: string;
  /** Subtracted from what the earlier parts drew (the design's own path operation). */
  hole?: boolean;
  /** Part opacity where the design gives one (a shaded face inside a solid icon). */
  alpha?: number;
}

export interface PreviewIconArt {
  /** Drawn extent in cell fractions — the icon is placed at this size whatever the footprint. */
  w: number;
  h: number;
  parts: readonly PreviewIconPart[];
}

/** Paint for one validity state. `hatch` is the stripe overlay the design gives the refused state. */
export interface PreviewPalette {
  bg: number;
  bgAlpha: number;
  line: number;
  hatch?: number;
}

export const PREVIEW_CELL_ART = {
  /** Background corner radius. */
  radius: 0.02513,
  /** Inset stroke around the background. */
  stroke: 0.04523,
  /** Distance from each edge to a corner dot's centre. */
  dotInset: 0.21357,
  dotRadius: 0.04774,
  /** The refused state's stripes: bar width and repeat pitch measured across the 45-degree bars. */
  hatchWidth: 0.17588,
  hatchPeriod: 0.30558,
} as const;

/** The two states. A refused cell keeps the accepted one's composition and swaps its paint; the
 *  design's own red example is the one that carries the stripes, so they ride the palette. */
export const PREVIEW_PALETTES: { valid: PreviewPalette; invalid: PreviewPalette } = {
  valid: {
    bg: 0x90ff4a,
    bgAlpha: 0.4,
    line: 0x92fa34,
  },
  invalid: {
    bg: 0xff7449,
    bgAlpha: 0.4,
    line: 0xff6f33,
    hatch: 0xff8c71,
  },
};

export const PREVIEW_ICON_ART: Record<PreviewIcon, PreviewIconArt> = {
  eraser: {
    w: 0.42456,
    h: 0.43944,
    parts: [
      { d: 'M0.1341,-0.20271C0.1341,-0.20271 0.18466,-0.16135 0.18466,-0.16135C0.21688,-0.13499 0.22163,-0.0875 0.19527,-0.05528C0.19527,-0.05528 0.03618,0.1392 0.03618,0.1392C0.03731,0.13902 -0.1312,0.00254 -0.13107,0.00238C-0.13107,0.00238 0.02803,-0.1921 0.02803,-0.1921C0.05438,-0.22432 0.10187,-0.22907 0.1341,-0.20271Z', },
      { d: 'M0.11713,-0.15816C0.11713,-0.15816 0.14046,-0.13907 0.14046,-0.13907C0.16194,-0.1215 0.16511,-0.08984 0.14754,-0.06836C0.14754,-0.06836 0.06799,0.02888 0.06799,0.02888C0.05042,0.05036 0.01876,0.05353 -0.00272,0.03596C-0.00272,0.03596 -0.02606,0.01687 -0.02606,0.01687C-0.04754,-0.00071 -0.0507,-0.03237 -0.03313,-0.05385C-0.03313,-0.05385 0.04641,-0.15108 0.04641,-0.15108C0.06399,-0.17256 0.09565,-0.17573 0.11713,-0.15816Z', hole: true, },
      { d: 'M-0.05115,0.08723C-0.05115,0.08723 -0.14061,0.01405 -0.14061,0.01405C-0.14061,0.01405 -0.21061,0.09961 -0.21061,0.09961C-0.21061,0.09961 -0.22819,0.17548 -0.14979,0.2078C-0.03707,0.25427 0.02664,0.15086 0.02664,0.15086C0.02664,0.15086 -0.05115,0.08723 -0.05115,0.08723Z', },
    ],
  },
  trim: {
    w: 0.51173,
    h: 0.52561,
    parts: [
      { d: 'M-0.10601,0.0886C-0.13103,0.1264 -0.18179,0.13687 -0.21939,0.11199C-0.25698,0.0871 -0.26718,0.03629 -0.24216,-0.00151C-0.21714,-0.03931 -0.16638,-0.04978 -0.12879,-0.0249C-0.09119,-0.00002 -0.08099,0.0508 -0.10601,0.0886Z', },
      { d: 'M-0.13556,0.0704C-0.14986,0.092 -0.17886,0.09799 -0.20035,0.08377C-0.22183,0.06955 -0.22766,0.04051 -0.21336,0.01891C-0.19906,-0.00269 -0.17006,-0.00867 -0.14857,0.00555C-0.12709,0.01977 -0.12126,0.0488 -0.13556,0.0704Z', hole: true, },
      { d: 'M0.10145,0.22592C0.07643,0.26372 0.02567,0.27419 -0.01192,0.2493C-0.04952,0.22442 -0.05972,0.1736 -0.0347,0.1358C-0.00968,0.098 0.04108,0.08753 0.07868,0.11242C0.11628,0.1373 0.12647,0.18812 0.10145,0.22592Z', },
      { d: 'M0.0719,0.20772C0.05761,0.22932 0.0286,0.2353 0.00712,0.22108C-0.01437,0.20686 -0.02019,0.17783 -0.0059,0.15623C0.0084,0.13463 0.03741,0.12864 0.05889,0.14286C0.08037,0.15708 0.0862,0.18612 0.0719,0.20772Z', hole: true, },
      { d: 'M0.05887,0.11975C0.05887,0.11975 0.0372,0.03979 0.0372,0.03979C0.0372,0.03979 0.22508,-0.00459 0.22508,-0.00459C0.22508,-0.00459 0.28084,-0.03827 0.24229,-0.08694C0.2405,-0.08919 -0.12266,-0.0004 -0.12266,-0.0004C-0.12266,-0.0004 -0.10317,0.06875 -0.10317,0.06875C-0.10317,0.06875 -0.02759,0.05316 -0.02759,0.05316C-0.02759,0.05316 -0.01023,0.13963 -0.01023,0.13963C-0.01023,0.13963 0.05887,0.11975 0.05887,0.11975Z', },
      { d: 'M0.02409,-0.04758C0.02409,-0.04758 -0.04626,-0.03251 -0.04626,-0.03251C-0.04626,-0.03251 -0.08181,-0.21708 -0.08181,-0.21708C-0.08181,-0.21708 -0.06947,-0.2795 -0.01202,-0.25858C-0.01206,-0.25864 0.02409,-0.04758 0.02409,-0.04758Z', },
    ],
  },
};
