import { isSurfacePrint } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import type { ToolContext } from '../runtime/types';

/** Per-cell artwork keeps its full square even when the pavement underneath is trimmed. */
export function paintTrimMode(ctx: ToolContext) {
  return ctx.arming.contentType === 'road' && isSurfacePrint(getCatalogItem(ctx.arming.tileMaterial)) ? 'off' : ctx.arming.autoEdgeCut;
}
