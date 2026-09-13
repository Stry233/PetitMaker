import { reviewParts } from './review-parts';
import type { TextPart } from './policy';

const scope = self as unknown as { onmessage: ((e: MessageEvent<TextPart[]>) => void) | null; postMessage(value: unknown): void };
scope.onmessage = ({ data: parts }) => {
  try {
    scope.postMessage({ progress: { phase: 'checking' } });
    scope.postMessage({ result: reviewParts(parts) });
  } catch {
    // Submitted text and internal stacks must not enter UI error reporting.
    scope.postMessage({ error: true });
  }
};
