import { useEffect, useState } from 'react';
import type { GridState } from '../../../core/model/types';
import { onMapEdited } from '../../../core/runtime/map-edits';
import { useEditorStore } from '../../../state/store';

/** `read(state)` for the live canvas, re-read at most once a frame while its cells or objects change.
 *  A reading `same` as the last keeps the last value, so a fact held by value renders only when it moves. */
export function useCanvasFact<T>(read: (state: GridState | null) => T, same: (a: T, b: T) => boolean = Object.is): T {
  const bus = useEditorStore((s) => s.eventBus);
  const grid = useEditorStore((s) => s.gridState);
  const [value, setValue] = useState(() => read(grid));
  useEffect(() => {
    const update = () => {
      const next = read(useEditorStore.getState().gridState);
      setValue((last) => (same(last, next) ? last : next));
    };
    update();
    return onMapEdited(bus, update, { frame: true });
  }, [bus, grid, read, same]);
  return value;
}
