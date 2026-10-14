import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadRoster, type ListModels, type ProviderId, type ProviderRegion } from '../../../agent/panel';
import { endpointCheckVerdict } from '../connection/setup-parts';

export interface ModelRoster {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  models: readonly string[];
}

const IDLE: ModelRoster = { status: 'idle', models: [] };
const LOADING: ModelRoster = { status: 'loading', models: [] };

/**
 * The connection's model list, read from the session roster cache or fetched once per endpoint.
 * A failed listing proves nothing about generation; `failed` only means no server answered.
 * `refresh` retires the cached answer and asks again.
 */
export function useModelRoster({ provider, customBaseUrl, apiKey, region, connected, listModels }: {
  provider: ProviderId;
  customBaseUrl: string;
  /** Read for the request that needs it; never kept in component state. */
  apiKey: string;
  region: ProviderRegion | undefined;
  connected: boolean;
  listModels: ListModels;
}): ModelRoster & { refresh(): void } {
  const [roster, setRoster] = useState<ModelRoster>(IDLE);
  /** The newest request; an answer to an older one is dropped. */
  const request = useRef(0);
  const lister = useRef(listModels);
  lister.current = listModels;

  const load = useCallback((fresh: boolean) => {
    request.current += 1;
    if (!connected) { setRoster(IDLE); return; }
    const mine = request.current;
    const answer = loadRoster({ provider, apiKey, customBaseUrl, ...(region === undefined ? {} : { region }) }, lister.current, fresh,
      () => mine === request.current);
    if ('held' in answer) { setRoster({ status: 'ready', models: answer.held }); return; }
    setRoster(LOADING);
    answer.pending
      .then((ids) => {
        if (mine !== request.current) return;
        setRoster({ status: 'ready', models: ids });
      })
      .catch((err: unknown) => {
        if (mine !== request.current) return;
        setRoster({ status: endpointCheckVerdict(err) === 'no-list' ? 'ready' : 'failed', models: [] });
      });
  }, [provider, customBaseUrl, apiKey, region, connected]);

  useEffect(() => {
    load(false);
    return () => { request.current += 1; };
  }, [load]);

  return useMemo(() => ({ ...roster, refresh: () => load(true) }), [roster, load]);
}
