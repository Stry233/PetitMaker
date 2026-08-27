/**
 * The hairline a DRAWN SILHOUETTE wears (`tokens.ts:MAP_SHAPE_EDGE`), drawn at the width every
 * engine can hold.
 *
 * The edge is an SVG reference filter, and WebKit draws that filter's band about twice as wide
 * and soft as Blink does at the same screen density (measured at dpr 1 and 2: ~2.5 raster px
 * of ink against Blink's ~1.3), so in Safari every outlined drawing wears a doubled, blurred
 * stroke. Running the SAME filter over a double-size copy of the drawing and scaling the result
 * back down halves the band, which lands WebKit within a device pixel of Blink's rendering.
 * Blink and Gecko rasterise the filter at device resolution already and would go LIGHT under the
 * same halving, so the double draw is applied only where the probe below answers WebKit.
 *
 * WebKit is told apart the way the cursor system tells Gecko apart (`cursor-css.ts`): by a
 * property only it parses. `-webkit-nbsp-mode` is an Apple-internal property no other engine has
 * ever aliased (probed: WebKit true; Blink and Gecko false). Memoised: the engine cannot change
 * under a running page.
 */

import type { CSSProperties, ReactNode } from 'react';
import { MAP_SHAPE_EDGE } from './tokens';

let webkit: boolean | undefined;
export function isWebKitEngine(): boolean {
  if (webkit !== undefined) return webkit;
  webkit = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    && CSS.supports('-webkit-nbsp-mode', 'normal');
  return webkit;
}

/** Test-only: drop the memo so a test can stand in each engine. */
export function __clearShapeEdgeProbe(): void {
  webkit = undefined;
}

/**
 * A box whose child drawing wears the map's hairline. The box takes `style` (its size or inset);
 * the child fills it. Decoration only: hidden from readers and transparent to the pointer, like
 * the drawings it frames.
 *
 * The double-size copy is drawn in a middle layer so the box's own layout never moves: the
 * child lays out at 200% and the transform brings the paint back to the box. The filter sits on
 * that middle layer, a PARENT of any masked child, because a filter applies before a mask on the
 * same element and an outline written there would be cut away with the mask.
 */
export function ShapeEdge({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  if (!isWebKitEngine()) {
    return (
      <span aria-hidden style={{ display: 'block', pointerEvents: 'none', ...style, filter: MAP_SHAPE_EDGE }}>
        {children}
      </span>
    );
  }
  return (
    <span aria-hidden style={{ display: 'block', pointerEvents: 'none', ...style }}>
      <span
        style={{
          display: 'block', width: '200%', height: '200%',
          transform: 'scale(0.5)', transformOrigin: 'top left',
          filter: MAP_SHAPE_EDGE,
        }}
      >
        {children}
      </span>
    </span>
  );
}
