import { describe, it, expect } from 'vitest';
import { makeState } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { CommandType, TerrainType, type Command, type GridState, type PlacedObject } from '../../../core/model/types';
import { ProvSource } from '../../../core/provenance/types';
import { roadLookup } from '../../../state/object-index';

function exec(state: GridState) { return new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state)); }
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

describe('a moved object keeps its author', () => {
  const flora = (id: string, x: number, y: number): PlacedObject =>
    ({ id, catalogId: 'flower-red', position: { x, y }, rotation: 0, elevation: 0 });
  const place = (o: PlacedObject): Command => ({ type: CommandType.PlaceObject, timestamp: 0, object: o, loadValue: 0 } as Command);
  const remove = (o: PlacedObject): Command => ({ type: CommandType.RemoveObject, timestamp: 0, objectId: o.id, removedObject: o } as Command);

  it('a human drag of an AI planting does not launder it into human work', () => {
    const s = makeState(8, 8); const e = exec(s);
    e.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => e.execute(place(flora('f1', 2, 2))));
    expect(s.provenance!.objectTaint.get('f1')!.contribution.ai).toBe(1);
    // The move gesture: RemoveObject then PlaceObject under the SAME id, human context.
    e.execute(remove(flora('f1', 2, 2)));
    e.execute(place(flora('f1', 4, 4)));
    const t = s.provenance!.objectTaint.get('f1')!;
    expect(t.contribution.ai).toBe(1);
    expect(t.contribution.human).toBe(0);
    expect(e.getProvenanceSummary().containsAi).toBe(true);
  });

  it('an AI drag of human work reads as modified, not re-authored', () => {
    const s = makeState(8, 8); const e = exec(s);
    e.execute(place(flora('f2', 2, 2)));
    e.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => {
      e.execute(remove(flora('f2', 2, 2)));
      e.execute(place(flora('f2', 5, 5)));
    });
    const t = s.provenance!.objectTaint.get('f2')!;
    expect(t.contribution.human).toBe(1);
    expect(t.contribution.ai).toBe(0);
  });

  it('undo of a move restores the pre-move taint exactly', () => {
    const s = makeState(8, 8); const e = exec(s);
    const start = e.getUndoStackSize();
    e.withSource({ source: ProvSource.AiWrite }, () => e.execute(place(flora('f3', 2, 2))));
    e.commitStroke(start);
    const moveStart = e.getUndoStackSize();
    e.execute(remove(flora('f3', 2, 2)));
    e.execute(place(flora('f3', 6, 6)));
    e.commitStroke(moveStart);
    e.undo();
    const t = s.provenance!.objectTaint.get('f3')!;
    expect(t.contribution.ai).toBe(1);
    expect(s.objects.get('f3')!.position.x).toBe(2);
  });

  it('a refused move re-places the original and keeps its taint', () => {
    const s = makeState(8, 8); const e = exec(s);
    e.withSource({ source: ProvSource.AiWrite }, () => e.execute(place(flora('f4', 2, 2))));
    // The tools roll a refused drop back by re-placing the original at its old spot.
    e.execute(remove(flora('f4', 2, 2)));
    e.execute(place(flora('f4', 2, 2)));
    expect(s.provenance!.objectTaint.get('f4')!.contribution.ai).toBe(1);
  });

  it('a genuine delete then a NEW object is fresh authorship, not a carried one', () => {
    const s = makeState(8, 8); const e = exec(s);
    e.withSource({ source: ProvSource.AiWrite }, () => e.execute(place(flora('f5', 2, 2))));
    e.execute(remove(flora('f5', 2, 2)));
    e.execute(place(flora('f6', 2, 2)));
    expect(s.provenance!.objectTaint.get('f5')).toBeUndefined();
    expect(s.provenance!.objectTaint.get('f6')!.contribution.human).toBe(1);
  });
});

describe('repaints that change nothing re-author nothing', () => {
  it('an AI drag across standing human terrain with identical content leaves it human', () => {
    const s = makeState(8, 8); const e = exec(s);
    e.execute(paint(2, 2));
    expect(s.provenance!.cellTaint[2]![2]!.contribution.human).toBe(1);
    // The water-brush idiom: the same cell repainted with the SAME content, now under AI.
    e.withSource({ source: ProvSource.AiWrite }, () => e.execute(paint(2, 2)));
    const t = s.provenance!.cellTaint[2]![2]!;
    expect(t.contribution.human).toBe(1);
    expect(t.contribution.ai).toBe(0);
  });

  it('a repaint that DOES change the cell re-authors it', () => {
    const s = makeState(8, 8); const e = exec(s);
    e.execute(paint(3, 3));
    e.withSource({ source: ProvSource.AiWrite }, () => e.execute({
      type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 3, y: 3 }],
      terrainType: TerrainType.Mountain, elevation: 2,
    } as Command));
    expect(s.provenance!.cellTaint[3]![3]!.contribution.ai).toBe(1);
  });
});

