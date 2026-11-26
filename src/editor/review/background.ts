/*
 * The background text checks of text that came from outside: custom note tags, placed blueprint
 * groups' names and original authors, and planet names from a save, a share code, a planet file or a restored session. Each verdict is recorded where
 * its readers look, so approved text is shown and refused text never is. A check that cannot run
 * leaves the text unanswered and undrawn, to be tried again after the next load. Text typed into a
 * field is answered as it is typed, not here.
 */
import { createBackgroundReview } from '../../pipelines/moderation/text-check';
import { listPlanets, settlePlanetName, type PlanetEntry } from '../../io/storage/planet-library';
import { blueprintPartText, type BlueprintRecord, type BlueprintTextPart } from '../../io/blueprint';
import { BlueprintLibraryWiped } from '../../io/storage/blueprint-library';
import { blueprintPlaceholderName, editorBlueprintLibrary } from '../editing/blueprint';
import { uncheckedPlanetName } from '../../state/planet-name-verdict';
import { recordTextVerdict, textVerdictKnown } from '../../state/text-verdicts';
import { useEditorStore } from '../../state/store';
import type { PlacedGroup } from '../../core/model/placed-group';

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
export const __resetTriedCustomTags = tagReview.forgetTried;

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
export const __resetTriedPlanetNames = nameReview.forgetTried;

type PendingBlueprint = { id: string; part: BlueprintTextPart; text: string };

/** One review per blueprint text part: an approved text becomes the shown one and a refused one gives
 *  way for good (the name to the placeholder its card showed, the author to anonymous, the folder to
 *  none). A verdict on a record gone meanwhile is dropped, so one stored again is checked again. */
function blueprintReview(part: BlueprintTextPart, field: 'blueprint-name' | 'blueprint-author' | 'blueprint-folder') {
  return createBackgroundReview<PendingBlueprint>({
    field,
    next: (tried) => {
      const records: readonly BlueprintRecord[] = editorBlueprintLibrary().records();
      for (const r of records) {
        if (!r.unreviewed?.includes(part)) continue;
        const text = blueprintPartText(r, part);
        const key = `${r.id}\n${part}\n${text}`;
        if (!tried.has(key)) return { key, text: text.trim(), item: { id: r.id, part, text } };
      }
      return undefined;
    },
    settle: async (p, allowed) => {
      if (allowed === null) return true;
      const replacement = allowed ? null : p.part === 'name' ? blueprintPlaceholderName(p.id) : '';
      return editorBlueprintLibrary().settleReview(p.id, p.part, p.text, replacement).catch((err: unknown) => {
        if (!(err instanceof BlueprintLibraryWiped)) console.error('[blueprint-library] review failed:', err);
        return true;
      });
    },
  });
}

const blueprintReviews = [
  blueprintReview('name', 'blueprint-name'), blueprintReview('author', 'blueprint-author'), blueprintReview('folder', 'blueprint-folder'),
];

/** Checks the name, author and folder of every imported blueprint still unreviewed, in that order; a call during a run checks again once that run ends. */
export async function reviewBlueprintText(): Promise<void> {
  for (const review of blueprintReviews) await review.run();
}

/** One review of the open map's placed blueprint groups' names or original authors, which came from
 *  outside: a group's name shows on its card, and its original author passes on as Adapted from, only once approved. */
function groupTextReview(field: 'blueprint-name' | 'blueprint-author', texts: (g: PlacedGroup) => readonly string[]) {
  return createBackgroundReview<string>({
    field,
    next: (tried) => {
      const text = (useEditorStore.getState().gridState?.groups ?? []).flatMap(texts).find((t) => !textVerdictKnown(t) && !tried.has(t));
      return text === undefined ? undefined : { key: text, text: text.trim(), item: text };
    },
    settle: (text, allowed) => { if (allowed !== null) recordTextVerdict(text, allowed); },
  });
}

const groupReviews = [
  groupTextReview('blueprint-name', (g) => [g.name]),
  groupTextReview('blueprint-author', (g) => (g.origin === null ? [] : [g.origin])),
];

/** Checks every unanswered group name, then original author, of the open map; a call during a run checks again once that run ends. */
export async function reviewGroupText(): Promise<void> {
  for (const review of groupReviews) await review.run();
}

/** Forgets which group texts this page has tried; for tests that reuse texts. */
export const __resetTriedGroupText = (): void => { for (const review of groupReviews) review.forgetTried(); };
