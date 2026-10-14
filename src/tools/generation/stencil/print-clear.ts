/**
 * The one exception to ordinary generation clearing: a connected print laid over a pavement
 * background keeps that background. Only when every cell of the complete scope (the whole
 * selected region including glyph whitespace, or every buildable cell without one) carries base
 * pavement at one elevation; otherwise the print clears like any other run.
 */
import type { GridState, MacroCoord, PlacedObject } from '../../../core/model/types';
import type { GenerateConfig } from '../recipe';
import { cellKey } from '../../../core/grid/rect';
import { isBuildableZone } from '../../../core/game/zones';
import { isCoatingItem, isSurfacePrint } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { getObjectIndex } from '../../../state/object-index';

/** A connected-print run: a shape stencil laid in centerline stroke tiles. */
export function isPrintGeneration(config: GenerateConfig): boolean {
  return config.algorithm === 'stencil' && config.stencilPlan.read === 'shape' && config.stencilPlan.fill?.kind === 'stroke';
}

/** Inspect the complete clearing scope, including the whitespace between glyph strokes. */
function hasFlatRoadBackground(state: GridState, region: readonly MacroCoord[] | null): boolean {
  const roads = getObjectIndex(state).roadByCell;
  const scope = region ?? (function* () {
    for (let y = 0; y < state.template.height; y++) {
      for (let x = 0; x < state.template.width; x++) {
        if (isBuildableZone(state.cells[y]?.[x]?.zone)) yield { x, y };
      }
    }
  })();
  let elevation: number | undefined;
  for (const { x, y } of scope) {
    const road = roads.get(cellKey(x, y));
    if (!road || (elevation !== undefined && road.elevation !== elevation)) return false;
    elevation = road.elevation;
  }
  return elevation !== undefined;
}

/** The objects a run's clearing leaves standing: the base pavement under a print that keeps its
 *  background, or none. */
export function printSpares(
  state: GridState,
  region: readonly MacroCoord[] | null,
  config: GenerateConfig,
): ((obj: PlacedObject) => boolean) | undefined {
  if (!isPrintGeneration(config) || !hasFlatRoadBackground(state, region)) return undefined;
  return (obj) => {
    const item = getCatalogItem(obj.catalogId);
    return isCoatingItem(item) && !isSurfacePrint(item);
  };
}
