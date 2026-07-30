// src/__tests__/core/provenance/tracker.test.ts
import { describe, it, expect } from 'vitest';
import { ProvenanceTracker } from '../../../core/provenance/tracker';
import { ProvSource } from '../../../core/provenance/types';

function tracker() { return new ProvenanceTracker(4, 4, { now: () => 0 }); }

describe('ProvenanceTracker', () => {
  it('records an AI create and taints the cell', () => {
    const t = tracker();
    t.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => {
      t.record('create', [{ x: 1, y: 1 }], [], { layers: [2], zones: [2] });
    });
    expect(t.getSummary().containsAi).toBe(true);
    expect(t.state.cellTaint[1]![1]!.contribution.ai).toBe(1);
    expect(t.state.ledger.length).toBe(1);
    expect(t.state.ledger[0]!.ai?.model).toBe('m');
  });

  it('undo via applyDelta(before) removes phantom taint', () => {
    const t = tracker();
    let delta!: ReturnType<ProvenanceTracker['record']>;
    t.withSource({ source: ProvSource.AiWrite }, () => {
      delta = t.record('create', [{ x: 0, y: 0 }], [], { layers: [1], zones: [2] });
    });
    expect(t.getSummary().containsAi).toBe(true);
    t.applyDelta(delta, 'before');
    expect(t.state.cellTaint[0]![0]).toBeNull();
    expect(t.getSummary().containsAi).toBe(false);
    expect(t.getSummary().aiEverUsed).toBe(true); // ledger remembers
  });

  it('analysis-only never taints but is recorded', () => {
    const t = tracker();
    t.noteAnalysisOnly();
    expect(t.getSummary().containsAi).toBe(false);
    expect(t.getSummary().counts.analysisOnlyCalls).toBe(1);
  });

  it('derived auto-trim inherits the active source', () => {
    const t = tracker();
    t.withSource({ source: ProvSource.AiWrite }, () => {
      t.record('create', [{ x: 2, y: 2 }], [], { layers: [1], zones: [2] });
      t.record('cosmetic', [{ x: 2, y: 2 }], [], { layers: [1], zones: [2], derived: true });
    });
    const last = t.state.ledger[t.state.ledger.length - 1]!;
    expect(last.derived).toBe(true);
    expect(t.state.cellTaint[2]![2]!.contribution.ai).toBeGreaterThan(0);
  });

  it('markReverted / markApplied flip ledger op status', () => {
    const t = tracker();
    let d!: ReturnType<ProvenanceTracker['record']>;
    t.withSource({ source: ProvSource.Human }, () => { d = t.record('create', [{ x: 3, y: 3 }], [], { layers: [1], zones: [2] }); });
    t.markReverted(d.opIds);
    expect(t.state.ledger[0]!.status).toBe('reverted');
    t.markApplied(d.opIds);
    expect(t.state.ledger[0]!.status).toBe('applied');
  });

  it('adopt reuses a restored state and resumes the op counter', () => {
    const t = tracker();
    t.withSource({ source: ProvSource.Human }, () => t.record('create', [{ x: 0, y: 0 }], [], { layers: [1], zones: [2] }));
    const t2 = new ProvenanceTracker(4, 4, { now: () => 0, adopt: t.state });
    let d!: ReturnType<ProvenanceTracker['record']>;
    t2.withSource({ source: ProvSource.Human }, () => { d = t2.record('create', [{ x: 1, y: 1 }], [], { layers: [1], zones: [2] }); });
    expect(d.opIds[0]).toBe('op-2'); // counter resumed past op-1
  });

  it('mergeDeltas keeps first-before and last-after per cell', () => {
    const t = tracker();
    let d1!: ReturnType<ProvenanceTracker['record']>, d2!: ReturnType<ProvenanceTracker['record']>;
    t.withSource({ source: ProvSource.Human }, () => {
      d1 = t.record('create', [{ x: 0, y: 0 }], [], { layers: [1], zones: [2] });
      d2 = t.record('cosmetic', [{ x: 0, y: 0 }], [], { layers: [1], zones: [2] });
    });
    const merged = t.mergeDeltas([d1, d2]);
    const cell = merged.cells.find((c) => c.x === 0 && c.y === 0)!;
    expect(cell.before).toBeNull();                 // first-before = original empty
    expect(cell.after!.lastModifiedByOp).toBe(d2.opIds[0]); // last-after = latest op
    expect(merged.opIds).toEqual([...d1.opIds, ...d2.opIds]);
  });

  it('finalizeObjectModifies preserves AI when a human moves an AI-placed object', () => {
    const t = tracker();
    t.withSource({ source: ProvSource.AiWrite }, () => t.record('create', [], [{ id: 'o1', kind: 'create' }], { layers: [], zones: [] }));
    // human "move" = remove + re-add the SAME id within one stroke
    let dr!: ReturnType<ProvenanceTracker['record']>, da!: ReturnType<ProvenanceTracker['record']>;
    t.withSource({ source: ProvSource.Human }, () => {
      dr = t.record('delete', [], [{ id: 'o1', kind: 'delete' }], { layers: [], zones: [] });
      da = t.record('create', [], [{ id: 'o1', kind: 'create' }], { layers: [], zones: [] });
    });
    t.finalizeObjectModifies(t.mergeDeltas([dr, da]));
    const o = t.state.objectTaint.get('o1')!;
    expect(o.contribution.ai).toBeGreaterThan(0);    // AI preserved
    expect(o.contribution.human).toBeGreaterThan(0); // human edit recorded -> mixed
  });
});
