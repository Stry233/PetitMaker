/** A selection stands only under a tool that holds one, kept by the store's own writers. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { resetStore, setArmed } from '../../_support/store';
import { ToolType } from '../../../state/editing/vocabulary';
import { activeToolOf } from '../../../state/editing/edit-mode';
import type { BlockRef } from '../../../state/selection';

const s = () => useEditorStore.getState();
const house: BlockRef = { kind: 'object', id: 'house' };

/** Counts the store updates `body` publishes. */
function publishes(body: () => void): number {
  let n = 0;
  const off = useEditorStore.subscribe(() => { n += 1; });
  body();
  off();
  return n;
}

beforeEach(resetStore);

describe('a selection written under a tool', () => {
  it.each([ToolType.TerrainBrush, ToolType.Eraser, ToolType.EdgeCut])(
    'puts the %s away for the Hand tool in the same update, keeping the surface', (tool) => {
      setArmed({ tool, content: 'water' });
      const seen: Array<[number, ToolType]> = [];
      const off = useEditorStore.subscribe((st) => seen.push([st.selection.length, activeToolOf(st)]));
      s().setSelection([house]);
      off();
      expect(seen).toEqual([[1, ToolType.Hand]]);
      expect(s().editMode.mode).toBe('water');
    });

  it('puts a brush away for a toggle too', () => {
    setArmed({ tool: ToolType.TerrainBrush });
    expect(publishes(() => s().toggleSelection(house))).toBe(1);
    expect(s().selection).toEqual([house]);
    expect(activeToolOf(s())).toBe(ToolType.Hand);
  });

  it('is dropped under a macro, publishing nothing', () => {
    setArmed({ tool: ToolType.Macro, content: 'road', macro: 'road-link' });
    expect(publishes(() => s().setSelection([house]))).toBe(0);
    expect(s().selection).toEqual([]);
    expect(activeToolOf(s())).toBe(ToolType.Macro);
  });

  it('stands under an armed placer', () => {
    setArmed({ tool: ToolType.ObjectPlacer, item: 'tree-apple' });
    s().setSelection([house]);
    expect(s().selection).toEqual([house]);
    expect(activeToolOf(s())).toBe(ToolType.ObjectPlacer);
  });
});

describe('arming a tool with a selection standing', () => {
  it('drops the selection in the update that arms a tool that cannot hold one', () => {
    s().setSelection([house]);
    const seen: Array<[number, ToolType]> = [];
    const off = useEditorStore.subscribe((st) => seen.push([st.selection.length, activeToolOf(st)]));
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    off();
    expect(seen).toEqual([[0, ToolType.TerrainBrush]]);
  });

  it('keeps it for a tool that holds one', () => {
    s().setSelection([house]);
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'tree-apple' } });
    expect(s().selection).toEqual([house]);
  });
});
