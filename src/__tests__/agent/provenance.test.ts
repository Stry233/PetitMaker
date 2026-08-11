import { describe, it, expect } from 'vitest';
import { makeState } from '../rules/_helpers';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { runStroke, type AgentToolDeps } from '../../agent/tools/tools-common';
import { executeToolCall } from '../../agent/tools';
import { CommandType, ItemCategory, TerrainType, type Command, type GridState } from '../../core/model/types';
import { getCatalogByCategory } from '../../state/catalog';
import { roadLookup } from '../../state/object-index';
import { ProvSource } from '../../core/provenance/types';

function deps(state: GridState, exec: CommandExecutor): AgentToolDeps {
  return {
    getState: () => state, getExecutor: () => exec, getRegion: () => [],
    getProvenanceSource: () => ({ provider: 'anthropic', model: 'claude' }),
  };
}

describe('agent provenance', () => {
  it('a write tool taints affected cells as AI', () => {
    const s = makeState(8, 8);
    const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry(), roadLookup(s));
    const cmd: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 2, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1 } as Command;
    runStroke(deps(s, e), [cmd], () => 'ok');
    const sum = e.getProvenanceSummary();
    expect(sum.containsAi).toBe(true);
    const ledger = e.getProvenanceTracker().state.ledger;
    expect(ledger[ledger.length - 1]!.ai?.model).toBe('claude');
  });

  // NOTE: the analysis-only ("noteAnalysisOnly does not taint") case is covered by
  // core/provenance/executor-provenance.test.ts ('analysis-only never taints content') —
  // it exercised only the executor directly (no agent path), so it lived there. Kept the
  // AI-taint case above, which is the genuinely agent-specific coverage (runStroke path).
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
    const exec = new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));
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
    const tracker = exec.getProvenanceTracker();
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
    const tracker = exec.getProvenanceTracker();
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
    const tracker = exec.getProvenanceTracker();
    for (const id of ids) expect(tracker.objectAuthor(id)).toBe('ai');
  });

  it('a user-approved runStrokeBody write records AiAccepted, matching runStroke', async () => {
    const state = makeState(20, 20);
    const exec = new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));
    const d: AgentToolDeps = {
      getState: () => state, getExecutor: () => exec, getRegion: () => [],
      getProvenanceSource: () => ({ provider: 'anthropic', model: 'claude', userApproved: true }),
    };
    await executeToolCall({ id: 't4', name: 'build_road', input: { line: { x1: 2, y1: 4, x2: 8, y2: 4 } } }, d);
    const ledger = exec.getProvenanceTracker().state.ledger;
    expect(ledger[ledger.length - 1]!.source).toBe(ProvSource.AiAccepted);
    expect(ledger[ledger.length - 1]!.ai?.model).toBe('claude');
  });
});
