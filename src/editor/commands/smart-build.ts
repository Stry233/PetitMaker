/*
 * The Smart Build key, whose body is its own wherever it acts: on a terrain surface it arms the
 * macro that surface's Smart Build stands for, and over the object shelf the planting card the
 * shelf's row shows. The pill and the card press the same bodies, so no control need be on screen.
 */
import { isSurfacePrint } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { buildToolOf, isContentMode, surfaceTools } from '../../state/editing/edit-mode';
import { keyContext } from '../../state/keymap/toolbar';
import { useEditorStore } from '../../state/store';
import { macroForSurface } from '../../tools/macros';
import { toggleShownPlanting } from '../editing/object-shelf';

/** Smart Build on the terrain surface in front: arms the surface's macro, or puts the smart tool
 *  down when it is armed. Nothing where the surface's row offers no Smart Build (`surfaceTools`). */
function toggleSmartMacro(): void {
  const s = useEditorStore.getState();
  const surface = s.editMode.mode;
  if (!isContentMode(surface)) return;
  const offered = surfaceTools(surface, { planetSession: s.planetSession !== null, printArmed: isSurfacePrint(getCatalogItem(s.tileMaterial)) });
  if (!offered.includes('smart')) return;
  s.setEditMode(buildToolOf(s) === 'smart' ? { arm: { kind: 'none' } } : { arm: { kind: 'smart', macro: macroForSurface(surface) } });
}

/** The Smart Build key's press. */
export function toggleSmartBuild(): void {
  if (keyContext(useEditorStore.getState()) === 'terrain') toggleSmartMacro();
  else toggleShownPlanting();
}
