import type {
  AnyRule,
  Command,
  GridState,
  PreCommandRule,
  PostStrokeRule,
  StrokeScope,
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
 * - Never mutates state or a command. Resolution (`resolve`) runs before any rule judges a
 *   command, so every rule sees the footprint the command lands with, whatever the order.
 * - Returns [] when no rules are registered or none apply.
 */
export class RuleRegistry implements RuleDispatcher {
  private preCommandRules: PreCommandRule[] = [];
  private postStrokeRules: PostStrokeRule[] = [];

  /** The named set this registry was built as (`index.ts:createRuleRegistry`), so another thread can
   *  build the same one; null for a registry assembled by hand. */
  constructor(readonly ruleSet: RuleSetName | null = null) {}

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

  resolve<C extends Command>(cmd: C, state: GridState): C {
    let landed: Command = cmd;
    for (const rule of this.preCommandRules) {
      if (rule.resolve && rule.appliesTo.includes(landed.type)) landed = rule.resolve(landed, state);
    }
    // A resolve step keeps the command's type (`definePreRule` narrows it to the rule's own).
    return landed as C;
  }

  validatePreCommand(cmd: Command, state: GridState, scope?: StrokeScope): ValidationError[] {
    const landed = this.resolve(cmd, state);
    const errors: ValidationError[] = [];
    for (const rule of this.preCommandRules) {
      if (rule.appliesTo.includes(landed.type)) {
        errors.push(...rule.validate(landed, state, scope));
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

/** The rule sets a live map runs under: the ordinary editor's, and the planet session's. */
export type RuleSetName = 'default' | 'planet';
