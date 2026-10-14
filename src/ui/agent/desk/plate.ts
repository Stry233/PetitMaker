/*
 * The panel plate: its wipe, its two shapes (floating and docked) and the heights the frame reserves
 * for it. The entry is a clip-path rather than a transform so the fixed character keeps its
 * containing block; four-component insets keep the interpolation stable between the seed, open and
 * docked shapes.
 */
import type { CSSProperties } from 'react';
import type { Variants } from 'framer-motion';
import { PLATE, PLATE_INK } from '../../design/tokens';
import { radii } from '../../design/styles';
import { framerMotion } from '../../design/motion';
import { DOCK_CHROME_W, type DockSide } from '../../shell/panel-frame';
import { COMPOSER_HEIGHT } from '../composer/Composer';
import { STATUS_CARD_HEIGHT } from './StatusCard';
import { PIN_KNOB } from '../parts/IconButton';
import { edge, PANEL_MIN_HEIGHT, PANEL_PAD, PANEL_WIDTH } from '../panel-skin';

/** Floating plate radius in frame pixels, shared by its border, wipe and dock-knob placement. */
export const PANEL_RADIUS = 28;

export const WIPE_SEED = `inset(0% 92% 92% 0% round ${PANEL_RADIUS}px)`;
export const WIPE_OPEN = `inset(0% -1% -1% 0% round ${PANEL_RADIUS}px)`;
export const WIPE_GROUND = 'inset(0% -1% -1% 0%)';

/** Carries the external dock knob along the plate's animated inset, accepting every CSS inset arity. */
export function knobCarry(clip: string): { x: number; y: number; scale: number } {
  const inset = /inset\(([^)]*)\)/.exec(clip)?.[1];
  if (inset === undefined) return { x: 0, y: 0, scale: 1 };
  const edges = (inset.split('round')[0] ?? '').trim().split(/\s+/).map((v) => parseFloat(v));
  const right = Math.max(0, (edges.length > 1 ? edges[1] : edges[0]) ?? 0) / 100;
  const bottom = Math.max(0, (edges.length > 2 ? edges[2] : edges[0]) ?? 0) / 100;
  return {
    x: 0 - PANEL_WIDTH * right,
    y: 0 - (PANEL_RADIUS + PIN_KNOB.size / 2) * bottom,
    scale: 1 - right,
  };
}

/** The holder owns opacity while the plate owns the matching clip-path wipe. */
export const panelVariants: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1 },
  ground: { opacity: 1 },
  gone: { opacity: 0, transition: framerMotion('panel.close') },
};

export const plateVariants: Variants = {
  hidden: { clipPath: WIPE_SEED },
  shown: { clipPath: WIPE_OPEN },
  ground: { clipPath: WIPE_GROUND },
  gone: { clipPath: WIPE_SEED, transition: framerMotion('panel.close') },
};

/** Docked plates are immediately square and opaque; the surrounding sheet supplies their entrance. */
export const REVEALED = { type: false } as const;

/** Gap between panel zones in frame pixels. */
const ZONE_GAP = 10;

/** How many gaps stand between the four zones. */
const ZONE_GAPS = 3;

/** Height reserved for the fixed desk, composer, gaps and plate padding. */
export const PINNED_HEIGHT = PANEL_PAD * 2 + STATUS_CARD_HEIGHT + COMPOSER_HEIGHT + ZONE_GAP * ZONE_GAPS;


/** Unpainted positioning box shared by the plate and its external dock tab. */
export const PLATE_HOLDER: CSSProperties = { position: 'relative', display: 'flex' };

/** Individual border and padding properties let React restore every edge after docking overrides. */
const PANEL_STYLE: CSSProperties = {
  width: PANEL_WIDTH,
  boxSizing: 'border-box',
  background: PLATE,
  borderTop: edge,
  borderRight: edge,
  borderBottom: edge,
  borderLeft: edge,
  borderRadius: PANEL_RADIUS,
  paddingTop: PANEL_PAD,
  paddingRight: PANEL_PAD,
  paddingBottom: PANEL_PAD,
  paddingLeft: PANEL_PAD,
  display: 'flex',
  flexDirection: 'column',
  gap: ZONE_GAP,
  color: PLATE_INK,
  minHeight: PANEL_MIN_HEIGHT,
  overflow: 'hidden',
};

/** Docked plates fill the available height, square their corners and retain only the sheet seam. */
export function dockedStyle(cap: string | undefined, side: DockSide): CSSProperties {
  const atSeam = side === 'left' ? 'right' : 'left';
  return {
    ...PANEL_STYLE,
    width: PANEL_WIDTH + DOCK_CHROME_W,
    minHeight: 0,
    height: cap ?? '100%',
    maxHeight: cap ?? '100%',
    borderRadius: radii.none,
    borderTop: '0',
    borderBottom: '0',
    borderLeft: atSeam === 'left' ? edge : '0',
    borderRight: atSeam === 'right' ? edge : '0',
  };
}

export function panelStyle(cap: string | undefined, hug: boolean): CSSProperties {
  // Setup and management forms hug their content while remaining bounded by the available height.
  if (hug) return { ...PANEL_STYLE, minHeight: 0, ...(cap === undefined ? null : { maxHeight: cap }) };
  if (cap === undefined) return PANEL_STYLE;
  return { ...PANEL_STYLE, maxHeight: cap, minHeight: `min(${PANEL_MIN_HEIGHT}px, ${cap})` };
}

export const JOB_ZONE_STYLE: CSSProperties = { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 };

/** Minimum useful record height in frame pixels. */
export const JOB_ZONE_FLOOR = 72;

/** Readable height for the largest plan gate; the panel may borrow this room from the bottom bar. */
const PLAN_GATE_ROOM = 419;

/** Extra height needed beyond the record floor to show the largest plan gate. */
export const GATE_BORROW = Math.max(0, PLAN_GATE_ROOM - JOB_ZONE_FLOOR);

/**
 * Caps the record floor at the height left after the fixed desk and composer. Closed-history rest
 * states waive the floor, and uncapped standalone mounts use the full default.
 */
export function jobZoneFloor(cap: string | undefined, waived: boolean): string | number {
  if (waived) return 0;
  if (cap === undefined) return JOB_ZONE_FLOOR;
  return `min(${JOB_ZONE_FLOOR}px, max(0px, calc(${cap} - ${PINNED_HEIGHT}px)))`;
}

