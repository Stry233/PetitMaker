/** A generator run the way the app runs one: every command through the executor, judged by its rules. */
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { GridState } from '../../core/model/types';
import { generateTerrain, type GenerateResult } from '../../tools/generation';
import type { GenerateConfig } from '../../tools/generation/recipe';

/** `config` generated on `state` through `executor`. */
export function generateWith(
  state: GridState, executor: Pick<CommandExecutor, 'execute' | 'getRegistry'>, config: GenerateConfig,
): GenerateResult {
  return generateTerrain({ state, execute: (cmd) => executor.execute(cmd), reg: executor.getRegistry() }, config);
}
