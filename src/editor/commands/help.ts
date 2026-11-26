/**
 * The commands that answer from the app's own Help and the live keymap: a search over Help's
 * passages, one page or one section in full, and the key bindings in force. Passages and command
 * names come in the interface language, which is what the user reads; the lines around them are
 * English, as every command's result is.
 */
import { translateFor } from '../../i18n/context';
import { loadHelpTables } from '../../i18n/translations';
import { memoLoad } from '../../platform/async/memo-load';
import { normalizeCombo, prettyCombo } from '../../platform/input/combo';
import { COMMAND_META } from '../../state/keymap/registry';
import { comboChanged, commandNameMatches, effectiveCombo } from '../../state/keymap/resolve';
import { useKeybinds } from '../../state/keymap/store';
import { toolbarContextOf } from '../../state/keymap/toolbar';
import { useEditorStore } from '../../state/store';
import type { HelpPassage, HelpReader } from '../help/passages';
import type { HelpPageId } from '../help/page-schema';
import { type Command, type CommandContext, refuse } from './types';

const store = () => useEditorStore.getState();

/** Help's pages and their text arrive with the first question, not with the frame. */
const loadHelp = memoLoad(() => Promise.all([import('../help/catalog'), import('../help/passages')])
  .then(([catalog, passages]) => ({ ...catalog, ...passages })));

type Help = Awaited<ReturnType<typeof loadHelp>>;

/** Help as the user reads it now: the interface language with its Help strings loaded, the live
 *  keymap and input form, and the facts a mounted frame adds. */
async function liveHelp(ctx: CommandContext): Promise<{ help: Help; reader: HelpReader }> {
  const { locale, inputMode, layoutShape } = store();
  const [help, factsAbove] = await Promise.all([loadHelp(), ctx.helpFactsAbove?.(), loadHelpTables(locale)]);
  return { help, reader: { locale, factsAbove, overrides: useKeybinds.getState().overrides, reading: { inputMode, shape: layoutShape } } };
}

/** One passage as text: where it stands, its heading, its words. */
const shown = ({ page, anchor, heading, text }: HelpPassage): string => `[${page}${anchor ? `#${anchor}` : ''}] ${heading}\n${text}`;

export const HELP_COMMANDS: readonly Command[] = [
  {
    id: 'help.search', effect: 'answer', target: 'app', labelKey: 'modal.help_title',
    description: 'Searches the app\'s Help by keywords and returns the matching passages in the interface language, each headed by its page id and section.',
    args: [{ name: 'query', kind: 'string', description: 'Keywords, in the interface language or in English.' }],
    async invoke({ query }, ctx) {
      const live = await liveHelp(ctx);
      const words = String(query).trim();
      if (!words) return refuse('query is empty.');
      const passages = live.help.searchPassages(words, live.reader);
      if (passages.length === 0) return `Help has no passage about "${words}".`;
      return [`Help passages about "${words}", best first, as [page#section] heading:`, ...passages.map(shown)].join('\n\n');
    },
  },
  {
    id: 'help.read', effect: 'answer', target: 'app', labelKey: 'modal.help_title',
    description: 'Returns one Help page in full, or one section of it, in the interface language.',
    args: [
      { name: 'page', kind: 'string', description: 'The Help page id, as help.search names it before the #.' },
      { name: 'section', kind: 'string', optional: true, description: 'A section of that page, as help.search names it after the #; left out, the whole page.' },
    ],
    async invoke({ page: id, section }, ctx) {
      const live = await liveHelp(ctx);
      const { HELP_PAGES, HELP_PAGE_ORDER, pagePassages, sectionAnchorOf } = live.help;
      if (!HELP_PAGE_ORDER.includes(id as HelpPageId)) return refuse(`Help has no page ${String(id)}. Its pages: ${HELP_PAGE_ORDER.join(', ')}.`);
      const page = HELP_PAGES[id as HelpPageId];
      const passages = pagePassages(page, live.reader);
      if (section === undefined) {
        const related = page.seeAlso.length > 0 ? ` Related pages: ${page.seeAlso.join(', ')}.` : '';
        return [`Help page ${page.id}, as [page#section] heading.${related}`, ...passages.map(shown)].join('\n\n');
      }
      const anchor = sectionAnchorOf(page, String(section));
      const passage = passages.find((entry) => entry.anchor !== undefined && entry.anchor === anchor);
      if (!passage) {
        const anchors = passages.flatMap((entry) => (entry.anchor ? [entry.anchor] : []));
        return refuse(`Help page ${page.id} has no section ${String(section)}. Its sections: ${anchors.join(', ')}.`);
      }
      return shown(passage);
    },
  },
  {
    id: 'help.key_bindings', effect: 'answer', target: 'app', labelKey: 'modal.keyboard_title',
    description: 'Lists the key bindings in force now, the user\'s own changes included, each as id (name in the interface language): key.',
    args: [{ name: 'filter', kind: 'string', optional: true, description: 'Only commands whose id or name contains this text; left out, every command.' }],
    invoke({ filter }) {
      const { locale } = store();
      const overrides = useKeybinds.getState().overrides;
      const toolbar = toolbarContextOf(store());
      const wanted = filter === undefined ? '' : String(filter).trim().toLowerCase();
      const key = (combo: string | null): string => (combo ? prettyCombo(normalizeCombo(combo)) : 'no key');
      const lines = COMMAND_META.flatMap((meta) => {
        const name = translateFor(locale, meta.labelKey);
        if (wanted && !meta.id.includes(wanted) && !commandNameMatches(name, wanted)) return [];
        const now = key(effectiveCombo(overrides, meta.id, toolbar));
        const changed = comboChanged(overrides, meta.id, toolbar) ? `, changed by the user from ${key(effectiveCombo({}, meta.id, toolbar))}` : '';
        return [`${meta.id} (${name}): ${now}${meta.continuous ? ', held' : ''}${changed}`];
      });
      if (lines.length === 0) return `No command matches "${wanted}".`;
      return [`Key bindings in force, with the toolbar keys of the ${toolbar} toolbar, which is the one up now:`, ...lines].join('\n');
    },
  },
];
