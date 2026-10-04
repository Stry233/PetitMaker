import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { MapTemplate } from '../../../../core/model/types';
import {
  adoptPlanet, duplicatePlanet, listPlanets, onPlanetLibraryChange, planetLibraryVersion,
  planetNameStatus, removePlanet, renamePlanet, savePlanet, shownAs, shownEntryName, shownPlanetName, type PlanetEntry,
} from '../../../../io/planet-library';
import { useEditorStore } from '../../../../state/store';
import { reviewPlanetNames } from '../export/edition-export';

const library = { save: savePlanet, adopt: adoptPlanet, rename: renamePlanet, duplicate: duplicatePlanet, remove: removePlanet };

/**
 * The saved planets, re-read after every library write, and the library's writes. An entry whose
 * name has not passed the text check is shown, and handed on, under its default name.
 */
export function usePlanetLibrary(): { entries: PlanetEntry[] } & typeof library {
  const locale = useEditorStore((s) => s.locale);
  const version = useSyncExternalStore(onPlanetLibraryChange, planetLibraryVersion);
  // The version is the freshness key: every successful write bumps it before listeners run.
  const entries = useMemo(
    () => listPlanets().map((e, i) => { const shown = shownEntryName(e, i, locale); return shown === e.name ? e : shownAs(e, shown); }),
    [version, locale],
  );
  const unreviewed = entries.some((e) => !e.nameReviewed);
  useEffect(() => { if (unreviewed) void reviewPlanetNames(); }, [unreviewed, version]);
  return { entries, ...library };
}

/** `shownPlanetName` for a surface: follows the library and the checks, and starts a check the name still needs. */
export function usePlanetName(template: MapTemplate | null | undefined): string {
  const locale = useEditorStore((s) => s.locale);
  const version = useSyncExternalStore(onPlanetLibraryChange, planetLibraryVersion);
  const name = useMemo(() => (template ? shownPlanetName(template, locale) : ''), [template, locale, version]);
  const pending = !!template && planetNameStatus(template) === 'pending';
  useEffect(() => { if (pending) void reviewPlanetNames(); }, [pending, version]);
  return name;
}
