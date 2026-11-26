/** The mode and tool option commands over the live store: each does what its control does and refuses a bad value. */
import { beforeEach, describe, expect, it } from 'vitest';

import { listCommands, runCommand } from '../../../editor/commands/run';
import { createDefaultRegistry } from '../../../rules';
import { ItemCategory } from '../../../config/catalog/categories';
import { createGenerateBatch } from '../../../editor/editing/generate-batch';
import { createGenerateRecipe } from '../../../editor/editing/generate-recipe';
import { toggleAgentRegion } from '../../../editor/editing/region-brush';
import { getCatalogByCategory, getRoadMaterials } from '../../../state/catalog';
import { armedItemOf, brushSizeOf, buildShapeOf, designModeOf } from '../../../state/editing/edit-mode';
import { regionRequestOf } from '../../../state/editing/region';
import { placesOneAtATime } from '../../../state/object-geometry';
import { scopeRequestFor } from '../../../tools/generation/facts';
import { useEditorStore } from '../../../state/store';
import { makeTemplate } from '../../_support/map-state';
import { resetStore } from '../../_support/store';

const s = () => useEditorStore.getState();
const current = (id: string) => listCommands().find((command) => command.id === id)?.current;
const run = async (id: string, args: Record<string, unknown> = {}) => {
  const outcome = await runCommand(id, args);
  expect(outcome, `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: true });
};
const refused = async (id: string, args: Record<string, unknown> = {}) => {
  expect(await runCommand(id, args), `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: false });
};

beforeEach(() => {
  resetStore();
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
});

describe('mode.set', () => {
  it('opens a mode as its tile does, with the tool the mode held, and puts it away', async () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'erase' } });
    await run('mode.set', { mode: 'none' });
    expect(s().editMode.mode).toBeNull();
    expect(current('mode.set')).toBe('none');

    await run('mode.set', { mode: 'mountain' });
    expect([s().editMode.mode, designModeOf(s())]).toEqual(['mountain', 'erase']);
    expect(current('mode.set')).toBe('mountain');

    await run('mode.set', { mode: 'blueprint' });
    expect(s().editMode.mode).toBe('blueprint');
  });

  it('opens Notes with the notes shown, as the layer panel\'s row does', async () => {
    s().setAnnotationsVisible(false);
    await run('mode.set', { mode: 'annotate' });
    expect(s().editMode.mode).toBe('annotate');
    expect(s().gridState!.annotations?.visible).not.toBe(false);
  });

  it('refuses an unknown mode and a mode the planet session does not offer, changing nothing', async () => {
    s().setEditMode({ mode: 'water' });
    await refused('mode.set', { mode: 'lava' });
    await refused('mode.set');
    useEditorStore.setState({ planetSession: { entryId: null } as never });
    await refused('mode.set', { mode: 'road' });
    expect(s().editMode.mode).toBe('water');
  });
});

