/**
 * The background text check for words that arrive from outside (a save, a share code, a planet
 * file) and are checked without a field the visitor is typing in. Every background review shares
 * one worker lease and takes its turn on it, so their matchers load once and no check finds the
 * lease busy. Each review tries an item once per page load until `forgetTried`.
 */
import type { TextField } from './policy';
import { reviewText, ReviewWorkerLease } from './reviewer';

export interface BackgroundReviewSpec<T> {
  field: TextField;
  /** The next item awaiting a check whose key is not in `tried`, or undefined when none is left.
   *  Asked again after every check, so an item settled meanwhile drops out. */
  next(tried: ReadonlySet<string>): { key: string; text: string; item: T } | undefined;
  /** Receives whether the check allowed the item's text, or null when the check could not run. */
  settle(item: T, allowed: boolean | null): void;
}

export interface BackgroundReview {
  /** Checks every pending item; a call during a run checks again once that run ends. */
  run(): Promise<void>;
  /** Forgets which items this review has tried; for tests that reuse texts. */
  forgetTried(): void;
}

const lease = new ReviewWorkerLease();
let turn: Promise<unknown> = Promise.resolve();

/** The check's answer on `text`, taken in turn on the shared lease. A blank text is refused
 *  without a check. */
function checkInTurn(field: TextField, text: string): Promise<boolean | null> {
  if (!text.trim()) return Promise.resolve(false);
  const answer = turn.then(async () => {
    try {
      return (await reviewText([{ field, text }], new AbortController().signal, () => {}, lease)).allowed;
    } catch {
      return null;
    }
  });
  turn = answer;
  return answer;
}

export function createBackgroundReview<T>(spec: BackgroundReviewSpec<T>): BackgroundReview {
  const tried = new Set<string>();
  let running: Promise<void> | null = null;
  const run = (): Promise<void> => {
    if (running) return running.then(run);
    running = (async () => {
      for (let pending = spec.next(tried); pending; pending = spec.next(tried)) {
        tried.add(pending.key);
        spec.settle(pending.item, await checkInTurn(spec.field, pending.text));
      }
    })().finally(() => { running = null; });
    return running;
  };
  return { run, forgetTried: () => tried.clear() };
}
