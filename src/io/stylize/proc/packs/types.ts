/*
 * types.ts — what a procedural pack is.
 *
 * A pack is its manifest row plus one drawing function. Everything else it needs — the field bake,
 * the outlines, the colour moves, the substrate — is shared, so adding a pack is authoring a look
 * rather than writing a renderer.
 */
import type { ProcFields } from '../fields';
import type { ProcView } from '../draw';
import type { Bitmap } from '../watercolorize';
import type { ProcPackMeta } from './manifest';

export type { ProcPackId, ProcPackMeta } from './manifest';

export interface ProcPack extends ProcPackMeta {
  draw(ctx: CanvasRenderingContext2D, fields: ProcFields, view: ProcView): void;
  /** A pack whose medium needs the event loop draws through this
   *  instead wherever the caller can await; `source` is the real rendered band when one exists.
   *  `draw` remains its synchronous fallback face. */
  drawAsync?(ctx: CanvasRenderingContext2D, fields: ProcFields, view: ProcView, source?: CanvasImageSource): Promise<void>;
  /** A mechanical pack's medium as a pure image pass: applied over the REAL capture in the app and
   *  over the pack's own base elsewhere. `fields`/`view` ride along for structure-aware passes
   *  (stroke orientation); the pass must not require them. */
  filterImage?(img: Bitmap, seed: number, fields?: ProcFields, view?: ProcView): void;
}
