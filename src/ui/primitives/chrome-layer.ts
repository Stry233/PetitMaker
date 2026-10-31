/*
 * A fixed surface of the chrome: it stands on the window rather than inside the frame, draws at the
 * chrome zoom and publishes the text weights resolved for that zoom, so its tokens and the size they
 * land at cannot come apart. Inside a pictured subtree it stands in its figure at the figure's own
 * scale instead (`design/preview.tsx`).
 *
 * The zoom goes on the fixed element itself, never on a wrapper around it: an ancestor `zoom` skews
 * what `left: 50%` resolves against.
 */
import type { CSSProperties } from 'react';
import { liftOf, useDenseScript, useDevicePixelRatio, useGlidingScale, useScaleView } from '../design/scale';
import { weightVars } from '../design/text-weight';
import { useUiPreview } from '../design/preview';

/** What a lifted surface draws at: its zoom, and the weight variables resolved for that zoom. */
export interface ChromeLift { zoom: number; weights: CSSProperties }

/**
 * The one touch lift of a surface over the window (`design/scale-model.ts:liftOf`): the chrome scale,
 * raised in touch mode by the one multiple that draws its `control`-px controls a fingertip across at
 * the fingertip scale, and the weights for it. Without `control` it is the chrome scale. The lift
 * follows the input mode in force, unless `touch` names the mode the surface was opened for.
 */
export function useChromeLift(control?: number, touch?: boolean): ChromeLift {
  const zoom = liftOf(useScaleView(), control, touch);
  return { zoom, weights: weightVars(zoom, useDevicePixelRatio(), useDenseScript()) };
}

/**
 * `useChromeLift` at the gliding scale (`design/scale.tsx:useGlidingScale`): the lift of an open
 * surface standing on the window, which re-renders once a frame while the UI zoom's follow glides, so
 * its zoom, weights and every placement or cap it divides by that zoom glide with the frame. An
 * input-mode switch steps them; the chrome's morph carries the surface (`primitives/morph.ts`).
 */
export function useGlidingChromeLift(control?: number, touch?: boolean, active = true): ChromeLift {
  const zoom = liftOf(useScaleView(useGlidingScale(active)), control, touch);
  return { zoom, weights: weightVars(zoom, useDevicePixelRatio(), useDenseScript()) };
}

/** The style a chrome layer wears: `position: fixed`, its zoom and, unless `weights` is false, the
 *  weight variables resolved for that zoom (`useGlidingChromeLift`, since a layer stands on the window
 *  while it is mounted). Spread it first, then the surface's own placement. */
export function useChromeLayer({ weights = true, control }: { weights?: boolean; control?: number } = {}): CSSProperties {
  const lift = useGlidingChromeLift(control);
  const pictured = useUiPreview();
  if (pictured) return { position: 'absolute', ...(weights ? lift.weights : null) };
  return { position: 'fixed', zoom: lift.zoom, ...(weights ? lift.weights : null) };
}

/** The zoom `useChromeLayer` draws at, for a surface converting its own placement from chrome px. */
export function useChromeLayerZoom(control?: number): number {
  return useGlidingChromeLift(control).zoom;
}
