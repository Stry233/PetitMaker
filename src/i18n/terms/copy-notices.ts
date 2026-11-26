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

/** What a copy took and left out; a placed blueprint copied whole (`blueprint`) is said as one. */
export function copyNotices(t: Translate, { copied, leftOut, blueprint = false }: { copied: number; leftOut: number; blueprint?: boolean }): CopyNotice[] {
  if (blueprint) return [{ text: t('copy.copied_blueprint'), tone: 'info' }];
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

/** The parts a blueprint placement left out, by why (`tools/blueprint/place.ts:PlacementSkips`). */
interface BlueprintSkips { ground: number; objects: number; capped: number; unknown: number }

/** Reasons in the order a tie is named. */
const SKIP_REASONS = ['ground', 'objects', 'capped', 'unknown'] as const;
const SKIP_KEYS = {
  ground: 'blueprint.skipped_ground', objects: 'blueprint.skipped_rules', capped: 'blueprint.skipped_capped', unknown: 'blueprint.skipped_unknown',
} as const;

/** What a blueprint placement came to: one notice counting every part left out and naming the
 *  reason that left out most of them, or none when nothing was. */
export function blueprintSkipNotices(t: Translate, skips: BlueprintSkips): CopyNotice[] {
  const total = SKIP_REASONS.reduce((n, r) => n + skips[r], 0);
  if (total === 0) return [];
  const lead = SKIP_REASONS.reduce((a, b) => (skips[b] > skips[a] ? b : a));
  return [{ text: t(SKIP_KEYS[lead], { n: total }), tone: 'info' }];
}
