// @vitest-environment jsdom
/**
 * The page's one sign-in: a round's key is filed as a pasted and checked key is, and what the panel
 * shows next follows from the connection alone, however the key came and went before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setSignInRound, signIn, type SignInOutcome } from '../../../agent/connection/sign-in-round';
import { initialZone, reduceZone, sendZoneEvent, type ZoneEvent, type ZoneFacts } from '../../../agent/connection/panel-zone';
import { connectionReady, isConnected, runnerSettings, useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { keyRefusal } from '../../../agent/core/job-readings';

const noModels = () => Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

beforeEach(async () => {
  localStorage.clear();
  for (const id of PROVIDER_IDS) useAgentConnection.getState().forgetKey(id);
  useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '', model: noModels() });
  await useAgentConnection.getState().hydrate();
});
afterEach(() => { __setSignInRound(null); });

/** Rounds the test ends by hand, in the order they were started. */
function rounds() {
  const ends: ((outcome: SignInOutcome) => void)[] = [];
  const signals: AbortSignal[] = [];
  const run = vi.fn((_id: ProviderId, signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<SignInOutcome>((resolve) => { ends.push(resolve); });
  });
  __setSignInRound(run);
  return { run, signals, end: (outcome: SignInOutcome, at = ends.length - 1) => ends[at]!(outcome) };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const connection = () => useAgentConnection.getState();
const key = () => runnerSettings(connection()).apiKey;
/** The zone's facts as the panel reads them off the connection. */
const facts = (): ZoneFacts => ({ connected: isConnected(connection()), ready: connectionReady(connection()), open: true, jobInFlight: false, visit: 1 });
/** Signs in with `id` and has the provider return `returned`. */
async function signInWith(id: ProviderId, returned: string, hand: ReturnType<typeof rounds>): Promise<void> {
  signIn.start(id);
  hand.end({ key: returned });
  await settled();
}

describe('a sign-in round', () => {
  it('starts inside the press, then files the returned key under its provider with no pin left behind', async () => {
    const hand = rounds();
    signIn.start('openrouter');
    expect(hand.run).toHaveBeenCalledTimes(1);
    expect(signIn.get()).toEqual({ provider: 'openrouter', standing: 'waiting' });
    hand.end({ key: 'sk-or-v1-returned-key' });
    await settled();
    expect(signIn.get()).toBeNull();
    expect(connection()).toMatchObject({ provider: 'openrouter', providerPinned: false });
    expect(key()).toBe('sk-or-v1-returned-key');
  });

  it('says how it ended without a key, and nothing of one cancelled or left to lapse', async () => {
    for (const [failed, standing] of [['blocked', 'blocked'], ['denied', 'denied'], ['failed', 'failed'], ['timeout', null], ['cancelled', null]] as const) {
      const hand = rounds();
      signIn.start('modelscope');
      hand.end({ failed });
      await settled();
      expect(signIn.get()).toEqual(standing === null ? null : { provider: 'modelscope', standing });
      expect(isConnected(connection())).toBe(false);
    }
  });

  it('keeps an ending standing until a surface acknowledges it, and a round under way through one', async () => {
    const hand = rounds();
    signIn.start('openrouter');
    hand.end({ failed: 'denied' });
    await settled();
    expect(signIn.get()).toEqual({ provider: 'openrouter', standing: 'denied' });
    signIn.acknowledge();
    expect(signIn.get()).toBeNull();

    signIn.start('openrouter');
    signIn.acknowledge();
    expect(signIn.get()).toEqual({ provider: 'openrouter', standing: 'waiting' });
    expect(hand.signals[1]!.aborted).toBe(false);
  });

  it('counts opening setup by hand as the answer to an ending, and lets a round under way finish', async () => {
    const hand = rounds();
    const sent: ZoneEvent[] = [];
    signIn.start('modelscope');
    hand.end({ failed: 'blocked' });
    await settled();
    sendZoneEvent((event) => { sent.push(event); }, { type: 'setup', entry: 'key' });
    expect(signIn.get()).toBeNull();
    expect(sent).toEqual([{ type: 'setup', entry: 'key' }]);

    signIn.start('modelscope');
    sendZoneEvent(() => {}, { type: 'setup', entry: 'chooser' });
    expect(signIn.get()?.standing).toBe('waiting');
    sendZoneEvent(() => {}, { type: 'manage' });
    expect(signIn.get()?.standing).toBe('waiting');
  });

  it('is aborted by a cancel, and its late answer connects nothing', async () => {
    const hand = rounds();
    signIn.start('openrouter');
    signIn.cancel();
    expect(hand.signals[0]!.aborted).toBe(true);
    expect(signIn.get()).toBeNull();
    hand.end({ key: 'sk-or-v1-late' });
    await settled();
    expect(key()).toBe('');
  });

  it('gives way to a newer round, whose key alone lands', async () => {
    const hand = rounds();
    signIn.start('openrouter');
    signIn.start('openrouter');
    expect(hand.signals[0]!.aborted).toBe(true);
    hand.end({ key: 'sk-or-v1-first' }, 0);
    await settled();
    expect(key()).toBe('');
    expect(signIn.get()).toEqual({ provider: 'openrouter', standing: 'waiting' });
    hand.end({ key: 'sk-or-v1-second' }, 1);
    await settled();
    expect(key()).toBe('sk-or-v1-second');
  });
});

describe('what the panel shows after a sign-in', () => {
  it('opens setup for a model the first time, where the provider has none chosen', async () => {
    const hand = rounds();
    let zone = initialZone(facts());
    expect(zone.zone).toEqual({ kind: 'session' });
    await signInWith('openrouter', 'sk-or-v1-first', hand);
    zone = reduceZone(zone, { type: 'facts', facts: facts() });
    expect(facts()).toMatchObject({ connected: true, ready: false });
    expect(zone.zone.kind).toBe('setup');
  });

  it('stays on the session when the key was forgotten and the user signs in again, since the model is still chosen', async () => {
    const hand = rounds();
    await signInWith('openrouter', 'sk-or-v1-first', hand);
    connection().setModel('some/model');
    let zone = initialZone(facts());
    expect(zone.zone).toEqual({ kind: 'session' });

    for (const again of ['sk-or-v1-second', 'sk-or-v1-third']) {
      connection().forgetKey('openrouter');
      zone = reduceZone(zone, { type: 'facts', facts: facts() });
      expect(facts().connected).toBe(false);
      expect(zone.zone).toEqual({ kind: 'session' });

      await signInWith('openrouter', again, hand);
      zone = reduceZone(zone, { type: 'facts', facts: facts() });
      expect(facts()).toMatchObject({ connected: true, ready: true });
      expect(zone.zone).toEqual({ kind: 'session' });
      expect(key()).toBe(again);
      expect(connection().providerPinned).toBe(false);
    }
  });

  it('replaces a held key of the same provider, and leaves another provider key as it was', async () => {
    const hand = rounds();
    connection().connectKey('claude', 'sk-ant-api03-heldheldheld');
    connection().setModel('claude-model');
    await signInWith('openrouter', 'sk-or-v1-first', hand);
    await signInWith('openrouter', 'sk-or-v1-second', hand);
    expect(connection().provider).toBe('openrouter');
    expect(key()).toBe('sk-or-v1-second');
    expect(runnerSettings({ ...connection(), provider: 'claude' }).apiKey).toBe('sk-ant-api03-heldheldheld');
  });

  it('releases a provider pin a left key screen had set', async () => {
    const hand = rounds();
    connection().pinProvider('deepseek');
    await signInWith('modelscope', 'ms_oauth_returned_token', hand);
    expect(connection()).toMatchObject({ provider: 'modelscope', providerPinned: false });
  });
});

describe('where a held key came from', () => {
  it('remembers a signed-in key as one, across a reload, until it is pasted over or forgotten', async () => {
    const hand = rounds();
    await signInWith('openrouter', 'sk-or-v1-first', hand);
    const at = connection().signedIn.openrouter;
    expect(typeof at).toBe('number');

    useAgentConnection.setState({ signedIn: {} });
    await connection().hydrate();
    expect(connection().signedIn.openrouter).toBe(at);

    connection().connectKey('openrouter', 'sk-or-v1-pasted-by-hand');
    expect(connection().signedIn.openrouter).toBeUndefined();

    await signInWith('openrouter', 'sk-or-v1-second', hand);
    expect(connection().signedIn.openrouter).toBeDefined();
    connection().forgetKey('openrouter');
    expect(connection().signedIn.openrouter).toBeUndefined();
  });

  it('asks for a key where the refused one was pasted, a new sign-in where it was signed in, and nothing more once that is done', () => {
    expect(keyRefusal(undefined, 1000)).toBe('key');
    expect(keyRefusal(500, 1000)).toBe('sign-in-expired');
    expect(keyRefusal(1500, 1000)).toBe('signed-in-again');
  });
});
