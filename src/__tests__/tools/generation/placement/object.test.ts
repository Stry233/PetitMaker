import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules/index';
import { makeState } from '../../../rules/_helpers';
import { getCatalogByCategory } from '../../../../state/catalog';
import { makeCtx, tryPlace } from '../../../../tools/generation/placement/object';
import { ItemCategory, TerrainType, type EditorEvents } from '../../../../core/model/types';

const floraId = getCatalogByCategory(ItemCategory.Flora)[0]!.id;

function ctxFor(size = 12) {
  const state = makeState(size, size);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  return { state, ctx: makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), 42) };
}

describe('placement/object', () => {
  it('places flora on flat grass and returns the object with a deterministic id', () => {
    const { state, ctx } = ctxFor();
    const placed = tryPlace(ctx, floraId, 5, 5);
    expect(placed?.id).toBe('gen-42-0');
    expect(state.objects.size).toBe(1);
    expect([...state.objects.values()][0]!.id).toBe('gen-42-0');
  });
  it('returns null + places nothing when the rule rejects (water under a flat item)', () => {
    const { state, ctx } = ctxFor();
    state.cells[5]![5]!.terrain = { type: TerrainType.Water, elevation: 0 };
    expect(tryPlace(ctx, floraId, 5, 5)).toBeNull();
    expect(state.objects.size).toBe(0);
  });
});
