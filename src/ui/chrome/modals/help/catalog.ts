/*
 * Every Help Center page, in reading order, under its group.
 *
 * The union in `page-schema.ts` is the id authority; this file is the ORDER and the assembly.
 * A page missing here fails the type, so the catalog cannot silently drop one.
 */
import { IS_LITE, forEdition, inEdition } from '../../../../core/runtime/edition';
import { liteHelpContent } from './lite-catalog';
import type { HelpGroupId, HelpPage, HelpPageId } from './page-schema';
import { MAP_LOAD_SHOWN } from '../../../shell/windows/map-load';
import { START_PAGES } from './pages/start';
import { BUILD_PAGES } from './pages/build';
import { GENERATE_PAGES } from './pages/generate';
import { PLAN_PAGES } from './pages/plan';
import { SHARE_PAGES } from './pages/share';
import { AGENT_PAGES } from './pages/agent';
import { MISC_PAGES } from './pages/misc';


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

const WRITTEN: readonly HelpPage[] = [
  ...START_PAGES,
  ...BUILD_PAGES,
  ...GENERATE_PAGES,
  ...PLAN_PAGES,
  ...SHARE_PAGES,
  ...AGENT_PAGES,
  ...MISC_PAGES,
];

/** A page ships only where its subject does: the zone-load meter is gated by `MAP_LOAD_SHOWN`, so
 *  its page (and every pointer to it) follows the same flag, and a page the edition leaves out goes
 *  with its pointers too. */
const SHIPPED = new Set(WRITTEN.filter((p) => (p.id !== 'load' || MAP_LOAD_SHOWN) && inEdition(p)).map((p) => p.id));
const shipped = (id: HelpPageId): boolean => SHIPPED.has(id);

const ALL: readonly HelpPage[] = forEdition<HelpPage>(WRITTEN.filter((p) => shipped(p.id)))
  .map((p) => IS_LITE ? liteHelpContent(p) : p)
  .map((p) => ({ ...p, seeAlso: p.seeAlso.filter(shipped) }));

/** The groups in reading order, each one that has a page to show. */
export const HELP_GROUPS: readonly HelpGroupId[] = (['start', 'build', 'generate', 'plan', 'share', 'agent', 'misc'] as const)
  .filter((group) => ALL.some((p) => p.group === group));

export const HELP_PAGE_ORDER: readonly HelpPageId[] = ALL.map((p) => p.id);

/** Runtime may omit a gated page; every consumer walks `HELP_PAGE_ORDER` or a filtered seeAlso. */
export const HELP_PAGES: Record<HelpPageId, HelpPage> = Object.fromEntries(
  ALL.map((p) => [p.id, p]),
) as Record<HelpPageId, HelpPage>;
