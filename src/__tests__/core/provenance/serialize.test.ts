import { describe, it, expect } from 'vitest';
import { ProvenanceTracker } from '../../../core/provenance/tracker';
import { serializeProvenance, deserializeProvenance } from '../../../core/provenance/serialize';
import { ProvSource } from '../../../core/provenance/types';

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
