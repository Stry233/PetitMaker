/**
 * The hover-preview decision: while the pointer rests over the map in a
 * selection-capable mode (Hand, or ObjectPlacer with nothing to place), a grey
 * box previews exactly what a click would select — the hovered object's
 * footprint, or the 1×1 terrain cell. Nothing shows outside those modes, over
 * the already-selected block, during region selection, or off the map.
 */
import { describe, it, expect } from 'vitest';
import {
  canHoldSelection, inSelectMode, isDraggableObject, objectUnderPointer, overSelectedObject, selectionHoverBox,
} from '../../canvas/interaction/selection-hover';
import { ItemCategory, ObjectCategory, ToolType } from '../../core/model/types';
import type { GridState, PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { registerCatalogItem } from '../../state/catalog';
import { createPlazaObject } from '../../core/model/grid-model';

registerCatalogItem({
  id: 'hover-house', category: ItemCategory.Building, name: { en: 'Hover House' },
  emoji: '🏠', width: 3, height: 2, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [],
});

function stateWithHouse(): GridState {
  const s = makeState(20, 20) as GridState;
  const house: PlacedObject = {
    id: 'h1', catalogId: 'hover-house', position: { x: 5, y: 6 },
    rotation: 0, category: ObjectCategory.House, elevation: 0,
  };
  s.objects.set(house.id, house);
  return s;
}

describe('selectionHoverBox', () => {
  it('previews the hovered object footprint in Hand mode (macro grid)', () => {
    const s = stateWithHouse();
    expect(selectionHoverBox(s, { x: 6, y: 7 }, ToolType.Hand, null, false, []))
      .toEqual({ x: 5, y: 6, w: 3, h: 2, terrainMode: false });
  });

  it('previews the 1×1 terrain cell on empty ground (micro grid)', () => {
    const s = stateWithHouse();
    expect(selectionHoverBox(s, { x: 12, y: 3 }, ToolType.Hand, null, false, []))
      .toEqual({ x: 12, y: 3, w: 1, h: 1, terrainMode: true });
  });

  it('also active for ObjectPlacer with NO item selected, but not when an item is armed', () => {
    const s = stateWithHouse();
    expect(selectionHoverBox(s, { x: 6, y: 7 }, ToolType.ObjectPlacer, null, false, [])).not.toBeNull();
    expect(selectionHoverBox(s, { x: 6, y: 7 }, ToolType.ObjectPlacer, 'hover-house', false, [])).toBeNull();
  });

  it('inactive for paint tools, during region selection, and off the map', () => {
    const s = stateWithHouse();
    expect(selectionHoverBox(s, { x: 6, y: 7 }, ToolType.TerrainBrush, null, false, [])).toBeNull();
    expect(selectionHoverBox(s, { x: 6, y: 7 }, ToolType.Hand, null, true, [])).toBeNull();
    expect(selectionHoverBox(s, { x: -1, y: 7 }, ToolType.Hand, null, false, [])).toBeNull();
    expect(selectionHoverBox(s, { x: 6, y: 25 }, ToolType.Hand, null, false, [])).toBeNull();
  });

  it('shows nothing over the block that is already selected (the orange ring is there)', () => {
    const s = stateWithHouse();
    expect(selectionHoverBox(s, { x: 6, y: 7 }, ToolType.Hand, null, false, [{ kind: 'object', id: 'h1' }])).toBeNull();
    expect(selectionHoverBox(s, { x: 12, y: 3 }, ToolType.Hand, null, false, [{ kind: 'terrain', x: 12, y: 3 }])).toBeNull();
    // ...but still previews OTHER targets while something is selected.
    expect(selectionHoverBox(s, { x: 12, y: 3 }, ToolType.Hand, null, false, [{ kind: 'object', id: 'h1' }]))
      .toEqual({ x: 12, y: 3, w: 1, h: 1, terrainMode: true });
  });

  it('a locked object is never draggable: a move is a change, which is exactly what locked forbids', () => {
    // planObjectMove validates only the resulting PlaceObject, which V-LOCK-02 doesn't gate (it
    // excludes the object's own id as a self-overlap and only gates RemoveObject) — so arming a
    // drag on a locked object would silently relocate it instead of refusing. isDraggableObject
    // is the one gate the press/cursor both consult, so it must refuse before that path runs.
    const s = makeState(120, 120) as GridState;
    s.template.plaza = { x: 40, y: 40, width: 20, height: 20, elevation: 1 };
    const plaza = createPlazaObject(s.template)!;
    expect(isDraggableObject(plaza)).toBe(false);
  });

  it('reads the WHOLE selection: any member is where a press picks the group up', () => {
    const s = stateWithHouse();
    const second: PlacedObject = {
      id: 'h2', catalogId: 'hover-house', position: { x: 12, y: 3 },
      rotation: 0, category: ObjectCategory.House, elevation: 0,
    };
    s.objects.set(second.id, second);
    const group = [{ kind: 'object', id: 'h1' }, { kind: 'object', id: 'h2' }] as const;
    expect(overSelectedObject(s, { x: 6, y: 7 }, group)).toBe(true);
    expect(overSelectedObject(s, { x: 13, y: 3 }, group)).toBe(true);
    expect(overSelectedObject(s, { x: 1, y: 1 }, group)).toBe(false);
    // ...and neither member gets a grey would-select box, since both already wear a ring.
    expect(selectionHoverBox(s, { x: 13, y: 3 }, ToolType.Hand, null, false, group)).toBeNull();
  });
});

describe('the two selection-mode gates', () => {
  it('separates "a click selects" from "a selection can exist"', () => {
    // inSelectMode drives the press path and the hover preview; canHoldSelection decides whether a
    // tool switch drops the selection. They differ on exactly one state: an ARMED placer, where a
    // plain click places but Ctrl-click (and a click on an existing object) still selects.
    expect(inSelectMode(ToolType.Hand, null)).toBe(true);
    expect(inSelectMode(ToolType.ObjectPlacer, null)).toBe(true);
    expect(inSelectMode(ToolType.ObjectPlacer, 'tree-apple')).toBe(false);
    expect(inSelectMode(ToolType.TerrainBrush, null)).toBe(false);

    expect(canHoldSelection(ToolType.Hand)).toBe(true);
    expect(canHoldSelection(ToolType.ObjectPlacer)).toBe(true);
    expect(canHoldSelection(ToolType.TerrainBrush)).toBe(false);
    expect(canHoldSelection(ToolType.Eraser)).toBe(false);
    expect(canHoldSelection(ToolType.EdgeCut)).toBe(false);
  });
});

describe('objectUnderPointer', () => {
  it('prefers the view\'s mesh pick, and falls back to the footprint test', () => {
    const s = stateWithHouse();
    const other: PlacedObject = {
      id: 'h2', catalogId: 'hover-house', position: { x: 12, y: 12 },
      rotation: 0, category: ObjectCategory.House, elevation: 0,
    };
    s.objects.set(other.id, other);
    // A 3D raycast can hit a body whose footprint does not cover the macro cell under the cursor.
    expect(objectUnderPointer(s, { x: 6, y: 7 }, 'h2')?.id).toBe('h2');
    expect(objectUnderPointer(s, { x: 6, y: 7 })?.id).toBe('h1');
    // A mesh id that is not an object on this map falls back rather than reporting nothing.
    expect(objectUnderPointer(s, { x: 6, y: 7 }, 'gone')?.id).toBe('h1');
    expect(objectUnderPointer(s, { x: 0, y: 0 })).toBeNull();
  });
});
