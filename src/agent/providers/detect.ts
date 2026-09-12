/**
 * Key-format detection and the probe that resolves an ambiguous bare `sk-…` key
 * by asking. SDK-free: the probe calls `fetch` directly against `<base>/models`
 * (a read-only, free endpoint on every OpenAI-dialect platform here) rather than
 * building an adapter, so this module never imports an SDK.
 */

import { OPENAI_DEFAULT_BASE, type ProviderId, QUIRKS } from './defaults';

/**
 * Provider detection from the API key FORMAT (instant, no network). Distinct
 * prefixes resolve immediately; bare `sk-…` keys (legacy OpenAI, DeepSeek, Qwen,
 * Moonshot, a self-hosted gateway) are ambiguous and return null — the caller
 * then probes `/models` (see `probeAmbiguousKey`) and finally asks the user.
 */
export function detectProviderFromKey(key: string): ProviderId | null {
  const k = key.trim();
  if (/^sk-or-/.test(k)) return 'openrouter';                    // OpenRouter (checked before bare sk-)
  if (/^sk-ant-/.test(k)) return 'claude';
  if (/^sk-(proj|svcacct|admin|None)-/.test(k)) return 'openai'; // "None" is a legacy OpenAI org-less key shape
  if (/^pplx-/.test(k)) return 'perplexity';
  if (/^AIza[\w-]{20,}$/.test(k)) return 'gemini';               // Google API key
  if (/^[0-9a-f]{32}\.[A-Za-z0-9]{16}$/.test(k)) return 'zhipu'; // GLM: 32hex.16alnum
  // sk-<32hex> is not format-distinct: DeepSeek uses it, but so do legacy OpenAI
  // keys, Qwen, Moonshot and self-hosted gateways ("custom") — resolve by probe.
  return null;
}

/** Providers whose keys are bare `sk-…` and can only be told apart by probing
 *  their /models endpoints. Also the order a setup screen stands them up in: the
 *  UI has to NAME the candidates before the probe answers, so the list is
 *  exported rather than restated there. */
export const AMBIGUOUS_CANDIDATES: readonly ProviderId[] = ['deepseek', 'openai', 'qwen', 'moonshot'];

/** Hard deadline on asking a provider what it runs: an unreachable endpoint
 *  stalls rather than failing fast, so without this a "detecting" UI would
 *  never resolve. Exported because the probe is not the only such request —
 *  the connection screen's own `/models` call is bound by the same number, and
 *  two ceilings for one question would drift. */
export const PROBE_DEADLINE_MS = 8000;

interface ProbeAttempt {
  id: ProviderId;
  baseUrl: string;
}

/** Every host to try for one candidate provider: a region-split platform (qwen,
 *  moonshot) contributes one attempt per regional host. */
function endpointsOf(id: ProviderId): ProbeAttempt[] {
  const urls = QUIRKS[id].baseUrls;
  if (urls && urls.length > 0) return urls.map((baseUrl) => ({ id, baseUrl }));
  if (id === 'openai') return [{ id, baseUrl: OPENAI_DEFAULT_BASE }];
  return [];
}

export interface ProbeOpts {
  candidates?: ProviderId[];
  fetchFn?: typeof fetch;
  deadlineMs?: number;
}

/**
 * Identify the provider of an ambiguous bare `sk-…` key by probing candidate
 * endpoints' `GET /models` concurrently — the endpoint that authenticates the
 * key is its provider. The candidates are `AMBIGUOUS_CANDIDATES` unless the
 * caller names others; a custom endpoint is never among them, so the key
 * reaches a user-named address only through the explicit endpoint step.
 * Resolves the first 2xx responder's id, or null if none accept it (offline,
 * CORS-blocked, invalid key) or the deadline passes first. Never throws: a
 * synchronously-throwing `fetchFn` counts as that candidate failing. Losing
 * requests are aborted once a winner resolves.
 */
export function probeAmbiguousKey(key: string, opts: ProbeOpts = {}): Promise<ProviderId | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const deadlineMs = opts.deadlineMs ?? PROBE_DEADLINE_MS;
  const candidateIds = opts.candidates ?? AMBIGUOUS_CANDIDATES;
  const attempts = candidateIds.flatMap((id) => endpointsOf(id));

  const jobs = attempts.map((attempt) => ({ attempt, controller: new AbortController() }));

  return new Promise<ProviderId | null>((resolve) => {
    let pending = jobs.length;
    let settled = false;

    const finish = (winner: ProviderId | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const job of jobs) job.controller.abort();
      resolve(winner);
    };

    const timer = setTimeout(() => finish(null), deadlineMs);
    if (pending === 0) { finish(null); return; }

    for (const { attempt, controller } of jobs) {
      let result: Promise<Response>;
      try {
        result = fetchFn(`${attempt.baseUrl}/models`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
      } catch {
        result = Promise.reject(new Error('fetchFn threw synchronously'));
      }
      result.then((res) => {
        if (res.ok) { finish(attempt.id); return; }
        pending -= 1;
        if (pending === 0) finish(null);
      }).catch(() => {
        pending -= 1;
        if (pending === 0) finish(null);
      });
    }
  });
}
