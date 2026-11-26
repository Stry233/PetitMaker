/** The map's menu and the delete question stand over what they were opened on: the map as it was,
 *  the mode and arming, and a target the map still holds. Any of them moving closes them. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { RUN } from '../../../editor/commands/commands';
import { deleteMenuObject, pressSelectionDelete, turnObjectQuarter } from '../../../editor/editing/object-menu';
import { paintTerrainCommand, placeObjectCommand } from '../../../core/model/command-build';
import { TerrainType } from '../../../core/model/types';
import type { BlockRef } from '../../../state/selection';
import { carryItem } from '../../../editor/editing/object-shelf';

const s = () => useEditorStore.getState();
const ctx = { toggleMenu: vi.fn() };
let tree: BlockRef;

beforeEach(() => {
  resetStore();
  s().loadMap(makeState(16, 16), createDefaultRegistry());
  s().commandExecutor!.execute(placeObjectCommand({ id: 'tree', catalogId: 'tree-apple', position: { x: 4, y: 4 }, rotation: 0, elevation: 0 }));
  tree = { kind: 'object', id: 'tree' };
});

const openBoth = () => {
  s().setContextMenu({ x: 10, y: 10, target: tree, mode: 'pc' });
  s().setDeletePopover(tree);
};

describe('the map menu and the delete question', () => {
  it('[EDIT-78] close as an undo takes their object away, so Delete answers again', () => {
    openBoth();
    RUN['history.undo'](ctx);
    expect([s().contextMenu, s().deletePopover]).toEqual([null, null]);
    RUN['history.redo'](ctx);
    s().setSelection([tree]);
    RUN['selection.delete'](ctx);
    expect(s().deletePopover).toEqual(tree);
  });

  it('[EDIT-78] close as any edit, undo or redo moves the map under them', () => {
    openBoth();
    s().commandExecutor!.execute(paintTerrainCommand([{ x: 10, y: 10 }], TerrainType.Mountain, 1));
    expect([s().contextMenu, s().deletePopover]).toEqual([null, null]);
  });

  it('[EDIT-78] close as the mode changes', () => {
    openBoth();
    s().setEditMode({ mode: 'mountain' });
    expect([s().contextMenu, s().deletePopover]).toEqual([null, null]);
  });

  it('[EDIT-78] stand on a store update that changes none of it', () => {
    openBoth();
    s().setShowLayerNumbers(!s().showLayerNumbers);
    expect(s().contextMenu?.target).toEqual(tree);
    expect(s().deletePopover).toEqual(tree);
  });

  it("[EDIT-42] keep the finger's menu standing through its own quarter turn", () => {
    s().setContextMenu({ x: 10, y: 10, target: tree, mode: 'touch' });
    turnObjectQuarter('tree');
    expect(s().contextMenu?.target).toEqual(tree);
    s().commandExecutor!.execute(paintTerrainCommand([{ x: 10, y: 10 }], TerrainType.Mountain, 1));
    expect(s().contextMenu, 'an edit of anything else still closes it').toBeNull();
  });

  it("[EDIT-42] keep the finger's menu through the 3D view's re-anchoring after its own turn, never through a pan or zoom", () => {
    s().setContextMenu({ x: 10, y: 10, target: tree, mode: 'touch' });
    turnObjectQuarter('tree');
    // The 3D view re-anchors its chrome a frame after an object edit, its camera standing still.
    s().eventBus.emit('viewport-changed', { zoom: 1, content: true });
    expect(s().contextMenu?.target).toEqual(tree);
    s().eventBus.emit('viewport-changed', { zoom: 1.1 });
    expect(s().contextMenu, 'a pan or zoom still closes it').toBeNull();
  });

  it('[EDIT-78] close as a carry of the armed card starts, though their object is not selected', () => {
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'tree-apple' } });
    openBoth();
    const carry = carryItem('tree-apple', { pointerId: 1, surface: null, onEnd: () => {} });
    expect([s().contextMenu, s().deletePopover]).toEqual([null, null]);
    carry?.cancel();
  });

  it('[EDIT-78] close as Blueprint\'s explorer unfolds', () => {
    s().setEditMode({ mode: 'blueprint' });
    openBoth();
    s().unfoldBlueprintExplorer([]);
    expect([s().contextMenu, s().deletePopover]).toEqual([null, null]);
  });

  it('[EDIT-78] close as the view moves or zooms under them, with no surface of theirs mounted', () => {
    openBoth();
    s().eventBus.emit('viewport-changed', { zoom: 1.1 });
    expect([s().contextMenu, s().deletePopover]).toEqual([null, null]);
  });

  it('[EDIT-78] close as the floor their object stands on is hidden, though it is not selected', () => {
    openBoth();
    s().setLayerVisibility(0, false);
    expect([s().contextMenu, s().deletePopover]).toEqual([null, null]);
  });
});

describe('Delete on what is locked', () => {
  it('[EDIT-30] asks nothing and refuses at once, by key, on the card and in the menu, leaving the selection', () => {
    const map = s().gridState!;
    map.objects.set('tree', { ...map.objects.get('tree')!, locked: true });
    const heard: unknown[] = [];
    const hear = (refusal: unknown) => { heard.push(refusal); };
    s().eventBus.on('validation-failed', hear);
    try {
      for (const press of [() => RUN['selection.delete'](ctx), pressSelectionDelete, () => deleteMenuObject('tree')]) {
        s().setSelection([tree]);
        press();
        expect(s().deletePopover).toBeNull();
        expect(s().gridState!.objects.has('tree')).toBe(true);
        expect(s().selection).toEqual([tree]);
      }
    } finally {
      s().eventBus.off('validation-failed', hear);
    }
    expect(heard).toHaveLength(3);
    expect(JSON.stringify(heard[0])).toContain('error.locked_immutable');
  });
});

describe("Blueprint's steps across maps", () => {
  it('[BLUE-03] take ids no step on the map before had, so a late unfolding made for its strip lands on none', () => {
    s().setEditMode({ mode: 'blueprint' });
    const before = s().blueprintStep.id;
    s().loadMap(makeState(16, 16), createDefaultRegistry());
    expect(s().blueprintStep.id).not.toBe(before);
    expect(s().unfoldBlueprintExplorer([], {}, before)).toBeNull();
    expect(s().blueprintStep.at).toBe('strip');
  });

  it('[BLUE-03] fold the explorer as a press that acts on the map begins', () => {
    s().setEditMode({ mode: 'blueprint' });
    s().unfoldBlueprintExplorer([]);
    s().beginMapPress();
    expect(s().blueprintStep.at).toBe('strip');
  });
});
