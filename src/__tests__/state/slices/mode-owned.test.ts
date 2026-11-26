/** What a mode owns ends as the user leaves the mode, and what a layer shows ends as it is hidden. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState, setTerrain } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { RUN } from '../../../editor/commands/commands';
import { pointerTarget } from '../../../view/interaction/selection-hover';
import { mapPoint } from '../../../core/grid/grids';
import { shownOn } from '../../../state/selection';
import type { MapAnnotation } from '../../../core/model/annotations';
import { DEFAULT_TAG } from '../../../config/annotation-tags';
import { TerrainType } from '../../../core/model/types';

const s = () => useEditorStore.getState();
const NOTE: MapAnnotation = { kind: 'chip', id: 'n1', tag: DEFAULT_TAG, x: 3, y: 3, size: 'm', color: '#FF8A7A' };
const colorOf = (id: string) => s().gridState!.annotations?.items.find((n) => n.id === id)?.color;

beforeEach(() => {
  resetStore();
  s().loadMap(makeState(16, 16), createDefaultRegistry());
  s().addAnnotation(NOTE);
  s().setEditMode({ mode: 'annotate' });
  s().setAnnotationSelection([NOTE.id]);
});

describe('a selection of notes', () => {
  it.each([null, 'mountain', 'object'] as const)('[EDIT-76] ends as Notes is left for %s, so a colour picked later reaches no note', (mode) => {
    s().setEditMode({ mode });
    expect(s().annotationSelection).toEqual([]);
    s().setAnnotationColor('#7AB8FF');
    expect(colorOf(NOTE.id)).toBe(NOTE.color);
  });

  it('[EDIT-77] ends as the Notes layer is hidden, so Delete removes no note out of sight', () => {
    s().setAnnotationsVisible(false);
    expect(s().annotationSelection).toEqual([]);
    RUN['selection.delete']({ toggleMenu: () => {} });
    expect(s().gridState!.annotations?.items.map((n) => n.id)).toEqual([NOTE.id]);
  });
});

describe('a selection on a build floor', () => {
  it('[EDIT-77] loses the members standing on a floor as it is hidden, and keeps the rest', () => {
    const state = makeState(16, 16);
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    s().loadMap(state, createDefaultRegistry());
    const map = s().gridState!;
    map.objects.set('high', { id: 'high', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 1 });
    map.objects.set('low', { id: 'low', catalogId: 'tree-apple', position: { x: 12, y: 12 }, rotation: 0, elevation: 0 });
    s().setEditMode({ mode: null });
    s().setSelection([{ kind: 'object', id: 'high' }, { kind: 'object', id: 'low' }]);
    s().setLayerVisibility(1, false);
    expect(s().selection).toEqual([{ kind: 'object', id: 'low' }]);
    s().setLayerVisibility(1, true);
    s().setSelection([{ kind: 'terrain', x: 4, y: 4 }]);
    s().setLayerVisibility(1, false);
    expect(s().selection, 'a mountain cell whose top is on the floor').toEqual([]);
  });
});

describe('a hidden build floor', () => {
  /** Floor 1 holds a mountain block with a tree on it; a second tree stands on the ground. */
  function floors(): void {
    const state = makeState(16, 16);
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    s().loadMap(state, createDefaultRegistry());
    const map = s().gridState!;
    map.objects.set('high', { id: 'high', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 1 });
    map.objects.set('low', { id: 'low', catalogId: 'tree-apple', position: { x: 12, y: 12 }, rotation: 0, elevation: 0 });
    s().setEditMode({ mode: null });
    s().setLayerVisibility(1, false);
  }

  it('[EDIT-77] takes no selection of what stands on it, by click or by any writer', () => {
    floors();
    s().setSelection([{ kind: 'object', id: 'high' }, { kind: 'object', id: 'low' }]);
    expect(s().selection).toEqual([{ kind: 'object', id: 'low' }]);
    s().setSelection([{ kind: 'terrain', x: 4, y: 4 }]);
    expect(s().selection, 'a mountain cell whose top is on it').toEqual([]);
  });

  it('[EDIT-77] is passed over by select-all', () => {
    floors();
    RUN['selection.all']({ toggleMenu: () => {} });
    expect(s().selection).toEqual([{ kind: 'object', id: 'low' }]);
  });

  it('[EDIT-77] offers the pointer nothing on it', () => {
    floors();
    const hidden = shownOn(s());
    expect(pointerTarget(s().gridState!, mapPoint({ x: 5.5, y: 5.5 }), undefined, hidden).hit).toBeNull();
    expect(pointerTarget(s().gridState!, mapPoint({ x: 12.5, y: 12.5 }), undefined, hidden).hit?.id).toBe('low');
    expect(pointerTarget(s().gridState!, mapPoint({ x: 5.5, y: 5.5 }), 'high', hidden).hit, 'nor its mesh').toBeNull();
  });
});

