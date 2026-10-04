import type { GridState, MapTemplate } from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';
import { isCustomTemplate } from '../../core/model/planet';
import { isTrustedPlanet } from '../../core/model/planet-validate';
import { MAP_TEMPLATES } from '../../config/maps';
import { templateHash, catalogHash } from './canonical';
import { ShareError } from './errors';
import { isValidElevation, isValidRotation, isValidTerrainType, onItemGrid } from '../import-validate';

export interface ValidationOutcome { warnings: string[] }

/** Template and catalog identities needed to validate an imported state. `template` is the custom
 *  planet the payload carried; built-in templates are checked against this build's copy. */
export interface ImportedStateInfo { templateId: string; templateHash: number; catalogHash: number; template?: MapTemplate }

/** Security gate over the deserialized GridState. Nothing imported is trusted. Throws a
 *  ShareError on unsafe input; returns warnings for safe drift (cosmetic template/catalog
 *  differences that still resolve). */
export function validateImportedState(state: GridState, info: ImportedStateInfo): ValidationOutcome {
  const warnings: string[] = [];
  const { template } = state;
  const W = template.width, H = template.height;

  // Template compatibility.
  const custom = info.template;
  if (custom && isCustomTemplate(custom) && custom.id === info.templateId) {
    if (!isTrustedPlanet(custom)) {
      throw new ShareError('incompatible-template', 'The map\'s planet is invalid.');
    }
    if (template.id !== custom.id || W !== custom.width || H !== custom.height) throw new ShareError('incompatible-template', 'The map is not on the planet it carries.');
  } else {
    if (!Object.prototype.hasOwnProperty.call(MAP_TEMPLATES, info.templateId)) {
      throw new ShareError('incompatible-template', `Unknown map template "${info.templateId}".`);
    }
    const known = MAP_TEMPLATES[info.templateId]!;
    if (templateHash(known) !== info.templateHash) {
      if (known.width !== W || known.height !== H) {
        throw new ShareError('incompatible-template', 'Map template dimensions differ; cannot import safely.');
      }
      warnings.push('template-drift');
    }
  }
  if (catalogHash() !== info.catalogHash) warnings.push('catalog-drift');

  // Objects — never trust ids, coords, rotations, elevations.
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    const item = getCatalogItem(o.catalogId);
    if (!item) throw new ShareError('missing-catalog-item', `Unknown catalog item "${o.catalogId}".`);
    const { x, y } = o.position;
    if (!onItemGrid(item, x) || !onItemGrid(item, y) || x < 0 || y < 0 || x >= W || y >= H) {
      throw new ShareError('validation-failed', 'Object coordinate out of bounds.');
    }
    if (!isValidRotation(o.rotation)) throw new ShareError('validation-failed', 'Illegal object rotation.');
    if (!isValidElevation(o.elevation)) {
      throw new ShareError('validation-failed', 'Object elevation out of range.');
    }
  }

  // Cells — terrain type + elevation range.
  for (let y = 0; y < H; y++) {
    const row = state.cells[y]; if (!row) continue;
    for (let x = 0; x < W; x++) {
      const t = row[x]?.terrain; if (!t) continue;
      if (!isValidTerrainType(t.type)) {
        throw new ShareError('validation-failed', 'Illegal terrain type.');
      }
      if (!isValidElevation(t.elevation)) {
        throw new ShareError('validation-failed', 'Cell elevation out of range.');
      }
    }
  }
  return { warnings };
}
