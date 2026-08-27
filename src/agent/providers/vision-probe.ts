/**
 * THE VISION PROBE: one tiny solid-color image and the question "what color is it", through any
 * adapter. The answer is the seat's vision capability as a FACT rather than a guess from the model
 * id — a gateway can front a renamed multimodal model, and it can just as well strip image parts
 * from a model whose name promises them; either way only the endpoint's own answer is evidence.
 * A refusal OR an answer that never names the color reads as text-only (a gateway that silently
 * drops image parts is, to the harness, the same blindness as refusing them); a failure that is
 * not about the image (auth, rate, network) throws, so a transient fault never files a verdict.
 *
 * Shared by the offline bench (via `eval/live-bench`) and the app's own capability check, so the
 * two can never disagree about what "has vision" means.
 */
import type { Adapter, AdapterRequest } from './types';

export interface VisionProbe { vision: boolean; detail: string }

/** A 16x16 solid pure-red PNG (89 bytes): large enough that a resizing gateway cannot lose it,
 *  small enough to cost nothing. */
export const PROBE_IMAGE = 'data:image/png;base64,'
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
