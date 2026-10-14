/**
 * What the runner host hands the runner. The config is mutated in place, because the runner holds the
 * running job's abort handle and may not be rebuilt. That makes forgetting a job of its own:
 * `runnerSettings` omits `customBaseUrl` and `region` when they do not apply, so a merge that copies
 * only present keys leaves the last answer standing: a Zhipu key resolved against the CN host keeps
 * `region: 1` after a globally-keyed provider is armed, and the next job goes to a host that never
 * issued the key.
 */
import { describe, it, expect, vi } from 'vitest';

import { createDefaultRegistry } from '../../../rules';
import type { ArmedConnection } from '../../../agent/connection/store';
import { useAgentConnection } from '../../../agent/connection/store';
import { baseUrlFor } from '../../../agent/providers/defaults';
import { agentSessionPort } from '../../../agent/exec/session-port';
import { createRunner, type RunnerConfig } from '../../../agent/exec/runner';
import { createRunnerHost } from '../../../agent/exec/runner-host';

const executor = { getRegistry: () => createDefaultRegistry() };

/** A host whose runner is built through a spy, so the config it keeps current can be read. */
function hosted(armed: ArmedConnection) {
  let cfg: RunnerConfig | null = null;
  const host = createRunnerHost((c) => { cfg = c; return createRunner(c); });
  const inputs = (a: ArmedConnection, uiLocale = 'en') => ({ armed: a, model: a.model, connected: false, executor, uiLocale });
  const runner = host.runner(inputs(armed));
  return { host, runner, cfg: () => cfg!, arm: (a: ArmedConnection, uiLocale?: string) => host.sync(inputs(a, uiLocale)) };
}

describe('the runner config the panel keeps current', () => {
  it('forgets a region that no longer applies, so a global key is never sent to the CN host', () => {
    // A Zhipu key resolved against the CN host: region 1 is what routes the adapter there.
    const h = hosted({ providerId: 'zhipu', apiKey: 'cn-key', model: 'glm-4', oversight: 'checkpoint', region: 1 });
    expect(baseUrlFor(h.cfg().providerId, h.cfg())).toBe(baseUrlFor('zhipu', { region: 1 }));

    // The user arms Qwen with a globally-issued key: `runnerSettings` reports no region at all.
    h.arm({ providerId: 'qwen', apiKey: 'global-key', model: 'qwen-max', oversight: 'checkpoint' });
    expect(h.cfg().region).toBeUndefined();
    expect(baseUrlFor(h.cfg().providerId, h.cfg())).toBe(baseUrlFor('qwen', {}));
    expect(baseUrlFor(h.cfg().providerId, h.cfg())).not.toBe(baseUrlFor('qwen', { region: 1 }));
  });

  it('forgets a custom endpoint the user has cleared', () => {
    const h = hosted({ providerId: 'custom', apiKey: 'k', model: 'local', oversight: 'yolo', customBaseUrl: 'https://gateway.example/v1' });
    expect(h.cfg().customBaseUrl).toBe('https://gateway.example/v1');

    h.arm({ providerId: 'custom', apiKey: 'k', model: 'local', oversight: 'yolo' });
    expect(h.cfg().customBaseUrl).toBeUndefined();
    expect(baseUrlFor(h.cfg().providerId, h.cfg())).toBeUndefined();
  });

  it('carries the rest of the armed connection, and the display language with it', () => {
    const h = hosted({ providerId: 'claude', apiKey: 'a', model: 'opus', oversight: 'strict' });
    const before = h.cfg();
    h.arm({ providerId: 'openai', apiKey: 'b', model: 'gpt-5.5', oversight: 'yolo' }, 'zh');
    expect(h.cfg()).toBe(before);
    expect(h.cfg()).toMatchObject({ providerId: 'openai', apiKey: 'b', model: 'gpt-5.5', oversight: 'yolo', uiLocale: 'zh' });
  });

  it('hands the runner the page session through its port', () => {
    expect(hosted({ providerId: 'claude', apiKey: 'a', model: 'opus', oversight: 'strict' }).cfg().session).toBe(agentSessionPort);
  });
});

describe('the runner host', () => {
  const armed: ArmedConnection = { providerId: 'claude', apiKey: 'a', model: 'opus', oversight: 'strict' };

  it('builds no runner before the editor has a registry, then exactly one', () => {
    const host = createRunnerHost();
    const inputs = { armed, model: 'opus', connected: false, executor: null, uiLocale: 'en' };
    expect(host.runner(inputs)).toBeNull();
    const runner = host.runner({ ...inputs, executor });
    expect(runner).not.toBeNull();
    host.sync({ ...inputs, executor, armed: { ...armed, oversight: 'yolo' }, uiLocale: 'zh' });
    expect(host.runner({ ...inputs, executor })).toBe(runner);
  });

  it('lets revoking the armed key stop the runner it built, until detached', () => {
    const { host, runner } = hosted(armed);
    const stop = vi.spyOn(runner!, 'stop');
    const detach = host.attach();
    useAgentConnection.getState().connectKey('claude', 'sk-ant-test');
    useAgentConnection.getState().forgetKey('claude');
    expect(stop).toHaveBeenCalledTimes(1);
    detach();
    useAgentConnection.getState().connectKey('claude', 'sk-ant-test');
    useAgentConnection.getState().forgetKey('claude');
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
