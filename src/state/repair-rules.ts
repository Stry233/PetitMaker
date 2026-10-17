/*
 * The rules of a map under a hand repair, whose problem objects stand where the save had them, over
 * a landmark or against a rule. Every rule applies as it does on any map, except that a post-stroke
 * violation found only under those objects does not refuse the stroke: it is what the repair is there
 * to clear, and each object stops counting once it stands legally (`relocation-plan.ts:unresolved`).
 */
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import type { GridState } from '../core/model/types';
import { objectRect } from './object-geometry';
import { evidenceBoxes, unresolved } from './relocation-plan';
import { rectsOverlap, type Rect } from '../core/grid/rect';

/** `base` on a map whose objects `problems()` names are left to repair. */
export function repairRules(base: RuleDispatcher, problems: () => ReadonlySet<string>): RuleDispatcher {
  return {
    resolve: (cmd, state) => base.resolve(cmd, state),
    validatePreCommand: (cmd, state, scope) => base.validatePreCommand(cmd, state, scope),
    getRules: () => base.getRules(),
    validatePostStroke(state: GridState, opts) {
      const ids = problems();
      if (ids.size === 0) return base.validatePostStroke(state, opts);
      // Every violation is read, since the first one found may be one the repair excuses.
      const violations = base.validatePostStroke(state);
      if (violations.length === 0) return violations;
      const standing = unresolved(state, base, ids).map((id) => objectRect(state.objects.get(id)!));
      const excused = (box: Rect) => standing.some((r) => rectsOverlap(box, r));
      const kept = violations.filter((v) => v.cells.length === 0 || !evidenceBoxes(v).every(excused));
      return opts?.firstOnly ? kept.slice(0, 1) : kept;
    },
  };
}
