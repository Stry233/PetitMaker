/** A painted region per surface that paints one: Generate's scope, the assistant's boundary and a
 *  blueprint's frame. Each reads its own, painting one never discards another, and the map shows the
 *  region of the surface in front. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { frontRegion, paintedRegion, paintsRegion, regionOf, regionOnScreen } from '../../../state/editing/region';
import { toggleAgentRegion } from '../../../editor/editing/region-brush';
import type { MacroCoord } from '../../../core/model/types';

const s = () => useEditorStore.getState();
const SCOPE: MacroCoord[] = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
const MARK: MacroCoord[] = [{ x: 6, y: 6 }];

/** `owner` paints `cells` with the region brush, as one stroke, and puts the brush away. */
function paint(owner: 'agent' | 'generator' | 'blueprint', cells: MacroCoord[], stop = true): void {
  s().setSelectingRegion(true, owner);
  s().commitRegion(cells);
  if (stop) s().setSelectingRegion(false);
}

beforeEach(() => {
  resetStore();
  s().loadMap(makeState(16, 16), createDefaultRegistry());
});

describe('a painted region', () => {
  it('is read only by the surface that painted it, on the map it was painted on', () => {
    paint('generator', SCOPE);
    expect(regionOf(s(), 'generator')).toEqual(SCOPE);
    expect(regionOf(s(), 'agent')).toEqual([]);
    expect(regionOf(s(), 'blueprint')).toEqual([]);
    useEditorStore.setState({ gridState: makeState(16, 16) });
    expect(regionOf(s(), 'generator'), 'another live map reads none').toEqual([]);
  });

  it("never discards another surface's region: each brush starts from its own", () => {
    paint('generator', SCOPE);
    s().setSelectingRegion(true, 'agent');
    expect(paintedRegion(s())).toEqual([]);
    s().commitRegion(MARK);
    s().setSelectingRegion(false);
    paint('blueprint', [{ x: 9, y: 9 }]);
    expect([regionOf(s(), 'generator'), regionOf(s(), 'agent'), regionOf(s(), 'blueprint')]).toEqual([SCOPE, MARK, [{ x: 9, y: 9 }]]);
  });
});

describe("the assistant's region brush", () => {
  it('[ASST-11] ends with a mode click, keeping its region and lane, and the mark button picks it up again', () => {
    paint('agent', MARK, false);
    s().commitRegion([...MARK, { x: 7, y: 6 }]);
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    expect(s().selectingRegion).toBe(false);
    expect(regionOf(s(), 'agent')).toEqual([...MARK, { x: 7, y: 6 }]);
    toggleAgentRegion();
    expect(paintsRegion(s(), 'agent')).toBe(true);
    expect(s().regionUndoLane.length, 'its lane came back with it').toBe(2);
    expect(s().undoRegion()).toBe(true);
    expect(regionOf(s(), 'agent')).toEqual(MARK);
  });

  it("[ASST-11] never ends another surface's step and lights only for its own", () => {
    paint('blueprint', SCOPE, false);
    expect(paintsRegion(s(), 'agent')).toBe(false);
    toggleAgentRegion();
    expect([s().selectingRegion, s().regionSelectionOwner]).toEqual([true, 'blueprint']);
    s().setSelectingRegion(false);
    toggleAgentRegion();
    expect(paintsRegion(s(), 'agent')).toBe(true);
    toggleAgentRegion();
    expect(s().selectingRegion).toBe(false);
  });
});

describe('the region in front', () => {
  it("[EDIT-54] is the one being painted, else Generate's scope in Generate mode, else the assistant's while its panel is open", () => {
    paint('generator', SCOPE);
    paint('agent', MARK);
    paint('blueprint', [{ x: 9, y: 9 }], false);
    expect(frontRegion(s())).toEqual({ owner: 'blueprint', cells: [{ x: 9, y: 9 }] });
    s().setSelectingRegion(false);
    expect(frontRegion(s()), 'a frame left behind, nothing open').toBeNull();
    expect(regionOnScreen(s())).toEqual([]);
    s().setAssistantOpen(true);
    expect(regionOnScreen(s())).toEqual(MARK);
    s().setEditMode({ mode: 'generate' });
    expect(regionOnScreen(s()), 'Generate stands in front of the panel').toEqual(SCOPE);
    s().setEditMode({ mode: 'object' });
    s().setAssistantOpen(false);
    expect(regionOnScreen(s()), "Generate's scope outside Generate mode").toEqual([]);
  });
});
