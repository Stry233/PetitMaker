export type TextField = 'title' | 'description' | 'footer' | 'planet' | 'stencil' | 'tag';
export type TextPart = { field: TextField; text: string; segments?: string[] };
export type Restriction = 'content' | 'political' | 'website';
export type ReviewResult = { allowed: true } | { allowed: false; reason: Restriction; fields: TextField[] };
export type ReviewProgress = { phase: 'checking' };

/** Eligibility is not a verdict: numeric captions must reach the same checks as words. */
export function needsTextReview(text: string): boolean {
  return normalizeText(text).length > 0;
}

/** Analysis copies only: preserve spelling, spacing and emoji in the exported text. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC')
    .replace(/[\p{Cf}\u034f]/gu, char => /[\u200c\u200d]/.test(char) ? char : '')
    .replace(/([\p{L}\p{N}])[\u200c\u200d\ufe00-\ufe0f\u{e0100}-\u{e01ef}]+(?=[\p{L}\p{N}])/gu, '$1').trim();
}
