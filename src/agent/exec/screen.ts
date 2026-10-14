/**
 * The local content check of the user's own text before a model reads it: the order, queued notes
 * and typed gate answers. A refused text answers the refusal line in the editor's language.
 */
import { withDeadline } from '../../platform/async/abort';
import { ReviewWorkerLease, reviewLongText } from '../../pipelines/moderation';
import { translateFor } from '../../i18n/context';
import { isLocale } from '../../core/model/locale';

/** One worker lease per module: orders arrive seconds apart, and an idle lease releases the worker on its own. */
const screeningLease = new ReviewWorkerLease();

/** Whether the export text check refuses the user's text, checked whole however long it is; an
 *  unavailable check does not block because the model carries the policy. */
async function textRefused(text: string): Promise<boolean> {
  // One bound for the whole text, so a slow first worker load never holds it longer than a model turn would.
  const bound = withDeadline(8_000);
  try {
    const verdict = await reviewLongText('description', text, bound.signal, screeningLease);
    return !verdict.allowed;
  } catch {
    return false;
  } finally {
    bound.dispose();
  }
}

function refusalText(uiLocale: string | undefined): string {
  return translateFor(isLocale(uiLocale) ? uiLocale : 'en', 'agent.refusal.content');
}

/** `LoopDeps.screen`: the refusal line for a refused text, null for an allowed one. */
export async function screenText(text: string, uiLocale: string | undefined): Promise<string | null> {
  return (await textRefused(text)) ? refusalText(uiLocale) : null;
}
