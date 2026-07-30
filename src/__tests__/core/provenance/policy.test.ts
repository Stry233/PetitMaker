// src/__tests__/core/provenance/policy.test.ts
import { describe, it, expect } from 'vitest';
import { applyOpToTaint, deriveSummary, PROVENANCE_POLICY } from '../../../core/provenance/policy';
import { ProvSource, TaintFlag, hasFlag, type UnitTaint, type SessionFlags } from '../../../core/provenance/types';

describe('PROVENANCE_POLICY', () => {
  it('exports numeric constants', () => {
    expect(typeof PROVENANCE_POLICY.COSMETIC_WEIGHT).toBe('number');
    expect(typeof PROVENANCE_POLICY.AI_EPSILON).toBe('number');
  });
  it('has mandated constant values', () => {
    expect(PROVENANCE_POLICY.COSMETIC_WEIGHT).toBe(0.35);
    expect(PROVENANCE_POLICY.AI_EPSILON).toBe(0.001);
  });
});

describe('policy.applyOpToTaint', () => {
  it('create by AI → full AI contribution + CONTAINS_AI', () => {
    const t = applyOpToTaint(null, ProvSource.AiWrite, 'create', 'op-1')!;
    expect(t.contribution.ai).toBe(1);
    expect(hasFlag(t.flags, TaintFlag.CONTAINS_AI)).toBe(true);
  });
  it('human cosmetic over AI reduces but keeps AI, sets HUMAN_AFTER_AI', () => {
    const ai = applyOpToTaint(null, ProvSource.AiWrite, 'create', 'op-1')!;
    const edited = applyOpToTaint(ai, ProvSource.Human, 'cosmetic', 'op-2')!;
    expect(edited.contribution.ai).toBeGreaterThan(0);
    expect(edited.contribution.ai).toBeLessThan(1);
    expect(edited.contribution.human).toBeGreaterThan(0);
    expect(hasFlag(edited.flags, TaintFlag.HUMAN_AFTER_AI)).toBe(true);
    expect(hasFlag(edited.flags, TaintFlag.CONTAINS_AI)).toBe(true);
  });
  it('human full replace over AI clears CONTAINS_AI', () => {
    const ai = applyOpToTaint(null, ProvSource.AiWrite, 'create', 'op-1')!;
    const repainted = applyOpToTaint(ai, ProvSource.Human, 'replace', 'op-2')!;
    expect(repainted.contribution.ai).toBe(0);
    expect(hasFlag(repainted.flags, TaintFlag.CONTAINS_AI)).toBe(false);
  });
  it('AI over human → mixed (AI_AFTER_HUMAN)', () => {
    const human = applyOpToTaint(null, ProvSource.Human, 'create', 'op-1')!;
    const aiEdit = applyOpToTaint(human, ProvSource.AiWrite, 'cosmetic', 'op-2')!;
    expect(hasFlag(aiEdit.flags, TaintFlag.AI_AFTER_HUMAN)).toBe(true);
    expect(aiEdit.contribution.human).toBeGreaterThan(0);
    expect(aiEdit.contribution.ai).toBeGreaterThan(0);
  });
  it('delete returns null', () => {
    const ai = applyOpToTaint(null, ProvSource.AiWrite, 'create', 'op-1')!;
    expect(applyOpToTaint(ai, ProvSource.Human, 'delete', 'op-2')).toBeNull();
  });
  it('procedural create is procedural, not AI', () => {
    const t = applyOpToTaint(null, ProvSource.Procedural, 'create', 'op-1')!;
    expect(t.contribution.procedural).toBe(1);
    expect(hasFlag(t.flags, TaintFlag.CONTAINS_AI)).toBe(false);
    expect(hasFlag(t.flags, TaintFlag.CONTAINS_PROC)).toBe(true);
  });
});

describe('policy.deriveSummary', () => {
  it('no taint → human_created, no AI', () => {
    const s = deriveSummary([[null]], new Map(), {
      aiAnalysisUsed: false, aiWritesUsed: false, aiAcceptedCount: 0,
      proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: false, aiAfterHuman: false });
    expect(s.containsAi).toBe(false);
    expect(s.exportDisclosure).toBe('human_created');
  });
  it('AI used but no remaining AI cells → ai_used_no_remaining_ai_content', () => {
    const s = deriveSummary([[null]], new Map(), {
      aiAnalysisUsed: false, aiWritesUsed: true, aiAcceptedCount: 0,
      proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: true, aiAfterHuman: false });
    expect(s.aiUsedNoRemaining).toBe(true);
    expect(s.exportDisclosure).toBe('ai_used_no_remaining_ai_content');
  });
});

function taint(ai: number, human: number, procedural: number): UnitTaint {
  return { createdByOp: 'o', lastModifiedByOp: 'o', origin: 0, contribution: { ai, human, procedural }, flags: 0 };
}
const NO_SESSION: SessionFlags = { aiAnalysisUsed: false, aiWritesUsed: false, aiAcceptedCount: 0, proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: false, aiAfterHuman: false };

describe('deriveSummary proceduralAreaPct', () => {
  it('reports procedural coverage as a percentage of content cells, mirroring aiTerrainPct', () => {
    // 4 content cells: 1 procedural, 1 ai, 2 human → proc 25%, ai 25%
    const cellTaint = [[taint(0,1,0), taint(0,0,1)], [taint(1,0,0), taint(0,1,0)]];
    const s = deriveSummary(cellTaint, new Map(), NO_SESSION);
    expect(s.proceduralAreaPct).toBe(25);
    expect(s.aiTerrainPct).toBe(25);
    expect(s.containsProcedural).toBe(true);
  });
  it('is 0 with no procedural content', () => {
    const s = deriveSummary([[taint(0,1,0)]], new Map(), NO_SESSION);
    expect(s.proceduralAreaPct).toBe(0);
    expect(s.containsProcedural).toBe(false);
  });
});
