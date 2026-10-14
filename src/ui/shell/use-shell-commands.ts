/*
 * What a keyboard command needs from this shell: the menu toggle, which lives in the shell's own
 * React state. Every other command body reads the store (`editor/commands/commands.ts:RUN`).
 */
import { createContext, useCallback, useContext, useMemo } from 'react';
import { hasRunBody, RUN, type CommandContext } from '../../editor/commands/commands';

interface ShellCommandDeps {
  /** The menu sheet's own toggle. It lives in the shell's React state, not the store. */
  toggleMenu: () => void;
}

/** The mounted frame's command context, so a control runs the same body its shortcut runs. */
export const ShellCommandsContext = createContext<CommandContext | null>(null);

const NO_SHELL: CommandContext = { toggleMenu: () => {} };

/** Runs a registry command as its key would; outside a mounted frame the menu toggle does nothing. */
export function useRunCommand(): (id: string) => void {
  const ctx = useContext(ShellCommandsContext) ?? NO_SHELL;
  return useCallback((id: string) => { if (hasRunBody(id)) RUN[id](ctx); }, [ctx]);
}

/** The shell's command context; a stable identity, because the shortcut hook rebuilds its table when it changes. */
export function useShellCommands({ toggleMenu }: ShellCommandDeps): CommandContext {
  return useMemo(() => ({ toggleMenu }), [toggleMenu]);
}
