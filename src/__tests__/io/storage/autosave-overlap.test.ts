import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'fflate';
import { readAutosave } from '../../../io/storage/autosave';
import { autosave } from '../../../editor/session/autosave';
import { COMPRESS_RECORD_AT } from '../../../io/storage/record-codec';
import { serialize } from '../../../io/save/json-codec';
import { DEFAULT_MAP } from '../../../config/maps';
import type { GridState } from '../../../core/model/types';
import { latticeMap } from '../../_support/legal-maps';

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
}

/** Compression workers whose replies the test releases one at a time, in any order. */
class HeldWorker {
  static all: HeldWorker[] = [];
  onmessage?: (event: { data: Uint8Array }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  input: Uint8Array | null = null;
  terminated = false;
  constructor() { HeldWorker.all.push(this); }
  postMessage(input: Uint8Array) { this.input = input; }
  terminate() { this.terminated = true; }
  reply() { this.onmessage?.({ data: gzipSync(this.input!, { level: 1 }) }); }
  crash() { this.onerror?.(); }
}

/** A map whose save exceeds the compression threshold, painted at one elevation so two maps differ. */
const largeMap = (elevation: number): GridState => latticeMap(DEFAULT_MAP, elevation);

function restoredElevation(): number | undefined {
  const restored = readAutosave();
  if (!restored) return undefined;
  for (const row of restored.state.cells) for (const cell of row) if (cell.terrain) return cell.terrain.elevation;
  return undefined;
}

describe('overlapping autosave writes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemStorage());
    vi.stubGlobal('Worker', HeldWorker);
    HeldWorker.all = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    autosave.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses the compression path for these maps', () => {
    expect(serialize(largeMap(1)).length).toBeGreaterThan(COMPRESS_RECORD_AT);
  });

  it('an older compression finishing after a newer one never replaces the newer map', async () => {
    autosave.schedule(largeMap(1));
    vi.advanceTimersByTime(2000);
    autosave.schedule(largeMap(2));
    vi.advanceTimersByTime(2000);
    const [first, second] = HeldWorker.all;
    expect(first!.terminated).toBe(true);
    second!.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(2);
    first!.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(2);
  });

  it('an edit while the earlier map is compressing drops that write and keeps the stored map until the edit lands', async () => {
    autosave.schedule(largeMap(1));
    vi.advanceTimersByTime(2000);
    HeldWorker.all[0]!.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(1);

    autosave.schedule(largeMap(2));
    vi.advanceTimersByTime(2000);
    autosave.schedule(largeMap(3));
    HeldWorker.all[1]!.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(1);
    vi.advanceTimersByTime(2000);
    HeldWorker.all[2]!.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(3);
  });

  it('hiding the page writes the pending map at once, and a stale compression cannot overwrite it', async () => {
    autosave.schedule(largeMap(1));
    vi.advanceTimersByTime(2000);
    autosave.schedule(largeMap(2));
    autosave.flush();
    expect(restoredElevation()).toBe(2);
    HeldWorker.all[0]!.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(2);
  });

  it('a crashed compression saves on this thread only while its map is still the newest', async () => {
    autosave.schedule(largeMap(1));
    vi.advanceTimersByTime(2000);
    HeldWorker.all[0]!.crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(1);

    autosave.schedule(largeMap(2));
    vi.advanceTimersByTime(2000);
    autosave.schedule(largeMap(3));
    HeldWorker.all[1]!.crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(restoredElevation()).toBe(1);
  });

  it('a reset while a compression is in flight leaves nothing behind', async () => {
    autosave.schedule(largeMap(1));
    vi.advanceTimersByTime(2000);
    autosave.clear();
    HeldWorker.all[0]!.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(readAutosave()).toBeNull();
  });
});
