import { textVariants, type ReviewResult, type TextPart } from './policy';
import { lexicalEvidence } from './lexical';
import { politicalEvidence } from './political';
import { reviewVerdict } from './evidence';
import { containsWebsite } from './website';
import { packageChineseEvidence } from './package-chinese';

export function reviewParts(parts: readonly TextPart[]): ReviewResult {
  const linkedFields = parts.filter(part => [part.text, ...(part.segments ?? [])].some(containsWebsite)).map(part => part.field);
  if (linkedFields.length) return { allowed: false, reason: 'website', fields: [...new Set(linkedFields)] };
  const groups = parts.flatMap(part => [...new Set([part.text, ...(part.segments ?? [])])].map(text => ({ fields: [part.field], text })));
  if (parts.length > 1) groups.push({ fields: [...new Set(parts.map(part => part.field))], text: parts.map(part => part.text).join('\n') });
  return reviewVerdict(groups.map(group => ({
    fields: group.fields,
    evidence: [...textVariants(group.text).flatMap(text => [...lexicalEvidence(text), ...packageChineseEvidence(text)]), ...politicalEvidence(group.text)],
  })));
}
