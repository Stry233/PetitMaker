// @vitest-environment jsdom
/**
 * The carry step's preview request: one per map version and destination, cancelled when the
 * question changes, and never shown for a question that is no longer being asked.
 *
 * The request itself is stubbed so each answer arrives when the test says; what is pinned is the
 * hook's side of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getMapTemplate } from '../../../../../config/maps';
import { createGridState } from '../../../../../core/model/template';
import type { GridState, MapTemplate } from '../../../../../core/model/types';
import type { TransferPreview, TransferPreviewRequest } from '../../../../../editor/operations';
import { useEditorStore } from '../../../../../state/store';

interface Asked { state: GridState; target: MapTemplate; request: TransferPreviewRequest; answer: (p: TransferPreview | null) => void }
const asked: Asked[] = [];

vi.mock('../../../../../editor/operations', () => ({
  requestTransferPreview: (state: GridState, target: MapTemplate, request: TransferPreviewRequest) =>
    new Promise<TransferPreview | null>((answer) => { asked.push({ state, target, request, answer }); }),
}));

const { useCarryPreview } = await import('../../../../../ui/chrome/modals/planet/PlanetCarryStep');

const tafa = getMapTemplate('tafa');
const hexia = getMapTemplate('hexia');
const previewOf = (target: MapTemplate): TransferPreview => ({
  state: createGridState(target), dropped: [], moved: { cells: 0, objects: 0 }, droppedCounts: { cells: 0, objects: 0 },
});

let map: GridState;
beforeEach(() => { asked.length = 0; map = createGridState(hexia); });

const answer = async (i: number, preview: TransferPreview | null) => { await act(async () => { asked[i]!.answer(preview); }); };

describe('the carry preview request', () => {
  it('asks once, shows the answer, and answers again from the cache', async () => {
    const hook = renderHook(({ active }) => useCarryPreview(map, tafa, active), { initialProps: { active: true } });
    expect(hook.result.current).toBeNull();
    expect(asked).toHaveLength(1);
    const p = previewOf(tafa);
    await answer(0, p);
    expect(hook.result.current).toBe(p);
    hook.rerender({ active: false });
    expect(hook.result.current).toBeNull();
    hook.rerender({ active: true });
    expect(hook.result.current).toBe(p);
    hook.unmount();
    expect(renderHook(() => useCarryPreview(map, tafa, true)).result.current).toBe(p);
    expect(asked).toHaveLength(1);
  });

  it('cancels a request whose destination changed and never shows its answer', async () => {
    const hook = renderHook(({ target }) => useCarryPreview(map, target, true), { initialProps: { target: tafa } });
    hook.rerender({ target: hexia });
    expect(asked.map((a) => a.target)).toEqual([tafa, hexia]);
    expect(asked[0]!.request.signal.aborted).toBe(true);
    expect(asked[1]!.request.signal.aborted).toBe(false);
    await answer(0, previewOf(tafa));
    expect(hook.result.current).toBeNull();
    const p = previewOf(hexia);
    await answer(1, p);
    expect(hook.result.current).toBe(p);
    // The cancelled answer was not kept either: going back asks again.
    hook.rerender({ target: tafa });
    expect(asked).toHaveLength(3);
  });

  it('cancels when the step is left', () => {
    const hook = renderHook(({ active }) => useCarryPreview(map, tafa, active), { initialProps: { active: true } });
    hook.rerender({ active: false });
    expect(asked[0]!.request.signal.aborted).toBe(true);
    hook.unmount();
  });

  it('drops an answer for a map edited since it was asked, and asks about the edited map', async () => {
    const hook = renderHook(() => useCarryPreview(map, tafa, true));
    map.cellsVersion = (map.cellsVersion ?? 0) + 1;
    hook.rerender();
    expect(asked).toHaveLength(2);
    expect(asked[0]!.request.signal.aborted).toBe(true);
    await answer(0, previewOf(tafa));
    expect(hook.result.current).toBeNull();
    const p = previewOf(tafa);
    await answer(1, p);
    expect(hook.result.current).toBe(p);
  });

  it('asks again once the plan notes changed, since they carry and edit in place', async () => {
    const hook = renderHook(() => useCarryPreview(map, tafa, true));
    await answer(0, previewOf(tafa));
    act(() => { useEditorStore.setState((s) => ({ annotationsEpoch: s.annotationsEpoch + 1 })); });
    expect(hook.result.current).toBeNull();
    expect(asked).toHaveLength(2);
    const p = previewOf(tafa);
    await answer(1, p);
    expect(hook.result.current).toBe(p);
  });

  it('drops an answer when the map changed under a request that was not cancelled', async () => {
    const hook = renderHook(() => useCarryPreview(map, tafa, true));
    // An edit the hook has not re-rendered for yet: the request is still live when its answer lands.
    map.objectsVersion = (map.objectsVersion ?? 0) + 1;
    await answer(0, previewOf(tafa));
    expect(hook.result.current).toBeNull();
  });

  it('waits for the step to settle before the main thread takes the replay', async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useCarryPreview(map, tafa, true, 300));
      let idle = false;
      void asked[0]!.request.whenIdle().then(() => { idle = true; });
      await vi.advanceTimersByTimeAsync(299);
      expect(idle).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(idle).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
