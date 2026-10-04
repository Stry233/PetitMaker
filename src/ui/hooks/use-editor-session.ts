import { useCallback, useEffect } from 'react';
import type { GridState } from '../../core/model/types';
import { installSelectionViewSync } from '../../canvas/interaction/selection-view-sync';
import { installRegionViewSync } from '../../canvas/interaction/region-view-sync';
import { scheduleAutosave, type RestoredAutosave } from '../../io/autosave';
import { adoptInstalledPlanet } from '../../io/planet-library';
import { host } from '../../kit/host';
import { loadMap } from '../../kit/operations/map';
import { useEditorStore } from '../../state/store';

interface SessionOptions {
  beforeRestore?: () => void;
  afterRestore?: () => void;
  settleRestore?: (map: GridState) => void;
}

/** Both editions persist and restore the same editor session. */
export function useEditorSession({ beforeRestore, afterRestore, settleRestore }: SessionOptions = {}) {
  const grid = useEditorStore(s => s.gridState);
  const bus = useEditorStore(s => s.eventBus);
  const annotations = useEditorStore(s => s.annotationsEpoch);
  const notes = useEditorStore(s => s.notesEpoch);
  useEffect(() => installSelectionViewSync(), []);
  useEffect(() => installRegionViewSync(), []);
  useEffect(() => {
    const save = () => {
      const { gridState: map, planetSession } = useEditorStore.getState();
      if (map && !planetSession) scheduleAutosave(map);
    };
    bus.on('cells-changed', save);
    bus.on('objects-changed', save);
    return () => { bus.off('cells-changed', save); bus.off('objects-changed', save); };
  }, [bus]);
  useEffect(() => {
    // The planet session's scratch canvas is never the user's map.
    if (grid && !useEditorStore.getState().planetSession) scheduleAutosave(grid);
  }, [grid, annotations, notes]);
  useEffect(() => {
    if (!grid) return;
    // Parent effects run after the views reset their cameras for a new map.
    const camera = host.camera.takeQueued();
    if (camera?.view2d) host.camera.set2d(camera.view2d);
    if (camera?.view3d) host.camera.set3d(camera.view3d);
    settleRestore?.(grid);
  }, [grid, settleRestore]);
  return useCallback((save: RestoredAutosave) => {
    beforeRestore?.();
    loadMap(save.state);
    adoptInstalledPlanet(save.state);
    if (save.history?.length) useEditorStore.getState().commandExecutor?.restoreHistory(save.history);
    host.camera.queue(save.camera ?? null);
    afterRestore?.();
  }, [beforeRestore, afterRestore]);
}
