/** Pins the job zone's one value: what each press opens and what each change in the facts takes back. */
import { describe, it, expect } from 'vitest';
import { initialZone, reduceZone, repairSteps, type ZoneEvent, type ZoneFacts, type ZoneState } from '../../../agent/connection/panel-zone';

/** Whether fixing the key has the harness drop the held one first. */
const dropsHeldKey = (s: ZoneState): boolean => repairSteps('fix-key', s).some((step) => step.step === 'harness');

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
    expect(initialZone({ ...FACTS, ready: false }).zone).toMatchObject({ kind: 'setup', entry: 'resume' });
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
    expect(run(s, facts({ cleared: new Set([9]) }, s)).zone.kind).toBe('record');
    expect(run(s, facts({ cleared: new Set([9, 4]) }, s)).zone.kind).toBe('session');
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
    expect(dropsHeldKey(s)).toBe(false);
    expect(run(s, { type: 'ask-key' }).zone).toEqual({ kind: 'setup', entry: 'key', focusKey: true });
  });

  it('waits for a held key to be dropped, then opens the field focused', () => {
    let s = initialZone(FACTS);
    expect(dropsHeldKey(s)).toBe(true);
    s = run(s, { type: 'ask-key' });
    expect(s.zone.kind).toBe('session');
    s = run(s, facts({ connected: false }, s));
    expect(s.zone).toEqual({ kind: 'setup', entry: 'key', focusKey: true });
    expect(s.keyOwed).toBe(false);
  });

  it('turns a standing setup screen to its key step', () => {
    const s = run(initialZone(FACTS), { type: 'setup', entry: 'endpoint' });
    expect(dropsHeldKey(s)).toBe(false);
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

describe('what a repair does, in order', () => {
  const steps = (act: Parameters<typeof repairSteps>[0], state: ZoneState) => repairSteps(act, state).map((step) => step.step);

  it('asks for a key, and has the harness drop a held one first', () => {
    const held = initialZone(FACTS);
    expect(repairSteps('fix-key', held)).toEqual([{ step: 'zone', event: { type: 'ask-key' } }, { step: 'harness' }]);
    // No key is held, so nothing is dropped and the field opens at once.
    expect(steps('fix-key', initialZone({ ...FACTS, connected: false, ready: false }))).toEqual(['zone']);
    // A key screen already standing takes the focus and keeps its key.
    const asking = run(initialZone({ ...FACTS, connected: false, ready: false }), { type: 'ask-key' });
    expect(steps('fix-key', asking)).toEqual(['focus-key', 'zone']);
  });

  it('sets a job aside by putting its notice down, filing the record, then telling the harness', () => {
    const s = initialZone(FACTS);
    expect(steps('set-aside', s)).toEqual(['put-down', 'file', 'harness']);
    expect(steps('dismiss', s)).toEqual(['put-down', 'harness']);
  });

  it('opens the connection where the repair is a provider, an address or a model', () => {
    const s = initialZone(FACTS);
    expect(repairSteps('change-provider', s)[0]).toEqual({ step: 'zone', event: { type: 'setup', entry: 'chooser' } });
    expect(repairSteps('edit-endpoint', s)[0]).toEqual({ step: 'zone', event: { type: 'setup', entry: 'endpoint' } });
    expect(repairSteps('edit-model', s)[0]).toEqual({ step: 'zone', event: { type: 'manage-open' } });
  });

  it('leaves a new order to the composer, a sign-in to its round and the rest to the harness', () => {
    const s = initialZone(FACTS);
    expect(steps('new-order', s)).toEqual(['compose']);
    expect(steps('sign-in', s)).toEqual(['sign-in']);
    expect(steps('try-again', s)).toEqual(['harness']);
    expect(steps('export-log', s)).toEqual(['harness']);
  });
});
