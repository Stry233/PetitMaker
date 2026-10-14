/**
 * A `providers/connect` module whose `buildAdapter` hands back the scripted adapter a test config
 * carries, and builds a real one otherwise. Install it with
 * `vi.mock('<path>/agent/providers/connect', async (real) => (await import('<path>/_support/agent/scripted-connect')).scriptedConnect(await real()))`.
 */
import type * as Connect from '../../../agent/providers/connect';
import type { Adapter } from '../../../agent/core/adapter';

/** A connection a test runs through its own adapter instead of a provider SDK. */
export type Scripted = { scripted?: Adapter };

export function scriptedConnect(real: typeof Connect): typeof Connect {
  return {
    ...real,
    buildAdapter: (cfg) => (cfg as Connect.AdapterConfig & Scripted).scripted ?? real.buildAdapter(cfg),
  };
}
