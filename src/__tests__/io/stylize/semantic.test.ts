// The experimental segmentation image: flat legend colors over the SAME letterbox frame the map
// capture lands in, so a layout-conditioned generation call sees the two images agree pixel for
// pixel on where everything is.
import { describe, it, expect, vi } from 'vitest';
import { LEGEND, renderSemanticLayout } from '../../../io/stylize/control/semantic';
import { planNormalize, type NormalizePlan } from '../../../io/stylize/normalize';
import { TerrainType, ItemCategory, type GridState } from '../../../core/model/types';
import { makeState, setTerrain } from '../../rules/_helpers';
import { getCatalogByCategory } from '../../../state/catalog';

interface FillCall { color: string; x: number; y: number; w: number; h: number }

function spyFillRects(): { rects: FillCall[]; restore: () => void } {
  const rects: FillCall[] = [];
  const ctx = {
    fillStyle: '',
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      rects.push({ color: this.fillStyle, x, y, w, h });
    },
  };
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { rects, restore: () => spy.mockRestore() };
}

const buildingId = getCatalogByCategory(ItemCategory.Building)[0]!.id;
const roadId = getCatalogByCategory(ItemCategory.Road)[0]!.id;
const treeId = getCatalogByCategory(ItemCategory.Tree)[0]!.id;
const bridgeId = getCatalogByCategory(ItemCategory.Bridge)[0]!.id;

describe('renderSemanticLayout', () => {
  it('fills water and building at their plan-mapped rects in the legend colors', () => {
    const state = makeState(2, 1);
    setTerrain(state, 0, 0, TerrainType.Water, 0);
    state.objects.set('b1', {
      id: 'b1', catalogId: buildingId, position: { x: 1, y: 0 }, rotation: 0, elevation: 0,
      width: 1, height: 1,
    });

    // A 2x1 template captured 1:1 into a matching 2:1 frame: no letterbox, one cell = 100x100.
    const plan = planNormalize(200, 100, 200, [{ id: '2:1', ratio: 2 }]);
    expect(plan).toEqual<NormalizePlan>({
      frameW: 200, frameH: 100, drawW: 200, drawH: 100, offsetX: 0, offsetY: 0, aspectId: '2:1',
    });

    const { rects, restore } = spyFillRects();
    const canvas = renderSemanticLayout(state, plan);
    restore();

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);

    const scaleX = plan.drawW / state.template.width;
    const scaleY = plan.drawH / state.template.height;
    const waterRect = { color: LEGEND.water, x: plan.offsetX + 0 * scaleX, y: plan.offsetY + 0 * scaleY, w: scaleX, h: scaleY };
    const buildingRect = { color: LEGEND.building, x: plan.offsetX + 1 * scaleX, y: plan.offsetY + 0 * scaleY, w: scaleX, h: scaleY };

    expect(rects).toContainEqual(waterRect);
    expect(rects).toContainEqual(buildingRect);
  });

  it('paints the whole frame (letterbox bars included) as ground before anything else', () => {
    const state = makeState(1, 1);
    // Force a horizontal letterbox: a square source into a forced 2:1 frame.
    const plan = planNormalize(100, 100, 100, [{ id: '2:1', ratio: 2 }]);
    expect(plan.offsetX).toBeGreaterThan(0);

    const { rects, restore } = spyFillRects();
    renderSemanticLayout(state, plan);
    restore();

    expect(rects[0]).toEqual({ color: LEGEND.ground, x: 0, y: 0, w: plan.frameW, h: plan.frameH });
  });

  it('fills road, plant and bridge footprints by catalog category', () => {
    const state = makeState(3, 1);
    state.objects.set('r1', { id: 'r1', catalogId: roadId, position: { x: 0, y: 0 }, rotation: 0, elevation: 0, width: 1, height: 1 });
    state.objects.set('t1', { id: 't1', catalogId: treeId, position: { x: 1, y: 0 }, rotation: 0, elevation: 0, width: 1, height: 1 });
    state.objects.set('br1', { id: 'br1', catalogId: bridgeId, position: { x: 2, y: 0 }, rotation: 0, elevation: 0, width: 1, height: 1 });

    const plan = planNormalize(300, 100, 300, [{ id: '3:1', ratio: 3 }]);
    const { rects, restore } = spyFillRects();
    renderSemanticLayout(state, plan);
    restore();

    const colors = rects.map((r) => r.color);
    expect(colors).toContain(LEGEND.road);
    expect(colors).toContain(LEGEND.plant);
    expect(colors).toContain(LEGEND.bridge);
  });

  it('never draws borders or text (no strokeRect/fillText calls)', () => {
    const state = makeState(1, 1) as GridState;
    const plan = planNormalize(100, 100, 100, [{ id: '1:1', ratio: 1 }]);
    const strokeRect = vi.fn();
    const fillText = vi.fn();
    const ctx = { fillStyle: '', fillRect: vi.fn(), strokeRect, fillText };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    renderSemanticLayout(state, plan);
    spy.mockRestore();
    expect(strokeRect).not.toHaveBeenCalled();
    expect(fillText).not.toHaveBeenCalled();
  });
});
