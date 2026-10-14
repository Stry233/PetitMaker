/** What each tool declares about itself: which modes select, which hold a selection, which brush. */
import { describe, it, expect } from 'vitest';
import { createTools, toolDeclares } from '../../../../tools/pointer/runtime/tool-set';
import type { ToolArming } from '../../../../state/editing/arming';
import { ToolType } from '../../../../state/editing/vocabulary';

const armed = (armedItem: string | null) => ({ armedItem }) as ToolArming;
const selectMode = (type: ToolType, item: string | null) => toolDeclares(type).selectMode(armed(item));

describe('the two selection-mode gates', () => {
  it('separates "a click selects" from "a selection can exist"', () => {
    // They differ on exactly one state: an armed placer, where a plain click places but Ctrl-click
    // (and a click on an existing object) still selects.
    expect(selectMode(ToolType.Hand, null)).toBe(true);
    expect(selectMode(ToolType.ObjectPlacer, null)).toBe(true);
    expect(selectMode(ToolType.ObjectPlacer, 'tree-apple')).toBe(false);
    expect(selectMode(ToolType.TerrainBrush, null)).toBe(false);

    const holds = Object.values(ToolType).filter((t) => toolDeclares(t).holdsSelection);
    expect(holds.sort()).toEqual([ToolType.Hand, ToolType.ObjectPlacer].sort());
  });

  it('names exactly the terrain brushes: the build brush, the eraser and the edge cutter', () => {
    const brushes = Object.values(ToolType).filter((t) => toolDeclares(t).brush);
    expect(brushes.sort()).toEqual([ToolType.TerrainBrush, ToolType.Eraser, ToolType.EdgeCut].sort());
  });

  it('registers one tool per type, the Hand tool first', () => {
    const ids = createTools().map((t) => t.id);
    expect(ids[0]).toBe(ToolType.Hand);
    expect([...ids].sort()).toEqual(Object.values(ToolType).sort());
  });
});
