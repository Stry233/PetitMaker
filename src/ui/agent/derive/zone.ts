/*
 * What the job zone shows: the session, a setup step, the management card or an opened record.
 * One value, changed by the panel's own presses and by the facts it stands on; the keyless rest is
 * derived from the connection rather than stored.
 */
import type { SetupEntry } from '../../../agent/panel';

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
  | { type: 'close-record' }
  /** A record was cleared; the zone lets it go if it was showing it. */
  | { type: 'record-cleared'; seq: number };

const SESSION: PanelZone = { kind: 'session' };

/** Whether asking for a key means the caller must first drop the held one. */
export function keyNeedsDropping(state: ZoneState): boolean {
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
  // A held but incomplete connection opens setup unless management is already editing it.
  if (facts.connected && !facts.ready && zone.kind !== 'manage' && zone.kind !== 'setup') {
    zone = { kind: 'setup', entry: 'key', focusKey: false };
  }
  // Management and opened records are transient and close with the panel.
  if (!facts.open && (zone.kind === 'manage' || zone.kind === 'record')) zone = SESSION;
  // Active work takes the zone back from an opened record.
  if (facts.jobInFlight && zone.kind === 'record') zone = SESSION;
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
    case 'record-cleared':
      return state.zone.kind === 'record' && state.zone.seq === event.seq ? at(SESSION) : state;
  }
}

export function sameFacts(a: ZoneFacts, b: ZoneFacts): boolean {
  return a.connected === b.connected && a.ready === b.ready && a.open === b.open
    && a.jobInFlight === b.jobInFlight && a.visit === b.visit;
}
