/**
 * The page's one back stack: every state a visitor can back out of, in the order it was entered, so
 * Escape, Android's back and the tour end the newest one still standing (`backOut`), and
 * Delete asks that same one what it means (`deleteMeaning`). The editor feeds the states it reads off
 * the store through a source polled before every read (`addBackSource`), and each floating surface
 * feeds itself while open. A state of the map stands under an open window
 * (`channels/overlay-state.ts:anyOverlayOpen`) and never pops before it. A page-wide mechanism.
 */
import { anyOverlayOpen } from '../channels/overlay-state';
import { createSignal } from '../../core/base/signal';
import { isComposingKey, isTextEntry } from './text-entry';

/** Where an entry ranks besides its entry order: under every other entry, among them, or over all of them. */
export type BackRank = -1 | 0 | 1;

/** What Delete does while an entry is in front: a body, `'pass'` to ask the entry under it, or null to
 *  keep the key and do nothing (a menu or question holding the keyboard). */
export type DeleteMeaning = (() => void) | 'pass' | null;

export interface BackEntry {
  /** Stable per state; entering an id that stands again moves it to the top. */
  readonly id: string;
  /** Whether it still stands; one that no longer does is dropped. */
  stands(): boolean;
  /** Backs out of it, leaving it no longer standing, unless it asks first (an entry entering above it). */
  back(): void;
  /** False while it stands out of reach (disconnected, inert or hidden): passed over and kept. */
  reachable?(): boolean;
  /** Takes a back-out without backing out of anything, as a save still landing does. */
  holds?(): boolean;
  rank?(): BackRank;
  /** A state of the map, which a window stands over. */
  readonly map?: boolean;
  /** A floating surface (a window, menu, question or card), which Escape closes even with the back
   *  command unbound. */
  readonly surface?: boolean;
  /** Absent, Delete passes to the entry under it. */
  deletes?(): DeleteMeaning;
  /** A surface's root, inside which the editor's keys do not act (`insideOpenSurface`). */
  root?(): HTMLElement | null;
}

const entries: BackEntry[] = [];
const sources = new Set<() => void>();
const changed = createSignal();
/** Counts entries entered, so a back-out can tell whether its entry asked something first. */
let entered = 0;

/** Enters `entry` at the top, or under the first entry `beneath` names (a surface opened over its own
 *  child); an entry of the same id leaves first. */
export function enterBack(entry: BackEntry, beneath?: (other: BackEntry) => boolean): void {
  const was = entries.findIndex((e) => e.id === entry.id);
  if (was >= 0) entries.splice(was, 1);
  const under = beneath ? entries.findIndex(beneath) : -1;
  if (under >= 0) entries.splice(under, 0, entry);
  else entries.push(entry);
  entered++;
  changed.emit();
}

/** Takes `entry` off the stack; a later entry of its id stays. */
export function leaveBack(entry: BackEntry): void {
  const at = entries.indexOf(entry);
  if (at < 0) return;
  entries.splice(at, 1);
  changed.emit();
}

/** Adds a source the stack polls before it is read; returns the removal. */
export function addBackSource(sync: () => void): () => void {
  sources.add(sync);
  return () => { sources.delete(sync); };
}

/** Called whenever an entry enters or leaves; returns the unsubscribe. */
export function onBackChange(listener: () => void): () => void {
  return changed.subscribe(listener);
}

const rankOf = (e: BackEntry): BackRank => e.rank?.() ?? 0;

/** The standing entries from the newest down, sources polled first and the fallen dropped. */
function standing(): BackEntry[] {
  for (const sync of [...sources]) sync();
  for (const e of [...entries]) if (!e.stands()) leaveBack(e);
  return entries.map((e, i) => ({ e, i }))
    .sort((a, b) => rankOf(b.e) - rankOf(a.e) || b.i - a.i)
    .map(({ e }) => e);
}

/** Whether `e` can be backed out of now: within reach, and no window over it if it is the map's. */
const open = (e: BackEntry): boolean => e.reachable?.() !== false && !(e.map && anyOverlayOpen());

/** The entry a back-out ends now, or null where nothing stands within reach. */
function front(): BackEntry | null {
  return standing().find(open) ?? null;
}

/** The standing floating surfaces from the one a back-out ends first down, within reach unless
 *  `all`: the one order Escape, focus and the arrows follow. */
