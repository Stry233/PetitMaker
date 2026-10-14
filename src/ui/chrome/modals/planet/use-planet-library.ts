import { useEffect, useSyncExternalStore } from 'react';
import { useVersioned } from '../../../primitives/use-versioned';
import type { MapTemplate } from '../../../../core/model/types';
import {
  adoptPlanet, duplicatePlanet, listPlanets, onPlanetLibraryChange, planetLibraryVersion,
  removePlanet, renamePlanet, savePlanet, shownAs, type PlanetEntry,
} from '../../../../editor/session/planet-library';
import { shownEntryName, shownPlanetName } from '../../../../editor/session/planet-names';
import { planetNameStatus } from '../../../../state/planet-name-verdict';
import { reviewPlanetNames } from '../../../../editor/review/edition-review';
import { useLocale } from '../../../../i18n/context';

const library = { save: savePlanet, adopt: adoptPlanet, rename: renamePlanet, duplicate: duplicatePlanet, remove: removePlanet };

/**
 * The saved planets, re-read after every library write, and the library's writes. An entry whose
 * name has not passed the text check is shown, and handed on, under its default name.
 */
export function usePlanetLibrary(): { entries: PlanetEntry[] } & typeof library {
  const locale = useLocale();
  const version = useSyncExternalStore(onPlanetLibraryChange, planetLibraryVersion);
  // The version is the freshness key: every successful write bumps it before listeners run.
  const entries = useVersioned(
    () => listPlanets().map((e, i) => { const shown = shownEntryName(e, i, locale); return shown === e.name ? e : shownAs(e, shown); }),
    [version, locale],
  );
  const unreviewed = entries.some((e) => !e.nameReviewed);
  useEffect(() => { if (unreviewed) void reviewPlanetNames(); }, [unreviewed, version]);
  return { entries, ...library };
}

/** `shownPlanetName` for a surface: follows the library and the checks, and starts a check the name still needs. */
export function usePlanetName(template: MapTemplate | null | undefined): string {
  const locale = useLocale();
  const version = useSyncExternalStore(onPlanetLibraryChange, planetLibraryVersion);
  const name = useVersioned(() => (template ? shownPlanetName(template, locale) : ''), [template, locale, version]);
  const pending = !!template && planetNameStatus(template, listPlanets()) === 'pending';
  useEffect(() => { if (pending) void reviewPlanetNames(); }, [pending, version]);
  return name;
}
