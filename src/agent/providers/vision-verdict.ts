/**
 * Session-local vision confirmation for gateways whose model ids are not authoritative. Only a
 * positive name-based prior is probed, so automatic requests can remove but never add capability.
 * Verdicts key on endpoint and model without retaining or hashing credentials. Failed probes record
 * nothing, leaving the prior in force; curated single-vendor providers use static metadata.
 */
import { endpointKey, QUIRKS, type ProviderId } from './defaults';
import { modelCapabilities } from './model-catalog';
import { probeVision } from './vision-probe';
import { buildAdapter, type AdapterConfig } from './connect';
import { createSignal } from '../../core/base/signal';

const VERDICTS = new Map<string, boolean>();
const IN_FLIGHT = new Set<string>();

/** Counts filed verdicts, so a reader can subscribe to a new one landing. */
const filed = createSignal(0);

export function visionKey(provider: ProviderId, customBaseUrl: string | undefined, model: string): string {
  return `${provider}|${endpointKey(provider, customBaseUrl) ?? ''}|${model}`;
}

function knownVision(key: string): boolean | undefined {
  return VERDICTS.get(key);
}

/** Notifies when a new verdict is filed. */
export function subscribeVisionVerdicts(listener: () => void): () => void {
  return filed.subscribe(listener);
}

/** The number of verdicts filed so far, for `useSyncExternalStore`. */
export function visionVerdictsVersion(): number {
  return filed.get();
}

type ProbeConnection = AdapterConfig & { model: string };

/** Asks for the connection's vision verdict if it is worth asking for and not already known or in flight. */
export function ensureVisionVerdict(conn: ProbeConnection): void {
  const vision = QUIRKS[conn.providerId].vision;
  if (!vision.probe) return;
  if (conn.model === '' || (conn.apiKey === '' && !(conn.providerId === 'custom' && conn.customBaseUrl))) return;
  if (!vision.guess(conn.model)) return; // tokens-only is safe unprobed
  const key = visionKey(conn.providerId, conn.customBaseUrl, conn.model);
  if (VERDICTS.has(key) || IN_FLIGHT.has(key)) return;
  IN_FLIGHT.add(key);
  void probeVision(buildAdapter(conn), conn.model)
    .then((probe) => {
      VERDICTS.set(key, probe.vision);
      filed.emit(filed.get() + 1);
    })
    .catch(() => {
      // A fault is not an answer: the prior stands, and the next mount may ask again.
    })
    .finally(() => {
      IN_FLIGHT.delete(key);
    });
}

/** Whether the connection's model reads images: a probe verdict, then the capability catalog, then the id. */
export function readsImages(provider: ProviderId, customBaseUrl: string | undefined, model: string): boolean {
  const known = knownVision(visionKey(provider, customBaseUrl, model));
  if (known !== undefined) return known;
  const capability = modelCapabilities(provider, model, customBaseUrl);
  return capability?.input ? capability.input.includes('image') : QUIRKS[provider].vision.guess(model);
}

/** Restores a fresh page's state: no verdicts and no probe in flight. */
export function __resetVisionVerdicts(): void {
  VERDICTS.clear();
  IN_FLIGHT.clear();
}
