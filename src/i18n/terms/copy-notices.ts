/**
 * What copying, pasting and deleting objects tell the visitor: one wording for the keyboard, the
 * menus, the placer and a Ctrl+drag copy, so every path says the same thing (EDIT-53, EDIT-57,
 * EDIT-59, EDIT-62), the Help figures included.
 */
import type { Translate } from '../keys';

/** One toast: its text, already translated, and its tone. */
export interface CopyNotice {
  text: string;
  tone: 'info' | 'warning';
}

/** What a copy took and left out. */
export function copyNotices(t: Translate, { copied, leftOut }: { copied: number; leftOut: number }): CopyNotice[] {
  const out: CopyNotice[] = [];
  if (copied > 0) out.push({ text: t('copy.copied', { n: copied }), tone: 'info' });
  if (leftOut > 0) out.push({ text: t('copy.left_out_planet', { n: leftOut }), tone: copied > 0 ? 'info' : 'warning' });
  return out;
}

/** What placing a copy came to: placed nearby, no room, members left out at their limit, members
 *  this release does not know. */
export function pasteNotices(
  t: Translate,
  { nearby, noRoom, capped, unknown = 0 }: { nearby: boolean; noRoom: boolean; capped: number; unknown?: number },
): CopyNotice[] {
  const out: CopyNotice[] = [];
  if (noRoom) out.push({ text: t('paste.no_room'), tone: 'warning' });
  if (nearby) out.push({ text: t('paste.nearby'), tone: 'info' });
  if (capped > 0) out.push({ text: t('paste.capped', { n: capped }), tone: 'info' });
  if (unknown > 0) out.push({ text: t('paste.unknown', { n: unknown }), tone: 'info' });
  return out;
}

/** What a group delete came to when it removed some members and kept the locked ones; a delete that
 *  removed nothing is a refusal, said by the rule, and one that removed all says nothing. */
export function groupDeleteNotices(t: Translate, { deleted, kept }: { deleted: number; kept: number }): CopyNotice[] {
  return deleted > 0 && kept > 0 ? [{ text: t('toast.group_delete_kept', { n: kept }), tone: 'info' }] : [];
}
