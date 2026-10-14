/** A history lane records the current snapshot as an undo step, capped, and steps either way. */
import { describe, it, expect } from 'vitest';
import { laneRecord, laneStep, type HistoryLane } from '../../state/history-lane';

const empty: HistoryLane<number> = { undo: [], redo: [] };

describe('history lane', () => {
  it('records the current snapshot and ends the redo branch', () => {
    expect(laneRecord({ undo: [1], redo: [5] }, 2)).toEqual({ undo: [1, 2], redo: [] });
  });

  it('keeps at most the limit, dropping the oldest', () => {
    let lane = empty;
    for (let i = 0; i < 8; i++) lane = laneRecord(lane, i, 3);
    expect(lane.undo).toEqual([5, 6, 7]);
    expect(laneRecord({ undo: [1, 2, 3], redo: [] }, 4, 1).undo).toEqual([4]);
  });

  it('steps back and forward, moving the current snapshot across', () => {
    const back = laneStep({ undo: [1, 2], redo: [] }, 3, 'undo')!;
    expect(back).toEqual({ restored: 2, lane: { undo: [1], redo: [3] } });
    expect(laneStep(back.lane, 2, 'redo')).toEqual({ restored: 3, lane: { undo: [1, 2], redo: [] } });
    expect(laneStep(empty, 0, 'undo')).toBeNull();
    expect(laneStep(empty, 0, 'redo')).toBeNull();
  });
});
