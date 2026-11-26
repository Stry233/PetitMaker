/** A deck's extent in a run's scope (`terrain-plan/scope.ts`). */
import type { MacroCoord } from '../../../../core/model/types';
import type { Scope } from '../../terrain-plan/scope';

/** Whether every cell from one bank to the other is in scope: the deck's own extent. */
export function spanInScope(scope: Scope, banks: readonly MacroCoord[]): boolean {
  const [a, b] = banks;
  if (!a || !b) return false;
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return scope.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}
