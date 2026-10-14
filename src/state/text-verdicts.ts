/**
 * This page's text-check verdicts by exact text: on the words a map carries as custom tags, and on
 * planet names no library entry carries. The checks run in io and the interface; renderers, hit
 * testing and exports read only `textApproved`, so a text with no verdict yet, and a refused one,
 * is never drawn or handed on. Verdicts are not persisted: a reload checks the text again.
 */
import { createSignal } from '../core/base/signal';

const verdicts = new Map<string, boolean>();
const changed = createSignal<number>(0);

export type TextVerdict = 'approved' | 'refused' | 'unchecked';

/** The check's verdict on exactly `text`. */
export function textVerdict(text: string): TextVerdict {
  const approved = verdicts.get(text);
  return approved === undefined ? 'unchecked' : approved ? 'approved' : 'refused';
}

/** Whether the check has approved exactly `text`. */
export function textApproved(text: string): boolean {
  return verdicts.get(text) === true;
}

/** Whether the check has answered for exactly `text`. */
export function textVerdictKnown(text: string): boolean {
  return verdicts.has(text);
}

/** The tags among `tags` whose text the check approved, in order: the ones a surface may show. */
export function approvedTexts<T extends { text: string }>(tags: readonly T[]): T[] {
  return tags.filter((tag) => textApproved(tag.text));
}

export function recordTextVerdict(text: string, approved: boolean): void {
  if (verdicts.get(text) === approved) return;
  verdicts.set(text, approved);
  changed.emit(changed.get() + 1);
}

/** Bumped on every new verdict; the freshness key a drawing surface subscribes to. */
export function textVerdictsVersion(): number {
  return changed.get();
}

export function onTextVerdicts(listener: () => void): () => void {
  return changed.subscribe(() => listener());
}

/** Forgets every verdict; for tests that reuse texts. */
export function __resetTextVerdicts(): void {
  verdicts.clear();
  changed.emit(changed.get() + 1);
}
