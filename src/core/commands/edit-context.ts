/**
 * What an edit runs against, passed as an argument rather than read from a store: the map, the
 * executor its commands go through, and the rules to ask. The editor's operations, Smart Build, the
 * assistant's tools and a test's by-hand triple all take this one shape.
 */
import type { GridState } from '../model/types';
import type { CommandSink } from '../model/command-sink';
import type { RuleDispatcher } from '../model/rule-dispatcher';
import type { CommandExecutor } from './command-executor';

export interface EditContext {
  state: GridState;
  executor: CommandExecutor;
  /** `RuleDispatcher`, not a registry that adds rules: an edit validates, it never registers a rule. */
  registry: RuleDispatcher;
}

/** A context as a command sink whose commands go through its executor. */
export function commandSink({ state, executor }: Pick<EditContext, 'state' | 'executor'>): CommandSink {
  return { state, execute: (cmd) => executor.execute(cmd) };
}
