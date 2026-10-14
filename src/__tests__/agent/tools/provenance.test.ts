import { describe, it, expect } from 'vitest';
import { makeState, makeExecutor } from '../../_support/map-state';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { runStroke } from '../../../agent/tools/stroke';
import type { AgentToolDeps } from '../../../agent/tools';
import { executeToolCall } from '../../../agent/tools';
import { CommandType, TerrainType, type Command, type GridState } from '../../../core/model/types';
import { getCatalogByCategory } from '../../../state/catalog';
import { ProvSource } from '../../../core/provenance/types';
import { ItemCategory } from '../../../config/catalog/categories';

function deps(state: GridState, exec: CommandExecutor): AgentToolDeps {
  return {
    getState: () => state, getExecutor: () => exec, getRegion: () => [],
    getProvenanceSource: () => ({ provider: 'anthropic', model: 'claude' }),
  };
}

describe('agent provenance', () => {
  it('a write tool taints affected cells as AI', () => {
    const s = makeState(8, 8);
    const e = makeExecutor(s);
    const cmd: Command = { type: CommandType.PaintTerrain, cells: [{ x: 2, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1 } as Command;
    runStroke(deps(s, e), [cmd], () => 'ok');
    const sum = e.getProvenanceSummary();
    expect(sum.containsAi).toBe(true);
    const ledger = s.provenance!.ledger;
    expect(ledger[ledger.length - 1]!.ai?.model).toBe('claude');
  });
});

/**
 * The seven tools whose stroke body is a loop or a populator call go through runStrokeBody,
 * not runStroke. An unsourced write there falls back to ProvSource.Human, which lies twice:
 * the export disclosure tells the recipient a person built the map, and clearGenerated spares
 * the content as hand-placed.
 */
describe('agent provenance (runStrokeBody tools)', () => {
  function setup(w = 20, h = 20) {
    const state = makeState(w, h);
    const exec = makeExecutor(state);
    return { state, exec, deps: deps(state, exec) };
  }

  it('build_road names the AI as the author of every road it lays', async () => {
    const { state, exec, deps: d } = setup();
    const r = await executeToolCall(
      { id: 't1', name: 'build_road', input: { line: { x1: 2, y1: 4, x2: 8, y2: 4 } } },
      d,
    );
    expect(r.isError).toBe(false);
    const ids = [...state.objects.keys()];
    expect(ids.length).toBeGreaterThan(0);
    const tracker = exec.getAuthorship();
    for (const id of ids) expect(tracker.objectAuthor(id)).toBe('ai');
    expect(exec.getProvenanceSummary().containsAi).toBe(true);
  });

  it('scatter_objects names the AI as the author of every item it drops', async () => {
    const { state, exec, deps: d } = setup();
    const floraId = getCatalogByCategory(ItemCategory.Flora)[0]!.id;
    const r = await executeToolCall(
      { id: 't2', name: 'scatter_objects', input: { catalogIds: [floraId], count: 6, rect: { x1: 2, y1: 2, x2: 16, y2: 16 } } },
      d,
    );
    expect(r.isError).toBe(false);
    const ids = [...state.objects.keys()];
    expect(ids.length).toBeGreaterThan(0);
    const tracker = exec.getAuthorship();
    for (const id of ids) expect(tracker.objectAuthor(id)).not.toBe('human');
    for (const id of ids) expect(tracker.objectAuthor(id)).toBe('ai');
  });

  it('plant_forest (a director tool) names the AI as the author of its planting', async () => {
    const { state, exec, deps: d } = setup(30, 30);
    const r = await executeToolCall(
      { id: 't3', name: 'plant_forest', input: { x: 2, y: 2, w: 24, h: 24, density: 0.8, seed: 7 } },
      d,
    );
    expect(r.isError).toBe(false);
    const ids = [...state.objects.keys()];
    expect(ids.length).toBeGreaterThan(0);
    const tracker = exec.getAuthorship();
    for (const id of ids) expect(tracker.objectAuthor(id)).toBe('ai');
  });

  it('a user-approved runStrokeBody write records AiAccepted, matching runStroke', async () => {
    const state = makeState(20, 20);
    const exec = makeExecutor(state);
    const d: AgentToolDeps = {
      getState: () => state, getExecutor: () => exec, getRegion: () => [],
      getProvenanceSource: () => ({ provider: 'anthropic', model: 'claude', userApproved: true }),
    };
    await executeToolCall({ id: 't4', name: 'build_road', input: { line: { x1: 2, y1: 4, x2: 8, y2: 4 } } }, d);
    const ledger = state.provenance!.ledger;
    expect(ledger[ledger.length - 1]!.source).toBe(ProvSource.AiAccepted);
    expect(ledger[ledger.length - 1]!.ai?.model).toBe('claude');
  });
});
