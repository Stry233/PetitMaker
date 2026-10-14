/** Pins the job zone's one value: what each press opens and what each change in the facts takes back. */
import { describe, it, expect } from 'vitest';
import { initialZone, keyNeedsDropping, reduceZone, type ZoneEvent, type ZoneFacts, type ZoneState } from '../../../../ui/agent/derive/zone';

const FACTS: ZoneFacts = { connected: true, ready: true, open: true, jobInFlight: false, visit: 0 };

function run(state: ZoneState, ...events: ZoneEvent[]): ZoneState {
  return events.reduce(reduceZone, state);
}

const facts = (over: Partial<ZoneFacts>, state: ZoneState): ZoneEvent => ({ type: 'facts', facts: { ...state.facts, ...over } });

describe('the zone the panel opens on', () => {
  it('opens on the session over a usable connection', () => {
    expect(initialZone(FACTS).zone).toEqual({ kind: 'session' });
  });

  it('opens setup over a held connection that is not yet usable', () => {
    expect(initialZone({ ...FACTS, ready: false }).zone).toMatchObject({ kind: 'setup', entry: 'key' });
  });
});

describe('the manage card', () => {
  it('toggles on the gear and closes on Done, leaving the session as it was', () => {
    const s = initialZone(FACTS);
    expect(run(s, { type: 'manage' }).zone.kind).toBe('manage');
    expect(run(s, { type: 'manage' }, { type: 'manage' }).zone.kind).toBe('session');
    expect(run(s, { type: 'manage' }, { type: 'manage-done' }).zone.kind).toBe('session');
  });

  it('closes when the connection goes, and does not come back with it', () => {
    let s = run(initialZone(FACTS), { type: 'manage' });
    s = run(s, facts({ connected: false }, s));
    expect(s.zone.kind).toBe('session');
    s = run(s, facts({ connected: true }, s));
    expect(s.zone.kind).toBe('session');
  });

  it('closes with the panel', () => {
    let s = run(initialZone(FACTS), { type: 'manage' });
    s = run(s, facts({ open: false }, s));
    s = run(s, facts({ open: true }, s));
    expect(s.zone.kind).toBe('session');
  });

  /** A panel reopened during its own close is a new opening, even where no closed render was seen. */
  it('closes on a new opening', () => {
    let s = run(initialZone(FACTS), { type: 'manage' });
    s = run(s, facts({ visit: 1 }, s));
    expect(s.zone.kind).toBe('session');
  });

  it('keeps the zone over a connection it is still editing', () => {
    let s = run(initialZone(FACTS), { type: 'manage' });
    s = run(s, facts({ ready: false }, s));
    expect(s.zone.kind).toBe('manage');
  });
});

describe('an opened record', () => {
  it('stands until Back, and lets go when it is the record cleared', () => {
    const s = run(initialZone(FACTS), { type: 'open-record', seq: 4 });
    expect(s.zone).toEqual({ kind: 'record', seq: 4 });
    expect(run(s, { type: 'close-record' }).zone.kind).toBe('session');
    expect(run(s, { type: 'record-cleared', seq: 9 }).zone.kind).toBe('record');
    expect(run(s, { type: 'record-cleared', seq: 4 }).zone.kind).toBe('session');
  });

  it('gives the zone back to a job that starts, and does not spring open at its settle', () => {
    let s = run(initialZone(FACTS), { type: 'open-record', seq: 4 });
    s = run(s, facts({ jobInFlight: true }, s));
    expect(s.zone.kind).toBe('session');
    s = run(s, facts({ jobInFlight: false }, s));
    expect(s.zone.kind).toBe('session');
  });

  it('closes with the panel', () => {
    let s = run(initialZone(FACTS), { type: 'open-record', seq: 4 });
    s = run(s, facts({ open: false }, s));
    expect(s.zone.kind).toBe('session');
  });
});

describe('asking for a key', () => {
  it('opens the field at once where no key is held', () => {
    const s = initialZone({ ...FACTS, connected: false });
    expect(keyNeedsDropping(s)).toBe(false);
    expect(run(s, { type: 'ask-key' }).zone).toEqual({ kind: 'setup', entry: 'key', focusKey: true });
  });

  it('waits for a held key to be dropped, then opens the field focused', () => {
    let s = initialZone(FACTS);
    expect(keyNeedsDropping(s)).toBe(true);
    s = run(s, { type: 'ask-key' });
    expect(s.zone.kind).toBe('session');
    s = run(s, facts({ connected: false }, s));
    expect(s.zone).toEqual({ kind: 'setup', entry: 'key', focusKey: true });
    expect(s.keyOwed).toBe(false);
  });

  it('turns a standing setup screen to its key step', () => {
    const s = run(initialZone(FACTS), { type: 'setup', entry: 'endpoint' });
    expect(keyNeedsDropping(s)).toBe(false);
    expect(run(s, { type: 'ask-key' }).zone).toEqual({ kind: 'setup', entry: 'key', focusKey: true });
  });

  it('leaves a keyless panel at rest when the key goes without being asked for', () => {
    let s = initialZone(FACTS);
    s = run(s, facts({ connected: false }, s));
    expect(s.zone.kind).toBe('session');
  });
});

describe('setup', () => {
  it('opens at the step a repair asks for, and hands model choice to management', () => {
    const s = run(initialZone(FACTS), { type: 'setup', entry: 'chooser' });
    expect(s.zone).toEqual({ kind: 'setup', entry: 'chooser', focusKey: false });
    expect(run(s, { type: 'setup-to-manage' }).zone.kind).toBe('manage');
    expect(run(s, { type: 'setup-done' }).zone.kind).toBe('session');
  });
});
