/**
 * The layer panel's highlight while a terrain brush or eraser works: the one layer the stroke works
 * on, from its press, which stays shown after the stroke.
 */
import { ELEVATION_MAX } from '../../../core/game/profile';
import type { ToolContext } from '../runtime/types';

/** Shows `layer` in the layer panel, clamped to the layers it lists; a road stroke shows none. */
export function showStrokeLayer(layer: number, ctx: ToolContext): void {
  ctx.setDisplayLayer(ctx.arming.contentType === 'road' ? null : Math.min(ELEVATION_MAX, Math.max(0, layer)));
}
