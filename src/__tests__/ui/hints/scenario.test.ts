import { describe, expect, it } from 'vitest';
import { ToolType } from '../../../core/model/types';
import { resolveHintScenario, type HintFacts } from '../../../ui/hints/scenario';

const base: HintFacts = {
  canOrbit: false, activeTool: ToolType.Hand, designMode: 'hand', selectionCount: 0,
  singleKind: null, armedItemId: null, armedSpans: false, curveSessionOpen: false,
  selectingRegion: false,
};

describe('resolveHintScenario', () => {
  it("resolves the base views by the active view's orbit capability", () => {
    expect(resolveHintScenario(base)).toBe('map-2d');
    expect(resolveHintScenario({ ...base, canOrbit: true })).toBe('map-3d');
  });

  it('an open curve session outranks everything', () => {
    expect(resolveHintScenario({ ...base, curveSessionOpen: true, selectingRegion: true, selectionCount: 3 })).toBe('curve-adjust');
  });

  it('curve draw is the curve mode of the terrain brush', () => {
    expect(resolveHintScenario({ ...base, activeTool: ToolType.TerrainBrush, designMode: 'curve' })).toBe('curve-draw');
  });

  it('region select outranks tools and selection', () => {
    expect(resolveHintScenario({ ...base, selectingRegion: true, activeTool: ToolType.TerrainBrush, designMode: 'brush' })).toBe('region');
  });

  it('an armed item resolves the placer, span traits its own scenario', () => {
    const armed = { ...base, activeTool: ToolType.ObjectPlacer, armedItemId: 'house-1' };
    expect(resolveHintScenario(armed)).toBe('placer');
    expect(resolveHintScenario({ ...armed, armedSpans: true })).toBe('span-placer');
  });

  it('the placer with nothing armed is selection ground', () => {
    expect(resolveHintScenario({ ...base, activeTool: ToolType.ObjectPlacer })).toBe('map-2d');
  });

  it('selection splits singular and plural and outranks brush tools', () => {
    expect(resolveHintScenario({ ...base, selectionCount: 1, singleKind: 'object' })).toBe('selection-one');
    expect(resolveHintScenario({ ...base, selectionCount: 2, activeTool: ToolType.Eraser, designMode: 'eraser' })).toBe('selection-many');
  });

  // A single selection is only worth its own rows when they describe what that thing can do.
  it('the one selected thing decides which selection rows it gets', () => {
    expect(resolveHintScenario({ ...base, selectionCount: 1, singleKind: 'terrain' })).toBe('selection-terrain');
    expect(resolveHintScenario({ ...base, selectionCount: 1, singleKind: 'object' })).toBe('selection-one');
  });

  // Nothing the selection rows offer applies to a locked object or to bare ground, so the tool the
  // user is holding keeps the panel.
  it('an inert single selection falls through to the tool underneath', () => {
    expect(resolveHintScenario({ ...base, selectionCount: 1, singleKind: 'inert' })).toBe('map-2d');
    expect(resolveHintScenario({
      ...base, selectionCount: 1, singleKind: 'inert', activeTool: ToolType.Eraser, designMode: 'eraser',
    })).toBe('eraser');
  });

  it('brush tools resolve by tool, all four shapes to build', () => {
    expect(resolveHintScenario({ ...base, activeTool: ToolType.Eraser, designMode: 'eraser' })).toBe('eraser');
    expect(resolveHintScenario({ ...base, activeTool: ToolType.EdgeCut, designMode: 'edge-cut' })).toBe('edge-cut');
    for (const mode of ['brush', 'line', 'rect', 'circle'] as const) {
      expect(resolveHintScenario({ ...base, activeTool: ToolType.TerrainBrush, designMode: mode })).toBe('build');
    }
  });
});
