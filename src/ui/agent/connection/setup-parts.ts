/* Shared connection-flow types, provider roster and styles for setup and management. */
import type { CSSProperties } from 'react';
import type { Transition } from 'framer-motion';
import {
  classify, type Oversight, PROVIDER_IDS, type ProviderId, toRawFailure,
} from '../../../agent/panel';
import { cursors, font, radii } from '../../design/styles';
import { INSET, MUTED, PLATE_INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { framerMotion } from '../../design/motion';
import type { I18nKey } from '../../../i18n/keys';

/** Manual provider roster; custom endpoints use a separate entry. */
export const PROVIDER_ROSTER: readonly ProviderId[] = PROVIDER_IDS.filter((id) => id !== 'custom');

/** Connection-flow progress projected into the desk header while setup owns the job zone. */
export type SetupStep =
  | 'awake' | 'typing' | 'shaped' | 'ambiguous' | 'unknown' | 'refused' | 'no-answer'
  | 'endpoint';

export interface SetupFace {
  step: SetupStep;
  /** What the step's words name, where they name anything: the provider, or the endpoint's host. */
  name?: string;
}

/** Oversight labels shared by management, status-card metadata and the i18n drift check. */
export const OVERSIGHT_COPY: Record<Oversight, { label: I18nKey; caption: I18nKey }> = {
  strict: { label: 'agent.oversight_strict', caption: 'agent.oversight_strict_caption' },
  checkpoint: { label: 'agent.oversight_checkpoint', caption: 'agent.oversight_checkpoint_caption' },
  yolo: { label: 'agent.oversight_yolo', caption: 'agent.oversight_yolo_caption' },
};

/** `unreachable` means no usable response; `no-list` means the server responded without a model catalog. */
type EndpointVerdict = 'unreachable' | 'no-list';

export function endpointCheckVerdict(err: unknown): EndpointVerdict {
  const cls = classify(toRawFailure(err, false)).cls;
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
  display: 'flex', alignItems: 'center', gap: 8,
  background: INSET, borderRadius: radii.md, padding: '10px 12px',
  borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent',
};

export const INPUT_STYLE: CSSProperties = {
  flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
  ...roleFont('field'), fontFamily: font.family, color: PLATE_INK, letterSpacing: '.05em',
  cursor: cursors.text,
};

export const NOTE_STYLE: CSSProperties = {
  ...roleFont('note'), fontFamily: font.family, color: MUTED,
  lineHeight: 1.45, padding: '0 2px',
  marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
};

export const GROUP_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

/** Pins growing control groups to the panel floor. */
export const FOOT_STYLE: CSSProperties = { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };

/** Position-only, zoom-corrected setup-step motion; reduced motion returns no animation props. */
interface StepSlide {
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
