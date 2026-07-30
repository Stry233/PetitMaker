// src/io/share/validate.ts
import type { GridState } from '../../core/model/types';
import { TerrainType } from '../../core/model/types';
import { ELEVATION_MAX } from '../../core/model/constants';
import { getCatalogItem } from '../../state/catalog';
import { getMapTemplate, MAP_TEMPLATES } from '../../config/maps';
import { templateHash, catalogHash } from './canonical';
import { ShareError } from './errors';

export interface ValidationOutcome { warnings: string[] }

/** The minimal identity fields `validateImportedState` needs, satisfied directly by the
 *  PetitGlyph v2 `DecodedMapPayload` fields (`templateId`/`templateHash`/`catalogHash`). */
export interface ImportedStateInfo { templateId: string; templateHash: number; catalogHash: number }

/** Security gate over the deserialized GridState. Nothing imported is trusted. Throws a
 *  ShareError on unsafe input; returns warnings for safe drift (cosmetic template/catalog
 *  differences that still resolve). */
export function validateImportedState(state: GridState, info: ImportedStateInfo): ValidationOutcome {
  const warnings: string[] = [];
  const { template } = state;
  const W = template.width, H = template.height;

  // Template compatibility.
  if (!MAP_TEMPLATES[info.templateId]) {
    throw new ShareError('incompatible-template', `Unknown map template "${info.templateId}".`);
  }
  const known = getMapTemplate(info.templateId);
  if (templateHash(known) !== info.templateHash) {
    if (known.width !== W || known.height !== H) {
      throw new ShareError('incompatible-template', 'Map template dimensions differ; cannot import safely.');
    }
    warnings.push('template-drift');
  }
  if (catalogHash() !== info.catalogHash) warnings.push('catalog-drift');

  // Objects — never trust ids, coords, rotations, elevations.
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    if (!getCatalogItem(o.catalogId)) throw new ShareError('missing-catalog-item', `Unknown catalog item "${o.catalogId}".`);
    const { x, y } = o.position;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= W || y >= H) {
      throw new ShareError('validation-failed', 'Object coordinate out of bounds.');
    }
    if (![0, 90, 180, 270].includes(o.rotation)) throw new ShareError('validation-failed', 'Illegal object rotation.');
    // Number.isInteger, not a bare range test: every comparison with NaN is false, so
    // `< 0 || > MAX` alone would wave a NaN elevation straight through.
    if (!Number.isInteger(o.elevation) || o.elevation < 0 || o.elevation > ELEVATION_MAX) {
      throw new ShareError('validation-failed', 'Object elevation out of range.');
    }
  }

  // Cells — terrain type + elevation range.
  for (let y = 0; y < H; y++) {
    const row = state.cells[y]; if (!row) continue;
    for (let x = 0; x < W; x++) {
      const t = row[x]?.terrain; if (!t) continue;
      if (t.type !== TerrainType.Mountain && t.type !== TerrainType.Water && t.type !== TerrainType.None) {
        throw new ShareError('validation-failed', 'Illegal terrain type.');
      }
      if (!Number.isInteger(t.elevation) || t.elevation < 0 || t.elevation > ELEVATION_MAX) {
        throw new ShareError('validation-failed', 'Cell elevation out of range.');
      }
    }
  }
  return { warnings };
}
