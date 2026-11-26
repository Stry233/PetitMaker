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
import { noticeOffer, standingActions, type ErrorClass, type NoticeClass, type RepairAct } from '../../../agent/panel';
import { ACT_LABEL, REPAIR, type BannerClass } from '../derive/repair';
import type { I18nKey } from '../../../i18n/keys';

export type { BannerClass } from '../derive/repair';

/** The banner's actions are the panel's one repair vocabulary. */
export type BannerActionId = RepairAct;

/** How a class's banner looks and reads; what it offers is the assistant's (`noticeOffer`). */
interface BannerSpec {
  icon: IconId;
  paper: 'danger' | 'wait';
  sentenceKey: I18nKey;
  /** The same sentence with the fact left out, for the caller that has none to give. */
  bareSentenceKey?: I18nKey;
  /** A class that words a shared action its own way (the corrupt notice's dismiss discards). */
  labels?: Partial<Record<RepairAct, I18nKey>>;
}

const NOTICE_SPEC: Record<NoticeClass, BannerSpec> = {
  'key-cleared': { icon: 'pw-key', paper: 'danger', sentenceKey: 'agent.banner_key_cleared' },
  'key-clearing': { icon: 'pw-key', paper: 'danger', sentenceKey: 'agent.banner_key_clearing' },
  'sign-in-expired': { icon: 'pw-key', paper: 'danger', sentenceKey: 'agent.banner_sign_in_expired' },
  'signed-in-again': { icon: 'pw-key', paper: 'wait', sentenceKey: 'agent.banner_signed_in_again' },
  'storage-pruned': { icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent.banner_storage_pruned' },
  'storage-full': { icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent.banner_storage_full' },
  'storage-corrupt': {
    icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent.banner_storage_corrupt',
    labels: { dismiss: 'agent.banner_action_discard' },
  },
  'other-map': { icon: 'pw-region-frame', paper: 'wait', sentenceKey: 'agent.banner_other_map' },
  'unknown-map': { icon: 'pw-region-frame', paper: 'wait', sentenceKey: 'agent.banner_unknown_map' },
};

const BANNER_SPEC: Record<BannerClass, BannerSpec> = { ...(REPAIR satisfies Record<ErrorClass, BannerSpec>), ...NOTICE_SPEC };

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
  const offer = noticeOffer(cls);
  const shown = standing ? standingActions(offer.actions) : offer.actions;

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
              variant={action === offer.act ? 'active' : 'quiet'}
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
