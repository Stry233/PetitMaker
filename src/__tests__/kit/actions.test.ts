/**
 * What a tile does and where a card draws it are two facts. The keyboard registry needs the first
 * and must not depend on the second, or a new shell takes the keymap with it.
 */
import { describe, it, expect } from 'vitest';
import { ACTIONS, ACTION_BY_ID } from '../../kit/actions';
import { ItemCategory } from '../../core/model/types';

describe('editor actions', () => {
  it('indexes every action by a unique id', () => {
    expect(ACTION_BY_ID.size).toBe(ACTIONS.length);
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });

  it('names a real catalog category on every placement action', () => {
    const categories = Object.values(ItemCategory) as string[];
    for (const a of ACTIONS.filter((x) => x.action === 'placement')) {
      expect(categories).toContain(a.payload);
    }
  });

  it('carries no layout', () => {
    for (const a of ACTIONS) {
      expect(a).not.toHaveProperty('x');
      expect(a).not.toHaveProperty('fill');
    }
  });

  it('road is a build action that opens the tile/path surface', () => {
    const road = ACTION_BY_ID.get('road');
    expect(road?.action).toBe('build');
    expect(road?.payload).toBe('tile'); // reuses the tile-coating brush
  });

  it('move is a grid action, distinct from the retired tile grid tile', () => {
    expect(ACTION_BY_ID.get('move')?.action).toBe('move');
    expect(ACTION_BY_ID.get('tile')).toBeUndefined();
  });
});
