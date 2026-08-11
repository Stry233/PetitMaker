/**
 * An object id is unique or the map and the screen disagree: `state.objects` is keyed by id, so a
 * repeat replaces the object holding it while the renderer keeps the sprite it already has.
 */
import { describe, it, expect } from 'vitest';
import { EditorAPI } from '../../api/editor-api';
import { newMap } from '../../kit/operations';
import { currentKit } from '../../kit/context';

describe('EditorAPI object ids', () => {
  it('mints a distinct id for every placement in the same millisecond', () => {
    newMap('hexia');
    const kit = currentKit()!;
    const api = new EditorAPI(() => kit.state, () => kit.executor);

    for (let i = 0; i < 200; i++) api.placeObject('tree-apple', 10 + (i % 40), 10 + Math.floor(i / 40));
    const ids = [...kit.state.objects.keys()];
    expect(ids.some((id) => id.startsWith('obj_'))).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
