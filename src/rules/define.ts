/* The declaration every rule file makes: its id, phase and commands, with errors that carry the id. */
import type {
  Command,
  CommandType,
  GridState,
  PostStrokeRule,
  PreCommandRule,
  StrokeScope,
  ValidationError,
} from '../core/model/types';
import type { RuleMessageKey } from './messages';

type WithoutKeys<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Where an error's cause lies: `evidenceOn(grid, cells)` or `bodyEvidence(rects)`. */
type Evidence = WithoutKeys<ValidationError, 'ruleId' | 'message' | 'messageParams'>;

/** What an error may add to its message and evidence. */
type Extra = Pick<ValidationError, 'messageParams'>;

/** One error of the rule this was made for: an i18n message key and its evidence. */
export type Fail = (message: RuleMessageKey, evidence: Evidence, extra?: Extra) => ValidationError;

/** The `Fail` of rule `ruleId`, for a helper outside the rule's own `validate`. */
export function failFor(ruleId: string): Fail {
  return (message, evidence, extra) => ({ ruleId, message, ...extra, ...evidence }) as ValidationError;
}

interface PreRuleSpec<T extends CommandType, Id extends string> {
  id: Id;
  appliesTo: readonly T[];
  /** The command as it lands, for a rule whose subject decides its own footprint: `cmd` itself
   *  when nothing changes, else a copy; never writes to `cmd`, and resolves a resolved command to
   *  itself. */
  resolve?(cmd: Extract<Command, { type: T }>, state: GridState): Extract<Command, { type: T }>;
  /** Runs only for a command of one of the `appliesTo` types, so it reads the narrowed command;
   *  `scope` holds what the open stroke or probe took off the map. */
  validate(cmd: Extract<Command, { type: T }>, state: GridState, fail: Fail, scope: StrokeScope | undefined): ValidationError[];
}

/** A pre-command rule whose `resolve` and `validate` see only the commands it applies to. */
export function definePreRule<T extends CommandType, Id extends string>(spec: PreRuleSpec<T, Id>): PreCommandRule & { readonly id: Id } {
  const applies: readonly CommandType[] = spec.appliesTo;
  const fail = failFor(spec.id);
  const narrowed = (cmd: Command): cmd is Extract<Command, { type: T }> => applies.includes(cmd.type);
  const { resolve } = spec;
  return {
    id: spec.id,
    phase: 'pre-command',
    appliesTo: [...spec.appliesTo],
    ...(resolve ? { resolve: (cmd: Command, state: GridState): Command => (narrowed(cmd) ? resolve(cmd, state) : cmd) } : {}),
    validate: (cmd, state, scope) => (narrowed(cmd) ? spec.validate(cmd, state, fail, scope) : []),
  };
}

interface PostRuleSpec<Id extends string> {
  id: Id;
  validate(state: GridState, opts: { firstOnly?: boolean } | undefined, fail: Fail): ValidationError[];
}

/** A post-stroke rule. */
export function definePostRule<Id extends string>(spec: PostRuleSpec<Id>): PostStrokeRule & { readonly id: Id } {
  const fail = failFor(spec.id);
  return {
    id: spec.id,
    phase: 'post-stroke',
    validate: (state, opts) => spec.validate(state, opts, fail),
  };
}
