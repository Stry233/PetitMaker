/*
 * Maps provider, storage, credential and map-history trouble classes to localized banners. The
 * exhaustive `BANNER_SPEC` assigns each class its icon, severity, message and actionable controls.
 * Retry exhaustion and storage conditions use wait styling; conditions that require user repair use
 * danger styling. Rate limits keep their distinct waiting language and retry-clock icon.
 */
import { Icon, type IconId } from './icons';
import { edge, statePaper } from './tokens';
import { INK, INSET, LINE, PANEL_EDGE_WIDTH, PLATE_INK } from '../design/tokens';
import { colors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';
import { useT } from '../../i18n/context';
import type { ErrorClass } from '../../agent/core/types';

/** `ErrorClass` plus the five non-provider kinds the panel also banners: the three storage
 *  readings, and the two standing notices that the record holds jobs no roll back may aim at from
 *  here — built on a map that is not open, or naming no map at all. */
export type BannerClass =
  | ErrorClass
  | 'key-cleared' | 'key-clearing'
  | 'storage-pruned' | 'storage-full' | 'storage-corrupt' | 'other-map' | 'unknown-map';

/**
 * What a banner offers, with at most two actions per class: the primary repair and a dismissal.
 *
 * EVERY ONE OF THESE IS A REAL VERB SOMEWHERE, which is the whole point of the id being a union: a
 * pill is drawn because the panel can route its press, and a class whose repair nothing can perform
 * offers no pill rather than a dead one. `fix-key`/`change-provider`/`edit-endpoint` open the
 * connection surface at their own step and `edit-model` opens the settings card at the model row
 * (the one place a model is picked), `try-again` files the same order again, `new-order` puts the
 * caret in the composer, `export-log` writes the raw log out, `set-aside` FILES the record (never
 * drops it), and `dismiss` demotes the banner to the standing strip.
 */
export type BannerActionId =
  | 'fix-key' | 'change-provider' | 'edit-endpoint' | 'edit-model'
  | 'try-again' | 'new-order' | 'export-log' | 'set-aside' | 'dismiss';

interface BannerSpec {
  icon: IconId;
  paper: 'danger' | 'wait';
  sentenceKey: string;
  /** The same sentence with the fact left out, for the caller that has none to give. Only the class
   *  whose sentence NAMES something carries one; every other sentence takes no parameter at all. */
  bareSentenceKey?: string;
  actions: readonly BannerActionId[];
  /**
   * WHICH PILL IS THE ACT, drawn in the accent rather than on the paper. It is named rather than
   * derived (it is not simply "the first" or "not the dismissal"): where a class HAS a repair, that
   * repair leads — and where it has none, nothing does. The corrupt notice is the case that makes
   * the difference: neither Discard nor Export repairs anything, since the saved session is already
   * gone, so an accent on either would point the user at a fix that does not exist.
   */
  act?: BannerActionId;
  /** A class that words a shared action its own way. The corrupt notice's `dismiss` is a DISCARD —
   *  the set-aside bytes go with it — and "Dismiss" would understate what the press does. */
  labels?: Partial<Record<BannerActionId, string>>;
}

const DISMISS: readonly BannerActionId[] = ['dismiss'];

/** A fault the ladder could not get past: another attempt is the honest first offer, and putting the
 *  job away is the other. */
const RETRY_OR_FILE: readonly BannerActionId[] = ['try-again', 'set-aside'];

/** THE TWO WAYS TO PUT A TROUBLE DOWN, and what a demotion has therefore already answered: both
 *  leave the standing strip, so the muted sentence keeps only the REPAIR. A second press on either
 *  would do nothing the first press did not already do. */
const PUT_DOWN: ReadonlySet<BannerActionId> = new Set<BannerActionId>(['dismiss', 'set-aside']);

/** A notice with nothing to press. Only a STANDING fact takes this: dismissing one would be a
 *  control that answers a press by putting the same sentence back the next time the list is read. */
const NO_ACTIONS: readonly BannerActionId[] = [];

const BANNER_SPEC: Record<BannerClass, BannerSpec> = {
  auth: {
    icon: 'pw-key', paper: 'danger', sentenceKey: 'agent3.banner_auth',
    actions: ['fix-key', 'set-aside'], act: 'fix-key',
  },
  // A KEY REFUSED AND A KEY GONE ARE ONE `ErrorClass` AND TWO SENTENCES. The provider turning a key
  // down is a fact about the key; the vault missing at the next request is a fact about the browser,
  // and the job stopped cleanly at a step boundary rather than failing mid-call. This reading also
  // carries NO pills: the held job's own card stands right under it with the repair and the
  // set-aside on it, and the same two verbs twice would be one trouble asked twice.
  'key-cleared': { icon: 'pw-key', paper: 'danger', sentenceKey: 'agent3.banner_key_cleared', actions: NO_ACTIONS },
  // AND A KEY GOING AWAY UNDER A RUNNING JOB IS A THIRD SENTENCE, because the stop has not happened
  // yet: `abort()` is asynchronous and this is the interval before the settle lands, with the live
  // ticket still standing and the dock still reading Thinking. Saying the job "stopped at the end of
  // the step" over that is a completed tense over an unfinished fact.
  'key-clearing': { icon: 'pw-key', paper: 'danger', sentenceKey: 'agent3.banner_key_clearing', actions: NO_ACTIONS },
  quota: {
    icon: 'pw-wallet', paper: 'danger', sentenceKey: 'agent3.banner_quota',
    actions: ['change-provider', 'set-aside'], act: 'change-provider',
  },
  cors: {
    icon: 'pw-link-out', paper: 'danger', sentenceKey: 'agent3.banner_cors',
    actions: ['edit-endpoint', 'set-aside'], act: 'edit-endpoint',
  },
  // NOTHING WAS SENT: the armed provider is the user's own server and no address is filed for it, so
  // the request could not be built at all. The same glyph and the same repair as a blocked endpoint,
  // since the reader's next move is the same field; the sentence is what differs, because a request
  // that was refused and a request that was never made are not one fact.
  config: {
    icon: 'pw-link-out', paper: 'danger', sentenceKey: 'agent3.banner_config',
    actions: ['edit-endpoint', 'set-aside'], act: 'edit-endpoint',
  },
  // THE REQUEST WAS SENT AND THE ENDPOINT HAS NO SUCH MODEL, which is the address's neighbour and
  // not the address: the host answered, so sending it again or re-entering the URL changes nothing.
  // The engine glyph, because the trouble is which engine was asked for, and the sentence names the
  // model, since "the model is unavailable" on a panel that can arm any id says nothing to act on.
  model: {
    icon: 'pw-lightning', paper: 'danger', sentenceKey: 'agent3.banner_model',
    bareSentenceKey: 'agent3.banner_model_bare',
    actions: ['edit-model', 'set-aside'], act: 'edit-model',
  },
  network: {
    icon: 'pw-cloud-off', paper: 'wait', sentenceKey: 'agent3.banner_network',
    actions: RETRY_OR_FILE, act: 'try-again',
  },
  // The clock, not the cloud: the retry dock wears `pw-retry-clock` while it waits out a
  // rate-limit, and the banner is that same wait having run out of attempts. Two glyphs for one
  // cause read as two different troubles.
  'rate-limit': {
    icon: 'pw-retry-clock', paper: 'wait', sentenceKey: 'agent3.banner_rate_limit',
    actions: RETRY_OR_FILE, act: 'try-again',
  },
  overloaded: {
    icon: 'pw-cloud-off', paper: 'wait', sentenceKey: 'agent3.banner_network',
    actions: RETRY_OR_FILE, act: 'try-again',
  },
  // A JOB TOO BIG TO HOLD IS NOT RETRIED, and that is the whole difference: another attempt at the
  // same order would overflow at the same place, so the offer is a fresh (shorter) one, with the
  // evidence exportable for a bug report.
  overflow: {
    icon: 'pw-compress', paper: 'danger', sentenceKey: 'agent3.banner_overflow',
    actions: ['new-order', 'export-log'], act: 'new-order',
  },
  abort: {
    icon: 'pw-warning', paper: 'danger', sentenceKey: 'agent3.banner_incident',
    actions: ['try-again', 'dismiss'], act: 'try-again',
  },
  unknown: {
    icon: 'pw-warning', paper: 'danger', sentenceKey: 'agent3.banner_incident',
    actions: ['try-again', 'dismiss'], act: 'try-again',
  },
  'storage-pruned': { icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent3.banner_storage_pruned', actions: DISMISS },
  'storage-full': { icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent3.banner_storage_full', actions: DISMISS },
  // The one notice whose whole content is itself: the saved bytes were set aside unread, so the two
  // answers are to let them go or to write them out for a bug report first.
  'storage-corrupt': {
    icon: 'pw-warning', paper: 'wait', sentenceKey: 'agent3.banner_storage_corrupt',
    actions: ['dismiss', 'export-log'], labels: { dismiss: 'agent3.banner_action_discard' },
  },
  // A NOTICE RATHER THAN A TROUBLE, and the second non-provider kind: the past-jobs list is holding
  // records built on a map that is not open, so they read but cannot be rolled back. Wait paper,
  // because nothing here is broken and nothing has to be fixed — opening the other map is what
  // changes the answer. The frame glyph is the one that means "somewhere on a map".
  'other-map': { icon: 'pw-region-frame', paper: 'wait', sentenceKey: 'agent3.banner_other_map', actions: NO_ACTIONS },
  // Its sibling, and the difference is what the panel can PROVE: these records name no map at all
  // (a session written before an order carried one), so they may be this map's and may not be. Same
  // wait paper and same absent action — nothing is broken, and nothing here can be fixed.
  'unknown-map': { icon: 'pw-region-frame', paper: 'wait', sentenceKey: 'agent3.banner_unknown_map', actions: NO_ACTIONS },
};

/** Every class the table covers, in declaration order — for callers (and this file's own tests)
 *  that want to enumerate the whole set rather than hand-list it. */
export const BANNER_CLASSES = Object.keys(BANNER_SPEC) as BannerClass[];

const ACTION_LABEL_KEY: Record<BannerActionId, string> = {
  'fix-key': 'agent3.banner_action_fix_key',
  'change-provider': 'agent3.banner_action_change_provider',
  'edit-endpoint': 'agent3.banner_action_edit_endpoint',
  'edit-model': 'agent3.banner_action_edit_model',
  'try-again': 'agent3.banner_action_try_again',
  'new-order': 'agent3.banner_action_new_order',
  'export-log': 'agent3.banner_action_export_log',
  'set-aside': 'agent3.banner_action_set_aside',
  dismiss: 'agent3.banner_action_dismiss',
};

export function Banner({ cls, model, standing = false, onAction }: {
  cls: BannerClass;
  /**
   * The armed model's display name, for the one sentence that names it.
   *
   * THE ARMED ONE RATHER THAN THE FAILED JOB'S, and the two are the same until the user acts: this
   * banner's own pill is what changes the armed model, so naming it names exactly what the press
   * will edit. A sentence needing it with none given falls back to the nameless wording rather than
   * rendering an empty gap.
   */
  model?: string;
  /**
   * THE THIRD DRESS: a fault the user has waved away.
   *
   * It demotes rather than unmounting, for two reasons that point the same way. The fault is still
   * TRUE — the credit is still spent, the endpoint still blocked — so removing the sentence would
   * leave the panel silent about the thing that stopped the job; and a banner that vanished under
   * the pointer that just pressed Dismiss would shorten the record by its own height, which is the
   * one thing the house's layout rule forbids. So the paper goes quiet, the ink goes muted, and the
   * REPAIR stays reachable. Only the dismissal itself leaves: it has been answered, and a control
   * that answers a second press with nothing is the thing `NO_ACTIONS` exists to refuse.
   *
   * A REPAIR-LESS CLASS (`storage-pruned`/`storage-full`, whose whole action set IS the put-down)
   * has nothing left once that filter runs, so `shown` falls back to the unfiltered set rather than
   * collapsing the row: the height still must not change, even where there was never a repair to
   * fall back ON. Pressing the one pill standing there answers a second press exactly like every
   * other put-down does — with nothing.
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
  const ink = standing ? colors.brownText : terminal ? colors.dangerDeep : INK;
  const textInk = standing ? colors.brownText : terminal ? colors.dangerDeep : PLATE_INK;
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
        // `edge` IS THE WHOLE SHORTHAND, so it takes no width in front of it; the demoted strip
        // states one because it is naming a colour, and it takes the same width from the same place.
        border: standing ? `${PANEL_EDGE_WIDTH}px solid ${LINE}` : edge,
        borderRadius: 12,
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        boxShadow: 'none',
      }}
    >
      <span data-testid="banner-icon" style={{ flex: '0 0 auto', marginTop: 1, color: ink }}>
        <Icon id={spec.icon} size={20} />
      </span>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ ...roleFont('label'), fontFamily: font.family, color: textInk, lineHeight: 1.45 }}>
          {sentence}
        </div>
        {/* A notice with no answers draws no row at all: an empty band under the sentence would be
            a reserved seat for a control that does not exist. */}
        <div style={{ display: shown.length === 0 ? 'none' : 'flex', gap: 7, flexWrap: 'wrap' }}>
          {shown.map((action) => (
            <button
              key={action}
              type="button"
              data-testid="banner-action"
              data-action={action}
              onClick={() => onAction(action)}
              style={{
                boxShadow: 'none',
                ...windowPill(action === spec.act ? 'active' : 'quiet', false, 'inset'),
              }}
            >
              {t(spec.labels?.[action] ?? ACTION_LABEL_KEY[action])}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
