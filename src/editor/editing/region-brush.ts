/** Mounts the region-select brush on the editor (the store's region lane, the map overlay and the
 *  pointer channel), and owns the region overlay, which shows the region of the surface in front
 *  (`state/editing/region.ts:frontRegion`). */
import { getActiveView } from '../../view/active-view';
import { annotationInkScale } from '../../core/model/annotation/text-metrics';
import { regionEdges } from '../../core/model/annotation/dimensions';
import { TERRAIN_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import type { MacroCoord } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { frontRegion, paintedRegion, paintsRegion, regionOf, regionRequestOf, type RegionOwner } from '../../state/editing/region';
import { isCommandHeld } from '../../state/keymap/held';
import { createRegionBrush } from '../../tools/pointer/region';
import { clearRegionSelection, setRegionBrushHandler } from '../../view/interaction/pointer/region-channel';
import { host } from '../host/host';

/** Draws `cells` as the region, or clears the overlay for none. Its dimension guides show where
 *  `dimensions` asks, by default while region selection shows them, measured in the unit the region
 *  request names (`RegionRequest.wholeCells`). */
function showRegion(cells: readonly MacroCoord[], dimensions?: boolean): void {
  const s = useEditorStore.getState();
  if (cells.length === 0) { host.buildableRegion.clear(); return; }
  const edges = (dimensions ?? (s.selectingRegion && s.regionDimensions)) && s.gridState
    ? regionEdges(cells, regionRequestOf(s).wholeCells === true) : null;
  host.buildableRegion.show([...cells], edges && s.gridState ? { edges, scale: annotationInkScale(s.gridState.template) } : undefined);
}

/** Keeps the map's region overlay on the region of the surface in front (`frontRegion`), with the
 *  guides while it is being painted and a plain wash otherwise; returns the stop. A painting brush
 *  draws its stroke between store updates itself. */
export function watchRegionOverlay(): () => void {
  let shown: { cells: readonly MacroCoord[]; guides: boolean; map: unknown } | null = null;
  const sync = (): void => {
    const s = useEditorStore.getState();
    const cells = frontRegion(s)?.cells ?? [];
    const guides = s.selectingRegion && s.regionDimensions;
    if (shown && shown.cells === cells && shown.guides === guides && shown.map === s.gridState) return;
    if (!shown && cells.length === 0) { shown = { cells, guides, map: s.gridState }; return; }
    shown = { cells, guides, map: s.gridState };
    showRegion(cells, guides);
  };
  const off = useEditorStore.subscribe(sync);
  sync();
  return off;
}

/** Clears `owner`'s region, by default the painting surface's: through the brush when it is
 *  painting it, else on the store; another surface's region and painting stay. */
export function clearRegion(owner: RegionOwner | null = useEditorStore.getState().regionSelectionOwner): void {
  const s = useEditorStore.getState();
  if (!owner || (s.selectingRegion && s.regionSelectionOwner !== owner)) return;
  clearRegionSelection();
  if (regionOf(useEditorStore.getState(), owner).length > 0) useEditorStore.getState().setRegion([], owner);
}

/** Arms or disarms the assistant panel's region brush; while another surface's brush paints, nothing. */
export function toggleAgentRegion(): void {
  const s = useEditorStore.getState();
  if (s.selectingRegion && !paintsRegion(s, 'agent')) return;
  s.setSelectingRegion(!s.selectingRegion, 'agent');
}

/**
 * Puts the assistant's region brush down whenever its panel is not open, however the panel closed
 * and whether or not it is mounted, since a brush left armed takes every press on the map; the
 * overlay follows the surface in front. Returns the stop.
 */
export function watchAgentRegionBrush(): () => void {
  const sync = (): void => {
    const s = useEditorStore.getState();
    if (!s.assistantOpen && paintsRegion(s, 'agent')) s.setSelectingRegion(false);
  };
  const off = useEditorStore.subscribe(sync);
  sync();
  return off;
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
    request: () => regionRequestOf(store.getState()),
    size: () => store.getState().regionBrushSize,
    constrain: () => isCommandHeld('tool.constrain'),
    grid: () => store.getState().gridState,
    region: () => paintedRegion(store.getState()),
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
    if (paintedRegion(next) !== paintedRegion(previous)) { brush.resync(); resample(); }
    else if (next.regionTool !== previous.regionTool) { brush.resync(); resample(); }
    else if (next.regionDimensions !== previous.regionDimensions) brush.redraw();
  });
  resample();
  return () => {
    unregister();
    unsubscribe();
    getActiveView()?.overlay.clearGhost();
  };
}
