/**
 * The four tool fields are derived. Writing them independently is what let them disagree, so
 * `setEditMode` is the only writer and `editMode` always describes what the map will do next.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { newMap } from '../../editor/operations';
import { editorPort } from '../../editor/session/context';
import { ToolType } from '../../state/editing/vocabulary';
import { activeToolOf, armedItemOf, armedMacroOf, contentTypeOf, designModeOf, buildToolOf } from '../../state/editing/edit-mode';

beforeEach(() => newMap(editorPort, 'hexia'));

const s = () => useEditorStore.getState();

describe('edit mode adoption', () => {
  it('arms a build surface and its shape together', () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'shape', shape: 'circle' } });
    expect(contentTypeOf(s())).toBe('mountain');
    expect(designModeOf(s())).toBe('circle');
    expect(activeToolOf(s())).toBe(ToolType.TerrainBrush);
    expect(s().editMode.mode).toBe('mountain');
  });

  it('keeps editMode and the derived fields in step across a mode switch', () => {
    s().setEditMode({ mode: 'water', arm: { kind: 'brush' } });
    s().setEditMode({ mode: 'road' });
    expect(contentTypeOf(s())).toBe('road');
    expect(buildToolOf(s())).toBe('brush');
  });

  it('rests the map when Generate opens', () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    s().setEditMode({ mode: 'generate' });
    expect(activeToolOf(s())).toBe(ToolType.Hand);
  });

  it('arms the placer only once an item is picked', () => {
    s().setEditMode({ mode: 'object', arm: { kind: 'none' } });
    expect(activeToolOf(s())).toBe(ToolType.Hand);
    s().setEditMode({ arm: { kind: 'item', itemId: 'tree-apple' } });
    expect(activeToolOf(s())).toBe(ToolType.ObjectPlacer);
    expect(armedItemOf(s())).toBe('tree-apple');
  });

  it('returns to rest', () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    s().setEditMode({ mode: null });
    expect(activeToolOf(s())).toBe(ToolType.Hand);
    expect(armedItemOf(s())).toBeNull();
  });

  /**
   * What this call arms outranks what was carried. The eraser survives a mode switch by design
   * (the tool input rides along), and object mode routes it ahead of the armed item, so clicking a
   * bridge card with the water eraser still armed leaves the eraser answering the map while the
   * card reads as chosen. Choosing an item is choosing to place it: the arming call puts
   * the carried eraser down.
   */
  it('arms the item a card picks even when an eraser rode in from another mode', () => {
    s().setEditMode({ mode: 'water', arm: { kind: 'erase' } });
    expect(activeToolOf(s())).toBe(ToolType.Eraser);
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } });
    expect(activeToolOf(s())).toBe(ToolType.ObjectPlacer);
    expect(armedItemOf(s())).toBe('bridge-teak');
  });

  /**
   * Entering object mode puts a carried eraser down too: the shelf resumes its own last card, never
   * a surface's tool, and the eraser is the tool that made this worth pinning — carried in, it kept
   * answering the map with no cell anywhere in the object shelf to show it, and a cursor that never
   * reset. It stays reachable in object mode by the explicit ask (the keyboard command), which is
   * the next test.
   */
  it('rests the map when the eraser rides a switch into object mode', () => {
    // Empty the shelf's own memory first, so what the return resumes is nothing.
    s().setEditMode({ mode: 'object', arm: { kind: 'none' } });
    s().setEditMode({ mode: 'water', arm: { kind: 'erase' } });
    s().setEditMode({ mode: 'object' });
    expect(activeToolOf(s())).toBe(ToolType.Hand);
  });

  /** The shelf's memory: a card armed before a trip to a surface is armed again on return. */
  it('resumes the armed card when the user comes back from sculpting', () => {
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } });
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    s().setEditMode({ mode: 'object' });
    expect(activeToolOf(s())).toBe(ToolType.ObjectPlacer);
    expect(armedItemOf(s())).toBe('bridge-teak');
  });

  it('still arms the object eraser when it is asked for inside object mode', () => {
    s().setEditMode({ mode: 'object', arm: { kind: 'none' } });
    s().setEditMode({ arm: { kind: 'erase' } });
    expect(activeToolOf(s())).toBe(ToolType.Eraser);
  });

  /** The same invariant covers the macro: the resolver reads the eraser ahead of an armed macro
   *  too, so a planting armed from the shelf with an eraser carried would also keep erasing. */
  it('arms the macro a card picks even when an eraser rode in from another mode', () => {
    s().setEditMode({ mode: 'water', arm: { kind: 'erase' } });
    s().setEditMode({ mode: 'object', arm: { kind: 'macro', macro: 'patch-tree' } });
    expect(activeToolOf(s())).toBe(ToolType.Macro);
    expect(armedMacroOf(s())).toBe('patch-tree');
  });

  /** The mirror: reaching for the eraser with an item armed ends the placement session, and ends
   *  it in the inputs too — a stale itemId would re-arm the item on the next tool change. */
  it('puts the armed item down when the eraser is asked for explicitly', () => {
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } });
    s().setEditMode({ arm: { kind: 'erase' } });
    expect(activeToolOf(s())).toBe(ToolType.Eraser);
    expect(armedItemOf(s())).toBeNull();
    s().setEditMode({ arm: { kind: 'brush' } });
    expect(armedItemOf(s()), 'the put-down item does not come back').toBeNull();
  });

  it('puts the region brush away when the build mode changes, and only then', () => {
    // Two things arm the pointer and the region outranks the tool, so a region left painting under
    // a terrain mode hands every press to the wrong one.
    s().setEditMode({ mode: 'generate' });
    s().setSelectingRegion(true);
    s().setEditMode({ mode: 'mountain' });
    expect(s().selectingRegion).toBe(false);

    // Picking a tool or an item inside the mode the region was painted for is not leaving it.
    s().setEditMode({ mode: 'object' });
    s().setSelectingRegion(true);
    s().setEditMode({ arm: { kind: 'item', itemId: 'tree-apple' } });
    expect(s().selectingRegion).toBe(true);
  });

  it('resets the pending placement rotation whenever the armed item changes', () => {
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'tree-apple' } });
    s().setPlacementRotation(90);
    s().setEditMode({ arm: { kind: 'item', itemId: 'building-stall' } });
    expect(s().placementRotation).toBe(0);
    // Re-resolving the same armed item is not a change: a pending turn survives a redundant call.
    s().setPlacementRotation(90);
    s().setEditMode({ arm: { kind: 'item', itemId: 'building-stall' } });
    expect(s().placementRotation).toBe(90);
  });
});
