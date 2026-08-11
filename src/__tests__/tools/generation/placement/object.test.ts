import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules/index';
import { makeState } from '../../../rules/_helpers';
import { getCatalogByCategory } from '../../../../state/catalog';
import { makeCtx, tryDecorate, tryPlace, enforceClearance } from '../../../../tools/generation/placement/object';
import { ItemCategory, TerrainType, type EditorEvents } from '../../../../core/model/types';
import { roadLookup } from '../../../../state/object-index';

const floraId = getCatalogByCategory(ItemCategory.Flora)[0]!.id;
const roadId = getCatalogByCategory(ItemCategory.Road)[0]!.id;

function ctxFor(size = 12) {
  const state = makeState(size, size);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, ctx: makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), 42) };
}

describe('placement/object', () => {
  it('places flora on flat grass and returns the object it put on the map', () => {
    const { state, ctx } = ctxFor();
    const placed = tryPlace(ctx, floraId, 5, 5);
    expect(state.objects.size).toBe(1);
    expect([...state.objects.values()][0]!.id).toBe(placed?.id);
  });
  it('returns null + places nothing when the rule rejects (water under a flat item)', () => {
    const { state, ctx } = ctxFor();
    state.cells[5]![5]!.terrain = { type: TerrainType.Water, elevation: 0 };
    expect(tryPlace(ctx, floraId, 5, 5)).toBeNull();
    expect(state.objects.size).toBe(0);
  });

  describe('a decoration never stands inside the street', () => {
    it('refuses a median cell between two parallel road strips (2 paved sides)', () => {
      const { state, ctx } = ctxFor();
      expect(tryPlace(ctx, roadId, 4, 5)).toBeTruthy();
      expect(tryPlace(ctx, roadId, 6, 5)).toBeTruthy();
      // (5,5) is bare ground with pavement on both its left and right edges — a median.
      expect(tryDecorate(ctx, floraId, 5, 5)).toBeNull();
      expect(state.objects.size).toBe(2);
    });

    it('refuses a pocket a looped road encloses on all four sides', () => {
      const { state, ctx } = ctxFor();
      for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]] as const) {
        expect(tryPlace(ctx, roadId, x, y), `road@${x},${y}`).toBeTruthy();
      }
      expect(tryDecorate(ctx, floraId, 5, 5)).toBeNull();
      expect(state.objects.size).toBe(8);
    });

    it('still plants a curb-adjacent cell with exactly one paved side', () => {
      const { state, ctx } = ctxFor();
      expect(tryPlace(ctx, roadId, 5, 5)).toBeTruthy();
      // (5,4) touches pavement on ONE side only — beside the road, not inside it.
      expect(tryDecorate(ctx, floraId, 5, 4)).toBeTruthy();
      expect(state.objects.size).toBe(2);
    });

    it('enforceClearance sweeps a decoration a later road loop grows around', () => {
      const { state, ctx } = ctxFor();
      expect(tryDecorate(ctx, floraId, 5, 5)).toBeTruthy();
      for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]] as const) {
        expect(tryPlace(ctx, roadId, x, y), `road@${x},${y}`).toBeTruthy();
      }
      expect(state.objects.size).toBe(9); // flora + 8 road tiles, still standing
      enforceClearance(ctx);
      expect(state.objects.size).toBe(8); // flora swept out of the now-enclosed pocket
    });
  });
});
