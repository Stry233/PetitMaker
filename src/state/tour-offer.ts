/**
 * The tour's offer record: which tour version this browser has been offered (the `tourSeen` pref,
 * a decimal version; the first tour wrote '1'), and what a visit does about it. The version this
 * build offers is `TOUR_VERSION` (`tour-version.ts`, which a rig reads without this module's imports).
 *
 * A visit decides once, from the record as the page found it: the loading screen's warm list, the
 * first-launch check and What's new all read `visitStanding`, so the offer this page records never
 * changes what the page decided, whichever of them reads first.
 */
import { readStoredPref, writePref } from '../platform/storage/prefs';
import { TOUR_VERSION } from './tour-version';

export { TOUR_VERSION };

/** Where this browser stands with tour `version`: offered it or a newer one (or its storage cannot
 *  be read, so an offer would repeat on every visit), never offered any tour, or offered an older one. */
export type TourStanding = 'offered' | 'never' | 'older';

/** The stored record, undefined where storage cannot be read. */
function storedRecord(): string | null | undefined {
  const stored = readStoredPref('tourSeen');
  return stored.available ? stored.raw : undefined;
}

function standingOf(record: string | null | undefined, version: number): TourStanding {
  if (record === undefined) return 'offered';
  if (record === null) return 'never';
  const seen = Number.parseInt(record, 10);
  return Number.isFinite(seen) && seen >= version ? 'offered' : 'older';
}

function tourStanding(version: number): TourStanding {
  return standingOf(storedRecord(), version);
}

/** This page's visit, a cache keyed by the version and by the record as this page last read or
 *  wrote it: the standing the page found, and whether the visit's start has acted on it. */
let visit: { version: number; record: string | null | undefined; standing: TourStanding; acted: boolean } | null = null;

/** Where this browser stood with tour `version` as this page found it, before any offer it
 *  recorded. A record something else wrote since (another tab) is read as a new visit. */
function visitStanding(version: number): TourStanding {
  const record = storedRecord();
  if (visit?.version !== version || visit.record !== record) visit = { version, record, standing: standingOf(record, version), acted: false };
  return visit.standing;
}

/** Where this browser stood with the tour this build offers as this page found it, whatever the
 *  page has recorded since. */
export function tourVisitStanding(): TourStanding {
  return visitStanding(TOUR_VERSION);
}

/** Whether the offer is answered for this build's tour: the tour ran or was waived, or this
 *  browser cannot keep the answer. Until then a visit may be a frame away from opening it. */
export function tourSettled(): boolean {
  return tourStanding(TOUR_VERSION) === 'offered';
}

/** Records tour `version` as offered; a refused write leaves it to offer itself again next time. */
export function recordTourOffered(version: number): void {
  visitStanding(version);
  const value = String(version);
  if (writePref('tourSeen', value) && visit) visit = { ...visit, record: value };
}

/** What a visit's start does: run the tour, waive it (record it offered without running), or nothing. */
type FirstLaunch = 'run' | 'waive' | 'none';

/** A browser never offered any tour but holding a saved map used the editor before tours existed, so
 *  it is waived; one offered an older tour runs the current one once, saved map or not. */
export function firstLaunchTour(standing: TourStanding, hasSavedMap: boolean): FirstLaunch {
  if (standing === 'offered') return 'none';
  if (standing === 'never' && hasSavedMap) return 'waive';
  return 'run';
}

/** What this visit's start does about tour `version`, once a page: a later call answers 'none'. */
export function takeVisitStart(version: number, hasSavedMap: boolean): FirstLaunch {
  const decision = firstLaunchTour(visitStanding(version), hasSavedMap);
  if (!visit || visit.acted) return 'none';
  visit = { ...visit, acted: true };
  return decision;
}