export function surfaceOrder(all = false): BackEntry[] {
  return standing().filter((e) => e.surface && (all || open(e)));
}

/** The entry of `id` on the stack, or undefined. */
export function entryOfId(id: string): BackEntry | undefined {
  return entries.find((e) => e.id === id);
}

/** Whether a back-out would end something now. */
export function canBackOut(): boolean {
  return front() !== null;
}

/** What a back-out may end: anything, or only a floating surface in front. */
type BackScope = 'all' | 'surfaces';

/**
 * Backs out of the newest standing entry within reach and returns whether anything took the press;
 * in `'surfaces'` scope only while that entry is a floating surface. The entry must no longer stand
 * after it, unless it asked something first; one that still does is dropped, so it can never hold Escape.
 */
export function backOut(scope: BackScope = 'all'): boolean {
  const target = front();
  if (!target || (scope === 'surfaces' && !target.surface)) return false;
  if (target.holds?.()) return true;
  const before = entered;
  target.back();
  standing();
  if (entries.includes(target) && target.stands() && entered === before) leaveBack(target);
  return true;
}

/** What Delete does now: the body the newest entry within reach names, asking past those that give it
 *  no meaning; null for nothing. */
export function deleteMeaning(): (() => void) | null {
  for (const e of standing()) {
    if (!open(e)) continue;
    const meaning = e.deletes ? e.deletes() : 'pass';
    if (meaning !== 'pass') return meaning;
  }
  return null;
}

/** Whether `target` sits inside the root of an open surface within reach, where the editor's keys do not act. */
export function insideOpenSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  return entries.some((e) => {
    const root = e.root?.();
    return !!root && root.contains(target) && e.stands() && open(e);
  });
}

/** Whether `el` is within reach: connected, not inert, not hidden from assistive technology or the eye. */
export function reachableRoot(el: HTMLElement | null): boolean {
  if (!el?.isConnected || el.closest('[inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/* ── the back key ─────────────────────────────────────────────────────────── */

/** Escape with no modifier. */
export const plainEscape = (e: KeyboardEvent): boolean => e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

/** What a key press backs out of as the back key, or null for a press that is not it; Escape alone
 *  until the editor names its binding. */
let isBackKey: (e: KeyboardEvent) => BackScope | null = (e) => (plainEscape(e) ? 'all' : null);

/** Whether a key press is the back key, for a listener that holds every other key (What's this?). */
export const backKeyPressed = (e: KeyboardEvent): boolean => isBackKey(e) !== null;

/** Names the back key, as the keymap binds it; returns the way back to the previous one. */
export function setBackKey(matches: (e: KeyboardEvent) => BackScope | null): () => void {
  const was = isBackKey;
  isBackKey = matches;
  return () => { if (isBackKey === matches) isBackKey = was; };
}

/** Whether a field takes the key as its own: a printing key typed into it, or Escape in a search
 *  field holding text, which the browser clears. */
function fieldTakes(e: KeyboardEvent): boolean {
  if (!isTextEntry(e.target)) return false;
  const el = e.target as Partial<HTMLInputElement>;
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
  return e.key === 'Escape' && el.tagName === 'INPUT' && el.type === 'search' && el.value !== '';
}

/** Presses the dispatcher has answered, so the window's listener does not answer one twice. */
const answered = new WeakSet<Event>();

/** The one dispatcher of the back key: after the target's own handlers (a field clearing its draft
 *  prevents the default), once per press, never during IME composition. A portaled surface routes
 *  its presses here before they bubble through its React owners. */
export function routeBackKey(e: KeyboardEvent): void {
  if (answered.has(e)) return;
  answered.add(e);
  if (e.defaultPrevented || isComposingKey(e) || fieldTakes(e)) return;
  const scope = isBackKey(e);
  if (scope === null || !backOut(scope)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

let holds = 0;

/** Listens for the back key while held; returns the release. Both the editor and any open surface hold it. */
export function holdBackKey(): () => void {
  if (holds++ === 0) {
    document.addEventListener('keydown', routeBackKey);
    window.addEventListener('keydown', routeBackKey);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds > 0) return;
    document.removeEventListener('keydown', routeBackKey);
    window.removeEventListener('keydown', routeBackKey);
  };
}
