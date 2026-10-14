/** The layer panel's highlight under a mountain dab names the layer the dab's plan lands on. */
import { describe, expect, it, vi } from 'vitest';
import { TerrainType } from '../../../../core/model/types';
import { showDabLayer } from '../../../../tools/pointer/paint/display-layer';
import { planPaint } from '../../../../tools/pointer/paint/paint-plan';
import { FRESH_STROKE } from '../../../../tools/pointer/paint/stroke-preview';
import { makeExecutor, makeState, setTerrain } from '../../../_support/map-state';
import { makeToolCtx } from '../../../_support/tool-ctx';

function highlightAndPlan(type: TerrainType, elevation: number, floor: number, patch?: { base: number }) {
  const state = makeState(8, 8);
  setTerrain(state, 3, 3, type, elevation);
  if (patch) Object.assign(state.cells[3]![3]!.terrain!, { patchOnly: true, patchBase: patch.base });
  const setDisplayLayer = vi.fn();
  const ctx = makeToolCtx(state, makeExecutor(state), 1, floor, { contentType: 'mountain', setDisplayLayer });
  showDabLayer({ x: 3, y: 3 }, ctx);
  const plan = planPaint([{ x: 3, y: 3 }], ctx, 'mountain', FRESH_STROKE);
  const landed = Math.max(...plan.commands.map((c) => ('elevation' in c ? c.elevation : 0)));
  return { shown: setDisplayLayer.mock.calls.at(-1)![0] as number, landed };
}

describe('the dab highlight', () => {
  it('shows the layer mountain painted over water converts it to, not one above', () => {
    const { shown, landed } = highlightAndPlan(TerrainType.Water, 2, 1);
    expect(landed).toBe(2);
    expect(shown).toBe(landed);
  });

  it('reads a fillet patch at the surface it stands on', () => {
    const { shown, landed } = highlightAndPlan(TerrainType.Mountain, 2, 1, { base: 1 });
    expect(shown).toBe(landed);
  });

  it('still shows the stack one above an ordinary mountain', () => {
    const { shown, landed } = highlightAndPlan(TerrainType.Mountain, 2, 1);
    expect(landed).toBe(3);
    expect(shown).toBe(3);
  });
});
