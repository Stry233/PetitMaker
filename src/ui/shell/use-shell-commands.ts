/*
 * What a command needs from this shell: the menu toggle, which lives in the shell's own React
 * state, the facts Help's copy quotes whose owners rank above the commands, and the export notice,
 * which only a mounted surface can show. Every other command body reads the store
 * (`editor/commands/run.ts:runCommand`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { CommandContext } from '../../editor/commands/commands';
import { mountShellCommands, pressCommand } from '../../editor/commands/run';

interface ShellCommandDeps {
  /** The menu sheet's own toggle. It lives in the shell's React state, not the store. */
  toggleMenu: () => void;
  /** Asks the frame's export notice and resolves whether it was accepted; null for a frame that shows none. */
  exportNotice: (() => Promise<boolean>) | null;
  /** A frame drawn as a picture of itself (a Help figure), which callers outside it never reach. */
  pictured: boolean;
  /** Loads the values Help's copy quotes whose owners rank above the commands; the frame hands it in,
   *  since the edition's surfaces import this module's hooks. */
  helpFactsAbove: NonNullable<CommandContext['helpFactsAbove']>;
}

/** The mounted frame's command context, so a control runs the same body its shortcut runs. */
export const ShellCommandsContext = createContext<CommandContext | null>(null);

/** Runs a command by id, as its key would where it has one; outside a mounted frame the menu toggle does nothing. */
export function useRunCommand(): (id: string, args?: Readonly<Record<string, unknown>>) => void {
  const ctx = useContext(ShellCommandsContext) ?? undefined;
  return useCallback((id: string, args?: Readonly<Record<string, unknown>>) => pressCommand(id, args, ctx), [ctx]);
}

const NO_MENU = (): void => {};

/** `useRunCommand` for a surface that shows the export notice itself: its presses ask `exportNotice`
 *  in the frame's place, so the notice an export opens is the one its control retires. */
export function useRunCommandBehindNotice(exportNotice: () => Promise<boolean>): (id: string, args?: Readonly<Record<string, unknown>>) => void {
  const shell = useContext(ShellCommandsContext);
  return (id, args) => pressCommand(id, args, { toggleMenu: NO_MENU, ...shell, exportNotice });
}

/** The shell's command context, mounted for callers outside the frame too; a stable identity,
 *  because the shortcut hook rebuilds its table when it changes. */
export function useShellCommands({ toggleMenu, exportNotice, pictured, helpFactsAbove }: ShellCommandDeps): CommandContext {
  const ctx = useMemo(() => ({ toggleMenu, helpFactsAbove, ...(exportNotice ? { exportNotice } : {}) }), [toggleMenu, exportNotice, helpFactsAbove]);
  // A pictured frame answers its own controls only: callers outside it keep the live frame's context.
  useEffect(() => (pictured ? undefined : mountShellCommands(ctx)), [ctx, pictured]);
  return ctx;
}
