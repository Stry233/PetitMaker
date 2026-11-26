/** The 3D card's shots as the strip and the commands change them: the set every edit starts from is
 *  `shotsOf`, so no surface has to mount for the card to have shots. */
import { useEditorStore } from '../../state/store';
import type { CameraAngle } from '../../state/view-camera';
import { MAX_SHOTS, MIN_SHOTS, addShot, deleteShot, replaceShot, shotsOf } from '../../state/shot-list';

const store = () => useEditorStore.getState();

/** The open map's shots; none without a map. */
export function exportShots(): CameraAngle[] {
  const { gridState, export3dShots } = store();
  return gridState ? shotsOf(export3dShots, gridState) : export3dShots;
}

/** Adds one shot; false without a map or at the most the card holds. */
export function addExportShot(): boolean {
  const { gridState, setExport3dShots } = store();
  const shots = exportShots();
  if (!gridState || shots.length >= MAX_SHOTS) return false;
  setExport3dShots(addShot(shots, gridState));
  return true;
}

/** Removes the shot at `index`; false where there is none or it is the last one left. */
export function removeExportShot(index: number): boolean {
  const shots = exportShots();
  if (shots.length <= MIN_SHOTS || !shots[index]) return false;
  store().setExport3dShots(deleteShot(shots, index));
  return true;
}

/** Brings the set to `count` shots, one added or dropped at a time; false without a map. */
export function setExportShotCount(count: number): boolean {
  const { gridState, setExport3dShots } = store();
  if (!gridState) return false;
  let shots = exportShots();
  while (shots.length < count) shots = addShot(shots, gridState);
  setExport3dShots(shots.slice(0, count));
  return true;
}

/** Opens the 3D preview to set the shot at `index`, starting from its angle. */
export function editExportShot(index: number): void {
  const angle = exportShots()[index];
  if (!angle) return;
  store().setPreview3DEdit({ index, angle });
  store().setModal('preview3d', true);
}

/** Keeps `angle` as the shot the 3D preview is setting. */
export function keepShotView(angle: CameraAngle): void {
  const edit = store().preview3DEdit;
  if (edit) store().setExport3dShots(replaceShot(exportShots(), edit.index, angle));
}
