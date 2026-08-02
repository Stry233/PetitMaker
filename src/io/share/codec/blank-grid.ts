// A fresh, empty state for a template — mirrors the store's initMap (grid + locked plaza).
import { getMapTemplate } from '../../../config/maps';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import type { GridState, PlacedObject } from '../../../core/model/types';

export function createBlankGridState(templateId: string): GridState {
  const template = getMapTemplate(templateId);
  const cells = createGrid(template);
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}
