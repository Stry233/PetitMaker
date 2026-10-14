/** The swatch strips' geometry and their scroll row, shared by the road surfaces and the notes strips. */
import { useRef, type CSSProperties, type RefObject } from 'react';
import { CONTROL_CLEARANCE, useScrollRow, type Bleed } from '../../primitives/use-scroll-row';
import { pressable, z } from '../../design/styles';
import { PLATE_INK } from '../../design/tokens';
import { SCALE } from '../units';
import { ACTIVE_PLATE, ROAD_STYLE } from './terrain-cells';
import { useFrameZoom } from '../use-frame-zoom';

/** The tile as it lands on screen, and the air between two of them. */
export const TILE = ROAD_STYLE.size * SCALE;
export const GAP = (ROAD_STYLE.pitch - ROAD_STYLE.size) * SCALE;
export const INNER = (ROAD_STYLE.size - 2 * ROAD_STYLE.inset) * SCALE;
/** The drawing's corner as a proportion of the square it turns, so the inner one is not rounded
 *  harder than the outer just because it is smaller. */
export const ROUND = ROAD_STYLE.radius / ROAD_STYLE.size;
/** How far the chosen tile's plate grows past its box, the way a chosen tool cell's does. The
 *  swatch is nearly all colour, so recolouring the plate alone leaves a ring four pixels wide to
 *  carry the whole answer; the plate is drawn behind the box rather than in it, so the tile does
 *  not move and neither do its neighbours. */
export const GROW = ACTIVE_PLATE.dy * SCALE;
/** Room for the hovered active plate, plus spring overshoot and pixel rounding. Negative margins
 *  retain tile alignment; tooltip coordinates subtract this same scroll-container overhang. */
export const SLACK = Math.ceil((TILE / 2 + GROW) * pressable.whileHover.scale - TILE / 2) + 1;
/**
 * How far a swatch is softened at an end the row can still travel toward: one whole swatch, since a quarter
 * of a hard-edged colour tile reads as a cut.
 */
const FADE = TILE;
/** The fade is one width at both ends and at every offset: unlike the row of names, every swatch is
 *  the same size and sits at the same pitch, so there is no gutter for a fixed width to land in. */
const fadeAt = (): number => FADE;
/**
 * A strip's room past a control's edge, as CSS: the control's hovered growth about its centre,
 * `half` px from that edge, carrying whatever stands `reach` px past the edge (a grown plate, a
 * badge) or the focus envelope, whichever reaches farther, plus a pixel of rounding.
 */
export function hoverBleed(half: number, reach = 0): string {
  return `calc((${half}px + max(${reach}px, ${CONTROL_CLEARANCE})) * ${pressable.whileHover.scale} - ${half}px + 1px)`;
}
/** Shared scrolling and hover clearance for road and annotation swatches; `bleed` is the room the
 *  strip's controls need past its edges, the road swatches' own by default. */
export function useSwatchStripRow(pointerEvents: 'auto' | 'none' = 'none', bleed: Bleed = SLACK): {
  rowRef: RefObject<HTMLDivElement>;
  rowProps: { className: string; style: CSSProperties };
} {
  const rowRef = useRef<HTMLDivElement>(null!);
  const zoom = useFrameZoom();
  // Only an end the row can still travel toward is shaded, so at either stop the outermost swatch —
  // grown plate, `SLACK` overhang and all — meets the edge at full strength.
  const rowFade = useScrollRow(rowRef, { zoom, bleed, pointerEvents, fade: { fadeAt } });
  return {
    rowRef,
    rowProps: {
      className: 'pw-noscroll',
      style: {
        position: 'relative', display: 'flex', color: PLATE_INK, alignItems: 'flex-end', flexWrap: 'nowrap',
        gap: GAP,
        // Hovered plates remain above the following tool row's transparent scroll padding.
        zIndex: z.panel,
        ...rowFade,
      },
    },
  };
}
