// The text check of one surface as an external store: when a typed text is checked (once it stands
// still and no IME composition runs, or only as it is committed where the edition says so), what a
// check that was stopped leaves, and whether the text may show or go out. A surface says what it
// holds through `watch` and reads `snapshot`; an export or a commit runs `check` on the same store,
// so both share one run and one result.
import type { TextField } from '../../pipelines/moderation/facts';
import { createSignal } from '../../core/base/signal';
import { automaticTextReview, textReviewAtCommit } from './edition-review';
import { reviewedTextParts } from './text-parts';
import {
  TextReviewer, textReviewKey, type ReviewIssue, type ReviewProgress, type ReviewResult, type TextPart,
} from './text-review';

/** How long a typed text stands still, in ms, before its check starts. */
const SETTLE_MS = 400;

/** What a surface holds under the check. */
export interface TextReviewInput {
  /** A closed surface checks nothing and forgets what was approved. */
  open: boolean;
  parts: readonly TextPart[];
  /** An IME composition is running; its candidate is never checked, however long it stands still. */
  composing: boolean;
  /** The parts are committed already, where the edition checks a typed text only once committed. */
  committed?: boolean;
}

interface TextReviewState {
  /** The check approved exactly this text, or there is none to check. */
  allowed: boolean;
  /** The text may be committed: approved, or unchecked text waiting for the check its commit runs. */
  ready: boolean;
  issue: ReviewIssue | null;
  pending: boolean;
  progress: ReviewProgress | undefined;
  /** The check of this text was stopped before it answered. */
  paused: boolean;
}

interface TextReviewSession {
  /** Says what the surface holds now. A change stops the check on its way and waits for the new text to settle. */
  watch(input: TextReviewInput): void;
  /** The state for the watched text, or for `input` where a reader holds a newer one than it has said. */
  snapshot(input?: TextReviewInput): TextReviewState;
  subscribe(listener: () => void): () => void;
  /** Checks `parts` now, as an export or a commit does, sharing the result or the run for the same text. */
  check(parts: TextPart[]): Promise<ReviewResult>;
  /** Stops the check running or waiting to start, which leaves its text paused. */
  cancel(): void;
  /** Checks the watched text now. */
  retry(): void;
  /** Stops everything and releases the check's worker, as a surface going away does. */
  release(): void;
}

/** What the last check said, for the exact text it was about. */
interface Heard { key: string; result?: ReviewResult; issue?: ReviewIssue; progress?: ReviewProgress; paused?: boolean }

const CLOSED: TextReviewInput = { open: false, parts: [], composing: false };

const sameState = (a: TextReviewState, b: TextReviewState): boolean =>
  a.allowed === b.allowed && a.ready === b.ready && a.issue === b.issue && a.pending === b.pending
  && a.progress === b.progress && a.paused === b.paused;

