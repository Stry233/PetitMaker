/* Shared connection-flow types, key grammar, provider roster and styles for setup and management. */
import type { CSSProperties } from 'react';
import type { Transition } from 'framer-motion';
import type { Oversight } from '../../agent/core/gates';
import { classify, type RawFailure } from '../../agent/core/errors';
import { detectProviderFromKey } from '../../agent/providers/detect';
import { PROVIDER_IDS, type ProviderId } from '../../agent/providers/defaults';
import { colors, cursors, font, radii } from '../design/styles';
import { INSET, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { framerMotion } from './motion';

/** Translator shape accepted by connection helpers. */
export type T = (key: string, params?: Record<string, string | number>) => string;

/** Manual provider roster; custom endpoints use a separate entry. */
export const PROVIDER_ROSTER: readonly ProviderId[] = PROVIDER_IDS.filter((id) => id !== 'custom');

/** Connection-flow progress projected into the desk header while setup owns the job zone. */
export type SetupStep =
  | 'awake' | 'typing' | 'shaped' | 'ambiguous' | 'unknown' | 'refused' | 'no-answer'
  | 'endpoint';

/** Setup entry point selected by a repair action. */
export type SetupEntry = 'key' | 'chooser' | 'endpoint';

export interface SetupFace {
  step: SetupStep;
  /** What the step's words name, where they name anything: the provider, or the endpoint's host. */
  name?: string;
}

export const OVERSIGHTS: readonly Oversight[] = ['strict', 'checkpoint', 'yolo'];

/** Oversight labels shared by management, dock metadata and the i18n drift check. */
export const OVERSIGHT_COPY: Record<Oversight, { label: string; caption: string }> = {
  strict: { label: 'agent3.oversight_strict', caption: 'agent3.oversight_strict_caption' },
  checkpoint: { label: 'agent3.oversight_checkpoint', caption: 'agent3.oversight_checkpoint_caption' },
  yolo: { label: 'agent3.oversight_yolo', caption: 'agent3.oversight_yolo_caption' },
};

/** Minimum actionable key shape and shared provider-key alphabet. */
const KEY_OK = /^[A-Za-z0-9_.-]{12,}$/;

/** A `sk-` key of 32 or more hex digits: DeepSeek's shape, and every gateway's. */
const SK_HEX = /^sk-[0-9a-f]{32,}$/i;
/** The same shape, still being typed. */
const SK_PARTIAL = /^s(k(-[0-9a-f]{0,31})?)?$/i;

export type KeyShape = ProviderId | 'empty' | 'partial' | 'ambiguous' | 'unknown';

/** Whether the field holds enough to be worth acting on. */
export function keyLooksUsable(raw: string): boolean {
  return KEY_OK.test(raw.trim());
}

/** Classifies the current key text without retaining an earlier verdict. */
export function readKeyShape(raw: string): KeyShape {
  const key = raw.trim();
  if (key === '') return 'empty';
  const named = detectProviderFromKey(key);
  if (named) return named;
  if (SK_HEX.test(key)) return 'ambiguous';
  if (SK_PARTIAL.test(key)) return 'partial';
  return 'unknown';
}

/**
 * Chooses the next route for a key shape. Quiet advance ignores short or partial keys; an explicit
 * action opens the chooser, and custom providers require an endpoint before commit.
 */
export type KeyDestination = 'commit' | 'ask' | 'endpoint' | null;

export function keyDestination(a: {
  shape: KeyShape; usable: boolean; endpointFiled: boolean; explicit: boolean;
}): KeyDestination {
  if (a.shape === 'empty') return null;
  // Quiet advance waits for a usable key; an explicit action may open the chooser sooner.
  if (!a.usable && !a.explicit) return null;
  if (a.shape === 'partial') return a.explicit ? 'ask' : null;
  if (a.shape === 'custom') return a.endpointFiled ? 'commit' : 'endpoint';
  if (a.shape === 'ambiguous') return 'ask';
  if (a.shape === 'unknown') return 'ask';
  return 'commit';
}

/** Whether the persisted custom-provider selection still needs an endpoint address. */
export function endpointOwed(a: { provider: ProviderId; customBaseUrl: string }): boolean {
  return a.provider === 'custom' && a.customBaseUrl === '';
}

/** Lightweight endpoint check for gating: HTTPS anywhere, HTTP only on loopback. */
export function urlLooksUsable(raw: string): boolean {
  return /^https:\/\/\S+/.test(raw.trim()) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(raw.trim());
}

/** Normalizes an unknown exception for the shared provider-error classifier. */
export function rawFailure(err: unknown): RawFailure {
  const status = (err as { status?: unknown } | null)?.status;
  return {
    message: err instanceof Error ? err.message : String(err),
    ...(typeof status === 'number' ? { status } : {}),
  };
}

/** `unreachable` means no usable response; `no-list` means the server responded without a model catalog. */
export type EndpointVerdict = 'unreachable' | 'no-list';

export function endpointCheckVerdict(err: unknown): EndpointVerdict {
  const cls = classify(rawFailure(err)).cls;
  return cls === 'network' || cls === 'cors' || cls === 'config' ? 'unreachable' : 'no-list';
}

/* ── the boxes both screens stand controls in ─────────────── */

export const WRAP_STYLE: CSSProperties = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14,
};

/** Field label style; zero margin removes the browser's paragraph spacing. */
export const SAY_STYLE: CSSProperties = {
  ...roleFont('label'), fontFamily: font.family, color: PLATE_INK, lineHeight: 1.5, margin: 0,
};

/** Field wrapper; longhand border properties allow safe `borderColor` overrides and wrapper focus rings. */
export const FIELD_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9,
  background: INSET, borderRadius: radii.md, padding: '11px 12px',
  borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent',
};

export const INPUT_STYLE: CSSProperties = {
  flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
  ...roleFont('field'), fontFamily: font.family, color: PLATE_INK, letterSpacing: '.05em',
  cursor: cursors.text,
};

export const NOTE_STYLE: CSSProperties = {
  ...roleFont('note'), fontFamily: font.family, color: colors.brownText,
  lineHeight: 1.45, padding: '0 3px',
  marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
};

export const GROUP_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

/** Pins growing control groups to the panel floor. */
export const FOOT_STYLE: CSSProperties = { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };

/** Visual treatment for an advancing control whose precondition is missing. */
export const GATED: CSSProperties = { opacity: 0.4, cursor: cursors.blocked };

/** Position-only, zoom-corrected setup-step motion; reduced motion returns no animation props. */
export interface StepSlide {
  layout?: 'position';
  transition?: Transition;
  transformTemplate?: (values: object, generated: string) => string;
}

export function stepSlide(
  reduced: boolean, transformTemplate: (values: object, generated: string) => string,
): StepSlide {
  if (reduced) return {};
  return { layout: 'position', transition: framerMotion('panel.setup.step'), transformTemplate };
}
