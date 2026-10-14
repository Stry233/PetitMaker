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
import { useChromeScale, useWeightVars } from '../design/scale';
import { useUiPreview } from '../design/preview';

/** The style a chrome layer wears: `position: fixed`, the chrome zoom and, unless `weights` is
 *  false, the resolved weight variables. Spread it first, then the surface's own placement. */
export function useChromeLayer({ weights = true }: { weights?: boolean } = {}): CSSProperties {
  const chrome = useChromeScale();
  const vars = useWeightVars();
  const pictured = useUiPreview();
  if (pictured) return { position: 'absolute', ...(weights ? vars : null) };
  return { position: 'fixed', zoom: chrome, ...(weights ? vars : null) };
}