describe('the options of the tool in hand, set to a value', () => {
  it('brush.size sizes the brush its slider sizes: the build brush, the eraser, the region brush', async () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    await run('brush.size', { value: 4 });
    expect(brushSizeOf(s())).toBe(4);
    expect(current('brush.size')).toBe(4);

    s().setEditMode({ arm: { kind: 'erase' } });
    await run('brush.size', { value: 2 });
    expect([s().eraserBrushSize, s().drawingBrushSize]).toEqual([2, 4]);

    s().setSelectingRegion(true, 'generator');
    await run('brush.size', { value: 5 });
    expect(s().regionBrushSize).toBe(5);
    expect(s().eraserBrushSize).toBe(2);

    for (const value of [0, 9, 2.5, 'big']) await refused('brush.size', { value });
    await refused('brush.size');
    expect(s().regionBrushSize).toBe(5);
  });

  it('brush.size sets the object brush\'s spacing within its own range', async () => {
    s().setEditMode({ mode: 'object' });
    useEditorStore.setState({ objectBrushBar: true });
    await run('brush.size', { value: 0 });
    expect(s().objectPaintSpacing).toBe(0);
    await run('brush.size', { value: 3 });
    expect(current('brush.size')).toBe(3);
    await refused('brush.size', { value: 5 });
    expect(s().objectPaintSpacing).toBe(3);
  });

  it('tool.shape sets the figure of the brush in hand, and the eraser\'s own for the eraser', async () => {
    s().setEditMode({ mode: 'water', arm: { kind: 'brush' } });
    await run('tool.shape', { value: 'rect' });
    expect(designModeOf(s())).toBe('rect');
    expect(current('tool.shape')).toBe('rect');

    s().setEditMode({ arm: { kind: 'erase' } });
    await run('tool.shape', { value: 'circle' });
    expect([s().eraserShape, buildShapeOf(s())]).toEqual(['circle', 'rect']);

    s().setEditMode({ arm: { kind: 'trim' } });
    await refused('tool.shape', { value: 'line' });
    await refused('tool.shape', { value: 'hexagon' });
    expect([designModeOf(s()), s().eraserShape, buildShapeOf(s())]).toEqual(['trim', 'circle', 'rect']);
  });

  it('tool.shape sets the region brush\'s figure only among those its request offers', async () => {
    s().setSelectingRegion(true, 'generator', { tools: ['rect', 'circle', 'erase'], single: true, minSide: null });
    await run('tool.shape', { value: 'circle' });
    expect(s().regionTool).toBe('circle');
    await refused('tool.shape', { value: 'free' });
    expect(s().regionTool).toBe('circle');
  });

  it('tool.thickness sets the mountain stroke\'s layers where the thickness group shows', async () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    await run('tool.thickness', { value: 3 });
    expect(s().terrainThickness).toBe(3);
    expect(current('tool.thickness')).toBe(3);

    await refused('tool.thickness', { value: 7 });
    s().setEditMode({ mode: 'water' });
    await refused('tool.thickness', { value: 2 });
    expect(s().terrainThickness).toBe(3);
  });

  it('tool.auto_edge_cut sets the cut a brush stroke makes', async () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    await run('tool.auto_edge_cut', { value: 'round' });
    expect(s().autoEdgeCut).toBe('round');
    expect(current('tool.auto_edge_cut')).toBe('round');

    await refused('tool.auto_edge_cut', { value: 'wavy' });
    s().setEditMode({ arm: { kind: 'trim' } });
    await refused('tool.auto_edge_cut', { value: 'off' });
    expect(s().autoEdgeCut).toBe('round');
  });

  it('tool.material picks a swatch of the road bar, a road surface or a print, and no other id', async () => {
    const road = getRoadMaterials()[1]!.id;
    const print = getRoadMaterials(true)[0]!.id;
    s().setEditMode({ mode: 'road' });
    await run('tool.material', { value: road });
    expect([s().tileMaterial, s().tileMaterialPicked]).toEqual([road, true]);
    expect(current('tool.material')).toBe(road);
    await run('tool.material', { value: print });
    expect(s().tileMaterial).toBe(print);

    await refused('tool.material', { value: 'tree-apple' });
    await refused('tool.material', { value: 3 });
    s().setEditMode({ mode: 'mountain' });
    await refused('tool.material', { value: road });
    expect(s().tileMaterial).toBe(print);
  });

  it('tool.road_family switches the road bar between roads and prints, back to the material last laid in each', async () => {
    const [firstRoad, road] = getRoadMaterials().map((item) => item.id);
    const [firstPrint, print] = getRoadMaterials(true).map((item) => item.id);
    s().setEditMode({ mode: 'road' });
    expect([s().tileMaterial, current('tool.road_family')]).toEqual([firstRoad, 'roads']);
    await run('tool.material', { value: road });
    await run('tool.road_family', { family: 'prints' });
    expect([s().tileMaterial, current('tool.road_family')]).toEqual([firstPrint, 'prints']);
    await run('tool.material', { value: print });
    await run('tool.road_family', { family: 'roads' });
    expect(s().tileMaterial).toBe(road);
    await run('tool.road_family', { family: 'roads' });
    expect(s().tileMaterial).toBe(road);
    await run('tool.road_family', { family: 'prints' });
    expect(s().tileMaterial).toBe(print);

    await refused('tool.road_family', { family: 'rails' });
    await refused('tool.road_family');
    s().setEditMode({ mode: 'mountain' });
    await refused('tool.road_family', { family: 'roads' });
    expect([s().tileMaterial, current('tool.road_family')]).toEqual([print, 'none']);
  });

  it('tool.material picks the ground a planet being edited lays', async () => {
    useEditorStore.setState({ planetSession: { entryId: null } as never });
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    await run('tool.material', { value: 'sand' });
    expect(s().planetMaterial).toBe('sand');
    await refused('tool.material', { value: getRoadMaterials()[0]!.id });
    expect(s().planetMaterial).toBe('sand');
  });
});

