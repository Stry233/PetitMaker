import type { MapTemplate } from '../../core/model/types';
import { isCustomTemplate } from '../../core/model/planet';
import { templateHash, catalogHash } from '../save/canonical';
import type { ImportWarning } from '../save/import-error';

/** The template and catalog identities a share code recorded when it was made. */
export interface RecordedIdentity { templateHash: number; catalogHash: number }

/** Drift between the build that made a share code and this one. The decoder and the save loader
 *  have already refused an unknown or untrusted planet and dropped unsafe objects and cells, so
 *  what is left is cosmetic: a built-in template or the catalog that changed but still resolves.
 *  A carried planet is its own template and cannot drift. */
export function importDriftWarnings(template: MapTemplate, recorded: RecordedIdentity): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  if (!isCustomTemplate(template) && templateHash(template) !== recorded.templateHash) warnings.push({ kind: 'template-drift' });
  if (catalogHash() !== recorded.catalogHash) warnings.push({ kind: 'catalog-drift' });
  return warnings;
}
