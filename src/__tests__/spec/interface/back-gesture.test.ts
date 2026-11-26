// @vitest-environment jsdom
/**
 * Android's back (UI-12) over the page's back stack: a close watcher where the browser has one, else
 * in an installed app one history entry of the page's own. jsdom has neither a close watcher nor a
 * display mode, so a stand-in watcher and the media query stand in for the browser's.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { enterBack, leaveBack, type BackEntry } from '../../../platform/input/back-stack';
import { watchBackGesture } from '../../../platform/input/back-gesture';

/** A state that stands until backed out of. */
function state(id: string): BackEntry & { standing: boolean } {
  const entry = { id, standing: true, stands: () => entry.standing, back: () => { entry.standing = false; } };
  return entry;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The close watchers the page stood, as the browser holds them. */
let watchers: { onclose: (() => void) | null; destroyed: boolean; destroy(): void }[] = [];
class StandInWatcher {
  onclose: (() => void) | null = null;
  destroyed = false;
  constructor() { watchers.push(this); }
  destroy(): void { this.destroyed = true; }
}
const live = () => watchers.filter((w) => !w.destroyed && w.onclose);
/** Android's back with a close watcher standing: the newest one closes. */
const closeRequest = () => { const w = live().at(-1)!; w.destroyed = true; w.onclose!(); };

let entries: BackEntry[] = [];
let stop = (): void => {};
const stand = (...made: BackEntry[]) => { for (const e of made) { entries.push(e); enterBack(e); } };

beforeEach(() => { watchers = []; entries = []; });
afterEach(() => {
  stop();
  for (const e of entries) leaveBack(e);
  delete (window as { CloseWatcher?: unknown }).CloseWatcher;
});

describe('Android back', () => {
  spec('UI-12', 'with a close watcher, back ends the newest state, and with nothing standing no watcher is left to keep the app', async () => {
    (window as { CloseWatcher?: unknown }).CloseWatcher = StandInWatcher;
    stop = watchBackGesture();
    await settle();
    expect(live()).toHaveLength(0);
    const older = state('older'), newer = state('newer');
    stand(older, newer);
    await settle();
    expect(live()).toHaveLength(1);
    closeRequest();
    await settle();
    expect([older.standing, newer.standing]).toEqual([true, false]);
    expect(live()).toHaveLength(1);
    closeRequest();
    await settle();
    expect(older.standing).toBe(false);
    expect(live()).toHaveLength(0);
  });

  spec('UI-12', 'the close request an Escape press raises backs out of nothing more, and the watcher stands again', async () => {
    (window as { CloseWatcher?: unknown }).CloseWatcher = StandInWatcher;
    stop = watchBackGesture();
    const one = state('one');
    stand(one);
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    closeRequest();
    await settle();
    expect(one.standing).toBe(true);
    expect(live()).toHaveLength(1);
  });

  spec('UI-12', 'in an installed app without close watchers, one history entry of the page stands while something does, and back pops it and backs out', async () => {
    window.matchMedia = ((query: string) => ({ matches: query === '(display-mode: standalone)', media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const start = history.length;
    stop = watchBackGesture();
    const one = state('one');
    stand(one);
    await settle();
    expect(history.length).toBe(start + 1);
    const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    history.back();
    await popped;
    await settle();
    expect(one.standing).toBe(false);
    expect(history.state).toBeNull();
    // Something standing again takes one entry again; ended another way, the page takes its entry off.
    const two = state('two');
    stand(two);
    await settle();
    expect((history.state as Record<string, unknown> | null)?.petitBack).toBe(true);
    two.standing = false;
    leaveBack(two);
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    await settle();
    expect(history.state).toBeNull();
  });
});
