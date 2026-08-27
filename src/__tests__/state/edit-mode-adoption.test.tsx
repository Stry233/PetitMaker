/**
 * The four tool fields are derived. Writing them independently is what let them disagree, so
 * `setEditMode` is the only writer and `editMode` always describes what the map will do next.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { newMap } from '../../kit/operations';
import { ToolType } from '../../core/model/types';

beforeEach(() => newMap('hexia'));

const s = () => useEditorStore.getState();

describe('edit mode adoption', () => {
  it('arms a build surface and its shape together', () => {
    s().setEditMode({ mode: 'mountain', tool: 'shape', shape: 'circle' });
    expect(s().contentType).toBe('mountain');
    expect(s().designMode).toBe('circle');
    expect(s().activeTool).toBe(ToolType.TerrainBrush);
    expect(s().editMode.mode).toBe('mountain');
  });

  it('keeps editMode and the derived fields in step across a mode switch', () => {
    s().setEditMode({ mode: 'water', tool: 'brush' });
    s().setEditMode({ mode: 'road' });
    expect(s().contentType).toBe('tile');
    expect(s().editMode.tool).toBe('brush');
  });

  it('rests the map when Generate opens', () => {
    s().setEditMode({ mode: 'mountain', tool: 'brush' });
    s().setEditMode({ mode: 'generate' });
    expect(s().activeTool).toBe(ToolType.Hand);
  });

  it('arms the placer only once an item is picked', () => {
    s().setEditMode({ mode: 'object', itemId: null });
    expect(s().activeTool).toBe(ToolType.Hand);
    s().setEditMode({ itemId: 'tree-apple' });
    expect(s().activeTool).toBe(ToolType.ObjectPlacer);
    expect(s().selectedItemId).toBe('tree-apple');
  });

  it('returns to rest', () => {
    s().setEditMode({ mode: 'mountain', tool: 'brush' });
    s().setEditMode({ mode: null });
    expect(s().activeTool).toBe(ToolType.Hand);
    expect(s().selectedItemId).toBeNull();
  });

  /**
   * WHAT THIS CALL ARMS OUTRANKS WHAT WAS CARRIED. The eraser survives a mode switch by design
   * (the tool input rides along), and object mode routes it ahead of the armed item, so clicking a
   * bridge card with the water eraser still armed leaves the ERASER answering the map while the
   * card reads as chosen (issue #5). Choosing an item is choosing to place it: the arming call puts
   * the carried eraser down.
   */
  it('arms the item a card picks even when an eraser rode in from another mode', () => {
    s().setEditMode({ mode: 'water', tool: 'erase' });
    expect(s().activeTool).toBe(ToolType.Eraser);
    s().setEditMode({ mode: 'object', itemId: 'bridge-teak' });
    expect(s().activeTool).toBe(ToolType.ObjectPlacer);
    expect(s().selectedItemId).toBe('bridge-teak');
  });

  /**
   * ENTERING OBJECT MODE PUTS A CARRIED ERASER DOWN TOO: the shelf resumes its own last card, never
   * a surface's tool, and the eraser is the tool that made this worth pinning — carried in, it kept
   * answering the map with no cell anywhere in the object shelf to show it, and a cursor that never
   * reset. It stays reachable IN object mode by the explicit ask (the keyboard command), which is
   * the next test.
   */
  it('rests the map when the eraser rides a switch into object mode', () => {
    // Empty the shelf's own memory first, so what the return resumes is nothing.
    s().setEditMode({ mode: 'object', tool: 'none' });
    s().setEditMode({ mode: 'water', tool: 'erase' });
    s().setEditMode({ mode: 'object' });
    expect(s().activeTool).toBe(ToolType.Hand);
  });

  /** The shelf's memory: a card armed before a trip to a surface is armed again on return. */
  it('resumes the armed card when the user comes back from sculpting', () => {
    s().setEditMode({ mode: 'object', itemId: 'bridge-teak' });
    s().setEditMode({ mode: 'mountain', tool: 'brush' });
    s().setEditMode({ mode: 'object' });
    expect(s().activeTool).toBe(ToolType.ObjectPlacer);
    expect(s().selectedItemId).toBe('bridge-teak');
  });

  it('still arms the object eraser when it is asked for inside object mode', () => {
    s().setEditMode({ mode: 'object', itemId: null });
    s().setEditMode({ tool: 'erase' });
    expect(s().activeTool).toBe(ToolType.Eraser);
  });

  /** The same invariant covers the macro: the resolver reads the eraser ahead of an armed macro
   *  too, so a planting armed from the shelf with an eraser carried would also keep erasing. */
  it('arms the macro a card picks even when an eraser rode in from another mode', () => {
    s().setEditMode({ mode: 'water', tool: 'erase' });
    s().setEditMode({ mode: 'object', macro: 'patch-tree' });
    expect(s().activeTool).toBe(ToolType.Macro);
    expect(s().armedMacro).toBe('patch-tree');
  });

  /** The mirror: reaching for the eraser with an item armed ends the placement session, and ends
   *  it in the INPUTS too — a stale itemId would re-arm the item on the next tool change. */
  it('puts the armed item down when the eraser is asked for explicitly', () => {
    s().setEditMode({ mode: 'object', itemId: 'bridge-teak' });
    s().setEditMode({ tool: 'erase' });
    expect(s().activeTool).toBe(ToolType.Eraser);
    expect(s().selectedItemId).toBeNull();
    s().setEditMode({ tool: 'brush' });
    expect(s().selectedItemId, 'the put-down item does not come back').toBeNull();
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
    s().setEditMode({ itemId: 'tree-apple' });
    expect(s().selectingRegion).toBe(true);
  });

  it('resets the pending placement rotation whenever the armed item changes', () => {
    s().setEditMode({ mode: 'object', itemId: 'tree-apple' });
    s().setPlacementRotation(90);
    s().setEditMode({ itemId: 'building-stall' });
    expect(s().placementRotation).toBe(0);
    // Re-resolving the SAME armed item is not a change: a pending turn survives a redundant call.
    s().setPlacementRotation(90);
    s().setEditMode({ itemId: 'building-stall' });
    expect(s().placementRotation).toBe(90);
  });
});
