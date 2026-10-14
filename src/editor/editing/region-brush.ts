/** Mounts the region-select brush on the editor (the store's region lane, the map overlay and the
 *  pointer channel), and owns the region overlay every surface shows the region through. */
import { getActiveView } from '../../view/active-view';
import { annotationInkScale } from '../../core/model/annotation/text-metrics';
import { TERRAIN_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import type { MacroCoord } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { isCommandHeld } from '../../state/keymap/held';
import { clearRegionSelection, createRegionBrush, setRegionBrushHandler } from '../../tools/pointer/region';
import { host } from '../host/host';

/** Draws `cells` as the region, or clears the overlay for none. Its dimension guides show where
 *  `dimensions` asks, by default while region selection shows them. */
export function showRegion(cells: readonly MacroCoord[], dimensions?: boolean): void {
  const s = useEditorStore.getState();
  if (cells.length === 0) { host.buildableRegion.clear(); return; }
  host.buildableRegion.show([...cells], (dimensions ?? (s.selectingRegion && s.regionDimensions)) && s.gridState
    ? annotationInkScale(s.gridState.template) : undefined);
}

/** A scope screen closing: the region keeps its wash, without the guides that belong to editing it. */
export function keepRegionWash(): void {
  const cells = useEditorStore.getState().region;
  if (cells.length) host.buildableRegion.show(cells);
}

/** Lets go of an outline shown outside region selection; a brush that is painting keeps its own. */
export function releaseRegionOutline(): void {
  if (!useEditorStore.getState().selectingRegion) host.buildableRegion.clear();
}

/** Clears the region: through the brush when it is mounted, else on the store. */
export function clearRegion(): void {
  clearRegionSelection();
  if (useEditorStore.getState().region.length > 0) useEditorStore.getState().setRegion([]);
}

/** Arms or disarms the region brush for the assistant panel. */
export function toggleAgentRegion(): void {
  const s = useEditorStore.getState();
  s.setSelectingRegion(!s.selectingRegion, 'agent');
}

/** The assistant panel closing with the brush it armed: disarms it and removes the overlay. */
export function releaseAgentRegion(): void {
  useEditorStore.getState().setSelectingRegion(false);
  host.buildableRegion.clear();
}

/** Asks the pointer machine to preview again at the pointer, after the brush's state changed. */
function resample(): void {
  useEditorStore.getState().eventBus.emit('pointer-resample', {});
}

/** Starts collecting painted cells for as long as region selection is on; returns the stop. */
export function startRegionBrush(): () => void {
  const store = useEditorStore;
  const brush = createRegionBrush({
    tool: () => store.getState().regionTool,
    request: () => store.getState().regionRequest,
    size: () => store.getState().regionBrushSize,
    constrain: () => isCommandHeld('tool.constrain'),
    grid: () => store.getState().gridState,
    region: () => store.getState().region,
    commit: (cells) => store.getState().commitRegion(cells),
    show: showRegion,
    ghost: (cells, eraser) => {
      const overlay = getActiveView()?.overlay;
      if (cells.length) overlay?.showGhost(cellSet(TERRAIN_GRID, [...cells]), { icon: eraser ? 'eraser' : null, valid: true });
      else overlay?.clearGhost();
    },
  });
  const unregister = setRegionBrushHandler(brush);
  const unsubscribe = store.subscribe((next, previous) => {
    if (next.region !== previous.region) { brush.resync(); resample(); }
    else if (next.regionTool !== previous.regionTool) { brush.resync(); resample(); }
    else if (next.regionDimensions !== previous.regionDimensions) brush.redraw();
  });
  resample();
  return () => {
    unregister();
    unsubscribe();
    getActiveView()?.overlay.clearGhost();
    if (!store.getState().selectingRegion) showRegion(store.getState().region);
  };
}
