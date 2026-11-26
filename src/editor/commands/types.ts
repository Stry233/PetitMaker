/** A command as any caller meets it: what it takes, what it acts on, its effect and how it runs. */
import type { I18nKey } from '../../i18n/keys';
import type { HelpFactsOf } from '../help/page-schema';

/** What the handlers can't get from the global store, supplied by the mounted shell. */
export interface CommandContext {
  /** Open the shell's menu, or put it away. Answered by the shell rather than by a store flag,
   *  because the menu's open state lives in the shell's own React state alongside what opening it
   *  implies (the restore offer is retired, since opening the menu means "start fresh"). */
  toggleMenu: () => void;
  /** Loads the values Help's copy quotes whose owners rank above this layer. A context without it
   *  answers from Help with those `{token}`s standing (`help/page-schema.ts:HelpFactAbove`). */
  helpFactsAbove?: () => Promise<HelpFactsOf>;
  /** Opens the responsibility notice a file export asks and resolves whether the person accepted it,
   *  answered by whoever can show it: the frame, or the surface whose control was pressed. A context
   *  without it exports nothing. */
  exportNotice?: () => Promise<boolean>;
}

/**
 * What running a command does. `answer` only answers a question; `change` alters something the same
 * command changes back; `outward` reaches outside the page or is hard to take back; `destroy`
 * removes stored work.
 */
export type CommandEffect = 'answer' | 'change' | 'outward' | 'destroy';

/** What a command acts on: the map with its history, its selection and the tool the pointer holds,
 *  or the app around it. */
export type CommandTarget = 'map' | 'app';

export type CommandValue = boolean | number | string;
export type CommandArgs = Readonly<Record<string, CommandValue>>;

interface ArgBase {
  name: string;
  /** One line in English, for a caller that reads the command instead of seeing its control. */
  description: string;
  optional?: true;
}

export type CommandArg = ArgBase & (
  | { kind: 'boolean' }
  | { kind: 'number'; min: number; max: number; integer?: true }
  /** `shown` gives the name the interface shows for a value that is an id, where one stands for it now. */
  | { kind: 'string'; shown?(value: string): string | undefined }
  /** `labels` names a value as the interface does, where it has such a name. */
  | { kind: 'enum'; values: readonly string[]; labels?: Readonly<Partial<Record<string, I18nKey>>> }
);

/** An argument a caller may leave out; a command a key runs takes no other kind. */
export type OptionalArg = CommandArg & { optional: true };

export interface CommandRefusal { ok: false; reason: string }

export const refuse = (reason: string): CommandRefusal => ({ ok: false, reason });

export const NO_MAP = 'No map is open.';

/** What a refusal says for each way the name check holds a given name back. */
export const NAME_ISSUES = {
  refused: 'The name check refused this name; choose another.',
  'too-long': 'The name is too long for the name check.',
  unavailable: 'The name check could not run; try again.',
} as const;

/** A short English line saying what was done, or a refusal. */
export type CommandResult = string | CommandRefusal;

export interface Command {
  /** Stable: saved keymaps and callers name it. */
  id: string;
  /** What the interface calls it. */
  labelKey: I18nKey;
  /** One line in English, for a caller that reads the command instead of seeing its control. */
  description: string;
  effect: CommandEffect;
  target: CommandTarget;
  args: readonly CommandArg[];
  /** The present value of what the command changes, where it has one. */
  current?(): CommandValue;
  /** Runs with arguments already checked against `args`. */
  invoke(args: CommandArgs, ctx: CommandContext): CommandResult | Promise<CommandResult>;
}

/** A command as a caller is shown it, with its present value read. */
export interface CommandInfo extends Omit<Command, 'current' | 'invoke'> {
  current?: CommandValue;
}

export type CommandOutcome = { ok: true; result: string } | CommandRefusal;
