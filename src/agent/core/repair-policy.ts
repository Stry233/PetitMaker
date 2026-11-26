/*
 * The assistant's policy over its own failure classes: which repair each one gets first, what else
 * is offered beside it, and whether an order may be sent while the fault stands. The panel words
 * and draws these rows; it decides none of them.
 */
import { isRetryable } from './errors';
import { jobStanding, keyRefusal, trouble, type JobStanding, type KeyRefusal } from './job-readings';
import type { ErrorClass } from './types';
import type { PanelView } from './view-types';

/**
 * Every repair a failure can be answered with. `fix-key`, `change-provider` and `edit-endpoint`
 * change the connection at that step, `edit-model` the model, `sign-in` replaces a key that came
 * from the provider's own page, `try-again` files the same order again while idle, `new-order`
 * asks for a different one, `export-log` writes the raw log out, `set-aside` files the record and
 * `dismiss` puts the notice down.
 */
export type RepairAct =
  | 'fix-key' | 'change-provider' | 'edit-endpoint' | 'edit-model'
  | 'try-again' | 'new-order' | 'export-log' | 'set-aside' | 'dismiss' | 'sign-in';

export interface RepairPolicy {
  /** The one repair offered first. */
  act: RepairAct;
  /** Every repair offered, `act` leading. */
  actions: readonly RepairAct[];
  /** Whether an order is refused while the fault stands, since sending one would fail the same way. */
  refusesOrders: boolean;
  /** The failure is transient and its retries ran out, so waiting is itself a repair. */
  exhausted: boolean;
}

type Offer = readonly [RepairAct, ...RepairAct[]];

const RETRY_OR_FILE: Offer = ['try-again', 'set-aside'];

const OFFERS: Record<ErrorClass, { actions: Offer; refusesOrders: boolean }> = {
  auth: { actions: ['fix-key', 'set-aside'], refusesOrders: true },
  quota: { actions: ['change-provider', 'set-aside'], refusesOrders: true },
  cors: { actions: ['edit-endpoint', 'set-aside'], refusesOrders: true },
  // Nothing was sent: the custom provider has no address, so the request could not be built.
  config: { actions: ['edit-endpoint', 'set-aside'], refusesOrders: false },
  // The host answered and serves no such model, so the repair is the model and not the address.
  model: { actions: ['edit-model', 'set-aside'], refusesOrders: true },
  // The key works; the provider serves it only once its account is linked or verified there.
  account: { actions: RETRY_OR_FILE, refusesOrders: false },
  network: { actions: RETRY_OR_FILE, refusesOrders: true },
  'rate-limit': { actions: RETRY_OR_FILE, refusesOrders: true },
  overloaded: { actions: RETRY_OR_FILE, refusesOrders: true },
  // The same order would overflow at the same place, so the offer is a shorter one.
  overflow: { actions: ['new-order', 'export-log'], refusesOrders: false },
  abort: { actions: ['try-again', 'dismiss'], refusesOrders: false },
  unknown: { actions: ['try-again', 'dismiss'], refusesOrders: false },
};

const policyOf = (actions: Offer, refusesOrders: boolean, exhausted: boolean): RepairPolicy =>
  ({ act: actions[0], actions, refusesOrders, exhausted });

export const REPAIR_POLICY = Object.fromEntries(
  (Object.keys(OFFERS) as ErrorClass[]).map((cls) => [cls, policyOf(OFFERS[cls].actions, OFFERS[cls].refusesOrders, isRetryable(cls))]),
) as Record<ErrorClass, RepairPolicy>;

/**
 * A refused key that came from a sign-in, in place of the `auth` row: signing in again is its
 * repair, and once that is done the refused order is free to be sent again.
 */
const SIGNED_IN_POLICY: Record<Exclude<KeyRefusal, 'key'>, RepairPolicy> = {
  'sign-in-expired': policyOf(['sign-in', 'set-aside'], true, false),
  'signed-in-again': policyOf(RETRY_OR_FILE, false, false),
};

/** The policy an incident of `cls` stands under, given how its refused key stands. */
export function repairPolicy(cls: ErrorClass, refusal: KeyRefusal = 'key'): RepairPolicy {
  return cls === 'auth' && refusal !== 'key' ? SIGNED_IN_POLICY[refusal] : REPAIR_POLICY[cls];
}

/** How the armed key stands: whether one is held, and when it came from a sign-in. */
export interface KeyStanding {
  connected: boolean;
  signedInAt?: number;
}

/**
 * The repair an incident is answered with first. A keyless incident restores a key before anything
 * else, whatever failed, since no other repair can be tried without one.
 */
