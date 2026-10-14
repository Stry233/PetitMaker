import type { ReviewResult, TextPart } from './policy';
import { packageViews } from './variants';
import { lexicalEvidence } from './lexical';
import { politicalEvidence } from './political';
import { reviewVerdict } from './evidence';
import { containsWebsite } from './website';
import { packageChineseEvidence } from './package-chinese';
import type { Provisional } from './segmenter';

export function reviewParts(parts: readonly TextPart[]): Provisional<ReviewResult> {
  const linkedFields = parts.filter(part => [part.text, ...(part.segments ?? [])].some(containsWebsite)).map(part => part.field);
  if (linkedFields.length) return { verdict: { allowed: false, reason: 'website', fields: [...new Set(linkedFields)] }, provisional: false };
  const groups = parts.flatMap(part => [...new Set([part.text, ...(part.segments ?? [])])].map(text => ({ fields: [part.field], text })));
  if (parts.length > 1) groups.push({ fields: [...new Set(parts.map(part => part.field))], text: parts.map(part => part.text).join('\n') });
  let provisional = false;
  const verdict = reviewVerdict(groups.map(group => {
    const political = politicalEvidence(group.text);
    provisional ||= political.provisional;
    return {
      fields: group.fields,
      evidence: [...packageViews(group.text).flatMap(text => [...lexicalEvidence(text), ...packageChineseEvidence(text)]), ...political.verdict],
    };
  }));
  return { verdict, provisional };
}
