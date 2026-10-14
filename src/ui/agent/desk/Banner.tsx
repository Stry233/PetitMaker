/*
 * Maps provider, storage, credential and map-history trouble classes to localized banners. The
 * exhaustive `BANNER_SPEC` assigns each class its icon, severity, message and actionable controls.
 * Retry exhaustion and storage conditions use wait styling; conditions that require user repair use
 * danger styling. Rate limits keep their distinct waiting language and retry-clock icon.
 */
import { Icon, type IconId } from '../parts/sprite';
import { edge, statePaper } from '../panel-skin';
import { DANGER_DEEP, INK, INSET, LINE, MUTED, PANEL_EDGE_WIDTH, PLATE_INK } from '../../design/tokens';
import { font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { Pill } from '../../primitives/Pill';
import { useT } from '../../../i18n/context';
import type { ErrorClass } from '../../../agent/panel';
import { ACT_LABEL, REPAIR, type BannerClass, type RepairAct, type RepairRow } from '../derive/repair';
import type { I18nKey } from '../../../i18n/keys';

export type { BannerClass } from '../derive/repair';

/** The banner's actions are the panel's one repair vocabulary. */
export type BannerActionId = RepairAct;

interface BannerSpec {
  icon: IconId;
  paper: 'danger' | 'wait';
  sentenceKey: I18nKey;
  /** The same sentence with the fact left out, for the caller that has none to give. */
  bareSentenceKey?: I18nKey;
  actions: readonly RepairAct[];
  /** The pill drawn in the accent: the class's repair, where it has one. */
  act?: RepairAct;
  /** A class that words a shared action its own way (the corrupt notice's dismiss discards). */
  labels?: Partial<Record<RepairAct, I18nKey>>;
}

/** Both put-downs leave the standing strip, so a demoted banner keeps only its repair. */
const PUT_DOWN: ReadonlySet<RepairAct> = new Set<RepairAct>(['dismiss', 'set-aside']);

/** A standing fact with nothing to press: dismissing it would only bring the same sentence back. */
const NO_ACTIONS: readonly RepairAct[] = [];

const ERROR_SPEC = Object.fromEntries(
  (Object.entries(REPAIR) as [ErrorClass, RepairRow][]).map(([cls, row]) => [cls, {
    icon: row.icon, paper: row.paper, sentenceKey: row.sentenceKey, actions: row.actions, act: row.act,
    ...(row.bareSentenceKey ? { bareSentenceKey: row.bareSentenceKey } : {}),
  }]),
) as Record<ErrorClass, BannerSpec>;

const BANNER_SPEC: Record<BannerClass, BannerSpec> = {
  ...ERROR_SPEC,
  // The held job's own card under this banner carries the repair, so the banner carries none.
  'key-cleared': { icon: 'pw-key', paper: 'danger', sentenceKey: 'agent.banner_key_cleared', actions: NO_ACTIONS },
  // The key went away under a running job whose stop has not settled yet.
  'key-clearing': { icon: 'pw-key', paper: 'danger', sentenceKey: 'agent.banner_key_clearing', actions: NO_ACTIONS },
  'storage-pruned': { icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent.banner_storage_pruned', actions: ['dismiss'] },
  'storage-full': { icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent.banner_storage_full', actions: ['dismiss'] },
  // The unreadable session was set aside: neither answer repairs it, so neither is lit.
  'storage-corrupt': {
    icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent.banner_storage_corrupt',
    actions: ['dismiss', 'export-log'], labels: { dismiss: 'agent.banner_action_discard' },
  },
  // Records built on a map that is not open read but cannot be rolled back from here.
  'other-map': { icon: 'pw-region-frame', paper: 'wait', sentenceKey: 'agent.banner_other_map', actions: NO_ACTIONS },
  // Records that name no map may or may not be this map's.
  'unknown-map': { icon: 'pw-region-frame', paper: 'wait', sentenceKey: 'agent.banner_unknown_map', actions: NO_ACTIONS },
};

/** Every class the table covers, in declaration order. */
export const BANNER_CLASSES = Object.keys(BANNER_SPEC) as BannerClass[];

export function Banner({ cls, model, standing = false, onAction }: {
  cls: BannerClass;
  /** The armed model's display name, which this banner's own repair edits; the sentence falls back to its nameless form without one. */
  model?: string;
  /**
   * A dismissed fault demotes rather than unmounting: the fault is still true, and a banner leaving
   * under the pointer would shorten the record. Only the dismissal leaves; a class whose only action
   * is the dismissal keeps it so the row's height holds.
   */
  standing?: boolean;
  onAction: (action: BannerActionId) => void;
}) {
  const t = useT();
  const spec = BANNER_SPEC[cls];
  // A sentence that names a fact, with none to name, is the bare wording rather than a rendered gap.
  const named = model !== undefined && model !== '' ? model : undefined;
  const sentence = named === undefined && spec.bareSentenceKey !== undefined
    ? t(spec.bareSentenceKey) : named === undefined ? t(spec.sentenceKey) : t(spec.sentenceKey, { model: named });
  const terminal = spec.paper === 'danger' && !standing;
  const ink = standing ? MUTED : terminal ? DANGER_DEEP : INK;
  const textInk = standing ? MUTED : terminal ? DANGER_DEEP : PLATE_INK;
  const putDown = spec.actions.filter((action) => !PUT_DOWN.has(action));
  const shown = standing ? (putDown.length > 0 ? putDown : spec.actions) : spec.actions;

  return (
    <div
      data-testid="banner"
      data-cls={cls}
      data-paper={standing ? 'standing' : spec.paper}
      {...(standing ? { 'data-standing': 'true' } : {})}
      style={{
        background: standing ? INSET : statePaper[spec.paper],
        // `edge` is the whole shorthand, so it takes no width in front of it; the demoted strip
        // states one because it is naming a colour, and it takes the same width from the same place.
        border: standing ? `${PANEL_EDGE_WIDTH}px solid ${LINE}` : edge,
        borderRadius: radii.md,
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        boxShadow: 'none',
      }}
    >
      <span data-testid="banner-icon" style={{ flex: '0 0 auto', marginTop: 2, color: ink }}>
        <Icon id={spec.icon} size={20} />
      </span>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ ...roleFont('label'), fontFamily: font.family, color: textInk, lineHeight: 1.45 }}>
          {sentence}
        </div>
        {/* A notice with no answers draws no row at all: an empty band under the sentence would be
            a reserved seat for a control that does not exist. */}
        <div style={{ display: shown.length === 0 ? 'none' : 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shown.map((action) => (
            <Pill
              key={action}
              variant={action === spec.act ? 'active' : 'quiet'}
              on="inset"
              data-testid="banner-action"
              data-action={action}
              onClick={() => onAction(action)}
            >
              {t(spec.labels?.[action] ?? ACT_LABEL[action])}
            </Pill>
          ))}
        </div>
      </div>
    </div>
  );
}
