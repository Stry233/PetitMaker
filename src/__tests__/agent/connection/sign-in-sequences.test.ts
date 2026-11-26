// @vitest-environment jsdom
/**
 * Signing in, pasting, forgetting and repairing a key in any order: the panel never rests on the
 * session with a connection it cannot use, never shows management without a key, and never opens the
 * key screen over a whole connection unless the user asked for it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setSignInRound, signIn, type SignInOutcome } from '../../../agent/connection/sign-in-round';
import { createKeyReading } from '../../../agent/connection/key-reading';
import { initialZone, reduceZone, repairSteps, sendZoneEvent, type ZoneEvent, type ZoneFacts, type ZoneState } from '../../../agent/connection/panel-zone';
import { connectionReady, isConnected, useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';

const PROVIDERS: readonly ProviderId[] = ['openrouter', 'modelscope', 'claude'];
const noModels = () => Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
const connection = () => useAgentConnection.getState();
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A small seeded generator, so a failing sequence is replayed by its seed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(async () => {
  localStorage.clear();
  for (const id of PROVIDER_IDS) connection().forgetKey(id);
  useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '', model: noModels() });
  await connection().hydrate();
});
afterEach(() => { __setSignInRound(null); });

describe('the panel under any order of sign-in, paste, forget and repair', () => {
  it('holds its invariants over seeded random sequences', async () => {
    for (let seed = 1; seed <= 120; seed++) {
      const random = seeded(seed);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      for (const id of PROVIDER_IDS) connection().forgetKey(id);
      useAgentConnection.setState({ provider: 'claude', providerPinned: false, model: noModels() });

      const pending: ((outcome: SignInOutcome) => void)[] = [];
      __setSignInRound(() => new Promise<SignInOutcome>((resolve) => { pending.push(resolve); }));
      let visit = 1;
      let open = true;
      const facts = (): ZoneFacts => ({ connected: isConnected(connection()), ready: connectionReady(connection()), open, jobInFlight: false, visit });
      let zone: ZoneState = initialZone(facts());
      /** Whether the standing key screen was asked for by the user, as opposed to opened by the facts. */
      let asked = false;
      const send = (event: ZoneEvent): void => sendZoneEvent((sent) => { zone = reduceZone(zone, sent); }, event);
      const trail: string[] = [];

      for (let step = 0; step < 40; step++) {
        const op = pick(['sign-in', 'answer-key', 'answer-fail', 'cancel', 'use-key', 'paste', 'check-settles', 'choose-model', 'leave-setup', 'gear', 'forget', 'repair-key', 'close', 'reopen'] as const);
        trail.push(op);
        if (op === 'sign-in' && !facts().connected && zone.zone.kind === 'session') signIn.start(pick(PROVIDERS));
        if (op === 'answer-key' && pending.length > 0) pending.pop()!({ key: `returned-key-${seed}-${step}` });
        if (op === 'answer-fail' && pending.length > 0) pending.pop()!({ failed: pick(['blocked', 'denied', 'failed', 'timeout'] as const) });
        if (op === 'cancel') signIn.cancel();
        if (op === 'use-key' && !facts().connected && zone.zone.kind === 'session') { send({ type: 'setup', entry: 'key' }); asked = true; }
        // The key screen files a pasted key, checks it and hands the model choice to management.
        if (op === 'paste' && zone.zone.kind === 'setup') {
          connection().connectKey(pick(PROVIDERS), `pasted-key-${seed}-${step}`);
          send({ type: 'setup-to-manage' });
        }
        // A key screen the facts opened checks the held key and hands on the same way.
        if (op === 'check-settles' && zone.zone.kind === 'setup' && facts().connected) send({ type: 'setup-to-manage' });
        if (op === 'choose-model' && facts().connected && (zone.zone.kind === 'setup' || zone.zone.kind === 'manage')) {
          connection().setModel('a-model');
          if (zone.zone.kind === 'setup') send({ type: 'setup-to-manage' });
          send({ type: 'manage-done' });
        }
        if (op === 'leave-setup' && zone.zone.kind === 'setup') send({ type: 'setup-done' });
        if (op === 'gear' && facts().connected) send({ type: 'manage' });
        if (op === 'forget' && zone.zone.kind === 'manage') connection().forgetKey();
        if (op === 'repair-key') {
          const drop = repairSteps('fix-key', zone).some((step) => step.step === 'harness');
          send({ type: 'ask-key' });
          asked = true;
          if (drop) connection().forgetKey();
        }
        if (op === 'close') open = false;
        if (op === 'reopen' && !open) { open = true; visit += 1; }
        await settled();
        send({ type: 'facts', facts: facts() });
        if (zone.zone.kind !== 'setup') asked = false;
        const settledOnce = zone;
        send({ type: 'facts', facts: facts() });

        const now = facts();
        const where = `seed ${seed}, after ${trail.join(' > ')}`;
        expect({ zone: zone.zone, keyOwed: zone.keyOwed }, `the same facts moved the zone twice: ${where}`).toEqual({ zone: settledOnce.zone, keyOwed: settledOnce.keyOwed });
        expect(!now.connected && zone.zone.kind === 'manage', `management without a key: ${where}`).toBe(false);
        expect(now.connected && !now.ready && zone.zone.kind === 'session', `resting on an unusable connection: ${where}`).toBe(false);
        expect(zone.zone.kind === 'setup' && now.connected && now.ready && !asked, `key screen over a whole connection, unasked: ${where}`).toBe(false);
        expect(signIn.get()?.standing === 'waiting' && pending.length === 0, `waiting on no round: ${where}`).toBe(false);
        // A key screen the facts opened over a held key starts by checking that key, never by asking for one.
        if (zone.zone.kind === 'setup' && now.connected && !now.ready && !asked) {
          const reading = createKeyReading({ entry: zone.zone.entry, listModels: () => new Promise(() => {}), pictured: true });
          expect(reading.get().phase, `asks for a key that is held: ${where}`).toBe('checking');
        }
      }
    }
  });
});
