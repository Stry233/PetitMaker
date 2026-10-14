/**
 * The hover-preview decision: while the pointer rests over the map in a
 * selection-capable mode (Hand, or ObjectPlacer with nothing to place), a grey
 * box shows what a click selects: the footprint of the object holding the pointer or, over ground, a
 * 1×1 box centred on the half-cell point nearest the pointer, sliding in half-cell steps, whose
 * centre names the terrain cell a click selects. Selected or not. Nothing shows outside those modes, during
 * region selection, or off the map.
 */
import { describe, it, expect } from 'vitest';
import { isDraggableObject, pointerTarget, selectionHoverBox } from '../../../view/interaction/selection-hover';
import { mapPoint } from '../../../core/grid/grids';
import { toolDeclares } from '../../../tools/pointer/runtime';
import type { ToolArming } from '../../../state/editing/arming';
import { ItemCategory } from '../../../config/catalog/categories';
import { ToolType } from '../../../state/editing/vocabulary';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { makeState } from '../../_support/map-state';
import { __setCatalogItem } from '../../../state/catalog';
import { templateAnchor, templateLandmarkObjects } from '../../../core/model/landmarks';
import { landmarkAt } from '../../_support/planet';
import { ANCHOR_LANDMARK } from '../../_support/anchor';

__setCatalogItem({
  id: 'hover-house', category: ItemCategory.Building, name: { en: 'Hover House' },
  width: 3, height: 2, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [],
});

function stateWithHouse(): GridState {
  const s = makeState(20, 20) as GridState;
  const house: PlacedObject = {
    id: 'h1', catalogId: 'hover-house', position: { x: 5, y: 6 },
    rotation: 0, elevation: 0,
  };
  s.objects.set(house.id, house);
  return s;
}

/** The hover box for the pointer at map point (x, y), with `arm.tool` answering its own select mode. */
function hoverAt(
  s: GridState, at: { x: number; y: number }, arm: { tool: ToolType; item: string | null; region: boolean }, mesh?: string,
) {
  const selectMode = toolDeclares(arm.tool).selectMode({ armedItem: arm.item } as ToolArming);
  return selectionHoverBox(s, pointerTarget(s, mapPoint(at), mesh), selectMode, arm.region);
}

