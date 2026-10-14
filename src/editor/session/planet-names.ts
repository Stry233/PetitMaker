// The names planets are shown under. `shownPlanetName` is the one reader of a planet's name for
// display: a built-in's own name, or a custom planet's name as `io/export/exportable.ts` shows and
// exports it.
import type { MapTemplate } from '../../core/model/types';
import type { Locale } from '../../core/model/locale';
import { isCustomTemplate } from '../../core/model/planet';
import { localizedName, translateFor } from '../../i18n/context';
import type { PlanetEntry } from '../../io/storage/planet-library';
import { shownCustomPlanetName, type ExportNaming } from '../../io/export/exportable';

/** The default name of the library entry at `index`, or of the next planet at the library's length. */
export function defaultPlanetName(locale: Locale, index: number): string {
  return translateFor(locale, 'planet.default_name', { n: index + 1 });
}

/** The localized default names `exportableState` and the shown name fall back to. */
export function planetNaming(locale: Locale): ExportNaming {
  return { defaultName: (index) => defaultPlanetName(locale, index) };
}

/** The name the library entry at `index` is shown under: its approved name, or its default name while unchecked or refused. */
export function shownEntryName(entry: Pick<PlanetEntry, 'name' | 'nameReviewed'>, index: number, locale: Locale): string {
  return entry.nameReviewed && entry.name.trim() ? entry.name : defaultPlanetName(locale, index);
}

/** A planet's name as shown and exported: a built-in's own name, or a custom planet's approved name or default name. */
export function shownPlanetName(template: MapTemplate, locale: Locale): string {
  return isCustomTemplate(template) ? shownCustomPlanetName(template, planetNaming(locale)) : localizedName(template.name, locale);
}
