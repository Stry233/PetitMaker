/**
 * The generate shelf's batch session: a preview card whose build throws goes blank and never holds
 * the batch's spinner, one card lands at a time and stands as the landed card only once its run has
 * landed, a run that throws says so on its card for a moment, and a card of the batch on show lands
 * by its place in the row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../../_support/map-state';
import { CANDIDATES } from '../../../tools/generation/facts';
import { useEditorStore } from '../../../state/store';
import type { Outcome } from '../../../editor/operations';

const build = vi.hoisted(() => ({
  throwOn: new Set<number>(), calls: 0, lands: 0,
  landing: null as null | { resolve: (o: unknown) => void; reject: (e: unknown) => void },
}));
vi.mock('../../../editor/operations', async (importOriginal) => ({
  ...await importOriginal<object>(),
  peekCandidate: () => null,
  generateCandidate: async (_kit: unknown, opts: { config: { seed: number } }) => {
    const n = build.calls++;
    if (build.throwOn.has(n)) throw new Error('generator threw');
    return { state: {}, outcome: {}, commands: [], seed: opts.config.seed };
  },
  generateMap: () => {
    build.lands += 1;
    return new Promise((resolve, reject) => { build.landing = { resolve, reject }; });
  },
}));
vi.mock('../../../editor/session/context', async (importOriginal) => ({
  ...await importOriginal<object>(),
  currentEditor: () => ({ state: { annotations: undefined } }),
}));
vi.mock('../../../view/map2d/capture/thumbnail', () => ({
  focusFrame: () => ({}),
  renderThumbnail: async () => 'data:image/png;base64,AA',
}));
vi.mock('../../../editor/editing/generate-report', () => ({ reportGenerate: () => true }));

const { createGenerateBatch, landCard } = await import('../../../editor/editing/generate-batch');
const { createGenerateRecipe } = await import('../../../editor/editing/generate-recipe');

/** A planet recipe, whose cards are recipe numbers; `own` files the visitor's own number. */
const newRecipe = (own?: string) => {
  const recipe = createGenerateRecipe(['island'], 'island', { richness: 50, corridorWidth: 1, contrast: 100 });
  if (own) recipe.commitCustom(own);
  return recipe;
};
const FAILED_MS = 4000;
const newBatch = (extra: { landed?: (o: Outcome) => void; own?: string; kit?: never } = {}) => createGenerateBatch({
  shotSize: { px: 64, aspect: 1 }, failedMs: FAILED_MS, recipe: newRecipe(extra.own),
  ...(extra.landed ? { ends: { gates: () => null, landed: extra.landed, forgetLanded: () => {}, cancelDrag: () => {} } } : {}),
  ...(extra.kit ? { kit: extra.kit } : {}),
});

/** Past the debounce before a batch builds, on the faked clock. */
const settle = () => vi.advanceTimersByTimeAsync(600);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useEditorStore.setState({ gridState: makeState(20, 20), generateApplied: null, commandExecutor: { historyDepth: () => 3, attachAside: () => {} } as never });
});
afterEach(() => {
  vi.useRealTimers();
  build.throwOn.clear();
  build.calls = 0;
  build.lands = 0;
  build.landing = null;
});

describe('the batch previews', () => {
  it('blanks a card whose build throws and lets the batch finish', async () => {
    build.throwOn.add(1);
    const batch = newBatch();
    const stop = batch.previewBatch();
    await settle();
    const view = batch.get();
    expect(view.previewing).toBe(false);
    expect(view.shots).toHaveLength(CANDIDATES);
    expect(view.shots[1]).toBeNull();
    expect(view.shots.filter((s) => typeof s === 'string')).toHaveLength(CANDIDATES - 1);
    expect(batch.candidateAt(1)).toBeNull();
    stop?.();
  });

  it('blanks the own card when its build throws instead of leaving it pending', async () => {
    build.throwOn.add(0);
    const batch = newBatch({ own: '7' });
    const stop = batch.previewOwn();
    await settle();
    expect(batch.get().customPending).toBe(false);
    expect(batch.get().customShot).toBeNull();
    stop?.();
  });
});

describe('landing a card', () => {
  it('lands one card at a time and stands it as the landed card once its run has landed', async () => {
    const landed = vi.fn();
    const batch = newBatch({ landed });
    const first = batch.landCard(2);
    await expect(batch.landCard(3)).resolves.toBe('busy');
    expect(build.lands, 'a second click while one lands is ignored').toBe(1);
    expect(batch.get().landingIndex).toBe(2);
    expect(useEditorStore.getState().generateApplied, 'nothing stands before the run lands').toBeNull();
    build.landing!.resolve({ cells: [], cancelled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(batch.get().landingIndex).toBeNull();
    await expect(first).resolves.toBe('landed');
    expect(useEditorStore.getState().generateApplied?.card).toBe(2);
    expect(landed).toHaveBeenCalledTimes(1);
    batch.dispose();
    expect(useEditorStore.getState().generateApplied, 'closing the shelf lets go of its landed card').toBeNull();
  });

  it('says on its card that a run threw, for a moment', async () => {
    const batch = newBatch();
    const run = batch.landCard(1);
    build.landing!.reject(new Error('run threw'));
    await expect(run).resolves.toBe('failed');
    expect(batch.get().failedIndex).toBe(1);
    expect(batch.get().landingIndex).toBeNull();
    expect(useEditorStore.getState().generateApplied).toBeNull();
    await vi.advanceTimersByTimeAsync(FAILED_MS);
    expect(batch.get().failedIndex).toBeNull();
  });

  it('lands nothing from a batch built on a map handed in', async () => {
    const batch = newBatch({ kit: { state: makeState(20, 20) } as never });
    await expect(batch.landCard(0)).resolves.toBe('unavailable');
    expect(build.lands).toBe(0);
  });

  it('refuses a card with no recipe: the own card before the visitor gave it a number', async () => {
    const batch = newBatch();
    await expect(batch.landCard(CANDIDATES)).resolves.toBe('unavailable');
    expect(build.lands).toBe(0);
  });
});

describe('the batch on show', () => {
  it('lands the card at a place in its row, and nothing once the shelf is put away', async () => {
    await expect(landCard(0), 'no shelf is open').resolves.toBe('closed');
    const batch = newBatch({ own: '7' });
    const takeDown = batch.show();
    const run = landCard(CANDIDATES);
    expect(batch.get().landingIndex, 'the own card stands after the dealt ones').toBe(CANDIDATES);
    build.landing!.resolve({ cells: [], cancelled: false });
    await expect(run).resolves.toBe('landed');
    expect(useEditorStore.getState().generateApplied?.card).toBe(CANDIDATES);
    takeDown();
    batch.dispose();
    await expect(landCard(0)).resolves.toBe('closed');
    expect(build.lands).toBe(1);
  });

  it('lands on the shelf opened last, and on the one under it once that is put away', async () => {
    const under = newBatch();
    const over = newBatch();
    const takeDownUnder = under.show();
    const takeDownOver = over.show();
    const onOver = landCard(1);
    expect([under.get().landingIndex, over.get().landingIndex]).toEqual([null, 1]);
    build.landing!.resolve({ cells: [], cancelled: false });
    await expect(onOver).resolves.toBe('landed');
    takeDownOver();
    over.dispose();
    const onUnder = landCard(3);
    expect(under.get().landingIndex).toBe(3);
    build.landing!.resolve({ cells: [], cancelled: false });
    await expect(onUnder).resolves.toBe('landed');
    takeDownUnder();
    under.dispose();
  });
});
