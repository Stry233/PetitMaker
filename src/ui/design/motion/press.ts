/*
 * Pointer feedback as Framer props, read for the live input mode through
 * `design/input-mode.tsx:useInteractionProfiles` and spread onto a motion element. The element must be
 * positioned by layout (flex, left and top), not a CSS `transform`: Framer owns `transform` for the
 * scale and would overwrite a centring translate.
 */
import type { Transition } from 'framer-motion';
import type { InputMode } from '../../../platform/device/input-mode';
import { framerMotion } from '.';
import { MOTIONS, type Motion } from './registry';

/** Each profile's registry motion. */
const PROFILE_MOTIONS = {
  tile: 'press.tile',
  action: 'press.action',
  choice: 'press.choice',
  toggle: 'press.toggle',
  pill: 'press.pill',
  row: 'press.row',
  tap: 'press.tap',
  actionTap: 'press.action-tap',
  pillTap: 'press.pill-tap',
  toggleTap: 'press.toggle-tap',
  curveVertex: 'press.curve-vertex',
  keyboardKey: 'press.keyboard-key',
  thumbnailAdd: 'press.thumbnail-add',
  quietLink: 'press.quiet-link',
  curveHandle: 'press.curve-handle',
  badge: 'press.badge',
  still: 'press.still',
} as const;

export type InteractionProfile = keyof typeof PROFILE_MOTIONS;

type EntryOf<K extends InteractionProfile> = (typeof MOTIONS)[(typeof PROFILE_MOTIONS)[K]];

/** A profile as Framer props: `whileHover` where the entry declares a hover, `whileTap` where it
 *  declares a press. */
type PcProfile<K extends InteractionProfile> = { readonly transition: Transition }
  & (EntryOf<K> extends { hover: infer H } ? { readonly whileHover: H } : unknown)
  & (EntryOf<K> extends { press: infer P } ? { readonly whileTap: P } : unknown);

type PcProfiles = { readonly [K in InteractionProfile]: PcProfile<K> };

const PC_PROFILES = Object.fromEntries(Object.entries(PROFILE_MOTIONS).map(([name, id]) => {
  const m: Motion = MOTIONS[id];
  return [name, {
    ...(m.hover ? { whileHover: m.hover } : {}),
    ...(m.press ? { whileTap: m.press } : {}),
    transition: framerMotion(id),
  }];
})) as unknown as PcProfiles;

/** One profile in either mode: a hover entry exists only in PC mode. */
export type InteractionProfiles = {
  readonly [K in InteractionProfile]: Omit<PcProfiles[K], 'whileHover'>
    & { readonly whileHover?: PcProfiles[K] extends { whileHover: infer H } ? H : never };
};

/** A finger gets press feedback on contact and nothing for a hover it cannot make. */
const TOUCH_PROFILES = Object.fromEntries(Object.entries(PC_PROFILES).map(([id, profile]) => {
  const { whileHover: _hover, ...press } = profile as { whileHover?: unknown };
  return [id, press];
})) as unknown as InteractionProfiles;

/** The interaction profiles for an input mode. */
export function interactionProfilesFor(mode: 'pc'): PcProfiles;
export function interactionProfilesFor(mode: InputMode): InteractionProfiles;
export function interactionProfilesFor(mode: InputMode): InteractionProfiles {
  return mode === 'touch' ? TOUCH_PROFILES : PC_PROFILES;
}

/** The tile's PC profile: how far a hover grows a control, for the room a layout keeps around it. */
export const pressable = PC_PROFILES.tile;
