import { PROVIDER_META, type ProviderId } from '../../agent/panel';
import type { HelpFigure } from './page-figures';
export { HELP_SURFACES } from './figures/surfaces';
export const helpProvider = (id: ProviderId) => PROVIDER_META[id];
export { PROVIDER_IDS, providerBaseUrls } from '../../agent/panel';
/** A figure as this edition shows it; the web edition's figures are written for it. */
export function editionFigure(figure: HelpFigure | undefined): HelpFigure | undefined { return figure; }
