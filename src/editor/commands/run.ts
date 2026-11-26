/**
 * The door to the commands: every command a caller can run, a listing with each one's present value,
 * and the one way a command is run by id, which checks the arguments against the command's own
 * description first. A control, a key and any other caller run the same bodies.
 */
import { META_BY_ID, type RunCommandId } from '../../state/keymap/registry';
import { KEY_FORMS, UNBOUND_COMMANDS } from './app';
import { ASSISTANT_REGION_COMMANDS } from './assistant-region';
import { FACTS, RUN, commandApplies, hasRunBody, sessionWithholds } from './commands';
import { EXPORT_COMMANDS } from './export';
import { GENERATE_COMMANDS } from './generate';
import { HELP_COMMANDS } from './help';
import { LIBRARY_COMMANDS } from './library';
import { SHELF_COMMANDS } from './shelves';
import { REPAIR_COMMANDS } from './repair';
import { TOOL_COMMANDS } from './tools';
import { SETTINGS_COMMANDS } from './settings';
import { SELECTION_COMMANDS } from './selection';
import { SESSION_COMMANDS } from './session';
import { refuse, type Command, type CommandArg, type CommandArgs, type CommandContext, type CommandInfo, type CommandOutcome, type CommandValue, type OptionalArg } from './types';

export type { Command, CommandArg, CommandEffect, CommandInfo, CommandOutcome } from './types';

/** A cycle's direction, the Shift of its key. */
const STEP_ARG: OptionalArg = { name: 'step', kind: 'enum', values: ['next', 'previous'], optional: true, description: 'Which way the cycle steps; next when left out.' };

/** A key's command as any caller runs it: its registry row, its facts and, where it has one, its form. */
function keyCommand(id: RunCommandId): Command {
  const meta = META_BY_ID.get(id)!;
  const form = KEY_FORMS[id];
  return {
    id, labelKey: meta.labelKey, ...FACTS[id],
    args: form?.args ?? (meta.reversible ? [STEP_ARG] : []),
    ...(form?.current ? { current: form.current } : {}),
    invoke(args, ctx) {
      const key = (): void => RUN[id](ctx, args.step === 'previous' ? -1 : 1);
      if (form) return form.run(args, key);
      key();
      return `${id} ran.`;
    },
  };
}

/** Every command: the keymap's, in its order, then those no key runs. */
export const ALL_COMMANDS: readonly Command[] = [
  ...[...META_BY_ID.keys()].filter(hasRunBody).map(keyCommand),
  ...UNBOUND_COMMANDS, ...LIBRARY_COMMANDS, ...HELP_COMMANDS,
  ...GENERATE_COMMANDS,
  ...TOOL_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...ASSISTANT_REGION_COMMANDS,
  ...SELECTION_COMMANDS,
  ...SHELF_COMMANDS,
  ...REPAIR_COMMANDS,
  ...EXPORT_COMMANDS,
  ...SESSION_COMMANDS,
];

const NO_SHELL: CommandContext = { toggleMenu: () => {} };
/** The contexts of the frames standing now, the newest last: a frame that goes gives the door back to
 *  the one before it. */
const mounted: CommandContext[] = [];

/** Registers a mounted frame's context for callers outside it; returns the unmount. */
export function mountShellCommands(ctx: CommandContext): () => void {
  mounted.push(ctx);
  return () => {
    const at = mounted.lastIndexOf(ctx);
    if (at >= 0) mounted.splice(at, 1);
  };
}

/** Every command of `table` as a caller is shown it. */
export function listCommands(table: readonly Command[] = ALL_COMMANDS): CommandInfo[] {
  return table.map(({ current, invoke: _invoke, ...shown }) => ({ ...shown, ...(current ? { current: current() } : {}) }));
}

/** The problem with `value` for `arg`, or null when it fits. */
function argProblem(arg: CommandArg, value: unknown): string | null {
  switch (arg.kind) {
    case 'boolean': return typeof value === 'boolean' ? null : `${arg.name} must be true or false.`;
    case 'string': return typeof value === 'string' ? null : `${arg.name} must be a string.`;
    case 'enum': return typeof value === 'string' && arg.values.includes(value) ? null : `${arg.name} must be one of: ${arg.values.join(', ')}.`;
    case 'number': {
      const fits = typeof value === 'number' && Number.isFinite(value) && value >= arg.min && value <= arg.max && (!arg.integer || Number.isInteger(value));
      return fits ? null : `${arg.name} must be ${arg.integer ? 'a whole number' : 'a number'} from ${arg.min} to ${arg.max}.`;
    }
  }
}

/** The arguments a command accepts out of `input`, or the first problem; an absent or null optional is left out. */
function checkedArgs(command: Command, input: Readonly<Record<string, unknown>>): { args: CommandArgs } | { problem: string } {
  const unknown = Object.keys(input).find((name) => !command.args.some((arg) => arg.name === name));
  if (unknown !== undefined) return { problem: `${unknown} is not an argument of ${command.id}.` };
  const args: Record<string, CommandValue> = {};
  for (const arg of command.args) {
    const value = input[arg.name];
    if (value === undefined || value === null) {
      if (!arg.optional) return { problem: `${arg.name} is required.` };
      continue;
    }
    const problem = argProblem(arg, value);
    if (problem) return { problem };
    args[arg.name] = value as CommandValue;
  }
  return { args };
}

/**
 * Runs the command `id` of `table` with `input`; an unknown id, a bad argument, a command that does
 * not apply now (`commandApplies`) and a command's own refusal answer with a reason. `ctx` is the
 * caller's shell, else the mounted one.
 */
export async function runCommand(
  id: string, input: Readonly<Record<string, unknown>> = {}, ctx?: CommandContext, table: readonly Command[] = ALL_COMMANDS,
): Promise<CommandOutcome> {
  const command = table.find((entry) => entry.id === id);
  if (!command) return refuse(`No command is called ${id}.`);
  const checked = checkedArgs(command, input);
  if ('problem' in checked) return refuse(checked.problem);
  if (sessionWithholds(id)) return refuse(`${id} is not offered while a planet is being edited or the map is under repair; finish that first.`);
  if (!commandApplies(id)) return refuse(`${id} does not apply in the app's present state.`);
  const result = await command.invoke(checked.args, ctx ?? mounted[mounted.length - 1] ?? NO_SHELL);
  return typeof result === 'string' ? { ok: true, result } : result;
}

/** A control's press: runs the command and drops the outcome, which the control's own state shows.
 *  A body that awaits nothing has run by the time this returns. */
export function pressCommand(id: string, args?: Readonly<Record<string, unknown>>, ctx?: CommandContext): void {
  void runCommand(id, args, ctx);
}
