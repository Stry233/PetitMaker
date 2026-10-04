import { useCallback, useSyncExternalStore } from 'react';
import { onMapEdited } from '../../core/runtime/map-edits';
import { useEditorStore } from '../../state/store';

/**
 * The live map's edit revision as `cellsVersion:objectsVersion`, re-read after every edit, undo and
 * redo included. With `listening` off the hook subscribes to nothing and re-reads only on render.
 */
export function useMapRevision(listening = true): string {
  const map = useEditorStore((s) => s.gridState);
  const bus = useEditorStore((s) => s.eventBus);
  const subscribe = useCallback(
    (notify: () => void) => (listening ? onMapEdited(bus, notify) : () => {}),
    [listening, bus],
  );
  const read = useCallback(() => `${map?.cellsVersion ?? 0}:${map?.objectsVersion ?? 0}`, [map]);
  return useSyncExternalStore(subscribe, read, read);
}