describe('selectionHoverBox', () => {
  it('previews the hovered object footprint in Hand mode (placement grid)', () => {
    const s = stateWithHouse();
    expect(hoverAt(s, { x: 6.5, y: 7.5 }, { tool: ToolType.Hand, item: null, region: false }))
      .toEqual({ x: 5, y: 6, w: 3, h: 2, grid: 'object' });
  });

  it('previews a 1×1 box centred on the nearest half-cell point over ground', () => {
    const s = stateWithHouse();
    expect(hoverAt(s, { x: 12.2, y: 3.2 }, { tool: ToolType.Hand, item: null, region: false })).toEqual({ x: 11.5, y: 2.5, w: 1, h: 1, grid: 'object' });
    expect(pointerTarget(s, mapPoint({ x: 12.2, y: 3.2 })).terrain).toEqual({ x: 12, y: 3 });
  });

  it('slides in half-cell steps, and its centre names the terrain cell a click selects', () => {
    const s = stateWithHouse();
    expect(hoverAt(s, { x: 12.3, y: 3.2 }, { tool: ToolType.Hand, item: null, region: false })).toEqual({ x: 12, y: 2.5, w: 1, h: 1, grid: 'object' });
    expect(hoverAt(s, { x: 12.8, y: 3.2 }, { tool: ToolType.Hand, item: null, region: false })).toEqual({ x: 12.5, y: 2.5, w: 1, h: 1, grid: 'object' });
    // Centre (12.5, 3): terrain cell 13 covers [12.5, 13.5), so the click selects (13, 3).
    expect(pointerTarget(s, mapPoint({ x: 12.3, y: 3.2 })).terrain).toEqual({ x: 13, y: 3 });
    // Centre (13, 3) lies inside terrain cell (13, 3) too.
    expect(pointerTarget(s, mapPoint({ x: 12.8, y: 3.2 })).terrain).toEqual({ x: 13, y: 3 });
    expect(pointerTarget(s, mapPoint({ x: 12.2, y: 3.2 })).terrain).toEqual({ x: 12, y: 3 });
  });

  it('boxes a half-anchored object only where its footprint holds the pointer', () => {
    const s = makeState(20, 20) as GridState;
    s.objects.set('h3', { id: 'h3', catalogId: 'hover-house', position: { x: 5.5, y: 6 }, rotation: 0, elevation: 0 });
    expect(hoverAt(s, { x: 5.7, y: 6.2 }, { tool: ToolType.Hand, item: null, region: false })).toEqual({ x: 5.5, y: 6, w: 3, h: 2, grid: 'object' });
    // The left half of cell 5 is outside the footprint: the pointer is over the ground there.
    expect(hoverAt(s, { x: 5.2, y: 6.2 }, { tool: ToolType.Hand, item: null, region: false })).toEqual({ x: 4.5, y: 5.5, w: 1, h: 1, grid: 'object' });
    expect(hoverAt(s, { x: 8.4, y: 6.2 }, { tool: ToolType.Hand, item: null, region: false })).toEqual({ x: 5.5, y: 6, w: 3, h: 2, grid: 'object' });
    expect(hoverAt(s, { x: 8.6, y: 6.2 }, { tool: ToolType.Hand, item: null, region: false })).toEqual({ x: 8, y: 5.5, w: 1, h: 1, grid: 'object' });
  });

  it('also active for ObjectPlacer with NO item selected, but not when an item is armed', () => {
    const s = stateWithHouse();
    expect(hoverAt(s, { x: 6.5, y: 7.5 }, { tool: ToolType.ObjectPlacer, item: null, region: false })).not.toBeNull();
    expect(hoverAt(s, { x: 6.5, y: 7.5 }, { tool: ToolType.ObjectPlacer, item: 'hover-house', region: false })).toBeNull();
  });

  it('inactive for paint tools, during region selection, and off the map', () => {
    const s = stateWithHouse();
    expect(hoverAt(s, { x: 6.5, y: 7.5 }, { tool: ToolType.TerrainBrush, item: null, region: false })).toBeNull();
    expect(hoverAt(s, { x: 6.5, y: 7.5 }, { tool: ToolType.Hand, item: null, region: true })).toBeNull();
    expect(hoverAt(s, { x: -1, y: 7.5 }, { tool: ToolType.Hand, item: null, region: false })).toBeNull();
    expect(hoverAt(s, { x: 6.5, y: 25 }, { tool: ToolType.Hand, item: null, region: false })).toBeNull();
  });

  it('previews a selected block too, so the pointer always shows what it is over', () => {
    const s = stateWithHouse();
    expect(hoverAt(s, { x: 6.5, y: 7.5 }, { tool: ToolType.Hand, item: null, region: false })).not.toBeNull();
    expect(hoverAt(s, { x: 12, y: 3 }, { tool: ToolType.Hand, item: null, region: false }))
      .toEqual({ x: 11.5, y: 2.5, w: 1, h: 1, grid: 'object' });
  });

  it('previews a half-grid body at ITS anchor, so the box never straddles what it points at', () => {
    // The plaza is anchored at x.5/y.5 and the hover box is drawn from this rect verbatim
    // (`OverlayLayer.showHover`), so the fractional origin has to survive the decision.
    const s = makeState(120, 120) as GridState;
    s.template.landmarks = [landmarkAt(40.5, 40.5)];
    const plaza = (templateLandmarkObjects(s.template)[0] ?? null)!;
    s.objects.set(plaza.id, plaza);
    expect(hoverAt(s, { x: 45, y: 45 }, { tool: ToolType.Hand, item: null, region: false }))
      .toEqual({ x: 40.5, y: 40.5, w: templateAnchor(s.template)!.width, h: templateAnchor(s.template)!.height, grid: 'object' });
  });

  it('a ramp is draggable: its drop re-validates through the snapping trait, so a bad drop refuses', () => {
    const ramp: PlacedObject = {
      id: 'r1', catalogId: 'ramp-green-steps', position: { x: 5, y: 5 }, rotation: 0, elevation: 0,
    };
    expect(isDraggableObject(ramp)).toBe(true);
  });

  it('a locked object is never draggable: a move is a change, which is exactly what locked forbids', () => {
    // planObjectMove validates only the resulting PlaceObject, which V-LOCK-02 doesn't gate (it
    // excludes the object's own id as a self-overlap and only gates RemoveObject) — so arming a
    // drag on a locked object would silently relocate it instead of refusing. isDraggableObject
    // is the one gate the press/cursor both consult, so it must refuse before that path runs.
    const s = makeState(120, 120) as GridState;
    s.template.landmarks = [{ id: ANCHOR_LANDMARK.id, x: 40, y: 40, width: 20, height: 20 }];
    const plaza = (templateLandmarkObjects(s.template)[0] ?? null)!;
    expect(isDraggableObject(plaza)).toBe(false);
  });
});

describe('pointerTarget', () => {
  it('prefers the view\'s mesh pick, and falls back to the footprint test', () => {
    const s = stateWithHouse();
    const other: PlacedObject = {
      id: 'h2', catalogId: 'hover-house', position: { x: 12, y: 12 },
      rotation: 0, elevation: 0,
    };
    s.objects.set(other.id, other);
    // A 3D raycast can hit a body whose footprint does not cover the macro cell under the cursor.
    expect(pointerTarget(s, mapPoint({ x: 6.5, y: 7.5 }), 'h2').hit?.id).toBe('h2');
    expect(pointerTarget(s, mapPoint({ x: 6.5, y: 7.5 })).hit?.id).toBe('h1');
    // A mesh id that is not an object on this map falls back rather than reporting nothing.
    expect(pointerTarget(s, mapPoint({ x: 6.5, y: 7.5 }), 'gone').hit?.id).toBe('h1');
    expect(pointerTarget(s, mapPoint({ x: 0.5, y: 0.5 })).hit).toBeNull();
  });
});
