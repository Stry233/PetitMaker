import { PROVIDER_META, type ProviderId } from '../../agent/panel';
import type { HelpPage } from './page-schema';
export { HELP_SURFACES } from './figures/surfaces';
export const helpProvider = (id: ProviderId) => PROVIDER_META[id];
export { PROVIDER_IDS, providerBaseUrls } from '../../agent/panel';
/** A page as this edition teaches it; the web edition's pages are written for it. */
export function editionHelpPage(page: HelpPage): HelpPage { return page; }
