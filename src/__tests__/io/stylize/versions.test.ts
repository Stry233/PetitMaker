// The session-only version shelf: mint/select/retire semantics, and invalidation driven by the
// map's own edit events rather than by any timer or store subscription of its own.
import { describe, it, expect, beforeEach } from 'vitest';
import { versionStore } from '../../../io/stylize/versions';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';

const image = {} as HTMLImageElement;

/** Every pre-existing scenario mints a fresh take; the stale-arrival path has its own test. */
const mint = (v: Parameters<typeof versionStore.mint>[0]) => {
  const minted = versionStore.mint(v);
  if (!minted) throw new Error('mint unexpectedly refused: stale fingerprint in a success-path test');
  return minted;
};

describe('versionStore', () => {
  beforeEach(() => versionStore.reset());

  it('mints monotonically numbered versions and auto-selects the newest', () => {
    const v1 = mint({ kind: 'model', direction: 'watercolor', image, fingerprint: 0 });
    expect(v1).toEqual({ id: 'v1', no: 1, kind: 'model', direction: 'watercolor', image, fingerprint: 0 });
    expect(versionStore.getState().selectedId).toBe('v1');

    const v2 = mint({ kind: 'model', direction: 'coastal', image, fingerprint: 0 });
    expect(v2.id).toBe('v2');
    expect(v2.no).toBe(2);
    expect(versionStore.getState().selectedId).toBe('v2');

    const v3 = mint({ kind: 'model', direction: 'sakura', image, fingerprint: 0 });
    expect(v3.id).toBe('v3');
    expect(v3.no).toBe(3);
    expect(versionStore.getState().versions.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
  });

  it('select/retire falls back to 原图 (null) when the selected version is retired', () => {
    const v1 = mint({ kind: 'model', direction: 'watercolor', image, fingerprint: 0 });
    const v2 = mint({ kind: 'model', direction: 'coastal', image, fingerprint: 0 });

    versionStore.select(v1.id);
    expect(versionStore.getState().selectedId).toBe(v1.id);

    versionStore.retire(v2.id);
    expect(versionStore.getState().versions.map((v) => v.id)).toEqual([v1.id]);
    expect(versionStore.getState().selectedId).toBe(v1.id); // untouched: v2 wasn't selected

    versionStore.retire(v1.id);
    expect(versionStore.getState().versions).toEqual([]);
    expect(versionStore.getState().selectedId).toBeNull();
  });

  it('select(null) means 原图', () => {
    const v1 = mint({ kind: 'model', direction: 'watercolor', image, fingerprint: 0 });
    versionStore.select(null);
    expect(versionStore.getState().selectedId).toBeNull();
    expect(versionStore.getState().versions.map((v) => v.id)).toEqual([v1.id]); // still on the shelf
  });

  it('remembers a custom version\'s prompt', () => {
    const v = mint({ kind: 'model', direction: 'custom', prompt: 'a hand-drawn map', image, fingerprint: 0 });
    expect(versionStore.getState().versions[0]!.prompt).toBe('a hand-drawn map');
    expect(v.prompt).toBe('a hand-drawn map');
  });

  it('setRunning flips the running flag', () => {
    expect(versionStore.getState().running).toBe(false);
    versionStore.setRunning(true);
    expect(versionStore.getState().running).toBe(true);
    versionStore.setRunning(false);
    expect(versionStore.getState().running).toBe(false);
  });

  it('reset empties the shelf and the mint counter', () => {
    mint({ kind: 'model', direction: 'watercolor', image, fingerprint: 0 });
    mint({ kind: 'model', direction: 'coastal', image, fingerprint: 0 });
    versionStore.reset();
    expect(versionStore.getState()).toEqual({ versions: [], selectedId: null, running: false });
    const v = mint({ kind: 'model', direction: 'watercolor', image, fingerprint: 0 });
    expect(v.id).toBe('v1'); // the counter reset too, not just the list
  });

  it('bindMapEvents retires every version on a cells-changed emit and clears the selection', () => {
    const bus = new EventBus<EditorEvents>();
    const unbind = versionStore.bindMapEvents(bus);

    const fp = versionStore.currentFingerprint();
    mint({ kind: 'model', direction: 'watercolor', image, fingerprint: fp });
    mint({ kind: 'model', direction: 'coastal', image, fingerprint: fp });
    expect(versionStore.getState().versions).toHaveLength(2);

    bus.emit('cells-changed', { cells: [{ x: 0, y: 0 }] });

    expect(versionStore.getState().versions).toEqual([]);
    expect(versionStore.getState().selectedId).toBeNull();

    unbind();
  });

  it('objects-changed and history-applied also invalidate the shelf', () => {
    const bus = new EventBus<EditorEvents>();
    versionStore.bindMapEvents(bus);

    mint({ kind: 'model', direction: 'watercolor', image, fingerprint: versionStore.currentFingerprint() });
    bus.emit('objects-changed', {});
    expect(versionStore.getState().versions).toEqual([]);

    mint({ kind: 'model', direction: 'watercolor', image, fingerprint: versionStore.currentFingerprint() });
    bus.emit('history-applied', { cells: [] });
    expect(versionStore.getState().versions).toEqual([]);
  });

  it('unbind stops retiring on further map events', () => {
    const bus = new EventBus<EditorEvents>();
    const unbind = versionStore.bindMapEvents(bus);
    unbind();

    mint({ kind: 'model', direction: 'watercolor', image, fingerprint: versionStore.currentFingerprint() });
    bus.emit('cells-changed', { cells: [] });
    expect(versionStore.getState().versions).toHaveLength(1);
  });

  it('subscribers are notified on mint, select, retire and reset', () => {
    let notifications = 0;
    const unsubscribe = versionStore.subscribe(() => { notifications++; });

    mint({ kind: 'model', direction: 'watercolor', image, fingerprint: 0 });
    versionStore.select(null);
    versionStore.retire(versionStore.getState().versions[0]?.id ?? 'nope');
    versionStore.reset();

    expect(notifications).toBeGreaterThanOrEqual(4);
    unsubscribe();
  });

  it('a take arriving with a stale fingerprint is refused, never shelved', () => {
    const bus = new EventBus<EditorEvents>();
    const unbind = versionStore.bindMapEvents(bus);

    // The job reads its fingerprint, then an edit lands while it is out painting.
    const fp = versionStore.currentFingerprint();
    bus.emit('cells-changed', { cells: [{ x: 0, y: 0 }] });

    const refused = versionStore.mint({ kind: 'model', direction: 'watercolor', image, fingerprint: fp });
    expect(refused).toBeNull();
    expect(versionStore.getState().versions).toEqual([]);
    expect(versionStore.getState().selectedId).toBeNull();

    // A fresh read mints normally again.
    const ok = versionStore.mint({ kind: 'model', direction: 'watercolor', image, fingerprint: versionStore.currentFingerprint() });
    expect(ok?.id).toBe('v1');

    unbind();
  });
});
