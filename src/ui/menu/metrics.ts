/*
 * metrics.ts — the main-menu layout measured 1:1 from the design canvas
 * (the "phone home page" group). All numbers are raw design pixels at the
 * design scale (card = 714x1074). Components multiply by SCALE via px() so
 * the whole card scales as one unit while preserving proportions.
 */
import { colors } from '../styles';

// Raw design-canvas measurements (design px). Components convert to screen px with the
// current responsive scale via usePx() (see scale.tsx) — no hard-coded scale.

/**
 * The design canvas IS the app screen: every element's canvas position is its
 * intended on-screen position. We map the canvas onto the viewport by a single
 * scale (viewportHeight / CANVAS.h) so each element lands at its exact canvas
 * fraction at any resolution.
 *   (Confirmed: the layer-panel group sits at canvas top-right 89.9%/3.2%,
 *    matching where the app's LayerPanel already lives.)
 */
export const CANVAS = { w: 3754, h: 1918 } as const;

/** Each screen-state's top-left on the canvas (= where it appears on screen). */
export const HOME_POS = { x: 44, y: 366 } as const;             // home card
export const COLLAPSED = { x: 108, y: 41, w: 176, h: 233 } as const; // collapsed phone (top-left)

export const CARD = {
  w: 640,       // phone body (design canvas)
  h: 963,
  r: 104,       // phone-body corner radius (smooth squircle)
  bezel: 13,    // even dark-frame thickness (design source varies ~17/11/10/12, evened out)
} as const;

/** Cream "screen", inset evenly inside the dark frame. */
export const CREAM = {
  x: CARD.bezel,
  y: CARD.bezel,
  w: CARD.w - CARD.bezel * 2,
  h: CARD.h - CARD.bezel * 2,
  r: CARD.r - CARD.bezel,
} as const;

/** Volume rail on the left edge of the phone body (a single rounded bar). */
export const VOL = {
  top: 160,
  height: 191,  // scales with the card
  protrude: 6,
  width: 14,
  r: 7,
} as const;

export const LOAD = {
  bg: { x: 67, y: 43, w: 386, h: 80, r: 40 }, // dark load pill (nearly full-pill)
  label: { x: 93, y: 70, w: 56, h: 28, fontSize: 28 }, // "负荷" label
  track: { x: 159, y: 74, w: 269, h: 19, r: 8 }, // full track (fill is value/max)
  count: { x: 241, y: 78, fontSize: 17 }, // e.g. "8996/10000"
} as const;

export const UTIL = {
  size: 55,
  r: 20,
  gear: { x: 463, y: 56 }, // settings button
  help: { x: 523, y: 56, fontSize: 38 }, // help "?"
  cog: { w: 41, h: 42 },
} as const;

/** A single tappable tile on the home screen. */
export interface TileSpec {
  id: string;
  /** Design-canvas top-left of the tile square (relative to card 0,0). */
  x: number;
  y: number;
  /** Tile square size. */
  size: number;
  r: number;
  /** Exact fill sampled from the design source. */
  fill: string;
  /** Icon asset basename (src/assets/icons/<icon>.png). */
  icon: string;
  /** i18n key for the label below the tile. */
  labelKey: string;
  /** Label colour — file row is brown, the rest is ink (from the design source). */
  labelColor: string;
  /** Label top (design px). */
  labelY: number;
  /** Action category dispatched on tap. */
  action: 'file' | 'build' | 'placement' | 'generate' | 'move';
  /** Extra payload (content type / placement category) for the action. */
  payload?: string;
}

const C = colors;

