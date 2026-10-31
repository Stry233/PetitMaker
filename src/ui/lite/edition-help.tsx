import type { HelpPage } from '../help/page-schema';
import type { ComponentType } from 'react';
import type { helpProvider as webHelpProvider } from '../help/edition-help';
import { CORE_SURFACES } from '../help/figures/core-surfaces';

export const helpProvider = (): ReturnType<typeof webHelpProvider> | undefined => undefined;
export const HELP_SURFACES: Record<string, ComponentType> = CORE_SURFACES;

export const PROVIDER_IDS: readonly never[] = [];
export const providerBaseUrls = (): string[] => [];
type Figure = HelpPage['figure'];
/** A surface figure this edition does not bundle is left out; demos draw from the shared scenes. */
const shown = (figure: Figure): Figure => (figure?.kind === 'surface' && !(figure.surface in HELP_SURFACES) ? undefined : figure);

/** A page as the offline edition shows it: its entries are already this edition's (`catalog.ts`),
 *  and only the figures it bundles remain. */
export function editionHelpPage(page: HelpPage): HelpPage {
  return {
    ...page,
    figure: shown(page.figure),
    sections: page.sections.map((section) => (section.kind === 'prose' ? { ...section, figure: shown(section.figure) } : section)),
  };
}
