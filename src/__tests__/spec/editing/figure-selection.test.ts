/** A Help figure's selection follows the editor's own rules: what moving on, a region, a clear and
 *  Undo do to it in a figure's world is what they do to the editor's selection. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { ToolType } from '../../../state/editing/vocabulary';

const TREE = 'tree-apple';

/** A world with one tree, selected by a click of the Hand tool. */
function selectedTree(): { w: SpecWorld; id: string } {
  const w = world();
  const at = w.openGround(4, 4);
  const placed = w.place(TREE, at.x + 1, at.y + 1);
  if (!placed.ok) throw new Error(`the tree was refused: ${placed.refusedBy.join(', ')}`);
  const tree = w.object(placed.id!)!;
  const centre = { x: tree.position.x + 0.5, y: tree.position.y + 0.5 };
  w.sandbox.restart();
  w.sandbox.pressMap(centre);
  w.sandbox.releaseMap(centre);
  expect(w.sandbox.selectedIds()).toEqual([tree.id]);
  return { w, id: tree.id };
}

describe("a Help figure's selection", () => {
  spec('EDIT-25', 'ends when a region selection starts', () => {
    const { w } = selectedTree();
    w.sandbox.selectRegion({ tool: 'rect', show: () => {} });
    expect(w.sandbox.selection).toEqual([]);
  });

  spec('EDIT-25', 'ends when an item card is armed, though the placer holds a selection', () => {
    const { w } = selectedTree();
    w.sandbox.pick({ tool: ToolType.ObjectPlacer, armedItem: TREE, picks: [TREE] });
    expect(w.sandbox.selection).toEqual([]);
  });

  spec('EDIT-71', 'cleared by Escape comes back with Undo, the map untouched', () => {
    const { w, id } = selectedTree();
    w.sandbox.clearSelection();
    expect(w.sandbox.selection).toEqual([]);
    expect(w.undo()).toBe(true);
    expect(w.object(id), 'the tree still stands').toBeDefined();
    expect(w.sandbox.selectedIds()).toEqual([id]);
  });
});
