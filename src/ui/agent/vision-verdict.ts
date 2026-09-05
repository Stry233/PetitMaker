/**
 * Session-local vision confirmation for gateways whose model ids are not authoritative. Only a
 * positive name-based prior is probed, so automatic requests can remove but never add capability.
 * Verdicts key on endpoint and model without retaining or hashing credentials. Failed probes record
 * nothing, leaving the prior in force; curated single-vendor providers use static metadata.
 */
import { PROVIDER_META, type ProviderId } from '../../agent/providers/defaults';
import { probeVision } from '../../agent/providers/vision-probe';
import { buildAdapter, type AdapterConfig } from '../../agent/exec/runner';

/** The providers whose vision answer is a guess from the model id rather than a platform fact. */
const ID_OPAQUE: ReadonlySet<ProviderId> = new Set(['custom', 'perplexity', 'openrouter']);

const VERDICTS = new Map<string, boolean>();
const IN_FLIGHT = new Set<string>();

export function visionKey(provider: ProviderId, customBaseUrl: string | undefined, model: string): string {
  return `${provider}|${customBaseUrl ?? ''}|${model}`;
}

export function knownVision(key: string): boolean | undefined {
  return VERDICTS.get(key);
}

export type ProbeConnection = AdapterConfig & { model: string };

/**
 * Files the connection's vision verdict if it is worth asking for and not already known or in
 * flight; `onSettled` fires only when a NEW verdict lands, so a caller can re-render off it.
 */
export function ensureVisionVerdict(conn: ProbeConnection, onSettled: () => void): void {
  if (!ID_OPAQUE.has(conn.providerId)) return;
  if (conn.apiKey === '' || conn.model === '') return;
  if (!PROVIDER_META[conn.providerId].vision(conn.model)) return; // tokens-only is safe unprobed
  const key = visionKey(conn.providerId, conn.customBaseUrl, conn.model);
  if (VERDICTS.has(key) || IN_FLIGHT.has(key)) return;
  IN_FLIGHT.add(key);
  void probeVision(buildAdapter(conn), conn.model)
    .then((probe) => {
      VERDICTS.set(key, probe.vision);
      onSettled();
    })
    .catch(() => {
      // A fault is not an answer: the prior stands, and the next mount may ask again.
    })
    .finally(() => {
      IN_FLIGHT.delete(key);
    });
}

/** Test seam: a fresh page has no verdicts. */
export function forgetVisionVerdicts(): void {
  VERDICTS.clear();
  IN_FLIGHT.clear();
}
