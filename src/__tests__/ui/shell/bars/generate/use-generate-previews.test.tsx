// @vitest-environment jsdom
/** A preview card whose build throws goes blank and never holds the batch's spinner. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeState } from '../../../../_support/map-state';
import { CANDIDATES } from '../../../../../ui/shell/bars/generate/generate-shelf';

const build = vi.hoisted(() => ({ throwOn: new Set<number>(), calls: 0, notes: undefined as unknown, asked: [] as { notes?: unknown }[] }));
vi.mock('../../../../../editor/operations', async (importOriginal) => ({
  ...await importOriginal<object>(),
  peekCandidate: () => null,
  generateCandidate: async (_kit: unknown, opts: { config: { seed: number } }) => {
    const n = build.calls++;
    if (build.throwOn.has(n)) throw new Error('generator threw');
    return { state: {}, outcome: {}, commands: [], seed: opts.config.seed };
  },
}));
vi.mock('../../../../../editor/session/context', async (importOriginal) => ({
  ...await importOriginal<object>(),
  currentEditor: () => ({ state: { annotations: build.notes } }),
}));
vi.mock('../../../../../view/map2d/capture/thumbnail', () => ({
  focusFrame: () => ({}),
  renderThumbnail: async (_state: unknown, _px: number, opts: { notes?: unknown }) => { build.asked.push(opts); return 'data:image/png;base64,AA'; },
}));

const { useGeneratePreviews } = await import('../../../../../ui/shell/bars/generate/use-generate-previews');

/** One options object for every render, as the shelf holds its inputs steady between edits. */
function options(customSeed: number | null = null) {
  return {
    gridState: makeState(20, 20), region: [], selectingRegion: false,
    settings: { kind: 'island' as const, richness: 50, maxElevation: 2, corridorWidth: 1, gates: null },
    base: 1, customSeed, hand: [], ownSample: null, fontsReady: true, ownFontsReady: true,
    planInputs: null, wordFits: () => true, fits: true, recipeKey: 'k', forgetApplied: () => {}, clearFailed: () => {},
  };
}

/** Past the debounce before a batch builds, on the faked clock. */
async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => {
  vi.useRealTimers();
  build.throwOn.clear();
  build.calls = 0;
  build.notes = undefined;
  build.asked.length = 0;
});

describe('generate previews', () => {
  it('blanks a card whose build throws and lets the batch finish', async () => {
    build.throwOn.add(1);
    const { result, unmount } = renderHook((o) => useGeneratePreviews(o), { initialProps: options() });
    await settle();
    expect(result.current.previewing).toBe(false);
    expect(result.current.shots).toHaveLength(CANDIDATES);
    expect(result.current.shots[1]).toBeNull();
    expect(result.current.shots.filter((s) => typeof s === 'string')).toHaveLength(CANDIDATES - 1);
    expect(result.current.candidateAt(1)).toBeNull();
    unmount();
  });

  it('blanks the own card when its build throws instead of leaving it pending', async () => {
    build.throwOn.add(CANDIDATES);
    const { result, unmount } = renderHook((o) => useGeneratePreviews(o), { initialProps: options(7) });
    await settle();
    expect(result.current.customPending).toBe(false);
    expect(result.current.customShot).toBeNull();
    unmount();
  });

});
