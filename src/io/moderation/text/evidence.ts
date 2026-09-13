import type { Restriction, ReviewResult, TextField } from './policy';

export type Evidence = { source: 'obscenity' | 'two-toad' | 'naughty-words'; category?: never }
  | { source: 'zhin-political' | 'fwwdn-political' | 'houbb-political'; category: 'political' };

/** Vocabulary sources overlap; a match is a lexical restriction, not a confidence vote. */
export function decideEvidence(evidence: readonly Evidence[]): Restriction | null {
  if (evidence.some(item => item.category === 'political')) return 'political';
  return evidence.length ? 'content' : null;
}

export function reviewVerdict(groups: readonly { fields: TextField[]; evidence: Evidence[] }[]): ReviewResult {
  const findings = groups.map(group => ({ ...group, reason: decideEvidence(group.evidence) })).filter(group => group.reason);
  // A refusal already localized to one field must not mark its innocent neighbours through the combined view.
  const individual = findings.filter(group => group.fields.length === 1);
  const refused = individual.length ? individual : findings;
  if (!refused.length) return { allowed: true };
  return { allowed: false, reason: refused.some(group => group.reason === 'political') ? 'political' : 'content', fields: [...new Set(refused.flatMap(group => group.fields))] };
}
