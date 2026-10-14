import { useCallback, useEffect } from 'react';
import type { GridState } from '../../core/model/types';
import type { RestoredAutosave } from '../../io/storage/autosave';
import { restoreSession } from '../../editor/session/restore';
import { useEditorStore } from '../../state/store';

interface SessionOptions {
  beforeRestore?: () => void;
  afterRestore?: () => void;
  settleRestore?: (map: GridState) => void;
}

/** Both editions restore the same editor session (`editor/session/restore.ts`) between the root's fade
 *  callbacks; its wiring is `editor/session/install.ts`. */
export function useEditorSession({ beforeRestore, afterRestore, settleRestore }: SessionOptions = {}) {
  const grid = useEditorStore(s => s.gridState);
  useEffect(() => {
    if (!grid) return;
    // Parent effects run after the views have drawn the new map and taken its parked camera.
    settleRestore?.(grid);
  }, [grid, settleRestore]);
  return useCallback((save: RestoredAutosave) => {
    beforeRestore?.();
    restoreSession(save);
    afterRestore?.();
  }, [beforeRestore, afterRestore]);
}
