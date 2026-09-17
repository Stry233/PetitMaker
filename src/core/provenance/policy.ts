// src/core/provenance/policy.ts
import {
  ProvSource, TaintFlag, setFlag, hasFlag,
  type UnitTaint, type DisclosureClass, type MapProvenanceSummary, type SessionFlags,
} from './types';

export const PROVENANCE_POLICY = {
  COSMETIC_WEIGHT: 0.35,   // a cosmetic modify contributes fractionally to its source, never full replacement weight
  AI_EPSILON: 0.001,       // contribution above which a source "counts"
} as const;

export type OpKind = 'create' | 'replace' | 'cosmetic' | 'delete';

export function sourceClass(s: ProvSource): 'ai' | 'human' | 'procedural' {
  if (s === ProvSource.AiWrite || s === ProvSource.AiAccepted) return 'ai';
  if (s === ProvSource.Procedural) return 'procedural';
  return 'human'; // Human, AutoRepair, AutoTrim, Imported, Unknown (derived inherit handled by caller's source)
}

function vecFor(cls: 'ai' | 'human' | 'procedural'): { ai: number; human: number; procedural: number } {
  return { ai: cls === 'ai' ? 1 : 0, human: cls === 'human' ? 1 : 0, procedural: cls === 'procedural' ? 1 : 0 };
}

function normalize(c: { ai: number; human: number; procedural: number }) {
  const sum = c.ai + c.human + c.procedural;
  if (sum <= 0) return { ai: 0, human: 0, procedural: 0 };
  return { ai: c.ai / sum, human: c.human / sum, procedural: c.procedural / sum };
}

function deriveFlags(c: { ai: number; human: number; procedural: number }, lastClass: 'ai' | 'human' | 'procedural', source: ProvSource): number {
  const e = PROVENANCE_POLICY.AI_EPSILON;
  let f = 0;
  if (c.ai > e) f = setFlag(f, TaintFlag.CONTAINS_AI);
  if (c.procedural > e) f = setFlag(f, TaintFlag.CONTAINS_PROC);
  if (c.ai > e && lastClass === 'human') f = setFlag(f, TaintFlag.HUMAN_AFTER_AI);
  if (c.human > e && lastClass === 'ai') f = setFlag(f, TaintFlag.AI_AFTER_HUMAN);
  if (lastClass === 'ai') f = setFlag(f, TaintFlag.MODIFIED_BY_AI);
  if (source === ProvSource.Unknown || source === ProvSource.Imported) f = setFlag(f, TaintFlag.UNKNOWN);
  return f;
}

/** Apply one operation's effect to a unit's taint. `null` in → unit was untouched/ground;
 *  `null` out → the unit is now empty (deleted). */
export function applyOpToTaint(prev: UnitTaint | null, source: ProvSource, kind: OpKind, opId: string): UnitTaint | null {
  if (kind === 'delete') return null;
  const cls = sourceClass(source);

  if (kind === 'create' || kind === 'replace' || prev === null) {
    const contribution = vecFor(cls);
    return {
      createdByOp: prev && kind !== 'create' ? prev.createdByOp : opId,
      lastModifiedByOp: opId,
      origin: prev && kind !== 'create' ? prev.origin : source,
      contribution,
      flags: deriveFlags(contribution, cls, source),
    };
  }

  // cosmetic modify: blend, preserving prior sources
  const w = PROVENANCE_POLICY.COSMETIC_WEIGHT;
  const e = vecFor(cls);
  const blended = normalize({
    ai: prev.contribution.ai * (1 - w) + e.ai * w,
    human: prev.contribution.human * (1 - w) + e.human * w,
    procedural: prev.contribution.procedural * (1 - w) + e.procedural * w,
  });
  return {
    createdByOp: prev.createdByOp,
    lastModifiedByOp: opId,
    origin: prev.origin,
    contribution: blended,
    flags: deriveFlags(blended, cls, source),
  };
}

/** Moves preserve contribution shares while recording the mover in the flags and ledger. */
export function applyMoveToTaint(prev: UnitTaint, source: ProvSource, opId: string): UnitTaint {
  const cls = sourceClass(source);
  return {
    ...prev,
    contribution: { ...prev.contribution },
    lastModifiedByOp: opId,
    flags: prev.flags | deriveFlags(prev.contribution, cls, source),
  };
}

/** Largest contribution share; ties favor human authorship when deciding what generation may clear. */
export function dominantAuthor(t: UnitTaint | null | undefined): 'ai' | 'human' | 'procedural' | null {
  if (!t) return null;
  const { ai, human, procedural } = t.contribution;
  if (human >= ai && human >= procedural) return 'human';
  return ai >= procedural ? 'ai' : 'procedural';
}

export function deriveSummary(
  cellTaint: (UnitTaint | null)[][],
  objectTaint: Map<string, UnitTaint>,
  session: SessionFlags,
): MapProvenanceSummary {
  const e = PROVENANCE_POLICY.AI_EPSILON;
  let contentCells = 0, aiCells = 0, procCells = 0;
  let humanAfterAi = session.humanAfterAi, aiAfterHuman = session.aiAfterHuman, anyUnknown = false;
  for (const row of cellTaint) {
    if (!row) continue;
    for (const t of row) {
      if (!t) continue;
      contentCells++;
      if (t.contribution.ai > e) aiCells++;
      if (t.contribution.procedural > e) procCells++;
      if (hasFlag(t.flags, TaintFlag.HUMAN_AFTER_AI)) humanAfterAi = true;
      if (hasFlag(t.flags, TaintFlag.AI_AFTER_HUMAN)) aiAfterHuman = true;
      if (hasFlag(t.flags, TaintFlag.UNKNOWN)) anyUnknown = true;
    }
  }
  let aiObjectCount = 0;
  for (const t of objectTaint.values()) {
    if (t.contribution.ai > e) aiObjectCount++;
    if (hasFlag(t.flags, TaintFlag.UNKNOWN)) anyUnknown = true;
  }
  const containsAi = aiCells > 0 || aiObjectCount > 0;
  const containsProcedural = procCells > 0;
  const aiEverUsed = session.aiWritesUsed || session.aiAcceptedCount > 0;
  const aiUsedNoRemaining = aiEverUsed && !containsAi;

  const aiTerrainPct = contentCells ? Math.round((aiCells / contentCells) * 100) : 0;
  const aiAreaPct = aiTerrainPct; // area ≈ tainted-content coverage; refined by caller if needed
  const proceduralAreaPct = contentCells ? Math.round((procCells / contentCells) * 100) : 0;

  let exportDisclosure: DisclosureClass;
  if (anyUnknown && !containsAi && !containsProcedural) exportDisclosure = 'unknown';
  else if (containsAi && (humanAfterAi || aiAfterHuman)) exportDisclosure = 'mixed_human_ai';
  else if (containsAi) exportDisclosure = 'contains_ai_assisted';
  else if (aiUsedNoRemaining) exportDisclosure = 'ai_used_no_remaining_ai_content';
  else if (containsProcedural) exportDisclosure = 'procedural';
  else exportDisclosure = 'human_created';

  return {
    containsAi, containsProcedural, aiEverUsed, aiUsedNoRemaining,
    aiTerrainPct, aiObjectCount, aiAreaPct, proceduralAreaPct,
    counts: { aiWrites: session.aiWritesUsed ? 1 : 0, aiAccepted: session.aiAcceptedCount, proceduralRuns: session.proceduralRuns, analysisOnlyCalls: session.analysisOnlyCalls },
    humanAfterAi, aiAfterHuman, dominant: exportDisclosure, exportDisclosure,
  };
}
