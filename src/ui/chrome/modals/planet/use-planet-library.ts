import { useSyncExternalStore } from 'react';
import { useVersioned } from '../../../primitives/use-versioned';
import type { MapTemplate } from '../../../../core/model/types';
import {
  adoptPlanet, duplicatePlanet, onPlanetLibraryChange, planetLibraryVersion,
  removePlanet, renamePlanet, savePlanet, shownPlanetEntries, type PlanetEntry,
} from '../../../../editor/session/planet-library';
import { shownPlanetName } from '../../../../editor/session/planet-names';
import { useLocale } from '../../../../i18n/context';

const library = { save: savePlanet, adopt: adoptPlanet, rename: renamePlanet, duplicate: duplicatePlanet, remove: removePlanet };

/**
 * The saved planets, re-read after every library write, and the library's writes. An entry whose
 * name has not passed the text check is shown, and handed on, under its default name; the check runs
 * in the background (`editor/session/planet-library.ts:watchUncheckedPlanetNames`).
 */
export function usePlanetLibrary(): { entries: PlanetEntry[] } & typeof library {
  const locale = useLocale();
  const version = useSyncExternalStore(onPlanetLibraryChange, planetLibraryVersion);
  // The version is the freshness key: every successful write bumps it before listeners run.
  const entries = useVersioned(() => shownPlanetEntries(locale), [version, locale]);
  return { entries, ...library };
}

/** `shownPlanetName` for a surface: follows the library and the checks. */
export function usePlanetName(template: MapTemplate | null | undefined): string {
  const locale = useLocale();
  const version = useSyncExternalStore(onPlanetLibraryChange, planetLibraryVersion);
  return useVersioned(() => (template ? shownPlanetName(template, locale) : ''), [template, locale, version]);
}
