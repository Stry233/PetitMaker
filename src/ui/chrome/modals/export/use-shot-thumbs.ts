// The export 3D-shots menu's thumbnails, one per shot in order, as `view/map3d/capture/stills.ts:createStillShelf`
// keeps them: '' for a shot not captured yet or that failed, and none where WebGL is unavailable.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GridState } from '../../../../core/model/types';
import { angleKey, createStillShelf, type StillShelfState } from '../../../../view/map3d/capture/stills';
import type { CameraAngle } from '../../../../state/view-camera';
import { CARD_3D_CELL_ASPECT } from '../../../../io/export/facts';
import { useSettledValue } from '../../../primitives/use-settled-value';

const THUMB_PX = 220;
// A capture waits out the shots strip's resize (`export.shot.resize`): building the scene mid-flight
// stalls that animation, and a stall snaps the layout on its final frame. Placeholders show meanwhile.
const SETTLE_MS = 480;

export function useShot3dThumbs(shotsIn: CameraAngle[], state: GridState | null, open: boolean): StillShelfState {
  const [shelf] = useState(() => createStillShelf({ maxPx: THUMB_PX, aspect: CARD_3D_CELL_ASPECT, settleMs: SETTLE_MS }));
  const stills = useSyncExternalStore(shelf.subscribe, shelf.snapshot);
  const shots = useSettledValue(shotsIn, (list) => list.map(angleKey).join('|'));

  useEffect(() => { shelf.show(open ? state : null, shots); }, [shelf, open, state, shots]);
  useEffect(() => () => shelf.release(), [shelf]);

  return stills;
}
