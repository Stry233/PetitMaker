/** The tool fields derive from `editMode`, whose only writer is `setEditMode`, so they always agree
 *  on what the map will do next. */
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

  /** What this call arms outranks what was carried. The eraser rides a mode switch and object mode
   *  routes it ahead of the armed item, so the arming call puts the carried eraser down. */
  it('arms the item a card picks even when an eraser rode in from another mode', () => {
    s().setEditMode({ mode: 'water', arm: { kind: 'erase' } });
    expect(activeToolOf(s())).toBe(ToolType.Eraser);
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } });
    expect(activeToolOf(s())).toBe(ToolType.ObjectPlacer);
    expect(armedItemOf(s())).toBe('bridge-teak');
  });

  /** Entering object mode puts a carried eraser down too: the shelf resumes its own last card, and a
   *  carried eraser would answer the map with nothing on the shelf to show it. */
  it('rests the map when the eraser rides a switch into object mode', () => {
    // Empty the shelf's memory first, so the return resumes nothing.
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

  it('arms the macro a card picks even when an eraser rode in from another mode', () => {
    s().setEditMode({ mode: 'water', arm: { kind: 'erase' } });
    s().setEditMode({ mode: 'object', arm: { kind: 'macro', macro: 'patch-tree' } });
    expect(activeToolOf(s())).toBe(ToolType.Macro);
    expect(armedMacroOf(s())).toBe('patch-tree');
  });

  /** The item is cleared from the inputs too, or a stale itemId would re-arm it on the next tool
   *  change. */
  it('puts the armed item down when the eraser is asked for explicitly', () => {
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } });
    s().setEditMode({ arm: { kind: 'erase' } });
    expect(activeToolOf(s())).toBe(ToolType.Eraser);
    expect(armedItemOf(s())).toBeNull();
    s().setEditMode({ arm: { kind: 'brush' } });
    expect(armedItemOf(s()), 'the put-down item does not come back').toBeNull();
  });

  it('puts the region brush away when the build mode changes, and only then', () => {
    // The region outranks the tool, so a region left painting under a terrain mode takes every press.
    s().setEditMode({ mode: 'generate' });
    s().setSelectingRegion(true);
    s().setEditMode({ mode: 'mountain' });
    expect(s().selectingRegion).toBe(false);

    // Arming inside the mode the region was painted for keeps it.
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
    // Re-arming the same item is not a change, so the pending turn survives.
    s().setPlacementRotation(90);
    s().setEditMode({ arm: { kind: 'item', itemId: 'building-stall' } });
    expect(s().placementRotation).toBe(90);
  });
});
