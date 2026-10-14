/**
 * My planets as the planet windows use it: the library's reads and writes (`io/storage/planet-library.ts`),
 * a planet file read into it or written out of it, a copy under its translated name, and a planet read
 * from a video opened as a draft. Each verb raises its own failure notice.
 */
import type { Locale } from '../../core/model/locale';
import { translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import { downloadBlob, exportFileName, safeName } from '../../io/export/download';
import { clampName, readPlanetFile, writePlanetFile } from '../../io/save/planet-codec';
import { readImportText } from '../../io/import/read-blob';
import {
  adoptPlanet, duplicatePlanet, listPlanets, onPlanetLibraryChange, planetEntryFor, planetLibraryVersion,
  removePlanet, renamePlanet, savePlanet, shownAs, type PlanetEntry,
} from '../../io/storage/planet-library';
import type { PlanetDraft } from '../operations/planet-session';
import type { ScanOutcome } from '../../pipelines/planet-scan';
import { defaultPlanetName } from './planet-names';

export {
  adoptPlanet, duplicatePlanet, listPlanets, onPlanetLibraryChange, planetEntryFor, planetLibraryVersion, removePlanet, renamePlanet, savePlanet, shownAs,
  type PlanetEntry,
};

/** The entry a planet file names in the library: the existing entry for its planet, or a new one under
 *  the file's name (unreviewed until the text check settles it) or the next default name. Null when the
 *  file cannot be read or saved, which has been said. */
export async function importPlanetFile(file: File, locale: Locale): Promise<PlanetEntry | null> {
  let read: ReturnType<typeof readPlanetFile>;
  try {
    const text = await readImportText(file);
    if (text === null) throw new Error('planet file past the import limit');
    read = readPlanetFile(text);
  } catch { showToast(translate('planet.import_failed'), 'error'); return null; }
  const entries = listPlanets();
  const same = entries.find((e) => e.template.id === read.template.id);
  if (same) return same;
  // The file's own name waits for the text check; the default name needs none.
  const named = read.name.trim();
  const saved = savePlanet(named || defaultPlanetName(locale, entries.length), read.template, { nameReviewed: !named });
  if (!saved.ok) { showToast(translate('planet.save_failed'), 'error'); return null; }
  return saved.entry;
}

/** A copy of `entry` under the copy name; null when it could not be saved, which has been said. */
export function duplicatePlanetEntry(entry: PlanetEntry): PlanetEntry | null {
  const copy = duplicatePlanet(entry.entryId, clampName(translate('planet.copy_suffix', { name: entry.name })));
  if (!copy) showToast(translate('planet.save_failed'), 'error');
  return copy;
}

/** Renames an entry; whether the library took it, a refusal said. */
export function renamePlanetEntry(entry: PlanetEntry, name: string): boolean {
  const ok = renamePlanet(entry.entryId, name);
  if (!ok) showToast(translate('planet.save_failed'), 'error');
  return ok;
}

/** Removes an entry; whether the library took it, a refusal said. */
export function removePlanetEntry(entry: PlanetEntry): boolean {
  const ok = removePlanet(entry.entryId);
  if (!ok) showToast(translate('planet.save_failed'), 'error');
  return ok;
}

/** Downloads `entry` as a planet file. */
export function downloadPlanetFile(entry: PlanetEntry): void {
  downloadBlob(new Blob([writePlanetFile(entry.name, entry.template)], { type: 'application/json' }), exportFileName([safeName(entry.name)], 'planet.json'));
}

/** A planet read from a video, as the planet editor opens it: a new planet with its cells to check. */
export function draftFromScan(outcome: ScanOutcome): PlanetDraft {
  return {
    template: outcome.template, rimSand: outcome.rimSand,
    review: { cells: outcome.review, landmark: outcome.landmark !== null, unplaced: outcome.unplaced },
  };
}
