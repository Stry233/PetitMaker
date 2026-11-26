import type { HelpFigure } from '../help/page-figures';
import type { ComponentType } from 'react';
import type { helpProvider as webHelpProvider } from '../help/edition-help';
import { CORE_SURFACES } from '../help/figures/core-surfaces';

export const helpProvider = (): ReturnType<typeof webHelpProvider> | undefined => undefined;
export const HELP_SURFACES: Record<string, ComponentType> = CORE_SURFACES;

export const PROVIDER_IDS: readonly never[] = [];
export const providerBaseUrls = (): string[] => [];
/** A surface figure this edition does not bundle is left out; demos draw from the shared scenes. */
export function editionFigure(figure: HelpFigure | undefined): HelpFigure | undefined {
  return figure?.kind === 'surface' && !(figure.surface in HELP_SURFACES) ? undefined : figure;
}
