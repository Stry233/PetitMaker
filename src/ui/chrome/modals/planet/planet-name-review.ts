/**
 * The background text check for planet names that came from outside: names the library adopted
 * from planet files, share codes and save files, and the open map's own planet name when no entry
 * carries it. Names are checked one at a time outside React; an approved name becomes the shown
 * name and a refused one gives way to the default name for good. A check that cannot run leaves
 * the name unchecked, still shown as the default name, to be tried again after the next load.
 * Each name is tried once per page load.
 */
import { reviewText, ReviewWorkerLease } from '../../../../io/moderation/text/reviewer';
import { listPlanets, recordPlanetNameVerdict, settlePlanetName, uncheckedPlanetName } from '../../../../io/planet-library';
import { useEditorStore } from '../../../../state/store';

const lease = new ReviewWorkerLease();
const tried = new Set<string>();
let running: Promise<void> | null = null;

/** The check's verdict on `text`, or null when the check could not run. */
async function verdict(text: string): Promise<boolean | null> {
  if (!text.trim()) return false;
  try {
    return (await reviewText([{ field: 'planet', text: text.trim() }], new AbortController().signal, () => {}, lease)).allowed;
  } catch {
    return null;
  }
}

/** Forgets which names this page has tried; for tests that reuse names. */
export function forgetTriedPlanetNames(): void {
  tried.clear();
}

/** Checks every unchecked planet name; a call during a run checks again once that run ends. */
export function reviewPlanetNames(): Promise<void> {
  if (running) return running.then(() => reviewPlanetNames());
  running = (async () => {
    for (const entry of listPlanets()) {
      const key = `${entry.entryId}\n${entry.name}`;
      if (entry.nameReviewed || tried.has(key)) continue;
      tried.add(key);
      const ok = await verdict(entry.name);
      // A refusal stores an empty name, which every reader shows as the current default name.
      if (ok !== null) settlePlanetName(entry.entryId, entry.name, ok ? null : '');
    }
    const template = useEditorStore.getState().gridState?.template;
    const name = template ? uncheckedPlanetName(template) : null;
    if (name !== null && !tried.has(name)) {
      tried.add(name);
      // A verdict on a name no entry carries lasts only for this page, so a failed check counts as refused.
      recordPlanetNameVerdict(name, (await verdict(name)) === true);
    }
  })().finally(() => { running = null; });
  return running;
}
