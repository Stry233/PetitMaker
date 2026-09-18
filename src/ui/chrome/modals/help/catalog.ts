import { IS_LITE } from '../../../../core/runtime/edition';
import { liteHelpContent, liteHelpPage } from './lite-catalog';
/*
 * catalog.ts — every Help Center page, in reading order, under its group.
 *
 * The union in `page-schema.ts` is the id authority; this file is the ORDER and the assembly.
 * A page missing here fails the type, so the catalog cannot silently drop one.
 */
import type { HelpGroupId, HelpPage, HelpPageId } from './page-schema';
import { MAP_LOAD_SHOWN } from '../../../shell/windows/map-load';
import { START_PAGES } from './pages/start';
import { BUILD_PAGES } from './pages/build';
import { GENERATE_PAGES } from './pages/generate';
import { PLAN_PAGES } from './pages/plan';
import { SHARE_PAGES } from './pages/share';
import { AGENT_PAGES } from './pages/agent';
import { MISC_PAGES } from './pages/misc';

export const HELP_GROUPS: readonly HelpGroupId[] = IS_LITE ? ['start', 'build', 'generate', 'plan', 'share', 'misc'] : ['start', 'build', 'generate', 'plan', 'share', 'agent', 'misc'];

/** Group headings, spelled out so the key scan can see each literal. */
export const HELP_GROUP_TITLES: Record<HelpGroupId, string> = {
  start: 'help.group.start',
  build: 'help.group.build',
  generate: 'help.group.generate',
  plan: 'help.group.plan',
  share: 'help.group.share',
  agent: 'help.group.agent',
  misc: 'help.group.misc',
};

/** A page ships only where its subject does: the zone-load meter is gated by `MAP_LOAD_SHOWN`,
 *  so its page (and every pointer to it) follows the same flag. */
const shipped = (id: HelpPageId): boolean => (id !== 'load' || MAP_LOAD_SHOWN) && (!IS_LITE || liteHelpPage(id));

const ALL: readonly HelpPage[] = [
  ...START_PAGES,
  ...BUILD_PAGES,
  ...GENERATE_PAGES,
  ...PLAN_PAGES,
  ...SHARE_PAGES,
  ...AGENT_PAGES,
  ...MISC_PAGES,
].filter((p) => shipped(p.id)).map(p => IS_LITE ? liteHelpContent(p) : p).map((p) => ({ ...p, seeAlso: p.seeAlso.filter(shipped) }));

export const HELP_PAGE_ORDER: readonly HelpPageId[] = ALL.map((p) => p.id);

/** Runtime may omit a gated page; every consumer walks `HELP_PAGE_ORDER` or a filtered seeAlso. */
export const HELP_PAGES: Record<HelpPageId, HelpPage> = Object.fromEntries(
  ALL.map((p) => [p.id, p]),
) as Record<HelpPageId, HelpPage>;
