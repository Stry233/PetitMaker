/**
 * What a tile does and where a card draws it are two facts. The keyboard registry needs the first
 * and must not depend on the second, or a new shell takes the keymap with it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, ACTION_BY_ID, openBuildSurface, runTileAction } from '../../../editor/commands/actions';
import { ItemCategory } from '../../../config/catalog/categories';
import { useEditorStore } from '../../../state/store';
import { designModeOf } from '../../../state/editing/edit-mode';

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

  it('road is a build action that opens the road surface', () => {
    const road = ACTION_BY_ID.get('road');
    expect(road?.action).toBe('build');
    expect(road?.payload).toBe('road');
  });

  it('move is a grid action, distinct from the retired tile grid tile', () => {
    expect(ACTION_BY_ID.get('move')?.action).toBe('move');
    expect(ACTION_BY_ID.get('tile')).toBeUndefined();
  });
});

describe('running a tap', () => {
  const s = () => useEditorStore.getState();
  const tap = (id: string): void => runTileAction(ACTION_BY_ID.get(id)!);
  beforeEach(() => {
    s().setSelectingRegion(false);
    s().setEditMode({ mode: null });
    for (const id of ['newProject', 'import', 'share'] as const) s().setModal(id, false);
    useEditorStore.setState({ planetSession: null });
  });

  it('opens the window a file action names', () => {
    tap('new');
    expect(s().modals.newProject).toBe(true);
    tap('image');
    expect([s().modals.share, s().shareTarget]).toEqual([true, 'friend']);
  });

  it('lays a build surface with its brush', () => {
    tap('river');
    expect(s().editMode.mode).toBe('water');
    expect(designModeOf(s())).toBe('free');
  });

  it('moves to rest and puts the region brush away with it', () => {
    s().setEditMode({ mode: 'mountain' });
    s().setSelectingRegion(true);
    tap('move');
    expect(s().editMode.mode).toBeNull();
    expect(s().selectingRegion).toBe(false);
  });

  it('opens a build tool on the surface in force, and on the mountain in a planet session', () => {
    s().setEditMode({ mode: 'water' });
    openBuildSurface('erase');
    expect([s().editMode.mode, designModeOf(s())]).toEqual(['water', 'erase']);
    s().setEditMode({ mode: 'road' });
    // `INVALID STORE SEED:` only the session's presence matters to the surface a tool key opens
    useEditorStore.setState({ planetSession: { entryId: null } as never });
    openBuildSurface('free');
    expect(s().editMode.mode).toBe('mountain');
  });

  it('leaves the notes bar alone', () => {
    s().setEditMode({ mode: 'annotate' });
    openBuildSurface('free');
    expect(s().editMode.mode).toBe('annotate');
  });
});
