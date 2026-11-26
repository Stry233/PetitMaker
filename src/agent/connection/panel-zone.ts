/*
 * What the job zone shows: the session, a setup step, the management card or an opened record.
 * One value, changed by the panel's own presses and by the facts it stands on; the keyless rest is
 * derived from the connection rather than stored.
 */
import { putsDown, type RepairAct } from '../core/repair-policy';
import type { SetupEntry } from './key-reading';
import { signIn } from './sign-in-round';

export type PanelZone =
  | { kind: 'session' }
  | { kind: 'setup'; entry: SetupEntry; focusKey: boolean }
  | { kind: 'manage' }
  | { kind: 'record'; seq: number };

/** The facts the zone answers to. */
export interface ZoneFacts {
  /** A credential is available. */
  connected: boolean;
  /** The credential, endpoint and model form a usable connection. */
  ready: boolean;
  /** The panel is open. */
  open: boolean;
  /** A job occupies the current seat. */
  jobInFlight: boolean;
  /** Counts the panel's openings; a new one finds no transient surface standing. */
  visit: number;
  /** The records removed from history; an opened one leaves the zone with them. */
  cleared?: ReadonlySet<number>;
}

export interface ZoneState {
  zone: PanelZone;
  /** A key was asked for while one is held; the field opens once the held key is gone. */
  keyOwed: boolean;
  facts: ZoneFacts;
}

export type ZoneEvent =
  | { type: 'facts'; facts: ZoneFacts }
  /** The gear: management opens, or closes when already open. */
  | { type: 'manage' }
  /** A repair that is a model choice opens management. */
  | { type: 'manage-open' }
  | { type: 'manage-done' }
  /** Open the connection screen at a step. */
  | { type: 'setup'; entry: SetupEntry }
  /** Open key entry with its field focused, now or once the held key is dropped. */
  | { type: 'ask-key' }
  /** Setup finished, was left, or handed model choice to management. */
  | { type: 'setup-done' }
  | { type: 'setup-to-manage' }
  | { type: 'open-record'; seq: number }
  | { type: 'close-record' };

const SESSION: PanelZone = { kind: 'session' };

/** Whether asking for a key means the caller must first drop the held one. */
function keyNeedsDropping(state: ZoneState): boolean {
  return state.zone.kind !== 'setup' && state.facts.connected;
}

/** The zone the facts allow, applied whenever they change. */
function settle(state: ZoneState): ZoneState {
  const { facts } = state;
  let { zone, keyOwed } = state;
  if (!facts.connected) {
    if (keyOwed) { zone = { kind: 'setup', entry: 'key', focusKey: true }; keyOwed = false; }
    else if (zone.kind === 'manage') zone = SESSION;
  }
  // Management and opened records are transient and close with the panel.
  if (!facts.open && (zone.kind === 'manage' || zone.kind === 'record')) zone = SESSION;
  // Active work takes the zone back from an opened record, and so does clearing that record.
  if (zone.kind === 'record' && (facts.jobInFlight || facts.cleared?.has(zone.seq) === true)) zone = SESSION;
  // A held but incomplete connection opens setup unless management is already editing it. This rule
  // comes last, after every rule that returns the zone to the session, so settling twice changes nothing.
  if (facts.connected && !facts.ready && zone.kind !== 'manage' && zone.kind !== 'setup') {
    zone = { kind: 'setup', entry: 'resume', focusKey: false };
  }
  return zone === state.zone && keyOwed === state.keyOwed ? state : { ...state, zone, keyOwed };
}

export function initialZone(facts: ZoneFacts, zone: PanelZone = SESSION): ZoneState {
  return settle({ zone, keyOwed: false, facts });
}

