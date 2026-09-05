import { describe, it, expect } from 'vitest';
import { ProvenanceTracker } from '../../../core/provenance/tracker';
import { serializeProvenance, deserializeProvenance } from '../../../core/provenance/serialize';
import { hasFlag, ProvSource, TaintFlag } from '../../../core/provenance/types';

describe('provenance serialize', () => {
  it('round-trips ledger + cell taint', () => {
    const t = new ProvenanceTracker(4, 4, { now: () => 0 });
    t.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => t.record('create', [{ x: 1, y: 2 }], [], { layers: [1], zones: [2] }));
    const ser = serializeProvenance(t.state);
    const restored = deserializeProvenance(ser, 4, 4);
    expect(restored.ledger.length).toBe(1);
    expect(restored.cellTaint[2]![1]!.contribution.ai).toBe(1);
    expect(restored.cellTaint[1]?.[2] ?? null).toBeNull();
    expect(restored.ledger[0]!.ai?.model).toBe('m');
  });
  it('deserialize(undefined) yields empty state', () => {
    const r = deserializeProvenance(undefined, 2, 2);
    expect(r.ledger).toEqual([]);
    expect(r.cellTaint[0]![0]).toBeNull();
  });
});

describe('the wire record is untrusted', () => {
  it('a forged origin reads Unknown and an out-of-range contribution clamps', () => {
    const raw = {
      v: 1 as const, ledger: [], session: {
        aiAnalysisUsed: false, aiWritesUsed: false, aiAcceptedCount: 0,
        proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: false, aiAfterHuman: false,
      },
      cells: [{ k: '1,1', t: { createdByOp: 'op-1', lastModifiedByOp: 'op-1', origin: 'totally-real-human' as never, contribution: { ai: 99, human: -3, procedural: 0.5 }, flags: 0 } }],
      objects: [{ id: 'o1', t: { createdByOp: 'op-1', lastModifiedByOp: 'op-1', origin: 'ai-write' as never, contribution: { ai: 1, human: 0, procedural: 0 }, flags: 0 } }],
    };
    const st = deserializeProvenance(raw as never, 4, 4);
    const cell = st.cellTaint[1]![1]!;
    expect(cell.origin).toBe(ProvSource.Unknown);
    expect(cell.contribution.ai).toBe(0);
    expect(cell.contribution.human).toBe(0);
    // Cleared flags cannot hide an AI contribution the vector still carries.
    const obj = st.objectTaint.get('o1')!;
    expect(hasFlag(obj.flags, TaintFlag.CONTAINS_AI)).toBe(true);
  });
});

