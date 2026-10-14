/**
 * Whether a custom planet's name may be shown. A library entry's name is settled by the entry's own
 * review flag (an empty settled name is a refusal); a name no entry carries reads the page's verdict
 * in `text-verdicts.ts`. Callers pass the library's entries, so this module reads no storage.
 */
import { isCustomTemplate } from '../core/model/planet';
import type { MapTemplate } from '../core/model/types';
import { textVerdict, textVerdictKnown } from './text-verdicts';

/** What the name check reads of a library entry. */
export interface NamedPlanetEntry {
  name: string;
  nameReviewed: boolean;
  template: Pick<MapTemplate, 'id'>;
}

export type PlanetNameStatus = 'approved' | 'pending' | 'refused';

/**
 * The entry among `entries` that names a map's planet. A copy shares its original's shape and so
 * its template id; among the entries of that shape it is the one carrying the map's own name, or
 * the only one, so a rename there renames the planet wherever it stands.
 */
export function planetEntryAmong<E extends NamedPlanetEntry>(entries: readonly E[], template: MapTemplate): E | null {
  if (!isCustomTemplate(template)) return null;
  const same = entries.filter((e) => e.template.id === template.id);
  return same.find((e) => e.name === template.name.en) ?? (same.length === 1 ? same[0]! : null);
}

/** Whether `template`'s name may be shown, its name, and the library index its default name counts
 *  from: the entry's own, or the library's length for a planet no entry carries. */
export function planetNameVerdict(template: MapTemplate, entries: readonly NamedPlanetEntry[]): { status: PlanetNameStatus; name: string; index: number } {
  const entry = planetEntryAmong(entries, template);
  if (entry) return { status: !entry.nameReviewed ? 'pending' : entry.name.trim() ? 'approved' : 'refused', name: entry.name, index: entries.indexOf(entry) };
  const name = template.name.en ?? '';
  const verdict = name.trim() ? textVerdict(name) : 'refused';
  return { status: verdict === 'unchecked' ? 'pending' : verdict, name, index: entries.length };
}

export function planetNameStatus(template: MapTemplate, entries: readonly NamedPlanetEntry[]): PlanetNameStatus {
  return isCustomTemplate(template) ? planetNameVerdict(template, entries).status : 'approved';
}

/** A custom planet's name that no entry carries and no check has answered yet. */
export function uncheckedPlanetName(template: MapTemplate, entries: readonly NamedPlanetEntry[]): string | null {
  if (!isCustomTemplate(template) || planetEntryAmong(entries, template)) return null;
  const name = template.name.en ?? '';
  return name.trim() && !textVerdictKnown(name) ? name : null;
}
