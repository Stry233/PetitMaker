/** The hidden interface stands on the page's back stack like every other state, and a back-out made
 *  before any editor session watches the stack leaves no watch behind. */
import { beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { placeObjectCommand } from '../../../core/model/command-build';
import { backOut } from '../../../editor/back/back-out';
import { canBackOut } from '../../../platform/input/back-stack';
import { interfaceHidden } from '../../../state/slices/shell';
import type { BlockRef } from '../../../state/selection';

const s = () => useEditorStore.getState();
const tree: BlockRef = { kind: 'object', id: 'tree' };

beforeEach(() => {
  resetStore();
  s().loadMap(makeState(16, 16), createDefaultRegistry());
  s().commandExecutor!.execute(placeObjectCommand({ id: 'tree', catalogId: 'tree-apple', position: { x: 4, y: 4 }, rotation: 0, elevation: 0 }));
});

describe('the hidden interface', () => {
  spec('UI-12', 'is the newest state: one back-out shows it again and the selection under it stands', () => {
    s().setSelection([tree]);
    s().setInterfaceHidden(true);
    expect(interfaceHidden(s())).toBe(true);
    expect(backOut()).toBe(true);
    expect(interfaceHidden(s())).toBe(false);
    expect(s().selection).toEqual([tree]);
    expect(backOut()).toBe(true);
    expect(s().selection).toEqual([]);
  });

  spec('UI-12', 'a back-out with no editor session watching leaves no watch behind', () => {
    s().setSelection([tree]);
    backOut();
    s().setSelection([tree]);
    expect(canBackOut(), 'nothing watches the editor\'s states once the back-out returned').toBe(false);
  });
});
