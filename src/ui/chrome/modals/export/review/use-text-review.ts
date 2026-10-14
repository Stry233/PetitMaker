import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TextReviewer, textReviewKey, type ReviewIssue, type ReviewProgress, type ReviewResult, type TextPart,
} from '../../../../../editor/review/text-review';
import { useSettledValue } from '../../../../primitives/use-settled-value';

type Snapshot = { key: string; result?: ReviewResult; issue?: ReviewIssue; progress?: ReviewProgress; paused?: boolean };

/** Preview and export share one check. Approval belongs to the exact resolved text, never the draft's identity. */
export function useTextReview(open: boolean, partsIn: TextPart[], composing: boolean) {
  const parts = useSettledValue(partsIn, textReviewKey);
  const key = textReviewKey(parts);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const scheduled = useRef<{ timer: ReturnType<typeof setTimeout>; key: string } | null>(null);
  const [reviewer] = useState(() => new TextReviewer());
  useEffect(() => {
    if (!open) reviewer.dispose();
    return () => reviewer.dispose();
  }, [open, reviewer]);

  const cancel = useCallback(() => {
    const running = reviewer.cancel();
    const key = running ?? scheduled.current?.key;
    if (scheduled.current) { clearTimeout(scheduled.current.timer); scheduled.current = null; }
    if (key) setSnapshot({ key, paused: true });
  }, [reviewer]);

  const check = useCallback((text: TextPart[]): Promise<ReviewResult> => {
    const key = textReviewKey(text);
    if (reviewer.wouldStart(text) && scheduled.current) { clearTimeout(scheduled.current.timer); scheduled.current = null; }
    return reviewer.check(text, {
      progress: (progress) => setSnapshot({ key, progress }),
      settled: (result) => setSnapshot({ key, result, ...(result.allowed ? {} : { issue: result }) }),
      failed: (issue) => setSnapshot({ key, issue }),
    });
  }, [reviewer]);

  useEffect(() => {
    if (!open) { reviewer.forget(); setSnapshot(null); return cancel; }
    if (composing || !parts.length) return cancel;
    // A long IME composition must not start a check just because its current candidate is still.
    const timer = setTimeout(() => {
      scheduled.current = null;
      void check(parts).catch(() => undefined);
    }, 400);
    scheduled.current = { timer, key };
    return cancel;
  }, [open, parts, key, composing, check, cancel, reviewer]);

  const current = snapshot?.key === key ? snapshot : null;
  const result = current?.result ?? reviewer.resultFor(key);
  return {
    allowed: open && !composing && (!parts.length || result?.allowed === true),
    issue: open ? current?.issue ?? (result && !result.allowed ? result : null) : null,
    pending: open && parts.length > 0 && !result && !current?.issue && !current?.paused,
    progress: current?.progress,
    paused: current?.paused === true,
    check, cancel,
    retry: () => { void check(parts).catch(() => undefined); },
  };
}
