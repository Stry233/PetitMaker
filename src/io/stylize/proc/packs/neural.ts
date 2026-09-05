/*
 * neural.ts — the packs drawn by an on-device model: the map's real render goes in, the model's
 * redraw comes out, scaled onto the pack's canvas. The take's seed varies the framing the model
 * sees, so a re-roll is a different painting of the same layout. Without a render to work from (a headless
 * surface) the pack falls back to the shared fields base, which is also its synchronous face.
 */
import { drawBase } from './aquarelle';
import { PROC_PACK_META, type ProcPackMeta } from './manifest';
import type { ProcPack } from './types';
import type { ProcFields } from '../fields';
import { viewHeight, viewWidth, type ProcView } from '../draw';

function neuralPack(meta: ProcPackMeta): ProcPack {
  const style = meta.neural!;
  return {
    ...meta,
    draw: drawBase,
    async drawAsync(ctx: CanvasRenderingContext2D, fields: ProcFields, view: ProcView, source?: CanvasImageSource): Promise<void> {
      if (!source) {
        drawBase(ctx, fields, view);
        return;
      }
      const { stylizeNeural } = await import('../../neural/session');
      const painted = await stylizeNeural(source, style, meta.palette.paper, fields.seed);
      ctx.drawImage(painted, 0, 0, Math.ceil(viewWidth(view)), Math.ceil(viewHeight(view)));
    },
  };
}

export const NEURAL_PACKS: readonly ProcPack[] = PROC_PACK_META.filter((m) => m.neural).map(neuralPack);
