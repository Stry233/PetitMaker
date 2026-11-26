/**
 * The two tools over the editor's commands (`editor/commands/run.ts`), the only way a job reaches
 * the app outside the map, and the assistant's policy over them: which commands a job is offered and
 * the approval each needs. Neither tool edits the map, so both declare `read`.
 */
import type { CommandEffect, CommandInfo } from '../../editor/commands/run';
import type { GateLevel } from '../core/tool-facts';
import type { AgentToolDeps } from './deps';
import { obj, req, str } from './schema';
import { defineTool } from './spec';

/**
 * The approval each effect asks of the gate: answering none, a change an ordinary write's, an
 * outward one a wide call's. An effect absent here is never run: a job destroys no stored work.
 */
const EFFECT_GATE: Readonly<Partial<Record<CommandEffect, GateLevel>>> = { answer: 'none', change: 'write', outward: 'wide' };

/** Whether a job may run `command`. The map is edited only through the map tools, which carry the
 *  job's undo grouping, region limit and authorship record, so a command acting on the map is not offered. */
const offered = (command: CommandInfo): boolean => command.target === 'app' && EFFECT_GATE[command.effect] !== undefined;

const UNAVAILABLE = 'App actions are only available in the live editor, not in this context.';

/** One command as the model reads it: its arguments by name with their kinds, values and bounds. */
function shownAction({ id, effect, description, args, current }: CommandInfo): Record<string, unknown> {
  return {
    id, effect, description,
    args: Object.fromEntries(args.map((arg) => [arg.name, {
      kind: arg.kind,
      ...(arg.kind === 'enum' ? { values: arg.values } : {}),
      ...(arg.kind === 'number' ? { min: arg.min, max: arg.max } : {}),
      ...(arg.optional ? { optional: true } : {}),
      description: arg.description,
    }])),
    ...(current !== undefined ? { current } : {}),
  };
}

/** The command `id` names among those a job is offered. */
const offeredCommand = (deps: AgentToolDeps, id: unknown): CommandInfo | undefined =>
  deps.listAppActions?.().find((command) => command.id === id && offered(command));

export const listAppActionsTool = defineTool({
  description: 'List what you can do in the app outside the map: settings, view options, windows, preparing an export, the blueprint and planet libraries, and reading the app\'s Help and key bindings. Returns each action id with its arguments, its effect (answer, change or outward) and its current value. Call it before run_app_action.',
  input: obj({}),
  access: 'read',
  run(deps) {
    if (!deps.listAppActions) return { isError: true, content: UNAVAILABLE };
    return { isError: false, content: JSON.stringify(deps.listAppActions().filter(offered).map(shownAction)) };
  },
});

export const runAppActionTool = defineTool({
  description: 'Run one app action from list_app_actions. Use it only for what the user asked: it changes the app, never the map. An export action opens the export window with the choices set, or the export notice for a blueprint file; the user confirms the download there.',
  input: obj({
    id: req(str({ description: 'The action id from list_app_actions.' })),
    args: obj({}, { description: 'The action\'s arguments by name, as list_app_actions gives them.' }),
  }),
  access: 'read',
  // A setting changed, a window opened or a Help page read for an answer is the job's delivery.
  delivers: true,
  example: '{"id":"overlay.chunks","args":{"on":true}}',
  // An id no offered command has asks nothing: the run refuses it.
  gate: (deps, input) => EFFECT_GATE[offeredCommand(deps, input.id)?.effect ?? 'answer'] ?? 'none',
  async run(deps, { id, args }) {
    if (!deps.runAppAction) return { isError: true, content: UNAVAILABLE };
    if (!offeredCommand(deps, id)) return { isError: true, content: `No app action is called ${id}. Nothing was changed.` };
    const outcome = await deps.runAppAction(id, args ?? {});
    return outcome.ok
      ? { isError: false, content: outcome.result }
      : { isError: true, content: `${outcome.reason} Nothing was changed.` };
  },
});
