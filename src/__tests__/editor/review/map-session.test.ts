/** The map check of one export surface as a store: when a check starts, the one run every caller
 *  shares, and that a verdict stands only for the pictures it was reached on. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reviewMap: vi.fn(), capture: vi.fn(), automatic: true }));
vi.mock('../../../pipelines/moderation', async (load) => ({
  ...await load<typeof import('../../../pipelines/moderation')>(),
  reviewMap: mocks.reviewMap,
}));
vi.mock('../../../editor/review/map-capture', () => ({ captureReviewViews: mocks.capture }));
vi.mock('../../../editor/review/edition-review', async (load) => ({
  ...await load<typeof import('../../../editor/review/edition-review')>(),
  get automaticExportReview() { return mocks.automatic; },
}));

import { createMapReviewSession, type MapReviewInput } from '../../../editor/review/map-session';
import { forgetMapReview, type MapReview } from '../../../editor/review/map-review';

const MAP = {};
const held = (more: Partial<MapReviewInput> = {}): MapReviewInput => (
  { open: true, automatic: true, map: MAP, revision: '1', notes: 0, illustration: null, pictured: false, ...more }
);
/** Lets the map check answer by hand: each run waits in `answers` for its verdict. */
function answeredByHand() {
  const answers: { signal: AbortSignal; say: (verdict: MapReview) => void }[] = [];
  mocks.reviewMap.mockImplementation((_views: unknown, signal: AbortSignal) => new Promise<MapReview>((say) => {
    answers.push({ signal, say });
  }));
  return answers;
}
const runs = (count: number) => vi.waitFor(() => expect(mocks.reviewMap).toHaveBeenCalledTimes(count));
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.automatic = true;
  mocks.capture.mockResolvedValue([{ width: 1, height: 1, pixels: new Uint8ClampedArray(4) }]);
  mocks.reviewMap.mockReset().mockResolvedValue({ status: 'clear' });
  forgetMapReview();
});