export function createTextReviewSession(): TextReviewSession {
  const reviewer = new TextReviewer();
  const changed = createSignal();
  let watched: { input: TextReviewInput; key: string } | null = null;
  let heard: Heard | null = null;
  let scheduled: { timer: ReturnType<typeof setTimeout>; key: string } | null = null;
  let state: TextReviewState | null = null;

  const say = (next: Heard | null): void => { heard = next; changed.emit(); };
  const unschedule = (): void => {
    if (scheduled) clearTimeout(scheduled.timer);
    scheduled = null;
  };

  const stateOf = ({ open, parts, composing, committed }: TextReviewInput): TextReviewState => {
    const key = textReviewKey(parts);
    const current = heard?.key === key ? heard : null;
    const result = current?.result ?? reviewer.resultFor(key);
    const allowed = open && !composing && (!parts.length || result?.allowed === true);
    const issue = open ? current?.issue ?? (result && !result.allowed ? result : null) : null;
    const awaitsCommit = textReviewAtCommit && !committed;
    // Unchecked text that waits for its commit is not pending until the commit starts its check.
    const pending = open && parts.length > 0 && !result && !current?.issue && !current?.paused
      && (!awaitsCommit || current?.progress !== undefined);
    return {
      allowed,
      ready: allowed || (awaitsCommit && open && !composing && !issue && !pending && !current?.paused),
      issue, pending, progress: current?.progress, paused: current?.paused === true,
    };
  };

  const check = (parts: TextPart[]): Promise<ReviewResult> => {
    const key = textReviewKey(parts);
    if (reviewer.wouldStart(parts)) unschedule();
    return reviewer.check(parts, {
      progress: (progress) => say({ key, progress }),
      settled: (result) => say({ key, result, ...(result.allowed ? {} : { issue: result }) }),
      failed: (issue) => say({ key, issue }),
    });
  };

  const cancel = (): void => {
    const key = reviewer.cancel() ?? scheduled?.key;
    unschedule();
    if (key) say({ key, paused: true });
  };

  return {
    watch(input) {
      const key = textReviewKey(input.parts);
      const before = watched;
      if (before && before.key === key && before.input.open === input.open && before.input.composing === input.composing
        && !before.input.committed === !input.committed) return;
      cancel();
      watched = { input, key };
      if (!input.open) {
        reviewer.forget();
        reviewer.dispose();
        say(null);
        return;
      }
      if (!input.composing && input.parts.length && (!textReviewAtCommit || input.committed)) {
        const timer = setTimeout(() => {
          scheduled = null;
          void check([...input.parts]).catch(() => undefined);
        }, SETTLE_MS);
        scheduled = { timer, key };
      }
      changed.emit();
    },
    snapshot(input = watched?.input ?? CLOSED) {
      const next = stateOf(input);
      if (!state || !sameState(state, next)) state = next;
      return state;
    },
    subscribe: (listener) => changed.subscribe(() => listener()),
    check,
    cancel,
    retry() {
      void check([...(watched?.input.parts ?? [])]).catch(() => undefined);
    },
    release() {
      reviewer.cancel();
      unschedule();
      reviewer.dispose();
      watched = null;
    },
  };
}

/** What one field that names something holds; `known` is the text the thing already carries, which needs no check. */
export interface ReviewedTextInput {
  open: boolean;
  text: string;
  known: string;
  field: TextField;
  composing: boolean;
}

interface ReviewedTextState {
  /** The text may be committed. */
  approved: boolean;
  /** The exact text the check approved, while it stands in the field. */
  approvedText: string | null;
  review: TextReviewState;
}

interface ReviewedTextSession {
  watch(input: ReviewedTextInput): void;
  snapshot(input?: ReviewedTextInput): ReviewedTextState;
  subscribe(listener: () => void): () => void;
  /** Runs `then` once the watched text is approved to go out: at once where its check already approved
   *  it, else after the check the commit runs, which shows a refusal or a check that could not run instead. */
  commit(then: () => void): void;
  retry(): void;
  release(): void;
}

/** The check behind one field that names something, over a text review session of its own. */
export function createReviewedTextSession(): ReviewedTextSession {
  const session = createTextReviewSession();
  let watched: ReviewedTextInput | null = null;
  let state: ReviewedTextState | null = null;

  const reviewOf = (input: ReviewedTextInput): TextReviewInput => (
    { open: input.open, parts: reviewedTextParts(input.text, input.known, input.field), composing: input.composing }
  );

  return {
    watch(input) {
      watched = input;
      session.watch(reviewOf(input));
    },
    snapshot(given) {
      const input = given ?? watched;
      const reviewInput = input ? reviewOf(input) : undefined;
      const review = session.snapshot(reviewInput);
      const text = reviewInput?.parts[0]?.text;
      const approvedText = review.allowed && text !== undefined ? text : null;
      // An edition without the automatic check lets text through as it lets export text through.
      const approved = !!input && !!input.text.trim() && !input.composing && (!automaticTextReview || review.ready);
      if (!state || state.review !== review || state.approved !== approved || state.approvedText !== approvedText) {
        state = { approved, approvedText, review };
      }
      return state;
    },
    subscribe: session.subscribe,
    commit(then) {
      if (!watched) return;
      const input = reviewOf(watched);
      const review = session.snapshot(input);
      if (!automaticTextReview || !input.parts.length || review.allowed) { then(); return; }
      if (!review.ready) return;
      void session.check([...input.parts]).then((result) => { if (result.allowed) then(); }, () => undefined);
    },
    retry: session.retry,
    release() {
      session.release();
      watched = null;
    },
  };
}