describe('what a bar\'s own controls start and end', () => {
  const ROSE = getCatalogByCategory(ItemCategory.Flora).find((item) => !placesOneAtATime(item))!.id;
  const BRIDGE = getCatalogByCategory(ItemCategory.Bridge).find(placesOneAtATime)!.id;

  it('region.dimensions shows and hides the painted region\'s width and height', async () => {
    expect(current('region.dimensions')).toBe(true);
    await run('region.dimensions', { on: false });
    expect([s().regionDimensions, current('region.dimensions')]).toEqual([false, false]);
    await run('region.dimensions', { on: true });
    expect(s().regionDimensions).toBe(true);
    await refused('region.dimensions');
  });

  it('region.paint starts Generate\'s region with the brush its kind asks for, and ends a painting with the region kept', async () => {
    await refused('region.paint', { on: true });
    expect(s().selectingRegion, 'no shelf is open').toBe(false);

    const recipe = createGenerateRecipe(['maze', 'text'], 'text', { richness: 50, corridorWidth: 1, contrast: 100 });
    const batch = createGenerateBatch({ shotSize: { px: 64, aspect: 1 }, failedMs: 4000, recipe });
    const takeDown = batch.show();
    try {
      s().setEditMode({ mode: 'generate' });
      await run('region.paint', { on: true });
      expect([s().selectingRegion, s().regionSelectionOwner, current('region.paint')]).toEqual([true, 'generator', true]);
      expect(regionRequestOf(s())).toEqual(scopeRequestFor('text'));
      s().commitRegion([{ x: 3, y: 3 }]);
      await run('region.paint', { on: false });
      expect([s().selectingRegion, s().regions.generator?.cells, current('region.paint')]).toEqual([false, [{ x: 3, y: 3 }], false]);

      recipe.setKind('maze');
      await run('region.paint', { on: true });
      expect(regionRequestOf(s())).toEqual(scopeRequestFor('maze'));
      await run('region.paint', { on: false });
    } finally {
      takeDown();
      batch.dispose();
    }

    toggleAgentRegion();
    await run('region.paint', { on: false });
    expect(s().selectingRegion, 'the assistant\'s painting ends the same way').toBe(false);

    s().setEditMode({ mode: 'blueprint' });
    s().setSelectingRegion(true, 'blueprint');
    await refused('region.paint', { on: false });
    expect([s().selectingRegion, current('region.paint')]).toEqual([true, false]);
  });

  it('objects.brush_bar opens the brush bar where its button would, and puts it away with the card still armed', async () => {
    await refused('objects.brush_bar', { on: true });
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: BRIDGE } });
    await refused('objects.brush_bar', { on: true });
    expect([s().objectBrushBar, current('objects.brush_bar')]).toEqual([false, false]);

    s().setEditMode({ arm: { kind: 'item', itemId: ROSE } });
    await run('objects.brush_bar', { on: true });
    expect([s().objectBrushBar, current('objects.brush_bar')]).toEqual([true, true]);
    await run('objects.brush_bar', { on: false });
    expect([s().objectBrushBar, armedItemOf(s())]).toEqual([false, ROSE]);
  });

  it('selection.clear puts the selection down and ends touch multi-select and a latched move', async () => {
    const tree = { kind: 'object' as const, id: 'tree' };
    s().setSelection([tree]);
    s().setMultiSelectLatched(true);
    s().setMoveLatched(true);
    await run('selection.clear');
    expect([s().selection, s().multiSelectLatched, s().moveLatched]).toEqual([[], false, false]);
  });

  it('notes.edit closes the save-and-share window and opens Notes with the notes shown', async () => {
    s().setAnnotationsVisible(false);
    s().openShare('friend');
    await run('notes.edit');
    expect([s().modals.share, s().editMode.mode, s().gridState!.annotations?.visible !== false]).toEqual([false, 'annotate', true]);
  });
});

describe('a tool pill\'s command', () => {
  it('takes the region brush up on the first figure offered where the remembered one is not', async () => {
    s().setSelectingRegion(true, 'generator');
    s().setRegionTool('erase');
    s().setSelectingRegion(false);
    s().setSelectingRegion(true, 'generator', { tools: ['rect', 'erase'], single: true, minSide: null });
    expect(s().regionTool).toBe('erase');
    await run('tool.brush');
    expect(s().regionTool).toBe('rect');
  });
});
