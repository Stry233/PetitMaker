/**
 * The vision probe: one small solid-color image and the question "what color is it", through any
 * adapter, because a gateway can front a renamed multimodal model or strip image parts from one
 * whose name promises them. A refusal or an answer that never names the color reads as text-only;
 * a failure unrelated to the image (auth, rate, network) throws, so it files no verdict.
 *
 * Shared by the offline bench and the app's own capability check, so the two can never disagree
 * about what "has vision" means.
 */
import type { Adapter, AdapterRequest } from '../core/adapter';

export interface VisionProbe { vision: boolean; detail: string }

/** A 16x16 solid pure-red PNG (89 bytes): large enough that a resizing gateway cannot lose it,
 *  small enough to cost nothing. */
const PROBE_IMAGE = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGP8z0AaYCJRPcOoBmIAE1GqkMCoBmIAyRoAQC4BH1m1rqAAAAAASUVORK5CYII=';

/** A failure the image cannot explain: these throw rather than reading as text-only. */
const NOT_ABOUT_THE_IMAGE = new Set(['auth', 'quota', 'rate-limit', 'overloaded', 'network', 'cors', 'abort']);

export async function probeVision(
  adapter: Adapter, model: string, signal: AbortSignal = new AbortController().signal,
): Promise<VisionProbe> {
  const req: AdapterRequest = {
    system: 'You are a connectivity probe. Answer in one word.',
    messages: [{ role: 'user', text: 'What color is the attached image? Answer with one word. Do not call any tool.', images: [PROBE_IMAGE] }],
    tools: [],
    model,
    sameModel: false,
    maxOutputTokens: 256,
  };
  let answer = '';
  for await (const ev of adapter.stream(req, signal)) {
    if (ev.t === 'text') answer += ev.delta;
    if (ev.t === 'error') {
      const first = ev.error.detail.split('\n')[0] ?? '';
      if (!NOT_ABOUT_THE_IMAGE.has(ev.error.cls)) {
        return { vision: false, detail: `image refused (${ev.error.status ?? ev.error.cls}): ${first}` };
      }
      throw new Error(
        `vision probe failed (${ev.error.cls}${ev.error.status !== undefined ? ` ${ev.error.status}` : ''}): ${first}.`,
      );
    }
    if (ev.t === 'done') {
      if (ev.stop === 'aborted') throw new Error('vision probe aborted before the endpoint answered.');
      const head = (answer.trim().split('\n')[0] ?? '').slice(0, 60);
      return /\bred\b/i.test(answer)
        ? { vision: true, detail: `image read (answered "${head}")` }
        : { vision: false, detail: `image ignored (answered "${head}")` };
    }
  }
  throw new Error('vision probe ended without a final event.');
}
