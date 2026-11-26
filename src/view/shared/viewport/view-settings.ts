/**
 * The store's view settings as a map view receives them: the layer panel's visibility and the
 * Settings choices for the passive overlays. Both canvas hosts drive their view through
 * `useViewSettings`, and a view built after the settings changed takes them through
 * `applyViewSettings`.
 */
import { useEffect, type RefObject } from 'react';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { layerNumbersShown } from '../../../state/layer-utils';
import { standInShown } from '../../../state/map-stand-in';
import { armingOf } from '../../../state/editing/arming';
import { toolDeclares } from '../../../tools/pointer/runtime';
import type { GridId } from '../../../core/grid/grids';

/** The passive overlays the Settings choices show; `grid` is the grid the cell lines draw, or null. */
export interface PassiveOverlays { grid: GridId | null; numbers: boolean; chunks: boolean }

/** Whether the views draw the passive overlays Settings choose: never over a stand-in, the save
 *  step's frame shown as its blueprint pictures hold it, which carry no grid lines, chunk bounds or
 *  layer numbers. */
const overlaysOpen = (s: EditorStore): boolean => !standInShown(s);

/** The grid the map draws in `s`: the Settings choice, `auto` taking the grid the active tool's
 *  cells lie on, so a terrain brush shows the cells it paints; none over a stand-in. */
export function shownGridOf(s: EditorStore): GridId | null {
  if (s.gridMode === 'off' || !overlaysOpen(s)) return null;
  if (s.gridMode !== 'auto') return s.gridMode;
  const arming = armingOf(s);
  return toolDeclares(arming.tool).grid(arming);
}

/** Whether the map draws the chunk bounds in `s`: the Settings choice, none over a stand-in. */
export const chunkBoundsShown = (s: EditorStore): boolean => s.showChunkBounds && overlaysOpen(s);

/** Whether the map draws the layer numbers in `s`: as `layerNumbersShown` says, none over a stand-in. */
const layerNumbersDrawn = (s: EditorStore): boolean => layerNumbersShown(s) && overlaysOpen(s);

/** What a map view takes from the store's view settings. */
export interface ViewSettingsTarget {
  /** The layer panel's visibility per build floor; a hidden floor peels. */
  setLayerVisibility(visibility: Readonly<Record<number, boolean>>): void;
  setPassiveOverlays(overlays: PassiveOverlays): void;
}

const passiveOverlaysOf = (s: EditorStore): PassiveOverlays =>
  ({ grid: shownGridOf(s), numbers: layerNumbersDrawn(s), chunks: chunkBoundsShown(s) });

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
  const numbers = useEditorStore(layerNumbersDrawn);
  const chunks = useEditorStore(chunkBoundsShown);
  useEffect(() => { targetRef.current?.setLayerVisibility(layerVisibility); }, [targetRef, layerVisibility]);
  useEffect(() => { targetRef.current?.setPassiveOverlays({ grid, numbers, chunks }); }, [targetRef, grid, numbers, chunks]);
}
