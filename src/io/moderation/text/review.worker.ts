import { runReview } from './review-run';
import type { TextPart } from './policy';

const scope = self as unknown as { onmessage: ((e: MessageEvent<TextPart[]>) => void) | null; postMessage(value: unknown): void };
scope.onmessage = async ({ data: parts }) => {
  try {
    scope.postMessage({ progress: { phase: 'checking' } });
    scope.postMessage({ result: await runReview(parts) });
  } catch {
    // Submitted text and internal stacks must not enter UI error reporting.
    scope.postMessage({ error: true });
  }
};
