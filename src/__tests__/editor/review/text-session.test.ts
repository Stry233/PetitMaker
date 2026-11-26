/** The text check of one surface as a store: when a typed text is checked, what a stopped check
 *  leaves, and that an approval belongs to the exact text it was given for. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reviewText: vi.fn(), atCommit: false }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (load) => ({
  ...await load<typeof import('../../../pipelines/moderation/text/reviewer')>(),
  reviewText: mocks.reviewText,
}));
vi.mock('../../../editor/review/edition-review', async (load) => ({
  ...await load<typeof import('../../../editor/review/edition-review')>(),
  get textReviewAtCommit() { return mocks.atCommit; },
}));

import { createReviewedTextSession, createTextReviewSession } from '../../../editor/review/text-session';
import type { ReviewResult, TextPart } from '../../../editor/review/text-review';

const title = (text: string): TextPart[] => [{ field: 'title', text }];
const held = (text: string, more: { open?: boolean; composing?: boolean; committed?: boolean } = {}) => (
  { open: true, parts: title(text), composing: false, ...more }
);
/** Lets the review answer by hand: each call waits in `answers` for its verdict. */
function answeredByHand() {
  const answers: { signal: AbortSignal; say: (result: ReviewResult) => void; fail: (error: Error) => void }[] = [];
  mocks.reviewText.mockImplementation((_parts: TextPart[], signal: AbortSignal) => new Promise<ReviewResult>((say, fail) => {
    answers.push({ signal, say, fail });
  }));
  return answers;
}
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  mocks.atCommit = false;
  mocks.reviewText.mockReset().mockResolvedValue({ allowed: true });
});
afterEach(() => { vi.useRealTimers(); });

