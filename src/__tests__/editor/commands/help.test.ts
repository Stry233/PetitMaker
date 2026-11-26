/** The Help commands over the live store: what they answer with and what they refuse. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCommand } from '../../../editor/commands/run';
import { HELP_PAGES } from '../../../editor/help/catalog';
import { helpFacts } from '../../../editor/help/facts';
import { useKeybinds } from '../../../state/keymap/store';
import { useEditorStore } from '../../../state/store';
import { STAND_IN_FACTS_ABOVE } from '../../_support/help-facts';
import { HELP_TABLES, installHelpTables } from '../../_support/locale-tables';

installHelpTables();

/** No frame is mounted and no caller's context is passed. */
const answer = async (id: string, args: Record<string, unknown> = {}): Promise<string> => {
  const outcome = await runCommand(id, args);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.result;
};

beforeEach(() => useEditorStore.setState({ locale: 'en' }));
afterEach(() => {
  useKeybinds.getState().resetAll();
  useEditorStore.setState({ locale: 'en' });
});

describe('the Help commands', () => {
  it('search: head each passage with its page and section, and say so when nothing matches', async () => {
    const found = await answer('help.search', { query: HELP_TABLES.en['help.camera.keys_t'] });
    expect(found).toContain(`[camera#camera-keys] ${HELP_TABLES.en['help.camera.keys_t']}`);
    expect(await answer('help.search', { query: 'zzqqxxyy' })).toContain('zzqqxxyy');
    expect(await runCommand('help.search', { query: '  ' })).toMatchObject({ ok: false });
  });

  it('read: give the whole page with its related pages, or the one section asked for', async () => {
    const page = await answer('help.read', { page: 'camera' });
    expect(page).toContain(`[camera] ${HELP_TABLES.en['help.camera.title']}`);
    for (const related of HELP_PAGES.camera.seeAlso) expect(page).toContain(related);
    for (const section of HELP_PAGES.camera.sections) if (section.kind !== 'callout') expect(page).toContain(`[camera#${section.anchor}]`);
    const section = await answer('help.read', { page: 'camera', section: 'camera-keys' });
    expect(section.startsWith(`[camera#camera-keys] ${HELP_TABLES.en['help.camera.keys_t']}`)).toBe(true);
    expect(section).not.toContain('[camera]');
  });

  it('read: refuse a page Help lacks and a section the page lacks, naming the sections it has', async () => {
    const noPage = await runCommand('help.read', { page: 'no-such-page' });
    expect(noPage).toMatchObject({ ok: false });
    expect(noPage.ok ? '' : noPage.reason).toContain('camera');
    const refused = await runCommand('help.read', { page: 'camera', section: 'no-such-section' });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? '' : refused.reason).toContain('camera-keys');
  });

  it('key bindings: narrow the list to the commands a filter names', async () => {
    const all = (await answer('help.key_bindings')).split('\n');
    const some = (await answer('help.key_bindings', { filter: 'history.' })).split('\n');
    expect(some.length).toBeLessThan(all.length);
    expect(some.slice(1).every((line) => line.startsWith('history.'))).toBe(true);
    expect(some.slice(1).length).toBeGreaterThan(0);
  });

  it('search and read: answer with no frame mounted, the facts the copy quotes filled in', async () => {
    const terrain = await answer('help.read', { page: 'terrain' });
    expect(terrain).toContain(`[terrain] ${HELP_TABLES.en['help.terrain.title']}`);
    expect(terrain).not.toMatch(/\{[A-Za-z0-9_:.]+\}/);
    const limit = await answer('help.read', { page: 'load', section: 'load-limit' });
    expect(HELP_TABLES.en['help.load.limit_b1']).toContain('{chunkLimit}');
    expect(limit).toContain(String(helpFacts('en').chunkLimit));
    const found = await answer('help.search', { query: HELP_TABLES.en['help.load.limit_t'] });
    expect(found).toContain(limit);
  });

  it('read: fill the values a frame adds where one supplies them', async () => {
    const framed = await runCommand('help.read', { page: 'agent-setup' }, { toggleMenu: () => {}, helpFactsAbove: async () => STAND_IN_FACTS_ABOVE });
    expect(HELP_TABLES.en['help.agentsetup.providers_b1']).toContain('{agentProviders}');
    expect(framed.ok ? framed.result : '').toContain(String(STAND_IN_FACTS_ABOVE('en').agentProviders));
    expect(framed.ok ? framed.result : '').not.toMatch(/\{[A-Za-z0-9_:.]+\}/);
  });
});