/* File row — 4 tiles, 111×111, labels brown (#826042). */
export const FILE_TILES: TileSpec[] = [
  { id: 'new',        x: 66,  y: 153, size: 111, r: 25, fill: C.tileYellow,     icon: 'new',          labelKey: 'menu.new',   labelColor: C.brownText, labelY: 273, action: 'file', payload: 'new' },
  { id: 'image',      x: 200, y: 153, size: 111, r: 25, fill: C.tileGreen,      icon: 'export-image', labelKey: 'menu.image', labelColor: C.brownText, labelY: 273, action: 'file', payload: 'image' },
  { id: 'export',     x: 334, y: 153, size: 111, r: 25, fill: C.tilePaleYellow, icon: 'export',       labelKey: 'menu.export', labelColor: C.brownText, labelY: 273, action: 'file', payload: 'export' },
  { id: 'import',     x: 467, y: 153, size: 111, r: 25, fill: C.tileDeepGreen,  icon: 'import',       labelKey: 'menu.import', labelColor: C.brownText, labelY: 273, action: 'file', payload: 'import' },
];

/* Three large build buttons — 166×166, labels ink (#43413F). Road (绘制道路) is
   the promoted tile/path brush (contentType 'tile'). */
export const BUILD_TILES: TileSpec[] = [
  { id: 'mountain', x: 66,  y: 340, size: 166, r: 40, fill: C.tileYellow, icon: 'mountain', labelKey: 'menu.build_mountain', labelColor: C.inkText, labelY: 514, action: 'build', payload: 'mountain' },
  { id: 'river',    x: 240, y: 340, size: 166, r: 40, fill: C.tileGreen,  icon: 'river',    labelKey: 'menu.build_river',    labelColor: C.inkText, labelY: 514, action: 'build', payload: 'water' },
  { id: 'road',     x: 415, y: 340, size: 166, r: 40, fill: C.tileYellow, icon: 'road',     labelKey: 'menu.build_road',     labelColor: C.inkText, labelY: 514, action: 'build', payload: 'tile' },
];
/** Build buttons are 166×166 (square). */
export const BUILD_TILE_H = 166;

/* Placement + generate + move grid — 8 tiles, 111×111, labels ink. */
export const GRID_TILES: TileSpec[] = [
  { id: 'building', x: 66,  y: 569, size: 111, r: 25, fill: C.tileYellow,     icon: 'building', labelKey: 'menu.place_building', labelColor: C.inkText, labelY: 687, action: 'placement', payload: 'building' },
  { id: 'facility', x: 201, y: 569, size: 111, r: 25, fill: C.tileGreen,      icon: 'facility', labelKey: 'menu.place_facility', labelColor: C.inkText, labelY: 687, action: 'placement', payload: 'facility' },
  { id: 'tree',     x: 336, y: 569, size: 111, r: 25, fill: C.tilePaleYellow, icon: 'tree',     labelKey: 'menu.place_tree',     labelColor: C.inkText, labelY: 687, action: 'placement', payload: 'tree' },
  { id: 'flower',   x: 471, y: 569, size: 111, r: 25, fill: C.tileDeepGreen,  icon: 'flower',   labelKey: 'menu.place_flower',   labelColor: C.inkText, labelY: 687, action: 'placement', payload: 'flora' },
  { id: 'bridge',   x: 66,  y: 737, size: 111, r: 25, fill: C.tileYellow,     icon: 'bridge',   labelKey: 'menu.place_bridge',   labelColor: C.inkText, labelY: 855, action: 'placement', payload: 'bridge' },
  { id: 'ramp',     x: 200, y: 737, size: 111, r: 25, fill: C.tileGreen,      icon: 'ramp',     labelKey: 'menu.place_ramp',     labelColor: C.inkText, labelY: 855, action: 'placement', payload: 'ramp' },
  { id: 'generate', x: 336, y: 737, size: 111, r: 25, fill: C.tilePaleYellow, icon: 'generate', labelKey: 'menu.generate',       labelColor: C.inkText, labelY: 855, action: 'generate' },
  { id: 'move',     x: 470, y: 737, size: 111, r: 25, fill: C.tileDeepGreen,  icon: 'move',     labelKey: 'menu.move',           labelColor: C.inkText, labelY: 855, action: 'move' },
];
