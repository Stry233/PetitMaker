/**
 * endpoint-truth.test.ts — A KEY FOR THE USER'S OWN SERVER NEVER LEAVES FOR SOMEBODY ELSE'S.
 *
 * The `openai` SDK treats an absent `baseURL` as "use my own default host", which is correct for the
 * `openai` provider and catastrophic for `custom`: the address is the user's, the key was issued by
 * whatever runs at it, and the SDK's fallback is another company's API. So the adapter REFUSES to be
 * built for `custom` with no address rather than building a client aimed anywhere.
 *
 * THE REFUSAL IS A CLASSIFIED FAULT, not a raw crash: it carries its own `ErrorClass` (`config`),
 * which is unretryable — another attempt with the same absent address does the same nothing — and
 * the panel's repair for it is the endpoint field.
 *
 * The floor is asserted THROUGH the runner too, which is the caller that would otherwise reach a
 * client on a stale settings record: the job settles as a config incident and no request is made.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { makeState } from '../../rules/_helpers';
import { classify, isRetryable, NO_ENDPOINT_ADDRESS } from '../../../agent/core/errors';
import { baseUrlFor, PROVIDER_IDS, QUIRKS, type ProviderId } from '../../../agent/providers/defaults';
import { createOpenAIAdapter } from '../../../agent/providers/openai';
import { createRunner } from '../../../agent/exec/runner';
import { eventsOf } from '../../../agent/core/log';
import { useAgentSession } from '../../../agent/session/store';
import type { AgentToolDeps } from '../../../agent/tools/tools';

function toolDeps(): AgentToolDeps {
  const state = makeState(20, 20);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
  useAgentSession.getState().clearSession();
});

describe('the custom endpoint has no default host', () => {
  it('refuses to build an OpenAI-dialect adapter for custom with no address', () => {
    expect(() => createOpenAIAdapter({ apiKey: 'sk-test', quirks: QUIRKS.custom }))
      .toThrow(NO_ENDPOINT_ADDRESS);
    expect(() => createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: '', quirks: QUIRKS.custom }))
      .toThrow(NO_ENDPOINT_ADDRESS);
  });

  it('names the missing address in the refusal', () => {
    expect(NO_ENDPOINT_ADDRESS).toMatch(/address/i);
    expect(NO_ENDPOINT_ADDRESS).toMatch(/endpoint/i);
  });

  it('builds for custom the moment an address is given', () => {
    expect(() => createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://gw.example/v1', quirks: QUIRKS.custom }))
      .not.toThrow();
  });

  /** `custom` is the only provider whose host is the user's; every other one either declares its
   *  own or lets its SDK carry one, so the requirement is declared exactly once. */
  it('requires an address for custom and for nothing else', () => {
    const declared = PROVIDER_IDS.filter((id) => QUIRKS[id].needsBaseUrl === true);
    expect(declared).toEqual(['custom']);
  });

  it('builds every other OpenAI-dialect provider off its own resolved host', () => {
    const dialect = PROVIDER_IDS.filter((id) => QUIRKS[id].dialect === 'openai' && id !== 'custom');
    for (const id of dialect) {
      const baseUrl = baseUrlFor(id as ProviderId, {});
      expect(() => createOpenAIAdapter({
        apiKey: 'sk-test', ...(baseUrl ? { baseUrl } : {}), quirks: QUIRKS[id],
      })).not.toThrow();
    }
  });

  it('classifies the refusal as an unretryable config fault', () => {
    const err = classify({ message: NO_ENDPOINT_ADDRESS });
    expect(err.cls).toBe('config');
    expect(isRetryable(err.cls)).toBe(false);
    expect(err.detail).toBe(NO_ENDPOINT_ADDRESS);
  });

  it('settles a job launched on an addressless custom connection as a config incident', async () => {
    const runner = createRunner({
      providerId: 'custom',
      apiKey: 'sk-9f2c0123456789abcdef0123456789ab',
      model: 'llama-3.1-8b',
      oversight: 'yolo',
      makeToolDeps: toolDeps,
      registry: createDefaultRegistry(),
    });

    runner.send('build a house');
    await flush();

    const events = eventsOf(useAgentSession.getState().log);
    const incident = events.find((e) => e.kind === 'incident');
    expect(incident).toMatchObject({ kind: 'incident', error: { cls: 'config' } });
    expect(events[events.length - 1]).toMatchObject({ kind: 'jobEnd', outcome: 'incident' });
    expect(runner.active()).toBe(false);
  });
});
