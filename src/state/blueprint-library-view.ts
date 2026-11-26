/**
 * What Blueprint's strip and explorer show of the library: the folder open, the cards a folder or a
 * search leaves in the library's own order, the details list's column sort, the explorer's selection among the cards shown, which card
 * wears the menu button, what the head's Export exports, and how many blueprints each folder holds. A search reaches every folder, as
 * the object shelf's reaches every category. Records are read by the fields named here, so the store
 * needs no file record type.
 */
import type { BlueprintStep, BlueprintUi } from './slices/blueprint';
import { foldedIncludes } from './fuzzy';

/** What the view reads of a library record, its texts as the page may show them. */
export interface LibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly folder: string | null;
  readonly savedAt: number;
}

/** Newest saved first, ties by id: the order a library never arranged lists its records in. */
export const newestSaved = (a: Pick<LibraryEntry, 'id' | 'savedAt'>, b: Pick<LibraryEntry, 'id' | 'savedAt'>): number =>
  b.savedAt - a.savedAt || (a.id < b.id ? -1 : 1);

/** What the head's Export exports, by what the explorer shows, with the ids it holds. */
export type ExportScope = { ids: readonly string[] } & (
  | { kind: 'named'; name: string } | { kind: 'selected' } | { kind: 'found' } | { kind: 'folder'; folder: string } | { kind: 'all' });

export interface LibraryViewInput<R extends LibraryEntry> {
  /** The library's records in the order it shows them. */
  readonly records: readonly R[];
  /** The library's folders, in the order they were made. */
  readonly folders: readonly string[];
  readonly ui: Pick<BlueprintUi, 'armed' | 'folder' | 'view' | 'sort'>;
  readonly step: BlueprintStep;
  /** The search as typed. */
  readonly query: string;
  /** The interface language's BCP 47 tag, which the name sort collates in. */
  readonly locale: string;
}

interface LibraryView<R extends LibraryEntry> {
  /** Whether a search, the query trimmed, is under way. */
  readonly searching: boolean;
  /** The folder open, or null for All; a folder the library no longer holds opens All. */
  readonly open: string | null;
  /** The folder tab marked open: `open`, none while searching. */
  readonly folder: string | null;
  /** The cards the folder or the search leaves, in the library's own order. */
  readonly cards: readonly R[];
  /** The same cards in the details list's order: its column sort, or the cards' own. */
  readonly listed: readonly R[];
  /** The ids of the cards in the order the explorer's view shows them: the list's, else the grid's. */
  readonly order: readonly string[];
  /** The ids the folder or the search leaves. */
  readonly shown: ReadonlySet<string>;
  /** The ids selected in the explorer among the cards shown, in the order `order` holds them. */
  readonly selected: readonly string[];
  readonly exportScope: ExportScope;
  /** The armed record, or null. */
  readonly armed: R | null;
  /** How many records each folder holds, and every record under null. */
  readonly counts: ReadonlyMap<string | null, number>;
}

/** The ids `step` selects in the explorer, none at any other step. */
const selectedAt = (step: BlueprintStep): readonly string[] => (step.at === 'explorer' ? step.selected : []);

export function libraryView<R extends LibraryEntry>({ records: all, folders, ui, step, query, locale }: LibraryViewInput<R>): LibraryView<R> {
  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const open = ui.folder !== null && folders.includes(ui.folder) ? ui.folder : null;
  const cards = searching ? all.filter((r) => foldedIncludes(r.name, trimmed))
    : open === null ? all : all.filter((r) => r.folder === open);
  const shown = new Set(cards.map((r) => r.id));
  const collator = new Intl.Collator(locale);
  const listed = ui.sort === 'name' ? [...cards].sort((a, b) => collator.compare(a.name, b.name))
    : ui.sort === 'date' ? [...cards].sort(newestSaved) : cards;
  const order = (ui.view === 'list' ? listed : cards).map((r) => r.id);
  // A selected blueprint deleted, or out of the cards shown, is no longer selected.
  const chosen = selectedAt(step);
  const selected = order.filter((id) => chosen.includes(id) && shown.has(id));
  const ids = cards.map((r) => r.id);
  const exportScope: ExportScope = selected.length === 1 ? { kind: 'named', name: cards.find((r) => r.id === selected[0])!.name, ids: selected }
    : selected.length > 1 ? { kind: 'selected', ids: selected }
    : searching ? { kind: 'found', ids }
    : open !== null ? { kind: 'folder', folder: open, ids } : { kind: 'all', ids };
  const counts = new Map<string | null, number>([[null, all.length]]);
  for (const r of all) if (r.folder !== null) counts.set(r.folder, (counts.get(r.folder) ?? 0) + 1);
  return {
    searching, open, folder: searching ? null : open, cards, listed, order, shown, selected, exportScope,
    armed: all.find((r) => r.id === ui.armed) ?? null, counts,
  };
}

/** The explorer's selection `step` holds now among the cards `view` shows, in the order it was made:
 *  what a press landing before the next render acts on. */
export function selectionShown(view: Pick<LibraryView<LibraryEntry>, 'shown'>, step: BlueprintStep): readonly string[] {
  return selectedAt(step).filter((id) => view.shown.has(id));
}

/** The blueprint whose card or details row wears the menu button, which opens the menu a mouse's right
 *  press opens: in touch mode, the one selected in the open explorer while no tick circles pick several;
 *  none with a mouse, on the strip or with several selected. `selected` is the view's selection. */
export function menuButtonOn(selected: readonly string[], step: BlueprintStep, touch: boolean): string | null {
  return touch && step.at === 'explorer' && !step.picking && selected.length === 1 ? selected[0]! : null;
}