export function reduceZone(state: ZoneState, event: ZoneEvent): ZoneState {
  const at = (zone: PanelZone): ZoneState => ({ ...state, zone });
  switch (event.type) {
    case 'facts': {
      const reopened = event.facts.visit !== state.facts.visit
        && (state.zone.kind === 'manage' || state.zone.kind === 'record');
      return settle({ ...state, facts: event.facts, ...(reopened ? { zone: SESSION } : {}) });
    }
    case 'manage':
      return at(state.zone.kind === 'manage' ? SESSION : { kind: 'manage' });
    case 'manage-open':
      return at({ kind: 'manage' });
    case 'manage-done':
      return state.zone.kind === 'manage' ? at(SESSION) : state;
    case 'setup':
      return at({ kind: 'setup', entry: event.entry, focusKey: false });
    case 'ask-key':
      return keyNeedsDropping(state)
        ? { ...state, keyOwed: true }
        : at({ kind: 'setup', entry: 'key', focusKey: true });
    case 'setup-done':
      return state.zone.kind === 'setup' ? settle(at(SESSION)) : state;
    case 'setup-to-manage':
      return at({ kind: 'manage' });
    case 'open-record':
      return at({ kind: 'record', seq: event.seq });
    case 'close-record':
      return state.zone.kind === 'record' ? at(SESSION) : state;
  }
}

/**
 * Sends `event` to the zone `dispatch` holds. Opening setup by hand answers a sign-in that ended
 * with no key, since the user chose another way in, so its ending no longer stands; a round under
 * way is left to finish. That happens here and not in `reduceZone`, which its holder may run again
 * for the same event.
 */
export function sendZoneEvent(dispatch: (event: ZoneEvent) => void, event: ZoneEvent): void {
  if (event.type === 'setup') signIn.acknowledge();
  dispatch(event);
}

export function sameFacts(a: ZoneFacts, b: ZoneFacts): boolean {
  return a.connected === b.connected && a.ready === b.ready && a.open === b.open
    && a.jobInFlight === b.jobInFlight && a.visit === b.visit && a.cleared === b.cleared;
}

/**
 * One step of a repair. The panel takes the steps in order with its own hands: `put-down` demotes
 * the incident's notice, `compose` hands the composer the focus, `sign-in` starts the provider's
 * round inside the press, `focus-key` focuses the standing key field, `zone` is an event for
 * `reduceZone`, `file` files the incident's record and `harness` is `exec/panel-repairs.ts:runRepair`.
 */
export type RepairStep =
  | { step: 'put-down' | 'compose' | 'sign-in' | 'focus-key' | 'file' | 'harness' }
  | { step: 'zone'; event: ZoneEvent };

/** Where each repair that changes the connection opens the zone. */
const ZONE_REPAIR: Partial<Record<RepairAct, ZoneEvent>> = {
  'change-provider': { type: 'setup', entry: 'chooser' },
  'edit-endpoint': { type: 'setup', entry: 'endpoint' },
  'edit-model': { type: 'manage-open' },
};

/** What `act` does, as the zone stands in `state`. */
export function repairSteps(act: RepairAct, state: ZoneState): readonly RepairStep[] {
  // A new order and a sign-in are the whole of their repair.
  if (act === 'new-order') return [{ step: 'compose' }];
  if (act === 'sign-in') return [{ step: 'sign-in' }];
  if (act === 'fix-key') {
    // A held key is dropped by the harness; once it is gone the field opens, focused.
    return [
      ...(state.zone.kind === 'setup' ? [{ step: 'focus-key' } as const] : []),
      { step: 'zone', event: { type: 'ask-key' } },
      ...(keyNeedsDropping(state) ? [{ step: 'harness' } as const] : []),
    ];
  }
  const opens = ZONE_REPAIR[act];
  return [
    ...(putsDown(act) ? [{ step: 'put-down' } as const] : []),
    ...(opens ? [{ step: 'zone', event: opens } as const] : []),
    ...(act === 'set-aside' ? [{ step: 'file' } as const] : []),
    { step: 'harness' },
  ];
}
