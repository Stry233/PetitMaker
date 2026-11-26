/** A card carried from the shelf to the map ends with the mode it began in: a change of mode cuts it
 *  off at once, so nothing a later release or cancel does reaches the new mode. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { placeObjectCommand } from '../../../core/model/command-build';
import { carryItem } from '../../../editor/editing/object-shelf';
import type { BlockRef } from '../../../state/selection';

const s = () => useEditorStore.getState();
const tree: BlockRef = { kind: 'object', id: 'tree' };

beforeEach(() => {
  resetStore();
  s().loadMap(makeState(16, 16), createDefaultRegistry());
  s().commandExecutor!.execute(placeObjectCommand({ id: 'tree', catalogId: 'tree-apple', position: { x: 4, y: 4 }, rotation: 0, elevation: 0 }));
});

describe('a shelf card carried to the map', () => {
  it('[EDIT-50] ends as the mode changes, and a later cancel gives back neither the arming nor the selection', () => {
    s().setEditMode({ mode: 'object' });
    s().setSelection([tree]);
    const onEnd = vi.fn();
    const carry = carryItem('tree-apple', { pointerId: 1, surface: null, onEnd });
    expect(carry).not.toBeNull();
    s().setEditMode({ mode: 'mountain' });
    expect(onEnd, 'the carry ended with the mode').toHaveBeenCalledTimes(1);
    carry!.cancel();
    expect(s().editMode.mode).toBe('mountain');
    expect(s().selection).toEqual([]);
  });
});
