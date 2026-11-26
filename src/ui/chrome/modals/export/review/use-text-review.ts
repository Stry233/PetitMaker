import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { TextPart } from '../../../../../editor/review/text-review';
import { createTextReviewSession, type TextReviewInput } from '../../../../../editor/review/text-session';

/** One surface's text check (`editor/review/text-session.ts`): the preview and the export share it, and
 *  `committed` says the parts are committed already where the edition checks text only once committed. */
export function useTextReview(open: boolean, parts: TextPart[], composing: boolean, committed: boolean = false) {
  const [session] = useState(createTextReviewSession);
  const input: TextReviewInput = { open, parts, composing, committed };
  // Read for this render's text: an approval never outlives the text it was given for, even by a render.
  const state = useSyncExternalStore(session.subscribe, () => session.snapshot(input));
  useLayoutEffect(() => { session.watch(input); });
  useEffect(() => () => session.release(), [session]);
  return { ...state, check: session.check, cancel: session.cancel, retry: session.retry };
}
