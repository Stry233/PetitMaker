import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewProgress, ReviewResult, TextPart } from '../../../../../io/moderation/text/policy';
import { reviewText, ReviewTooLong, ReviewWorkerLease } from '../../../../../io/moderation/text/reviewer';

export type ReviewIssue = Exclude<ReviewResult, { allowed: true }> | 'unavailable' | 'too-long';

type Snapshot = { key: string; result?: ReviewResult; issue?: ReviewIssue; progress?: ReviewProgress; paused?: boolean };
type Run = { key: string; controller: AbortController; promise: Promise<ReviewResult> };

/** Preview and export share one check. Approval belongs to the exact resolved text, never the draft's identity. */
export function useTextReview(open: boolean, parts: TextPart[], composing: boolean) {
  const key = JSON.stringify(parts);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const completed = useRef<{ key: string; result: ReviewResult } | null>(null);
  const active = useRef<Run | null>(null);
  const scheduled = useRef<{ timer: ReturnType<typeof setTimeout>; key: string } | null>(null);
  const [lease] = useState(() => new ReviewWorkerLease());
  useEffect(() => {
    if (!open) lease.dispose();
    return () => lease.dispose();
  }, [open, lease]);

  const cancel = useCallback(() => {
    const run = active.current;
    const key = run?.key ?? scheduled.current?.key;
    if (scheduled.current) { clearTimeout(scheduled.current.timer); scheduled.current = null; }
    active.current = null;
    run?.controller.abort();
    if (key) setSnapshot({ key, paused: true });
  }, []);

  const check = useCallback((text: TextPart[]): Promise<ReviewResult> => {
    const key = JSON.stringify(text);
    if (!text.length) return Promise.resolve({ allowed: true });
    if (completed.current?.key === key) return Promise.resolve(completed.current.result);
    if (active.current?.key === key) return active.current.promise;
    cancel();
    const controller = new AbortController();
    const run = { key, controller } as Run;
    active.current = run;
    setSnapshot({ key, progress: { phase: 'checking' } });
    run.promise = reviewText(text, controller.signal, (progress) => {
      if (active.current === run) setSnapshot({ key, progress });
    }, lease).then((result) => {
      if (active.current === run) {
        completed.current = { key, result };
        setSnapshot({ key, result, issue: result.allowed ? undefined : result });
      }
      return result;
    }, (error: unknown) => {
      if (active.current === run) setSnapshot({ key, issue: error instanceof ReviewTooLong ? 'too-long' : 'unavailable' });
      throw error;
    }).finally(() => { if (active.current === run) active.current = null; });
    return run.promise;
  }, [cancel, lease]);

  useEffect(() => {
    if (!open) { completed.current = null; setSnapshot(null); return cancel; }
    if (composing || !parts.length) return cancel;
    // A long IME composition must not start a check just because its current candidate is still.
    const timer = setTimeout(() => {
      scheduled.current = null;
      void check(parts).catch(() => undefined);
    }, 400);
    scheduled.current = { timer, key };
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key contains every field and resolved value
  }, [open, key, composing, check, cancel]);

  const current = snapshot?.key === key ? snapshot : null;
  const cached = completed.current?.key === key ? completed.current.result : undefined;
  const result = current?.result ?? cached;
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
