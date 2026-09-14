import { reviewParts } from './review-parts';
import { loadLexicon, takeUnconfirmed } from './segmenter';
import type { TextPart } from './policy';

const scope = self as unknown as { onmessage: ((e: MessageEvent<TextPart[]>) => void) | null; postMessage(value: unknown): void };
scope.onmessage = async ({ data: parts }) => {
  try {
    scope.postMessage({ progress: { phase: 'checking' } });
    let result = reviewParts(parts);
    // The segmentation lexicon downloads only when a phrase hit needs confirming; approved text never pays for it.
    if (takeUnconfirmed()) {
      await loadLexicon();
      result = reviewParts(parts);
    }
    scope.postMessage({ result });
  } catch {
    // Submitted text and internal stacks must not enter UI error reporting.
    scope.postMessage({ error: true });
  }
};
