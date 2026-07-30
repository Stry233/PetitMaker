import { describe, it, expect } from 'vitest';
import { ChunkTracker } from '../../core/model/chunk-tracker';

describe('ChunkTracker', () => {
  it('starts with zero load for all chunks', () => {
    const tracker = new ChunkTracker();
    expect(tracker.getLoad(0, 0)).toBe(0);
    expect(tracker.getLoad(5, 5)).toBe(0);
  });

  it('adds load when an object is placed', () => {
    const tracker = new ChunkTracker();
    const delta = tracker.addObject({ x: 5, y: 5 }, 1, 1, 594);
    expect(tracker.getLoad(0, 0)).toBe(594);
    expect(delta.get('0,0')).toBe(594);
  });

  it('removes load when an object is removed', () => {
    const tracker = new ChunkTracker();
    tracker.addObject({ x: 5, y: 5 }, 1, 1, 594);
    const delta = tracker.removeObject({ x: 5, y: 5 }, 1, 1, 594);
    expect(tracker.getLoad(0, 0)).toBe(0);
    expect(delta.get('0,0')).toBe(-594);
  });

  it('tracks load across multiple chunks for large objects', () => {
    const tracker = new ChunkTracker();
    tracker.addObject({ x: 15, y: 15 }, 2, 2, 1000);
    expect(tracker.getLoad(0, 0)).toBe(1000);
    expect(tracker.getLoad(1, 0)).toBe(1000);
    expect(tracker.getLoad(0, 1)).toBe(1000);
    expect(tracker.getLoad(1, 1)).toBe(1000);
  });

  it('canPlace returns true when under limit', () => {
    const tracker = new ChunkTracker();
    expect(tracker.canPlace({ x: 0, y: 0 }, 1, 1, 5000)).toBe(true);
  });

  it('canPlace returns false when over limit', () => {
    const tracker = new ChunkTracker();
    tracker.addObject({ x: 0, y: 0 }, 1, 1, 9500);
    expect(tracker.canPlace({ x: 1, y: 1 }, 1, 1, 600)).toBe(false);
  });

  it('getChunkLoads returns full map', () => {
    const tracker = new ChunkTracker();
    tracker.addObject({ x: 0, y: 0 }, 1, 1, 100);
    tracker.addObject({ x: 20, y: 0 }, 1, 1, 200);
    const loads = tracker.getChunkLoads();
    expect(loads.get('0,0')).toBe(100);
    expect(loads.get('1,0')).toBe(200);
  });

  it('applyDelta correctly adjusts loads', () => {
    const tracker = new ChunkTracker();
    tracker.addObject({ x: 0, y: 0 }, 1, 1, 500);
    const delta = new Map<string, number>();
    delta.set('0,0', -500);
    tracker.applyDelta(delta);
    expect(tracker.getLoad(0, 0)).toBe(0);
  });
});