export function firstRepair(cls: ErrorClass, key: { connected: boolean; refusal: KeyRefusal }): RepairAct {
  return key.connected ? repairPolicy(cls, key.refusal).act : REPAIR_POLICY.auth.act;
}

type SignedInRefusal = Exclude<KeyRefusal, 'key'>;

/** A notice that is not a failure class: a key gone or refused, storage trouble, records of another map. */
export type NoticeClass =
  | 'key-cleared' | 'key-clearing' | SignedInRefusal
  | 'storage-pruned' | 'storage-full' | 'storage-corrupt' | 'other-map' | 'unknown-map';

/** Everything a notice can stand for. */
export type TroubleClass = ErrorClass | NoticeClass;

/** What a notice offers: its answers in order, and the one that repairs it where one does. */
interface NoticeOffer {
  actions: readonly RepairAct[];
  act?: RepairAct;
}

/** A standing fact with nothing to press: dismissing it would only bring the same sentence back. */
const NOTHING: NoticeOffer = { actions: [] };

const NOTICE_OFFERS: Record<Exclude<NoticeClass, SignedInRefusal>, NoticeOffer> = {
  // The held job's own card carries the repair, so the notice carries none.
  'key-cleared': NOTHING,
  // The key went away under a running job whose stop has not settled yet.
  'key-clearing': NOTHING,
  'storage-pruned': { actions: ['dismiss'] },
  'storage-full': { actions: ['dismiss'] },
  // The unreadable session was set aside: neither answer repairs it, so neither leads.
  'storage-corrupt': { actions: ['dismiss', 'export-log'] },
  // Records made on a map that is not open read but cannot be taken back from here.
  'other-map': NOTHING,
  'unknown-map': NOTHING,
};

/** What the notice of `cls` offers. */
export function noticeOffer(cls: TroubleClass): NoticeOffer {
  if (cls in REPAIR_POLICY) return REPAIR_POLICY[cls as ErrorClass];
  if (cls in SIGNED_IN_POLICY) return SIGNED_IN_POLICY[cls as SignedInRefusal];
  return NOTICE_OFFERS[cls as keyof typeof NOTICE_OFFERS];
}

/** Both put-downs: the notice leaves for its standing strip, the fault still true. */
const PUT_DOWN: ReadonlySet<RepairAct> = new Set<RepairAct>(['dismiss', 'set-aside']);

export function putsDown(act: RepairAct): boolean {
  return PUT_DOWN.has(act);
}

/** What a notice put down keeps offering: its repairs, or its one answer where it has no other. */
export function standingActions(actions: readonly RepairAct[]): readonly RepairAct[] {
  const kept = actions.filter((act) => !PUT_DOWN.has(act));
  return kept.length > 0 ? kept : actions;
}

/** The notice an incident of `cls` reads under, given how its refused key stands. */
export function incidentNotice(cls: ErrorClass, refusal: KeyRefusal): TroubleClass {
  return cls === 'auth' && refusal !== 'key' ? refusal : cls;
}

/** How the standing trouble reads and whether it admits an order. */
export interface TroubleStanding {
  /** How a refused key stands, measured against when the owed job's order was sent. */
  keyRefusal: KeyRefusal;
  /** The notice the standing incident reads under. */
  incidentCls: TroubleClass | null;
  /**
   * No order is taken: no key is held, the key went missing under a job that needs it, or the
   * incident's fault would fail the next order the same way and its notice has not been put down.
   */
  refusesOrders: boolean;
}

export function troubleStanding(
  jobs: Pick<JobStanding, 'owedJob' | 'incident' | 'keyCleared' | 'standingTrouble'>, key: KeyStanding,
): TroubleStanding {
  const refusal = keyRefusal(key.signedInAt, jobs.owedJob?.orderAt ?? 0);
  const { incident } = jobs;
  return {
    keyRefusal: refusal,
    incidentCls: incident ? incidentNotice(incident.cls, refusal) : null,
    refusesOrders: !key.connected || jobs.keyCleared
      || (incident !== null && !jobs.standingTrouble && repairPolicy(incident.cls, refusal).refusesOrders),
  };
}

const NO_SEQS: ReadonlySet<number> = new Set();

/**
 * Whether an order is refused now, for a caller with no panel between it and the session. Its
 * incident counts as put down once its record is filed, which setting a job aside does, and every
 * policy that refuses orders offers that.
 */
export function ordersRefused(view: PanelView, key: KeyStanding, filed: ReadonlySet<number>): boolean {
  const incident = trouble(view);
  const jobs = jobStanding({
    view, connected: key.connected, openedSeq: null, filed, cleared: NO_SEQS, restored: false,
    dismissed: incident && filed.has(incident.seq) ? incident.seq : null,
  });
  return troubleStanding(jobs, key).refusesOrders;
}
