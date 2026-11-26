/**
 * Change Planet's carry preview: worked out once per map version, notes and destination, and an
 * answer that lands after the map or its notes moved, or after the asking step went, is dropped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../../_support/map-state';
import { MAP_LIST } from '../../../config/maps';

const asked = vi.hoisted(() => ({ answers: [] as ((preview: unknown) => void)[] }));
vi.mock('../../../tools/generation/run', async (actual) => ({
  ...await actual<object>(),
  requestTransferPreview: () => new Promise((resolve) => { asked.answers.push(resolve); }),
}));

const {
  cachedCarryPreview, carryPreviewsVersion, requestCarryPreview,
} = await import('../../../editor/operations/transfer-map');

const target = MAP_LIST[1]!;
const PREVIEW = { state: {}, dropped: [] };
const answer = async () => { asked.answers.shift()!(PREVIEW); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => { asked.answers.length = 0; });

describe('the carry preview', () => {
  it('is remembered for the map and notes it was asked for', async () => {
    const state = makeState(10, 10);
    const version = carryPreviewsVersion();
    requestCarryPreview(state, target, { notesEpoch: () => 4, settleMs: 0 });
    expect(cachedCarryPreview(state, 4, target)).toBeNull();
    await answer();
    expect(cachedCarryPreview(state, 4, target)).toBe(PREVIEW);
    expect(carryPreviewsVersion()).toBeGreaterThan(version);
    expect(cachedCarryPreview(state, 5, target), 'other notes are another map').toBeNull();
  });

  it('drops an answer once the notes moved while it was worked out', async () => {
    const state = makeState(10, 10);
    let epoch = 1;
    requestCarryPreview(state, target, { notesEpoch: () => epoch, settleMs: 0 });
    epoch = 2;
    await answer();
    expect(cachedCarryPreview(state, 1, target)).toBeNull();
    expect(cachedCarryPreview(state, 2, target)).toBeNull();
  });

  it('remembers nothing once cancelled', async () => {
    const state = makeState(10, 10);
    const cancel = requestCarryPreview(state, target, { notesEpoch: () => 0, settleMs: 0 });
    cancel();
    await answer();
    expect(cachedCarryPreview(state, 0, target)).toBeNull();
  });
});
