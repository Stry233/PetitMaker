import { afterEach, beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { agentSessionPort } from '../../../agent/exec/session-port';
import { makeToolDeps } from '../../../agent/exec/tool-deps';
import { createExecutor } from '../../../agent/exec/executor';
import { runCommand } from '../../../editor/commands/run';
import { translateFor } from '../../../i18n/context';
import { prettyCombo } from '../../../platform/input/combo';
import { META_BY_ID } from '../../../state/keymap/registry';
import { effectiveCombo } from '../../../state/keymap/resolve';
import { useKeybinds } from '../../../state/keymap/store';
import { useEditorStore } from '../../../state/store';
import { helpFacts } from '../../../editor/help/facts';
import { createDefaultRegistry } from '../../../rules';
import { HELP_TABLES, installHelpTables } from '../../_support/locale-tables';
import { makeTemplate } from '../../_support/map-state';

installHelpTables();

const answer = async (id: string, args: Record<string, unknown> = {}): Promise<string> => {
  const outcome = await runCommand(id, args);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.result;
};
const LOOKUPS = ['help.search', 'help.read', 'help.key_bindings'];

beforeEach(() => {
  useEditorStore.getState().initMap(makeTemplate(30, 30), createDefaultRegistry());
  useEditorStore.setState({ locale: 'zh' });
});
afterEach(() => {
  useKeybinds.getState().resetAll();
  useEditorStore.setState({ locale: 'en' });
});

describe('answers from Help and the key bindings', () => {
  spec('ASST-32', 'a job is offered the Help search, a Help page and the key bindings, each as an answer that asks nothing', async () => {
    const listed = await createExecutor(makeToolDeps({ vision: false, session: agentSessionPort })).execute({ callId: 'l', name: 'list_app_actions', args: {} });
    const rows = JSON.parse(listed.content) as { id: string; effect: string }[];
    for (const id of LOOKUPS) expect(rows.find((row) => row.id === id), id).toMatchObject({ effect: 'answer' });
  });

  spec('ASST-32', 'a search answers with Help\'s own passage in the interface language, under its page and section', async () => {
    const heading = HELP_TABLES.zh['help.camera.keys_t']!;
    const found = await answer('help.search', { query: heading });
    expect(found).toContain(`[camera#camera-keys] ${heading}`);
    expect(found).not.toContain(HELP_TABLES.en['help.camera.keys_t']);
  });

  spec('ASST-32', 'a page is read in full in the interface language, with the facts its copy quotes filled in', async () => {
    const page = await answer('help.read', { page: 'load' });
    expect(page).toContain(HELP_TABLES.zh['help.load.title']);
    expect(page).toContain(String(helpFacts('zh').chunkLimit));
    expect(page).not.toMatch(/\{[A-Za-z0-9_:.]+\}/);
  });

  spec('ASST-32', 'the key bindings are the ones in force: a key the user moved is listed where it is now, with the one it left', async () => {
    const id = 'history.undo';
    const name = translateFor('zh', META_BY_ID.get(id)!.labelKey);
    const shipped = prettyCombo(effectiveCombo({}, id));
    expect(await answer('help.key_bindings', { filter: id })).toContain(`${id} (${name}): ${shipped}`);
    expect(useKeybinds.getState().rebind(id, 'f9').ok).toBe(true);
    const moved = await answer('help.key_bindings', { filter: id });
    expect(moved).toContain(`${id} (${name}): F9`);
    expect(moved).toContain(shipped);
  });
});
