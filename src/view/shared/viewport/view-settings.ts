/**
 * The store's view settings as a map view receives them: the layer panel's visibility and the
 * Settings choices for the passive overlays. Both canvas hosts drive their view through
 * `useViewSettings`, and a view built after the settings changed takes them through
 * `applyViewSettings`.
 */
import { useEffect, type RefObject } from 'react';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { layerNumbersShown } from '../../../state/layer-utils';
import { armingOf } from '../../../state/editing/arming';
import { toolDeclares } from '../../../tools/pointer/runtime';
import type { GridId } from '../../../core/grid/grids';

/** The passive overlays the Settings choices show; `grid` is the grid the cell lines draw, or null. */
export interface PassiveOverlays { grid: GridId | null; numbers: boolean; chunks: boolean }

/** The grid the map draws in `s`: the Settings choice, `auto` taking the grid the active tool's
 *  cells lie on, so a terrain brush shows the cells it paints. */
export function shownGridOf(s: EditorStore): GridId | null {
  if (s.gridMode === 'off') return null;
  if (s.gridMode !== 'auto') return s.gridMode;
  const arming = armingOf(s);
  return toolDeclares(arming.tool).grid(arming);
}

/** What a map view takes from the store's view settings. */
export interface ViewSettingsTarget {
  /** The layer panel's visibility per build floor; a hidden floor peels. */
  setLayerVisibility(visibility: Readonly<Record<number, boolean>>): void;
  setPassiveOverlays(overlays: PassiveOverlays): void;
}

export const passiveOverlaysOf = (s: EditorStore): PassiveOverlays =>
  ({ grid: shownGridOf(s), numbers: layerNumbersShown(s), chunks: s.showChunkBounds });

/** Gives `target` the settings as they stand. */
export function applyViewSettings(target: ViewSettingsTarget): void {
  const s = useEditorStore.getState();
  target.setLayerVisibility(s.layerVisibility);
  target.setPassiveOverlays(passiveOverlaysOf(s));
}

/** Gives the view in `targetRef` each settings change. */
export function useViewSettings(targetRef: RefObject<ViewSettingsTarget | null>): void {
  const layerVisibility = useEditorStore((s) => s.layerVisibility);
  const grid = useEditorStore(shownGridOf);
  const numbers = useEditorStore(layerNumbersShown);
  const chunks = useEditorStore((s) => s.showChunkBounds);
  useEffect(() => { targetRef.current?.setLayerVisibility(layerVisibility); }, [targetRef, layerVisibility]);
  useEffect(() => { targetRef.current?.setPassiveOverlays({ grid, numbers, chunks }); }, [targetRef, grid, numbers, chunks]);
}
