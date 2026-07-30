import { describe, it, expect } from 'vitest';
import { makeState } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { CommandType, TerrainType, type Command, type GridState } from '../../../core/model/types';
import { ProvSource } from '../../../core/provenance/types';

function exec(state: GridState) { return new CommandExecutor(state, new EventBus(), createDefaultRegistry()); }
function paint(x: number, y: number): Command {
  return { type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1 } as Command;
}

describe('executor provenance capture', () => {
  it('human paint taints the cell as human, not AI', () => {
    const s = makeState(8, 8); const e = exec(s);
    const start = e.getUndoStackSize();
    e.execute(paint(2, 2)); e.commitStroke(start);
    expect(s.provenance!.cellTaint[2]![2]!.contribution.human).toBe(1);
    expect(e.getProvenanceSummary().containsAi).toBe(false);
  });

  it('AI source paint taints the cell as AI', () => {
    const s = makeState(8, 8); const e = exec(s);
    const start = e.getUndoStackSize();
    e.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => e.execute(paint(3, 3)));
    e.commitStroke(start);
    expect(e.getProvenanceSummary().containsAi).toBe(true);
    expect(s.provenance!.cellTaint[3]![3]!.contribution.ai).toBe(1);
  });

  it('undo removes phantom taint; redo restores it', () => {
    const s = makeState(8, 8); const e = exec(s);
    const start = e.getUndoStackSize();
    e.withSource({ source: ProvSource.AiWrite }, () => e.execute(paint(4, 4)));
    e.commitStroke(start);
    expect(e.getProvenanceSummary().containsAi).toBe(true);
    e.undo();
    expect(e.getProvenanceSummary().containsAi).toBe(false);
    e.redo();
    expect(e.getProvenanceSummary().containsAi).toBe(true);
  });

  it('analysis-only never taints content', () => {
    const s = makeState(4, 4); const e = exec(s);
    e.noteAnalysisOnly();
    expect(e.getProvenanceSummary().containsAi).toBe(false);
    expect(e.getProvenanceSummary().counts.analysisOnlyCalls).toBe(1);
  });
});
