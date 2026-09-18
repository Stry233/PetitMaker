import { useCallback, useEffect, useRef } from 'react';
import type { GridState } from '../../core/model/types';
import { installSelectionViewSync } from '../../canvas/interaction/selection-view-sync';
import { installRegionViewSync } from '../../canvas/interaction/region-view-sync';
import { scheduleAutosave, type RestoredAutosave } from '../../io/autosave';
import type { PersistedCamera } from '../../io/save-format';
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
  const pendingCamera = useRef<PersistedCamera | null>(null);
  useEffect(() => installSelectionViewSync(), []);
  useEffect(() => installRegionViewSync(), []);
  useEffect(() => {
    const save = () => {
      const map = useEditorStore.getState().gridState;
      if (map) scheduleAutosave(map);
    };
    bus.on('cells-changed', save);
    bus.on('objects-changed', save);
    return () => { bus.off('cells-changed', save); bus.off('objects-changed', save); };
  }, [bus]);
  useEffect(() => { if (grid) scheduleAutosave(grid); }, [grid, annotations, notes]);
  useEffect(() => {
    if (!grid) return;
    // Parent effects run after the views reset their cameras for a new map.
    const camera = pendingCamera.current;
    pendingCamera.current = null;
    if (camera?.view2d) host.camera.set2d(camera.view2d);
    if (camera?.view3d) host.camera.set3d(camera.view3d);
    settleRestore?.(grid);
  }, [grid, settleRestore]);
  return useCallback((save: RestoredAutosave) => {
    beforeRestore?.();
    loadMap(save.state);
    if (save.history?.length) useEditorStore.getState().commandExecutor?.restoreHistory(save.history);
    pendingCamera.current = save.camera ?? null;
    afterRestore?.();
  }, [beforeRestore, afterRestore]);
}
