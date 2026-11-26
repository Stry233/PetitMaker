/**
 * Android's back as a back-out (`back-stack.ts:backOut`): while something on the back stack can be
 * backed out of, one close watcher, or in an installed app without `CloseWatcher` one history entry of
 * the page's own, takes the gesture and ends the newest state; with nothing standing there is neither,
 * so back leaves the app or the page as it always does. The tab's history gains at most that one
 * entry, at the page's own address, and loses it again once nothing stands.
 */
import { backOut, canBackOut, onBackChange } from './back-stack';
import { isInstalledApp } from '../device/fullscreen';

interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}
type CloseWatcherClass = new () => CloseWatcherLike;

/** The mark on the history entry the page pushes. */
const HISTORY_MARK = 'petitBack';
/** A close request this soon after an Escape press is that press's, which the back key already answered, in ms. */
const ESCAPE_CLOSE_MS = 100;

/** Reads the stack again once the update that changed it has finished. */
function onStackSettled(sync: () => void): () => void {
  let queued = false;
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  };
  const off = onBackChange(schedule);
  sync();
  return off;
}

/** A close watcher standing while something can be backed out of. Chromium raises a close request on
 *  Escape as well, which the back key answers first, so such a request only stands the watcher again. */
function watchCloseRequests(Watcher: CloseWatcherClass): () => void {
  let watcher: CloseWatcherLike | null = null;
  let escapeAt = -Infinity;
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') escapeAt = performance.now(); };
  const sync = (): void => {
    const wanted = canBackOut();
    if (wanted && !watcher) {
      const made = new Watcher();
      made.onclose = () => {
        if (watcher === made) watcher = null;
        if (performance.now() - escapeAt > ESCAPE_CLOSE_MS) backOut();
        sync();
      };
      watcher = made;
    } else if (!wanted && watcher) {
      const gone = watcher;
      watcher = null;
      gone.destroy();
    }
  };
  window.addEventListener('keydown', onKey, true);
  const off = onStackSettled(sync);
  return () => {
    off();
    window.removeEventListener('keydown', onKey, true);
    watcher?.destroy();
    watcher = null;
  };
}

const marked = (state: unknown): boolean => !!state && typeof state === 'object' && (state as Record<string, unknown>)[HISTORY_MARK] === true;

/** One history entry of the page's own while something can be backed out of: back pops it and backs
 *  out, and it is taken off again once nothing stands. */
function watchHistoryBack(): () => void {
  // A reload while the entry stood finds it current; it stands for nothing now.
  if (marked(history.state)) history.replaceState(null, '');
  let pushed = false;
  /** The page took its own entry off and waits for that pop. */
  let leaving = false;
  const sync = (): void => {
    if (leaving) return;
    const wanted = canBackOut();
    if (wanted && !pushed) {
      history.pushState({ [HISTORY_MARK]: true }, '');
      pushed = true;
    } else if (!wanted && pushed && marked(history.state)) {
      pushed = false;
      leaving = true;
      history.back();
    }
  };
  const onPop = (): void => {
    if (leaving) { leaving = false; sync(); return; }
    if (marked(history.state)) {
      // Forward onto the entry back just popped: it stands for what still stands, else goes again.
      if (!pushed && canBackOut()) pushed = true;
      else if (!pushed) { leaving = true; history.back(); }
      return;
    }
    if (!pushed) return;
    pushed = false;
    backOut();
    sync();
  };
  window.addEventListener('popstate', onPop);
  const off = onStackSettled(sync);
  return () => {
    off();
    window.removeEventListener('popstate', onPop);
  };
}

/** Takes Android's back while something stands: a close watcher where the browser has one, else in
 *  an installed app the page's own history entry; a tab without close watchers keeps its back as it is.
 *  Returns the stop. */
export function watchBackGesture(): () => void {
  const Watcher = (window as unknown as { CloseWatcher?: CloseWatcherClass }).CloseWatcher;
  if (typeof Watcher === 'function') return watchCloseRequests(Watcher);
  return isInstalledApp() ? watchHistoryBack() : () => {};
}
