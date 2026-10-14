/**
 * Group delete: the one group operation that applies partially and reports the rest. The case
 * pinned here is Ctrl+A then Delete, which always includes the locked plaza — refusing the whole
 * delete would make that flow fail every time.
 *
 * The register split is on the counts, not on group-vs-single: something removed + something kept
 * is a normal partial outcome (a calm toast); nothing removed at all is a refusal of the whole
 * request, reported the same way a single blocked removal always has (`validation-failed`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { __setCatalogItem } from '../../../state/catalog';
import { CommandType } from '../../../core/model/types';
import type { GridState, PlacedObject } from '../../../core/model/types';
import type { EditorEvents } from '../../../state/editing/events';
import { makeState, makeExecutor } from '../../_support/map-state';
import { deleteGroup } from '../../../tools/objects/group-actions';
import { deleteSelection } from '../../../editor/editing/group-edit';
import { useEditorStore } from '../../../state/store';
import { COMMAND_BY_ID } from '../../../editor/commands/commands';
import { resetStore, setStoreState } from '../../_support/store';
import { ItemCategory } from '../../../config/catalog/categories';

beforeEach(resetStore);

__setCatalogItem({
  id: 'del-hut', category: ItemCategory.Building, name: { en: 'del-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [],
});

interface Spec { id: string; x: number; y: number; locked?: boolean }

function mapWith(specs: Spec[]): { gs: GridState; exec: CommandExecutor } {
  const gs = makeState(24, 24);
  const exec = makeExecutor(gs);
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: 'del-hut', position: { x: s.x, y: s.y },
      rotation: 0, elevation: 0,
      ...(s.locked ? { locked: true } : {}),
    };
    const res = exec.execute({ type: CommandType.PlaceObject, object });
    expect(res.success).toBe(true);
  }
  return { gs, exec };
}

describe('deleteGroup', () => {
  it('deletes what it can, keeps the locked member, and reports both counts with no refusal', () => {
    const { gs, exec } = mapWith([
      { id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }, { id: 'plaza', x: 10, y: 10, locked: true },
    ]);
    const before = exec.historyDepth();
    expect(deleteGroup(exec, gs, ['a', 'b', 'plaza'])).toEqual({ deleted: 2, kept: 1, refusal: null });
    expect(gs.objects.has('plaza')).toBe(true);
    expect(gs.objects.has('a')).toBe(false);
    expect(gs.objects.has('b')).toBe(false);
    // One undo entry restores every deleted member, plaza included in the pre-delete snapshot.
    expect(exec.historyDepth()).toBe(before + 1);
    exec.undo();
    expect(gs.objects.size).toBe(3);
  });

  it('deleting a selection of one unlocked object behaves exactly as a single removal', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }]);
    const before = exec.historyDepth();
    expect(deleteGroup(exec, gs, ['a'])).toEqual({ deleted: 1, kept: 0, refusal: null });
    expect(gs.objects.has('a')).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1);
  });

  it('a locked-only selection refuses outright (nothing removed), naming the rule, not a cheerful "kept 1"', () => {
    const { gs, exec } = mapWith([{ id: 'plaza', x: 10, y: 10, locked: true }]);
    const before = exec.historyDepth();
    const result = deleteGroup(exec, gs, ['plaza']);
    expect(result.deleted).toBe(0);
    expect(result.kept).toBe(1);
    expect(result.refusal?.errors[0]?.ruleId).toBe('V-LOCK-02');
    expect(gs.objects.has('plaza')).toBe(true);
    expect(exec.historyDepth()).toBe(before);
  });

  it('a group of three locked members refuses outright rather than reporting it kept all three', () => {
    const { gs, exec } = mapWith([
      { id: 'p1', x: 10, y: 10, locked: true },
      { id: 'p2', x: 12, y: 10, locked: true },
      { id: 'p3', x: 14, y: 10, locked: true },
    ]);
    const before = exec.historyDepth();
    const result = deleteGroup(exec, gs, ['p1', 'p2', 'p3']);
    expect(result).toEqual({
      deleted: 0, kept: 3,
      refusal: { cmd: expect.anything(), errors: expect.arrayContaining([expect.objectContaining({ ruleId: 'V-LOCK-02' })]) },
    });
    expect(exec.historyDepth()).toBe(before);
  });

  it('skips a stale id rather than throwing or blocking the rest', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    const res = deleteGroup(exec, gs, ['a', 'ghost', 'b']);
    expect(res).toEqual({ deleted: 2, kept: 0, refusal: null });
    expect(gs.objects.size).toBe(0);
    expect(deleteGroup(exec, gs, ['ghost'])).toEqual({ deleted: 0, kept: 0, refusal: null });
  });

  describe('the onWillRemove hook (widened from the single-object trigger)', () => {
    it('fires for every member actually removed, not for a kept (locked) one', () => {
      const { gs, exec } = mapWith([
        { id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }, { id: 'plaza', x: 10, y: 10, locked: true },
      ]);
      const animated: string[] = [];
      const result = deleteGroup(exec, gs, ['a', 'b', 'plaza'], (obj) => animated.push(obj.id));
      expect(result).toEqual({ deleted: 2, kept: 1, refusal: null });
      expect(animated.sort()).toEqual(['a', 'b']);
    });

    it('never fires when nothing is removed (a locked-only selection refuses outright)', () => {
      const { gs, exec } = mapWith([{ id: 'plaza', x: 10, y: 10, locked: true }]);
      const animated: string[] = [];
      expect(deleteGroup(exec, gs, ['plaza'], (obj) => animated.push(obj.id)).deleted).toBe(0);
      expect(animated).toEqual([]);
    });
  });
});

describe('the report a selection delete gives', () => {
  it('a refusal (nothing removed) fires validation-failed, never the calm toast', () => {
    const { gs, exec } = mapWith([{ id: 'plaza', x: 10, y: 10, locked: true }]);
    const bus = new EventBus<EditorEvents>();
    const seen: { cmd: unknown; errors: { ruleId: string }[] }[] = [];
    bus.on('validation-failed', (payload) => seen.push(payload));
    const t = vi.fn((key: string) => key);
    setStoreState({ gridState: gs, commandExecutor: exec, eventBus: bus });
    deleteSelection(t, ['plaza']);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.errors[0]?.ruleId).toBe('V-LOCK-02');
    expect(t).not.toHaveBeenCalled();
  });

  it('a partial result (one kept among several) shows the SINGULAR kept toast, not an error', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'plaza', x: 10, y: 10, locked: true }]);
    const bus = new EventBus<EditorEvents>();
    let failed = false;
    bus.on('validation-failed', () => { failed = true; });
    const t = vi.fn((key: string, params?: Record<string, string | number>) => `${key}:${params?.n}`);
    setStoreState({ gridState: gs, commandExecutor: exec, eventBus: bus });
    deleteSelection(t, ['a', 'plaza']);
    expect(failed).toBe(false);
    expect(t).toHaveBeenCalledWith('toast.group_delete_kept', { n: 1 });
  });

  it('a partial result with more than one kept member shows the PLURAL kept toast', () => {
    const { gs, exec } = mapWith([
      { id: 'a', x: 4, y: 4 },
      { id: 'p1', x: 10, y: 10, locked: true }, { id: 'p2', x: 12, y: 10, locked: true },
    ]);
    const bus = new EventBus<EditorEvents>();
    const t = vi.fn((key: string, params?: Record<string, string | number>) => `${key}:${params?.n}`);
    setStoreState({ gridState: gs, commandExecutor: exec, eventBus: bus });
    deleteSelection(t, ['a', 'p1', 'p2']);
    expect(t).toHaveBeenCalledWith('toast.group_delete_kept', { n: 2 });
  });

  it('everything removed reports nothing at all', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    const bus = new EventBus<EditorEvents>();
    let firedAnything = false;
    bus.on('validation-failed', () => { firedAnything = true; });
    const t = vi.fn();
    setStoreState({ gridState: gs, commandExecutor: exec, eventBus: bus });
    deleteSelection(t, ['a', 'b']);
    expect(firedAnything).toBe(false);
    expect(t).not.toHaveBeenCalled();
  });
});

const noopCtx = { toggleMenu: () => {} };

describe('selection.delete (plural path, wired to deleteGroup)', () => {
  it('Ctrl+A then Delete clears everything but the locked plaza, in one undo, leaving the plaza selected', () => {
    const { gs, exec } = mapWith([
      { id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }, { id: 'plaza', x: 10, y: 10, locked: true },
    ]);
    useEditorStore.setState({ gridState: gs, commandExecutor: exec, selection: [] });
    try {
      const before = exec.historyDepth();
      COMMAND_BY_ID.get('selection.all')!.run(noopCtx);
      COMMAND_BY_ID.get('selection.delete')!.run(noopCtx);
      expect(gs.objects.has('plaza')).toBe(true);
      expect(gs.objects.size).toBe(1);
      expect(exec.historyDepth()).toBe(before + 1);
      // The selection is narrowed to the survivors, which is what names the kept members.
      expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: 'plaza' }]);
      exec.undo();
      expect(gs.objects.size).toBe(3);
    } finally {
      useEditorStore.setState({ gridState: null, commandExecutor: null, selection: [] });
    }
  });

  it('Ctrl+A then Delete on an all-locked map refuses outright, leaving the selection intact', () => {
    const { gs, exec } = mapWith([{ id: 'plaza', x: 10, y: 10, locked: true }]);
    useEditorStore.setState({ gridState: gs, commandExecutor: exec, selection: [] });
    try {
      const before = exec.historyDepth();
      COMMAND_BY_ID.get('selection.all')!.run(noopCtx);
      COMMAND_BY_ID.get('selection.delete')!.run(noopCtx);
      expect(gs.objects.size).toBe(1);
      expect(exec.historyDepth()).toBe(before);
      expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: 'plaza' }]);
    } finally {
      useEditorStore.setState({ gridState: null, commandExecutor: null, selection: [] });
    }
  });
});