describe('a map review session', () => {
  it('checks by itself once its surface is open and withholds the preview until the verdict', async () => {
    const answers = answeredByHand();
    const session = createMapReviewSession();
    session.watch(held({ automatic: false }));
    await settle();
    expect(mocks.capture, 'before the surface asks').not.toHaveBeenCalled();
    session.watch(held());
    await runs(1);
    expect(session.snapshot()).toMatchObject({ result: null, pending: true, previewReady: false });
    answers[0]!.say({ status: 'clear' });
    await settle();
    expect(session.snapshot()).toMatchObject({ result: { status: 'clear' }, pending: false, previewReady: true });
    await expect(session.check()).resolves.toEqual({ status: 'clear' });
    expect(mocks.reviewMap, 'the kept verdict answers').toHaveBeenCalledOnce();
  });

  it('tells its readers as the state changes', async () => {
    const session = createMapReviewSession();
    const seen: boolean[] = [];
    const stop = session.subscribe(() => seen.push(session.snapshot().previewReady));
    session.watch(held());
    await runs(1);
    await settle();
    expect(seen.at(-1)).toBe(true);
    stop();
    session.watch(held({ revision: '2' }));
    expect(seen.at(-1), 'a reader that left hears nothing').toBe(true);
  });

  it('waits for the export where it does not check by itself, and shares the one run', async () => {
    const answers = answeredByHand();
    const session = createMapReviewSession();
    session.watch(held({ automatic: false, notes: null }));
    const first = session.check();
    const second = session.check();
    await runs(1);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(false, false);
    answers[0]!.say({ status: 'clear' });
    await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'clear' }, { status: 'clear' }]);
    expect(mocks.reviewMap).toHaveBeenCalledOnce();
  });

  it('blocks the preview only on a finding, and a check that could not run stands until retry', async () => {
    mocks.reviewMap.mockResolvedValue({ status: 'blocked', kind: 'text' });
    const session = createMapReviewSession();
    session.watch(held());
    await runs(1);
    await settle();
    expect(session.snapshot()).toMatchObject({ result: { status: 'blocked' }, previewReady: false });

    mocks.reviewMap.mockResolvedValue({ status: 'unavailable' });
    session.watch(held({ notes: 1 }));
    expect(session.snapshot(), 'changed notes retire the verdict').toMatchObject({ result: null, previewReady: false });
    await runs(2);
    await settle();
    expect(session.snapshot()).toMatchObject({ result: { status: 'unavailable' }, previewReady: true });
    await settle();
    expect(mocks.reviewMap, 'no check repeats by itself').toHaveBeenCalledTimes(2);

    mocks.reviewMap.mockResolvedValue({ status: 'clear' });
    session.retry();
    await runs(3);
    await settle();
    expect(session.snapshot()).toMatchObject({ result: { status: 'clear' }, previewReady: true });
  });

  it('never lets a late verdict stand for newer pictures', async () => {
    const answers = answeredByHand();
    const session = createMapReviewSession();
    session.watch(held());
    await runs(1);
    expect(session.snapshot(held({ revision: '2' })), 'a map a reader holds ahead of the store').toMatchObject({ result: null, previewReady: false, revision: '2:0:' });
    session.watch(held({ revision: '2' }));
    expect(answers[0]!.signal.aborted).toBe(true);
    answers[0]!.say({ status: 'clear' });
    await runs(2);
    await settle();
    expect(session.snapshot()).toMatchObject({ result: null, pending: true, previewReady: false });
    answers[1]!.say({ status: 'blocked', kind: 'image' });
    await settle();
    expect(session.snapshot()).toMatchObject({ result: { status: 'blocked' }, pending: false, previewReady: false });
    expect(session.snapshot(held()).result, 'nor for the pictures it was stopped on').toBeNull();
  });

  it('stops the run when its surface closes, and checks nothing for a closed one', async () => {
    const answers = answeredByHand();
    const session = createMapReviewSession();
    session.watch(held());
    await runs(1);
    session.watch(held({ open: false }));
    expect(answers[0]!.signal.aborted).toBe(true);
    expect(session.snapshot().pending).toBe(false);
    await expect(session.check()).resolves.toEqual({ status: 'unavailable' });
    expect(mocks.reviewMap).toHaveBeenCalledOnce();

    session.watch(held());
    await runs(2);
    session.release();
    expect(answers[1]!.signal.aborted).toBe(true);
  });

  it('stops on cancel and starts no other until it is asked', async () => {
    const answers = answeredByHand();
    const session = createMapReviewSession();
    session.watch(held({ automatic: false }));
    const stopped = session.check().catch(() => 'stopped');
    await runs(1);
    session.cancel();
    expect(answers[0]!.signal.aborted).toBe(true);
    answers[0]!.say({ status: 'clear' });
    expect(await stopped).toBe('stopped');
    expect(session.snapshot()).toMatchObject({ result: null, pending: false });
    answers.length = 0;
    void session.check();
    await runs(2);
    answers[0]!.say({ status: 'clear' });
    await settle();
    expect(session.snapshot().result).toEqual({ status: 'clear' });
  });

  it('shows a surface opened again on unchanged pictures the verdict already reached', async () => {
    const first = createMapReviewSession();
    first.watch(held());
    await runs(1);
    await settle();
    first.release();
    const again = createMapReviewSession();
    again.watch(held());
    expect(again.snapshot()).toMatchObject({ result: { status: 'clear' }, previewReady: true });
    again.watch(held({ illustration: 'v2' }));
    expect(again.snapshot(), 'another illustration').toMatchObject({ result: null, revision: '1:0:v2' });
    await runs(2);
    expect(mocks.capture).toHaveBeenLastCalledWith(true, true);
  });

  it('reads a pictured surface as clear without checking', async () => {
    const session = createMapReviewSession();
    session.watch(held({ pictured: true }));
    await settle();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(session.snapshot()).toMatchObject({ result: { status: 'clear' }, previewReady: true });
  });

  it('never checks in an edition without the automatic check, and lets its preview through', async () => {
    mocks.automatic = false;
    const session = createMapReviewSession();
    session.watch(held());
    await settle();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(session.snapshot()).toMatchObject({ result: null, pending: false, previewReady: true, revision: '1:0:' });
    session.watch(held({ revision: '2', notes: 3 }));
    expect(session.snapshot().revision).toBe('2:3:');
    await expect(session.check()).rejects.toThrow();
    session.retry();
    session.cancel();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
