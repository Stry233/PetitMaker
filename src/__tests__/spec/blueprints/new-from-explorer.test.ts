/** New blueprint pressed in the open explorer: the explorer folds and the frame step opens, and the
 *  selection the explorer put aside goes straight to the frame step, never shown in between. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { placeObjectCommand } from '../../../core/model/command-build';
import { beginBlueprintFrame, foldBlueprintLibraryForFrame, leaveBlueprintFrame, unfoldBlueprintLibrary } from '../../../editor/editing/blueprint';
import type { BlockRef } from '../../../state/selection';

const s = () => useEditorStore.getState();
const tree: BlockRef = { kind: 'object', id: 'tree' };

beforeEach(() => {
  resetStore();
  s().loadMap(makeState(16, 16), createDefaultRegistry());
  s().commandExecutor!.execute(placeObjectCommand({ id: 'tree', catalogId: 'tree-apple', position: { x: 4, y: 4 }, rotation: 0, elevation: 0 }));
  s().setEditMode({ mode: 'blueprint' });
  s().setSelection([tree]);
  unfoldBlueprintLibrary(true);
});

describe('New blueprint in the open explorer', () => {
  it('[BLUE-04] hands the selection the explorer put aside to the frame step without showing it, and Cancel gives it back', () => {
    const shown: number[] = [];
    const off = useEditorStore.subscribe((st) => { shown.push(st.selection.length); });
    const strip = foldBlueprintLibraryForFrame();
    expect(strip).not.toBeNull();
    expect(beginBlueprintFrame(null, 'explorer', strip!)).toBe(true);
    off();
    expect(shown.filter((n) => n > 0), 'no update shows the selection').toEqual([]);
    expect(leaveBlueprintFrame()).toBe(true);
    expect(s().selection).toEqual([tree]);
  });
});
