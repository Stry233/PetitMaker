import { describe, it, expect } from 'vitest';
import { makeState } from '../rules/_helpers';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { runStroke, type AgentToolDeps } from '../../agent/tools/tools-common';
import { CommandType, TerrainType, type Command, type GridState } from '../../core/model/types';

function deps(state: GridState, exec: CommandExecutor): AgentToolDeps {
  return {
    getState: () => state, getExecutor: () => exec, getRegion: () => [],
    getProvenanceSource: () => ({ provider: 'anthropic', model: 'claude' }),
  };
}

describe('agent provenance', () => {
  it('a write tool taints affected cells as AI', () => {
    const s = makeState(8, 8);
    const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry());
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