describe('a text review session', () => {
  it('checks a typed text once it has stood still, and never a composition', async () => {
    const session = createTextReviewSession();
    session.watch(held('Gar'));
    await vi.advanceTimersByTimeAsync(300);
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.reviewText, 'the wait starts again with each change').not.toHaveBeenCalled();
    expect(session.snapshot()).toMatchObject({ allowed: false, pending: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.reviewText).toHaveBeenCalledOnce();
    expect(mocks.reviewText.mock.calls[0]![0]).toEqual(title('Garden'));
    expect(session.snapshot()).toMatchObject({ allowed: true, ready: true, pending: false, issue: null });

    session.watch(held('山下', { composing: true }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.reviewText, 'a still candidate').toHaveBeenCalledOnce();
    expect(session.snapshot().allowed).toBe(false);
    session.watch(held('山下'));
    await vi.advanceTimersByTimeAsync(400);
    expect(mocks.reviewText).toHaveBeenCalledTimes(2);
    expect(session.snapshot().allowed).toBe(true);
  });

  it('tells its readers as the state changes', async () => {
    const session = createTextReviewSession();
    const seen: boolean[] = [];
    const stop = session.subscribe(() => seen.push(session.snapshot().allowed));
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    expect(seen.at(-1)).toBe(true);
    stop();
    session.watch(held('River'));
    expect(seen.at(-1), 'a reader that left hears nothing').toBe(true);
  });

  it('[UI-17] shares the run on its way with an export, and its result afterwards', async () => {
    const answers = answeredByHand();
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    const exporting = session.check(title('Garden'));
    expect(mocks.reviewText).toHaveBeenCalledOnce();
    answers[0]!.say({ allowed: true });
    await expect(exporting).resolves.toEqual({ allowed: true });
    expect(session.snapshot().allowed).toBe(true);
    await expect(session.check(title('Garden'))).resolves.toEqual({ allowed: true });
    expect(mocks.reviewText).toHaveBeenCalledOnce();
  });

  it('starts an export\'s check at once, in place of the wait', async () => {
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await expect(session.check(title('Garden'))).resolves.toEqual({ allowed: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.reviewText).toHaveBeenCalledOnce();
  });

  it('[UI-17] never lets a late answer approve a newer text', async () => {
    const answers = answeredByHand();
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    session.watch(held('River'));
    expect(answers[0]!.signal.aborted).toBe(true);
    expect(session.snapshot().allowed, 'revoked with the edit').toBe(false);
    answers[0]!.say({ allowed: true });
    await settle();
    expect(session.snapshot()).toMatchObject({ allowed: false, pending: true });
    expect(session.snapshot(held('Garden')).allowed, 'nor the text it was stopped for').toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    answers[1]!.say({ allowed: true });
    await settle();
    expect(session.snapshot().allowed).toBe(true);
    expect(session.snapshot(held('Mountain')).allowed, 'a text a reader holds ahead of the store').toBe(false);
  });

  it('[UI-17] keeps a refusal and a check that could not run closed', async () => {
    const refusal: ReviewResult = { allowed: false, reason: 'content', fields: ['title'] };
    mocks.reviewText.mockResolvedValueOnce(refusal).mockRejectedValueOnce(new Error('no worker'));
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    expect(session.snapshot()).toMatchObject({ allowed: false, ready: false, pending: false, issue: refusal });
    session.watch(held('River'));
    await vi.advanceTimersByTimeAsync(400);
    expect(session.snapshot()).toMatchObject({ allowed: false, pending: false, issue: 'unavailable' });
  });

  it('[UI-17] pauses a stopped check, takes no late answer for it, and checks again on retry', async () => {
    const answers = answeredByHand();
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    session.cancel();
    expect(answers[0]!.signal.aborted).toBe(true);
    answers[0]!.say({ allowed: true });
    await settle();
    expect(session.snapshot()).toMatchObject({ allowed: false, paused: true, pending: false });
    session.retry();
    expect(session.snapshot()).toMatchObject({ paused: false, pending: true });
    answers[1]!.say({ allowed: true });
    await settle();
    expect(session.snapshot()).toMatchObject({ allowed: true, paused: false });
  });

  it('pauses a text whose wait was stopped before its check began', async () => {
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    session.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.reviewText).not.toHaveBeenCalled();
    expect(session.snapshot()).toMatchObject({ allowed: false, paused: true, pending: false });
  });

  it('allows a surface with no text at once and forgets approvals when it closes', async () => {
    const answers = answeredByHand();
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    session.watch({ open: true, parts: [], composing: false });
    expect(answers[0]!.signal.aborted).toBe(true);
    expect(session.snapshot().allowed).toBe(true);

    mocks.reviewText.mockReset().mockResolvedValue({ allowed: true });
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    expect(session.snapshot().allowed).toBe(true);
    session.watch(held('Garden', { open: false }));
    expect(session.snapshot().allowed).toBe(false);
    session.watch(held('Garden'));
    expect(session.snapshot()).toMatchObject({ allowed: false, pending: true });
  });

  it('stops for good when its surface goes away', async () => {
    const answers = answeredByHand();
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(400);
    session.watch(held('River'));
    session.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.signal.aborted).toBe(true);
  });

  it('leaves a typed text unchecked until its commit where the edition checks text once committed', async () => {
    mocks.atCommit = true;
    const session = createTextReviewSession();
    session.watch(held('Garden'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.reviewText).not.toHaveBeenCalled();
    expect(session.snapshot()).toMatchObject({ allowed: false, ready: true, pending: false });
    await session.check(title('Garden'));
    expect(session.snapshot()).toMatchObject({ allowed: true, ready: true });

    session.watch(held('River', { committed: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(mocks.reviewText, 'a committed text is checked as it stands').toHaveBeenCalledTimes(2);
  });
});

describe('a reviewed text session', () => {
  const field = (text: string, known = '') => ({ open: true, text, known, field: 'planet' as const, composing: false });

  it('needs no check for the text the thing already carries, and none for an empty one to refuse it', async () => {
    const session = createReviewedTextSession();
    session.watch(field(' Bay ', 'Bay'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.reviewText).not.toHaveBeenCalled();
    expect(session.snapshot()).toMatchObject({ approved: true, approvedText: null });
    session.watch(field('  ', 'Bay'));
    expect(session.snapshot().approved).toBe(false);
  });

  it('approves the exact trimmed text once checked and commits it at once', async () => {
    const session = createReviewedTextSession();
    session.watch(field('Cove '));
    expect(session.snapshot()).toMatchObject({ approved: false, approvedText: null });
    await vi.advanceTimersByTimeAsync(400);
    expect(session.snapshot()).toMatchObject({ approved: true, approvedText: 'Cove' });
    const then = vi.fn();
    session.commit(then);
    expect(then).toHaveBeenCalledOnce();
    expect(session.snapshot(field('Coves')), 'a text a reader holds ahead of the store').toMatchObject({ approved: false, approvedText: null });
  });

  it('commits nothing while the text is unchecked or refused', async () => {
    mocks.reviewText.mockResolvedValue({ allowed: false, reason: 'content', fields: ['planet'] });
    const session = createReviewedTextSession();
    const then = vi.fn();
    session.watch(field('Cove'));
    session.commit(then);
    await vi.advanceTimersByTimeAsync(400);
    session.commit(then);
    expect(then).not.toHaveBeenCalled();
    expect(session.snapshot().approved).toBe(false);
  });

  it('runs the check as the text is committed where the edition checks text once committed', async () => {
    mocks.atCommit = true;
    const answers = answeredByHand();
    const session = createReviewedTextSession();
    const then = vi.fn();
    session.watch(field('Cove'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.snapshot().approved, 'waiting for its commit').toBe(true);
    session.commit(then);
    expect(then).not.toHaveBeenCalled();
    answers[0]!.say({ allowed: true });
    await settle();
    expect(then).toHaveBeenCalledOnce();

    session.watch(field('Reef'));
    session.commit(then);
    answers[1]!.say({ allowed: false, reason: 'content', fields: ['planet'] });
    await settle();
    expect(then, 'a refused text').toHaveBeenCalledOnce();
    expect(session.snapshot().approved).toBe(false);
  });
});
