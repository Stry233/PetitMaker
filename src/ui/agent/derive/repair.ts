/* One row per provider failure class: how the desk card, the banner and the composer name it and repair it. */
import type { ErrorClass } from '../../../agent/panel';
import type { IconId } from '../parts/sprite';
import type { I18nKey } from '../../../i18n/keys';

/**
 * Every repair the panel can route, in one vocabulary shared by the desk card and the banners.
 * `fix-key`, `change-provider` and `edit-endpoint` open setup at their step, `edit-model` opens
 * management, `try-again` files the same order again while idle, `new-order` focuses the composer,
 * `export-log` writes the raw log out, `set-aside` files the record and `dismiss` demotes the banner.
 */
export type RepairAct =
  | 'fix-key' | 'change-provider' | 'edit-endpoint' | 'edit-model'
  | 'try-again' | 'new-order' | 'export-log' | 'set-aside' | 'dismiss';

/** A provider failure, or one of the panel's own notices: credentials, storage and map identity. */
export type BannerClass =
  | ErrorClass
  | 'key-cleared' | 'key-clearing'
  | 'storage-pruned' | 'storage-full' | 'storage-corrupt' | 'other-map' | 'unknown-map';

export interface RepairRow {
  /** The one repair the class offers first, on the desk card and as the banner's lit action. */
  act: RepairAct;
  /** The banner's actions, the repair first. */
  actions: readonly RepairAct[];
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
  /** The ladder ran out of attempts on a transient failure: the desk keeps the wait paper. */
  exhausted?: true;
  /** The composer's guidance while the fault stands, and whether it refuses text. */
  composer?: { key: I18nKey; off: boolean };
}

const RETRY_OR_FILE: readonly RepairAct[] = ['try-again', 'set-aside'];
const AGAIN: I18nKey = 'agent.dock_retry_again';
const WAITING = { key: 'agent.composer_blocked_waiting', off: true } as const;

export const REPAIR: Record<ErrorClass, RepairRow> = {
  auth: {
    act: 'fix-key', actions: ['fix-key', 'set-aside'], icon: 'pw-key', paper: 'danger',
    sentenceKey: 'agent.banner_auth', errorWord: 'agent.dock_err_auth', retryWord: AGAIN, retryIcon: 'pw-warning',
    composer: { key: 'agent.composer_blocked_key', off: true },
  },
  quota: {
    act: 'change-provider', actions: ['change-provider', 'set-aside'], icon: 'pw-wallet', paper: 'danger',
    sentenceKey: 'agent.banner_quota', errorWord: 'agent.dock_err_quota', retryWord: AGAIN, retryIcon: 'pw-warning',
    composer: { key: 'agent.composer_blocked_provider', off: true },
  },
  cors: {
    act: 'edit-endpoint', actions: ['edit-endpoint', 'set-aside'], icon: 'pw-link-out', paper: 'danger',
    sentenceKey: 'agent.banner_cors', errorWord: 'agent.dock_err_cors', retryWord: AGAIN, retryIcon: 'pw-warning',
    composer: { key: 'agent.composer_blocked_endpoint', off: true },
  },
  // Nothing was sent: the custom provider has no address, so the request could not be built.
  config: {
    act: 'edit-endpoint', actions: ['edit-endpoint', 'set-aside'], icon: 'pw-link-out', paper: 'danger',
    sentenceKey: 'agent.banner_config', errorWord: 'agent.dock_err_config', retryWord: AGAIN, retryIcon: 'pw-warning',
  },
  // The host answered and serves no such model, so the repair is the model and not the address.
  model: {
    act: 'edit-model', actions: ['edit-model', 'set-aside'], icon: 'pw-lightning', paper: 'danger',
    sentenceKey: 'agent.banner_model', bareSentenceKey: 'agent.banner_model_bare',
    errorWord: 'agent.dock_err_model', retryWord: AGAIN, retryIcon: 'pw-warning',
    composer: { key: 'agent.composer_blocked_model', off: true },
  },
  network: {
    act: 'try-again', actions: RETRY_OR_FILE, icon: 'pw-cloud-off', paper: 'wait', exhausted: true,
    sentenceKey: 'agent.banner_network', errorWord: 'agent.dock_err_no_answer',
    retryWord: 'agent.dock_retry_offline', retryIcon: 'pw-cloud-off', composer: WAITING,
  },
  'rate-limit': {
    act: 'try-again', actions: RETRY_OR_FILE, icon: 'pw-retry-clock', paper: 'wait', exhausted: true,
    sentenceKey: 'agent.banner_rate_limit', errorWord: 'agent.dock_err_no_answer',
    retryWord: 'agent.dock_retry_busy', retryIcon: 'pw-retry-clock', composer: WAITING,
  },
  overloaded: {
    act: 'try-again', actions: RETRY_OR_FILE, icon: 'pw-cloud-off', paper: 'wait', exhausted: true,
    sentenceKey: 'agent.banner_network', errorWord: 'agent.dock_err_no_answer',
    retryWord: 'agent.dock_retry_busy', retryIcon: 'pw-warning', composer: WAITING,
  },
  // The same order would overflow at the same place, so the offer is a shorter one.
  overflow: {
    act: 'new-order', actions: ['new-order', 'export-log'], icon: 'pw-compress', paper: 'danger',
    sentenceKey: 'agent.banner_overflow', errorWord: 'agent.dock_err_overflow', retryWord: AGAIN, retryIcon: 'pw-warning',
    composer: { key: 'agent.composer_shorter', off: false },
  },
  abort: {
    act: 'try-again', actions: ['try-again', 'dismiss'], icon: 'pw-warning', paper: 'danger',
    sentenceKey: 'agent.banner_incident', errorWord: 'agent.dock_incident', retryWord: AGAIN, retryIcon: 'pw-warning',
  },
  unknown: {
    act: 'try-again', actions: ['try-again', 'dismiss'], icon: 'pw-warning', paper: 'danger',
    sentenceKey: 'agent.banner_incident', errorWord: 'agent.dock_incident', retryWord: AGAIN, retryIcon: 'pw-warning',
  },
};

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
};

export function deskActLabel(act: RepairAct): I18nKey {
  return DESK_ACT_LABEL[act] ?? ACT_LABEL[act];
}
