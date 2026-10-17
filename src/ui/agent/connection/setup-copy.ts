import type { Translate, I18nKey } from '../../../i18n/keys';
import { providerName } from '../../../i18n/terms/providers';
import { isRegionSplit, type KeyShape, type ProviderId } from '../../../agent/panel';
import type { FloatMenuItem } from '../../primitives/FloatMenu';
import { PROVIDER_ROSTER } from './setup-parts';

export interface RowFace { id: ProviderId | null; name: string; sub: string; dim: boolean }

/** Derives the provider row's identity, status copy and emphasis from setup state. */
export function rowFace(a: {
  t: Translate; shape: KeyShape; pinned: ProviderId | null; checking: boolean;
  refused: boolean;
}): RowFace {
  const { t, shape, pinned, checking, refused } = a;
  if (refused) {
    const id = pinned ?? (typeof shape === 'string' && shape !== 'ambiguous' && shape !== 'partial'
      && shape !== 'unknown' && shape !== 'empty' ? shape : null);
    return {
      id,
      name: id ? providerName(id, t) : t('agent.setup_row_provider'),
      sub: t('agent.setup_row_refused'),
      dim: false,
    };
  }
  // An explicit provider choice takes priority over automatic reading status.
  if (pinned) {
    return {
      id: pinned,
      name: providerName(pinned, t),
      sub: t(checking ? 'agent.setup_row_pinned_checking' : 'agent.setup_row_pinned'),
      dim: false,
    };
  }
  if (shape === 'ambiguous') {
    return {
      id: null,
      name: t('agent.setup_row_two'),
      sub: t('agent.setup_row_sofar'),
      dim: false,
    };
  }
  if (shape === 'empty' || shape === 'partial' || shape === 'unknown') {
    return { id: null, name: t('agent.setup_row_any'), sub: t('agent.setup_row_any_sub'), dim: true };
  }
  return {
    id: shape,
    name: providerName(shape, t),
    sub: t(checking ? 'agent.setup_row_checking' : 'agent.setup_row_sofar'),
    dim: false,
  };
}

/** The sentence under the row, or none. `danger` is the refusal's own ink. */
export function noteLine(a: {
  t: Translate; shape: KeyShape; pinned: ProviderId | null; typing: boolean; checking: boolean;
  refused: boolean; needsEndpoint: boolean; held: boolean;
}): { text: string; danger: boolean } | null {
  const { t, shape, pinned, typing, checking, refused, needsEndpoint, held } = a;
  if (refused) return { text: t('agent.setup_key_refused'), danger: true };
  // A missing endpoint prevents every key check and takes priority in the note.
  if (needsEndpoint) return { text: t('agent.setup_say_custom'), danger: false };
  if (shape === 'ambiguous') {
    return { text: t('agent.setup_note_ambiguous_wait'), danger: false };
  }
  if (pinned && checking) return { text: t('agent.setup_note_pinned_checking', { name: providerName(pinned, t) }), danger: false };
  if (shape !== 'empty' && shape !== 'partial' && shape !== 'unknown' && checking) {
    return { text: t('agent.setup_note_shaped', { name: providerName(shape, t) }), danger: false };
  }
  if (!typing) return held ? { text: t('agent.setup_note_replaces'), danger: false } : null;
  if (shape === 'partial') return { text: t('agent.setup_note_partial'), danger: false };
  if (shape === 'unknown') return { text: t('agent.setup_note_unknown'), danger: false };
  return null;
}

export type FootVerb = 'recheck' | 'manual' | 'address' | 'reenter';

/** The foot's words. `recheck` carries two, chosen at the call site by what failed. */
export const FOOT_LABEL: Record<FootVerb, I18nKey> = {
  recheck: 'agent.setup_use_this_key',
  manual: 'agent.setup_pick_provider',
  address: 'agent.setup_give_address',
  reenter: 'agent.setup_back',
};

/** Returns recovery actions for failures, missing endpoints and pending checks. */
export function footVerbs(a: {
  refused: boolean; needsEndpoint: boolean; waiting: boolean;
}): FootVerb[] {
  if (a.refused) return ['recheck', 'manual'];
  if (a.needsEndpoint) return ['address'];
  if (a.waiting) return ['reenter'];
  return [];
}

/** Provider-menu items, with compatibility hints for ambiguous keys. */
export function rosterItems(t: Translate, shape: KeyShape, pinned: boolean, regionProvider: ProviderId | null): FloatMenuItem[] {
  const amb = shape === 'ambiguous';
  const roster = regionProvider ? [regionProvider, ...PROVIDER_ROSTER.filter(id => id !== regionProvider)] : PROVIDER_ROSTER;
  const items: FloatMenuItem[] = roster.flatMap<FloatMenuItem>((id, index) => {
    const separated = regionProvider !== null && index === 1;
    if (isRegionSplit(id)) {
      return ([0, 1] as const).map((region) => ({
        id: `${id}:${region}`, label: providerName(id, t),
        sub: t(region === 0 ? 'agent.endpoint_global' : 'agent.endpoint_cn'),
        separated: separated && region === 0,
      }));
    }
    return [{ id, label: providerName(id, t), separated }];
  });
  items.push({
    id: 'custom',
    label: t('agent.setup_custom_endpoint'),
    separated: true,
    ...(amb ? { sub: t('agent.setup_gateway_fits') } : {}),
  });
  if (pinned) items.push({ id: 'automatic', label: t('agent.setup_detect_automatically'), separated: true });
  return items;
}

/** Returns the endpoint host for desk metadata, or an empty string while the address is incomplete. */
export function urlHost(raw: string): string {
  try { return new URL(raw.trim()).host; } catch { return ''; }
}
