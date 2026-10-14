/** The review cores the export surfaces run: one text check at a time with its result kept by exact
 *  text, and one map check whose failures read as unavailable. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reviewText: vi.fn(), reviewMap: vi.fn(), capture: vi.fn() }));
vi.mock('../../../pipelines/moderation', async (load) => ({
  ...await load<typeof import('../../../pipelines/moderation')>(),
  reviewText: mocks.reviewText, reviewMap: mocks.reviewMap,
}));
vi.mock('../../../editor/review/map-capture', () => ({ captureReviewViews: mocks.capture }));

import { TextReviewer } from '../../../editor/review/text-review';
import { reviewedTextParts } from '../../../editor/review/text-parts';
import { MAP_REVIEW_UNAVAILABLE, reviewLiveMap } from '../../../editor/review/map-review';
import { ReviewTooLong } from '../../../pipelines/moderation';

const listener = () => ({ progress: vi.fn(), settled: vi.fn(), failed: vi.fn() });
const TITLE = [{ field: 'title' as const, text: 'Bay' }];

beforeEach(() => vi.clearAllMocks());

describe('the text reviewer', () => {
  it('keeps the result for its exact text and reuses the run for the same text', async () => {
    mocks.reviewText.mockResolvedValue({ allowed: true });
    const reviewer = new TextReviewer();
    const heard = listener();
    const first = reviewer.check(TITLE, heard);
    expect(reviewer.check(TITLE, listener())).toBe(first);
    await first;
    expect(heard.settled).toHaveBeenCalledWith({ allowed: true });
    expect(reviewer.wouldStart(TITLE)).toBe(false);
    await reviewer.check(TITLE, listener());
    expect(mocks.reviewText).toHaveBeenCalledOnce();
    reviewer.forget();
    expect(reviewer.wouldStart(TITLE)).toBe(true);
  });

  it('cancels the run another text replaces, which then reports nothing', async () => {
    mocks.reviewText.mockImplementation((_parts, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const reviewer = new TextReviewer();
    const old = listener();
    const stale = reviewer.check(TITLE, old).catch(() => 'cancelled');
    mocks.reviewText.mockResolvedValue({ allowed: true });
    await reviewer.check([{ field: 'title', text: 'Cove' }], listener());
    expect(await stale).toBe('cancelled');
    expect(old.failed).not.toHaveBeenCalled();
    expect(reviewer.cancel()).toBeUndefined();
  });

  it('reports text past the budget as too long', async () => {
    mocks.reviewText.mockRejectedValue(new ReviewTooLong());
    const heard = listener();
    await expect(new TextReviewer().check(TITLE, heard)).rejects.toBeInstanceOf(ReviewTooLong);
    expect(heard.failed).toHaveBeenCalledWith('too-long');
  });

  it('sends a named field only when it changed and needs the check', () => {
    expect(reviewedTextParts(' Bay ', 'Bay', 'title')).toEqual([]);
    expect(reviewedTextParts('Cove ', 'Bay', 'title')).toEqual([{ field: 'title', text: 'Cove' }]);
  });
});

describe('the live map check', () => {
  it('reads a failed capture as unavailable and lets an abort through', async () => {
    mocks.capture.mockRejectedValue(new Error('no view'));
    expect(await reviewLiveMap({ illustration: false, annotations: true }, new AbortController().signal)).toBe(MAP_REVIEW_UNAVAILABLE);
    const aborted = new AbortController();
    aborted.abort();
    await expect(reviewLiveMap({ illustration: false, annotations: true }, aborted.signal)).rejects.toThrow();
  });

  it('returns the verdict for the captured views', async () => {
    mocks.capture.mockResolvedValue([]);
    mocks.reviewMap.mockResolvedValue({ status: 'clear' });
    expect(await reviewLiveMap({ illustration: true, annotations: false }, new AbortController().signal)).toEqual({ status: 'clear' });
    expect(mocks.capture).toHaveBeenCalledWith(true, false);
  });
});
