/**
 * vision-verdict.ts — whether THIS connection can actually read an image, probed once per session.
 *
 * `PROVIDER_META[..].vision(model)` is a PRIOR read off the model id, and on a gateway the id can
 * lie: a proxy can strip or refuse image parts from a model whose name promises them, and a job
 * that trusted the name would then send pictures into refusals. So on the id-opaque providers a
 * vision-TRUE prior is confirmed by the endpoint's own answer before any job relies on it
 * (`providers/vision-probe.ts`, one tiny image through the SAME adapter a job would use).
 *
 * THE PROBE ONLY EVER TAKES VISION AWAY. A vision-FALSE prior is never probed: tokens-only is the
 * safe reading of an unknown model, a probe is one real request on the user's key, and an
 * automatic upgrade probe would spend it on every connection that will never send an image (it
 * also raced the e2e journeys' scripted turns, which is the same surprise in a lab coat). A
 * gateway fronting a multimodal model under a name the table cannot read stays tokens-only until
 * its slug says otherwise. The curated single-vendor platforms keep their authoritative static
 * answers and are never probed at all.
 *
 * KEYED BY ENDPOINT AND MODEL, NEVER BY KEY (`model-roster.ts`'s rule): the secret lives outside
 * the store and nothing here may hold or hash a copy of it.
 *
 * ONLY A COMPLETED PROBE IS AN ANSWER. A probe that THROWS (auth, rate, network) files nothing, so
 * a transient fault never brands a sighted connection blind; the prior stands until a real answer
 * lands, which is exactly the pre-probe behavior. Probes kick when the panel column mounts (the
 * panel opening is the user's intent to work), so a job launched before the answer arrives runs on
 * the prior and the next one runs on the fact.
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
