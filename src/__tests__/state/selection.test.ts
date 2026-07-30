import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { singleSelection, sameRef } from '../../state/selection';

const obj = (id: string) => ({ kind: 'object', id }) as const;

beforeEach(() => useEditorStore.getState().clearSelection());

describe('the selection is a set, not a scalar', () => {
  it('starts empty as [], never null, so nothing needs an optional chain', () => {
    expect(useEditorStore.getState().selection).toEqual([]);
  });

  it('toggles membership in and out, keeping insertion order', () => {
    const s = useEditorStore.getState();
    s.toggleSelection(obj('a'));
    s.toggleSelection(obj('b'));
    expect(useEditorStore.getState().selection.map((r) => r.kind === 'object' && r.id)).toEqual(['a', 'b']);
    s.toggleSelection(obj('a'));
    expect(useEditorStore.getState().selection.map((r) => r.kind === 'object' && r.id)).toEqual(['b']);
  });

  it('derives the single selection the old consumers still need', () => {
    expect(singleSelection([])).toBeNull();
    expect(singleSelection([obj('a')])).toEqual(obj('a'));
    // Plural has no single answer, and guessing one is how a group op silently acts on one member.
    expect(singleSelection([obj('a'), obj('b')])).toBeNull();
  });

  it('compares refs by value, since a ref is rebuilt on every hover', () => {
    expect(sameRef(obj('a'), obj('a'))).toBe(true);
    expect(sameRef(obj('a'), obj('b'))).toBe(false);
    expect(sameRef({ kind: 'terrain', x: 1, y: 2 }, { kind: 'terrain', x: 1, y: 2 })).toBe(true);
  });
});
