/**
 * The planet session's overlays, drawn through the view host while a session is open: the chunk
 * frame its ground and plaza cover, flashed once when a ground stroke reaches past the canvas edge,
 * and a scanned planet's cells to check with the landmark's footprint outlined where it stands now,
 * so the outline follows the landmark as it is moved or turned. The canvas is re-read when the map
 * is replaced and at most once a frame while its cells or objects change; an overlay is drawn again
 * only when what it shows moves, and whenever a remounted view starts with an empty one.
 */
import type { GridState } from '../../core/model/types';
import type { PlanetFrame } from '../../core/model/planet';
import type { Rect } from '../../core/grid/rect';
import { templateLandmark } from '../../core/model/landmarks';
import { onMapEdited } from '../../core/commands/map-edits';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import { coalesceToFrame } from '../../platform/async/after-paint';
import { objectRect } from '../../state/object-geometry';
import { useEditorStore, type EditorStore } from '../../state/store';
import { onActiveViewChange } from '../../view/active-view';
import { sessionFrame } from '../operations/planet-session';
import { host } from '../host/host';

const frameOf = (state: GridState | null): PlanetFrame | null => (state ? sessionFrame(state) : null);
const sameFrame = (a: PlanetFrame | null, b: PlanetFrame | null): boolean =>
  a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.cols === b.cols && a.rows === b.rows);

const landmarkOf = (state: GridState | null): Rect | null => {
  const landmark = state ? templateLandmark(state) : undefined;
  return landmark ? objectRect(landmark) : null;
};
const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

type Review = NonNullable<EditorStore['planetSession']>['review'];

/** Draws the planet session's overlays for as long as the editor lives; returns the stop, which
 *  takes them down. `frameFlashMs` is the frame flash's length, which the motion registry declares. */
export function installPlanetOverlays(frameFlashMs: number): () => void {
  const store = useEditorStore;
  const bus = store.getState().eventBus;
  let open = false;
  let grid: GridState | null = null;
  let frame: PlanetFrame | null = null;
  let landmark: Rect | null = null;
  let review: Review;
  let shown = false;

  const drawFrame = (): void => host.planetFrame.show(frame);
  const drawReview = (): void => host.planetReview.show(
    review && shown ? cellSet(PLACEMENT_GRID, review.cells) : null,
    review?.landmark && shown ? landmark : null,
  );

  const readCanvas = (): void => {
    if (!open) return;
    const state = store.getState().gridState;
    const nextFrame = frameOf(state);
    if (!sameFrame(frame, nextFrame)) { frame = nextFrame; drawFrame(); }
    const nextLandmark = landmarkOf(state);
    if (!sameRect(landmark, nextLandmark)) { landmark = nextLandmark; drawReview(); }
  };
  const coalesced = coalesceToFrame(readCanvas);

  const sync = (): void => {
    const s = store.getState();
    if (!s.planetSession) {
      if (!open) return;
      open = false;
      coalesced.cancel();
      host.planetFrame.show(null);
      host.planetReview.show(null);
      return;
    }
    if (!open) {
      open = true;
      grid = s.gridState;
      frame = frameOf(grid);
      landmark = landmarkOf(grid);
      review = s.planetSession.review;
      shown = s.planetReviewShown;
      drawFrame();
      drawReview();
      return;
    }
    if (s.gridState !== grid) { grid = s.gridState; readCanvas(); }
    if (s.planetSession.review !== review || s.planetReviewShown !== shown) {
      review = s.planetSession.review;
      shown = s.planetReviewShown;
      drawReview();
    }
  };

  const redraw = (): void => { if (open) { drawFrame(); drawReview(); } };
  const flash = (): void => { if (open) host.planetFrame.flash(frameFlashMs); };

  const offStore = store.subscribe(sync);
  const offEdits = onMapEdited(bus, coalesced.run);
  const offView = onActiveViewChange(redraw);
  bus.on('ground-clipped', flash);
  sync();
  return () => {
    offStore();
    offEdits();
    offView();
    bus.off('ground-clipped', flash);
    coalesced.cancel();
    if (open) { host.planetFrame.show(null); host.planetReview.show(null); }
    open = false;
  };
}
