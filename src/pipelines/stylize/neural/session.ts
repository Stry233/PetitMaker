/*
 * A rendered band in, the same band redrawn by an on-device model out.
 *
 * The model saw letterboxed frames at training: the band fitted into the nearest of five aspects
 * on the style's paper, longest edge 1536. It is redrawn under exactly those conditions here, then
 * cropped back to the band, so the strokes land at the scale they were learned at whatever size the
 * caller's canvas is. A take's seed varies the framing (mirror, a few percent smaller, a nudge) and
 * the crop undoes it, which is where re-rolls get a different medium over the same layout.
 * Inference runs in one shared worker so the interface keeps breathing.
 */
import { StylizeError } from '../dialects/types';
import { cropBackRect, planNormalize, type AspectOption } from '../normalize';
import { MODEL_URLS, type NeuralStyle } from './models';
import { modelSize, rgbaToTensor, tensorToRgba } from './tensor';
import { variationFor } from './variation';
import { hasNeuralConsumers, observeNeuralConsumers } from './lifecycle';
import { createWorkerClient, WORKER_IDLE_MS } from '../../../platform/async/worker-client';
import type { NeuralBackend, NeuralReply, NeuralRequest } from './neural.worker';

const NEURAL_MAX_EDGE = 1536;
const NEURAL_ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 }, { id: '3:4', ratio: 3 / 4 }, { id: '4:3', ratio: 4 / 3 },
  { id: '9:16', ratio: 9 / 16 }, { id: '16:9', ratio: 16 / 9 },
];

// Kept warm for a short reopen, and for as long as a stylize surface is open, without retaining model
// heaps for the rest of the editor session.
const client = createWorkerClient<NeuralRequest, NeuralReply>({
  spawn: () => new Worker(new URL('./neural.worker.ts', import.meta.url), { type: 'module' }),
  idleMs: WORKER_IDLE_MS,
  keyed: true,
  holdOpen: hasNeuralConsumers,
});
observeNeuralConsumers(() => client.settle());

/** How long one run may take. A first run fetches the runtime, several megabytes, before it can
 *  answer anything, so the bound is generous; past it the run is lost either way. */
const NEURAL_INFER_TIMEOUT_MS = 120_000;

function infer(modelUrl: string, data: Float32Array, width: number, height: number): Promise<NeuralReply> {
  return client.request({
    message: { modelUrl, width, height, data },
    transfer: [data.buffer],
    // A worker stalled on its runtime fetch cannot be asked again, so a timeout discards it and the
    // next attempt loads a fresh one.
    timeoutMs: NEURAL_INFER_TIMEOUT_MS,
    fallback: (failure) => {
      if (failure.kind === 'post' || failure.kind === 'spawn') throw failure.cause;
      throw new StylizeError('device', failure.kind === 'unsupported' ? 'no worker'
        : failure.kind === 'timeout' ? 'inference timed out' : 'inference worker broke');
    },
  });
}

function sourceSize(img: CanvasImageSource): { w: number; h: number } {
  const anyImg = img as {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    width: number | SVGAnimatedLength;
    height: number | SVGAnimatedLength;
  };
  const w = anyImg.naturalWidth ?? (typeof anyImg.width === 'number' ? anyImg.width : anyImg.width.baseVal.value);
  const h = anyImg.naturalHeight ?? (typeof anyImg.height === 'number' ? anyImg.height : anyImg.height.baseVal.value);
  return { w, h };
}

/** The backend the last completed run used, for the harness and the curious. */
export let lastBackend: NeuralBackend | null = null;
/** Why the last run did not use WebGPU, when it did not. */
export let lastGpuError: string | undefined;

/** Redraw a band with the named style. Resolves to a canvas the size of the model's frame crop,
 *  which the caller scales onto its own; rejects with a `StylizeError('device')` when this machine
 *  cannot run the model. */
export async function stylizeNeural(source: CanvasImageSource, style: NeuralStyle, paper: string, seed = 0): Promise<HTMLCanvasElement> {
  const { w, h } = sourceSize(source);
  const v = variationFor(seed);
  const fit = planNormalize(w, h, NEURAL_MAX_EDGE, NEURAL_ASPECTS);
  // The take's framing: the map a little smaller than its fit, placed within the room that leaves.
  const drawW = Math.round(fit.drawW * v.scale), drawH = Math.round(fit.drawH * v.scale);
  const plan = {
    ...fit, drawW, drawH,
    offsetX: Math.round(v.shiftX * (fit.frameW - drawW)),
    offsetY: Math.round(v.shiftY * (fit.frameH - drawH)),
  };
  const frame = document.createElement('canvas');
  frame.width = plan.frameW;
  frame.height = plan.frameH;
  const fctx = frame.getContext('2d');
  if (!fctx) throw new StylizeError('device', 'no 2d context');
  fctx.fillStyle = paper;
  fctx.fillRect(0, 0, frame.width, frame.height);
  fctx.save();
  fctx.translate(v.flipX ? frame.width : 0, v.flipY ? frame.height : 0);
  fctx.scale(v.flipX ? -1 : 1, v.flipY ? -1 : 1);
  fctx.drawImage(source, plan.offsetX, plan.offsetY, drawW, drawH);
  fctx.restore();

  const size = modelSize(frame.width, frame.height);
  const pixels = fctx.getImageData(0, 0, frame.width, frame.height).data;
  const tensor = rgbaToTensor(pixels, frame.width, size);
  frame.width = frame.height = 0;
  const reply = await infer(MODEL_URLS[style], tensor, size.width, size.height);
  if (!reply.ok) throw new StylizeError('device', reply.error);
  lastBackend = reply.backend;
  lastGpuError = reply.gpuError;
  const outSize = { width: reply.width, height: reply.height };
  let painted = document.createElement('canvas');
  painted.width = outSize.width;
  painted.height = outSize.height;
  const pctx = painted.getContext('2d');
  if (!pctx) throw new StylizeError('device', 'no 2d context');
  pctx.putImageData(new ImageData(tensorToRgba(reply.data, outSize), outSize.width, outSize.height), 0, 0);
  // Undo the framing: mirror the whole output back first, so the map's rect is where the plan put
  // it, then crop. The model's crop to multiples of 8 trims at most 7px off the frame, so the rect
  // is taken against the model's own output size.
  if (v.flipX || v.flipY) {
    const upright = document.createElement('canvas');
    upright.width = painted.width;
    upright.height = painted.height;
    const uctx = upright.getContext('2d')!;
    uctx.translate(v.flipX ? upright.width : 0, v.flipY ? upright.height : 0);
    uctx.scale(v.flipX ? -1 : 1, v.flipY ? -1 : 1);
    uctx.drawImage(painted, 0, 0);
    painted.width = painted.height = 0;
    painted = upright;
  }
  const rect = cropBackRect(plan, outSize.width, outSize.height);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(rect.w));
  out.height = Math.max(1, Math.round(rect.h));
  out.getContext('2d')!.drawImage(painted, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
  painted.width = painted.height = 0;
  return out;
}
