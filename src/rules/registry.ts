import type {
  AnyRule,
  Command,
  GridState,
  PreCommandRule,
  PostStrokeRule,
  ValidationError,
} from '../core/model/types';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';

/**
 * Central rule dispatcher for two-phase validation.
 *
 * Pre-command rules are filtered by `appliesTo` before invocation.
 * Post-stroke rules always run against the full state.
 *
 * Rules execute in registration order. All applicable rules run even if
 * earlier ones produced errors — errors are accumulated, not short-circuited.
 *
 * Guarantees:
 * - Never mutates STATE. One documented exception on commands: the waterSpan and
 *   heightDrop traits SNAP cmd.object (position/rotation/spanLength/elevation)
 *   during validation so later rules judge the real footprint (rules/index.ts
 *   documents the ordering). A command REJECTED by a later rule keeps the snap —
 *   callers must not reuse a failed command object for a fresh attempt.
 * - Returns [] when no rules are registered or none apply.
 */
export class RuleRegistry implements RuleDispatcher {
  private preCommandRules: PreCommandRule[] = [];
  private postStrokeRules: PostStrokeRule[] = [];

  register(rule: AnyRule): void {
    if (rule.phase === 'pre-command') {
      this.preCommandRules.push(rule);
    } else {
      this.postStrokeRules.push(rule);
    }
  }

  /** Registered rule ids + phases, for introspection (e.g. the agent system prompt). */
  getRules(): { id: string; phase: 'pre-command' | 'post-stroke' }[] {
    return [...this.preCommandRules, ...this.postStrokeRules].map((r) => ({ id: r.id, phase: r.phase }));
  }

  validatePreCommand(cmd: Command, state: GridState): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const rule of this.preCommandRules) {
      if (rule.appliesTo.includes(cmd.type)) {
        errors.push(...rule.validate(cmd, state));
      }
    }
    return errors;
  }

  validatePostStroke(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const rule of this.postStrokeRules) {
      errors.push(...rule.validate(state, opts));
      if (opts?.firstOnly && errors.length > 0) return errors;
    }
    return errors;
  }
}
