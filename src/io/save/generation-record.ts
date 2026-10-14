import type { RecordedRecipe } from '../../tools/generation/recipe';
import { isFiniteNumber } from '../../core/base/guards';

/** A generation recipe read from a save section or a share code: informational, so only the
 *  fields every reader needs are checked. */
export function isGenerationConfig(value: unknown): value is RecordedRecipe {
  if (!value || typeof value !== 'object') return false;
  const g = value as Partial<RecordedRecipe>;
  return isFiniteNumber(g.seed) && typeof g.algorithm === 'string';
}
