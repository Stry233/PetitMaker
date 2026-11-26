/*
 * One row per provider failure class: how the desk card, the banner and the composer name it. Which
 * repair a class gets, which notice it reads under and whether it refuses orders is the assistant's
 * policy (`agent/panel.ts`), which each row carries beside its icon, paper and words.
 */
import {
  incidentNotice, REPAIR_POLICY, type ErrorClass, type KeyRefusal, type RepairAct, type RepairPolicy, type TroubleClass,
} from '../../../agent/panel';
import type { IconId } from '../parts/sprite';
import type { I18nKey } from '../../../i18n/keys';

/** A provider failure, or one of the panel's own notices: credentials, storage and map identity. */
export type BannerClass = TroubleClass;

/** How a class looks and reads. */
interface RepairFace {
  icon: IconId;
  /** Banner paper: retries exhausted read as a wait, repairs the user owes as danger. */
  paper: 'danger' | 'wait';
  sentenceKey: I18nKey;
  /** The same sentence without its named fact, for a caller with none to give. */
  bareSentenceKey?: I18nKey;
  /** Desk word once the job has settled on this failure. */
  errorWord: I18nKey;
  /** Desk word while the loop retries after this failure. */
  retryWord: I18nKey;
  retryIcon: IconId;
  /** The composer's guidance while the fault stands; a class that refuses orders has one. */
  composerKey?: I18nKey;
}

interface RepairRow extends RepairPolicy, RepairFace {}

const AGAIN: I18nKey = 'agent.dock_retry_again';
const WAITING: I18nKey = 'agent.composer_blocked_waiting';

const FACE: Record<ErrorClass, RepairFace> = {
  auth: {
    icon: 'pw-key', paper: 'danger',
    sentenceKey: 'agent.banner_auth', errorWord: 'agent.dock_err_auth', retryWord: AGAIN, retryIcon: 'pw-warning',
    composerKey: 'agent.composer_blocked_key',
  },
  quota: {
    icon: 'pw-wallet', paper: 'danger',
    sentenceKey: 'agent.banner_quota', errorWord: 'agent.dock_err_quota', retryWord: AGAIN, retryIcon: 'pw-warning',
    composerKey: 'agent.composer_blocked_provider',
  },
  cors: {
    icon: 'pw-link-out', paper: 'danger',
    sentenceKey: 'agent.banner_cors', errorWord: 'agent.dock_err_cors', retryWord: AGAIN, retryIcon: 'pw-warning',
    composerKey: 'agent.composer_blocked_endpoint',
  },
  config: {
    icon: 'pw-link-out', paper: 'danger',
    sentenceKey: 'agent.banner_config', errorWord: 'agent.dock_err_config', retryWord: AGAIN, retryIcon: 'pw-warning',
  },
  model: {
    icon: 'pw-lightning', paper: 'danger',
    sentenceKey: 'agent.banner_model', bareSentenceKey: 'agent.banner_model_bare',
    errorWord: 'agent.dock_err_model', retryWord: AGAIN, retryIcon: 'pw-warning',
    composerKey: 'agent.composer_blocked_model',
  },
  account: {
    icon: 'pw-key', paper: 'danger',
    sentenceKey: 'agent.banner_account', errorWord: 'agent.dock_err_account', retryWord: AGAIN, retryIcon: 'pw-warning',
  },
  network: {
    icon: 'pw-cloud-off', paper: 'wait',
    sentenceKey: 'agent.banner_network', errorWord: 'agent.dock_err_no_answer',
    retryWord: 'agent.dock_retry_offline', retryIcon: 'pw-cloud-off', composerKey: WAITING,
  },
  'rate-limit': {
    icon: 'pw-retry-clock', paper: 'wait',
    sentenceKey: 'agent.banner_rate_limit', errorWord: 'agent.dock_err_no_answer',
    retryWord: 'agent.dock_retry_busy', retryIcon: 'pw-retry-clock', composerKey: WAITING,
  },
  overloaded: {
    icon: 'pw-cloud-off', paper: 'wait',
    sentenceKey: 'agent.banner_network', errorWord: 'agent.dock_err_no_answer',
    retryWord: 'agent.dock_retry_busy', retryIcon: 'pw-warning', composerKey: WAITING,
  },
  overflow: {
    icon: 'pw-compress', paper: 'danger',
    sentenceKey: 'agent.banner_overflow', errorWord: 'agent.dock_err_overflow', retryWord: AGAIN, retryIcon: 'pw-warning',
    composerKey: 'agent.composer_shorter',
  },
  abort: {
    icon: 'pw-warning', paper: 'danger',
    sentenceKey: 'agent.banner_incident', errorWord: 'agent.dock_incident', retryWord: AGAIN, retryIcon: 'pw-warning',
  },
  unknown: {
    icon: 'pw-warning', paper: 'danger',
    sentenceKey: 'agent.banner_incident', errorWord: 'agent.dock_incident', retryWord: AGAIN, retryIcon: 'pw-warning',
  },
};

export const REPAIR = Object.fromEntries(
  (Object.keys(FACE) as ErrorClass[]).map((cls) => [cls, { ...REPAIR_POLICY[cls], ...FACE[cls] }]),
) as Record<ErrorClass, RepairRow>;

/** The desk card's compact wording for a repair; the rest read as the banner does. */
const DESK_ACT_LABEL: Partial<Record<RepairAct, I18nKey>> = {
  'fix-key': 'agent.dock_act_fix_key',
  'try-again': 'agent.dock_act_try_again',
  'new-order': 'agent.dock_act_new_order',
};

export const ACT_LABEL: Record<RepairAct, I18nKey> = {
  'fix-key': 'agent.banner_action_fix_key',
  'change-provider': 'agent.banner_action_change_provider',
  'edit-endpoint': 'agent.banner_action_edit_endpoint',
  'edit-model': 'agent.banner_action_edit_model',
  'try-again': 'agent.banner_action_try_again',
  'new-order': 'agent.banner_action_new_order',
  'export-log': 'agent.banner_action_export_log',
  'set-aside': 'agent.banner_action_set_aside',
  dismiss: 'agent.banner_action_dismiss',
  'sign-in': 'agent.banner_action_sign_in',
};

/** How an incident's fault is worded on the desk and in the composer. */
interface IncidentWords {
  errorWord: I18nKey;
  composerKey?: I18nKey;
}

/** A refused key that came from a sign-in, worded in place of the `auth` row. */
const SIGNED_IN_WORDS: Record<Exclude<KeyRefusal, 'key'>, IncidentWords> = {
  'sign-in-expired': { errorWord: 'agent.dock_err_sign_in', composerKey: 'agent.composer_blocked_sign_in' },
  'signed-in-again': { errorWord: 'agent.dock_signed_in_again' },
};

/** The words an incident of `cls` reads by, given how its refused key stands. */
export function incidentWords(cls: ErrorClass, refusal: KeyRefusal): IncidentWords {
  const notice = incidentNotice(cls, refusal);
  return notice === 'sign-in-expired' || notice === 'signed-in-again' ? SIGNED_IN_WORDS[notice] : REPAIR[cls];
}

export function deskActLabel(act: RepairAct): I18nKey {
  return DESK_ACT_LABEL[act] ?? ACT_LABEL[act];
}
