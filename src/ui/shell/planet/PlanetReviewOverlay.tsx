/**
 * A scanned planet's cells to check, drawn on the map while the review is shown. The landmark's
 * footprint is outlined where it stands now, so the outline follows the landmark as it is moved or
 * turned. It draws through the view and renders nothing of its own.
 */
import { useEffect } from 'react';
import type { GridState, Rect } from '../../../core/model/types';
import { templateLandmark } from '../../../core/model/grid-model';
import { objectRect } from '../../../state/object-geometry';
import { onActiveViewChange } from '../../../canvas/active-view';
import { host } from '../../../kit/host';
import { useEditorStore } from '../../../state/store';
import { useCanvasFact } from './use-canvas-fact';

const landmarkOf = (state: GridState | null): Rect | null => {
  const plaza = state ? templateLandmark(state) : undefined;
  return plaza ? objectRect(plaza) : null;
};
const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

export function PlanetReviewOverlay(): null {
  const review = useEditorStore((s) => s.planetSession?.review);
  const shown = useEditorStore((s) => s.planetReviewShown);
  const landmark = useCanvasFact(landmarkOf, sameRect);

  useEffect(() => {
    const show = () => host.planetReview.show(review && shown ? review.cells : null, review?.landmark && shown ? landmark : null);
    show();
    // A remounted renderer starts with an empty overlay.
    const off = onActiveViewChange(show);
    return () => { off(); host.planetReview.show(null); };
  }, [review, shown, landmark]);

  return null;
}
