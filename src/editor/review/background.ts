/*
 * The background text checks of text that came from outside: custom note tags and planet names
 * from a save, a share code, a planet file or a restored session. Each verdict is recorded where
 * its readers look, so approved text is shown and refused text never is. A check that cannot run
 * leaves the text unanswered and undrawn, to be tried again after the next load. Text typed into a
 * field is answered as it is typed, not here.
 */
import { createBackgroundReview } from '../../pipelines/moderation';
import { listPlanets, settlePlanetName, type PlanetEntry } from '../../io/storage/planet-library';
import { uncheckedPlanetName } from '../../state/planet-name-verdict';
import { recordTextVerdict, textVerdictKnown } from '../../state/text-verdicts';
import { useEditorStore } from '../../state/store';

const tagReview = createBackgroundReview<string>({
  field: 'tag',
  next: (tried) => {
    const tags = useEditorStore.getState().gridState?.annotations?.customTags ?? [];
    const text = tags.map((t) => t.text).find((t) => !textVerdictKnown(t) && !tried.has(t));
    return text === undefined ? undefined : { key: text, text, item: text };
  },
  settle: (text, allowed) => { if (allowed !== null) recordTextVerdict(text, allowed); },
});

/** Checks every unanswered custom tag of the open map; a call during a run checks again once that run ends. */
export const reviewCustomTags = tagReview.run;

/** Forgets which tag texts this page has tried; for tests that reuse texts. */
export const forgetTriedCustomTags = tagReview.forgetTried;

type PendingName = { entry: PlanetEntry } | { name: string };

/** Planet names the library adopted, then the open map's own planet name when no entry carries it.
 *  An approved name becomes the shown name and a refused one gives way to the default name for good;
 *  an unchecked entry's name shows as the default name. */
const nameReview = createBackgroundReview<PendingName>({
  field: 'planet',
  next: (tried) => {
    for (const entry of listPlanets()) {
      const key = `${entry.entryId}\n${entry.name}`;
      if (!entry.nameReviewed && !tried.has(key)) return { key, text: entry.name.trim(), item: { entry } };
    }
    const template = useEditorStore.getState().gridState?.template;
    const name = template ? uncheckedPlanetName(template, listPlanets()) : null;
    return name !== null && !tried.has(name) ? { key: name, text: name.trim(), item: { name } } : undefined;
  },
  settle: (pending, allowed) => {
    // A refusal stores an empty name, which every reader shows as the current default name.
    if ('entry' in pending) { if (allowed !== null) settlePlanetName(pending.entry.entryId, pending.entry.name, allowed ? null : ''); return; }
    // A verdict on a name no entry carries lasts only for this page, so a failed check counts as refused.
    recordTextVerdict(pending.name, allowed === true);
  },
});

/** Checks every unchecked planet name; a call during a run checks again once that run ends. */
export const reviewPlanetNames = nameReview.run;

/** Forgets which planet names this page has tried; for tests that reuse names. */
export const forgetTriedPlanetNames = nameReview.forgetTried;
