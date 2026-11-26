import { describe, expect, it } from 'vitest';
import { libraryView, newestSaved, selectionShown, type LibraryEntry, type LibraryViewInput } from '../../state/blueprint-library-view';
import { REST_BLUEPRINT_UI, REST_STEP, type BlueprintStep } from '../../state/slices/blueprint';

const entry = (id: string, name: string, folder: string | null, savedAt: number): LibraryEntry => ({ id, name, folder, savedAt });

/** A library in its own order, which is not the order they were saved in. */
const RECORDS = [
  entry('a', 'Pond Garden', 'Gardens', 30),
  entry('b', 'Bridge', null, 10),
  entry('c', 'Rose Garden', 'Gardens', 20),
  entry('d', 'Tea House', 'Houses', 40),
];

const explorer = (selected: readonly string[]): BlueprintStep => ({ at: 'explorer', id: 1, selected, picking: false, aside: false, setAside: [] });

type Input = LibraryViewInput<LibraryEntry>;

const view = (over: Partial<Omit<Input, 'ui'>> & { ui?: Partial<Input['ui']> } = {}) => libraryView({
  records: RECORDS, folders: ['Gardens', 'Houses'], step: REST_STEP, query: '', locale: 'en',
  ...over,
  ui: { ...REST_BLUEPRINT_UI, ...over.ui },
});

const ids = (rs: readonly LibraryEntry[]) => rs.map((r) => r.id);

describe('what the Blueprint library shows', () => {
  it('shows every blueprint in the library order on All, and a folder its own', () => {
    expect(ids(view().cards)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(view({ ui: { folder: 'Gardens' } }).cards)).toEqual(['a', 'c']);
    expect(view({ ui: { folder: 'Gardens' } }).folder).toBe('Gardens');
  });

  it('opens All when the open folder is gone from the library', () => {
    const v = view({ ui: { folder: 'Sheds' } });
    expect(v.open).toBeNull();
    expect(ids(v.cards)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('searches every folder by name, case aside and trimmed, with no folder tab open', () => {
    const v = view({ ui: { folder: 'Houses' }, query: '  garden ' });
    expect(v.searching).toBe(true);
    expect(v.folder).toBeNull();
    expect(v.open).toBe('Houses');
    expect(ids(v.cards)).toEqual(['a', 'c']);
    expect(view({ query: '   ' }).searching).toBe(false);
  });

  it('[BLUE-10] finds a name whatever its accents and character width', () => {
    const records = [...RECORDS, entry('e', 'Café Corner', null, 50), entry('f', 'ＣＡＦＥ', null, 60)];
    for (const query of ['cafe', 'CAFÉ', 'ｃａｆｅ']) expect(ids(view({ records, query }).cards), query).toEqual(['e', 'f']);
  });

  it('sorts the details list by name in the interface language, or newest saved first, while the grid keeps its order', () => {
    const names = [entry('x', 'Zebra', null, 1), entry('y', 'Ärger', null, 2), entry('z', 'bach', null, 3)];
    expect(view({ records: names, ui: { sort: 'name' }, locale: 'de' }).listed.map((r) => r.name)).toEqual(['Ärger', 'bach', 'Zebra']);
    expect(view({ records: names, ui: { sort: 'name' }, locale: 'sv' }).listed.map((r) => r.name)).toEqual(['bach', 'Zebra', 'Ärger']);
    const dated = view({ ui: { sort: 'date', view: 'list' } });
    expect(ids(dated.listed)).toEqual(['d', 'a', 'c', 'b']);
    expect(ids(dated.cards)).toEqual(['a', 'b', 'c', 'd']);
    expect(dated.order).toEqual(['d', 'a', 'c', 'b']);
    expect(view({ ui: { sort: 'date', view: 'grid' } }).order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selects only blueprints the explorer shows, in the order it shows them, and nothing outside the explorer', () => {
    const step = explorer(['d', 'gone', 'a']);
    expect(view({ step }).selected).toEqual(['a', 'd']);
    expect(view({ step, ui: { folder: 'Gardens' } }).selected).toEqual(['a']);
    expect(view({ step, ui: { sort: 'date', view: 'list' } }).selected).toEqual(['d', 'a']);
    expect(view({ step: REST_STEP }).selected).toEqual([]);
  });

  it('hands a press the selection as made, among the blueprints shown', () => {
    const v = view({ ui: { folder: 'Gardens' } });
    expect(selectionShown(v, explorer(['c', 'd', 'a']))).toEqual(['c', 'a']);
    expect(selectionShown(v, REST_STEP)).toEqual([]);
  });

  it('exports the one selected by name, a selection, what a search found, the open folder, else everything', () => {
    expect(view({ step: explorer(['c']) }).exportScope).toEqual({ kind: 'named', name: 'Rose Garden', ids: ['c'] });
    expect(view({ step: explorer(['c', 'a']) }).exportScope).toEqual({ kind: 'selected', ids: ['a', 'c'] });
    expect(view({ query: 'garden', ui: { folder: 'Houses' } }).exportScope).toEqual({ kind: 'found', ids: ['a', 'c'] });
    expect(view({ ui: { folder: 'Houses' } }).exportScope).toEqual({ kind: 'folder', folder: 'Houses', ids: ['d'] });
    expect(view().exportScope).toEqual({ kind: 'all', ids: ['a', 'b', 'c', 'd'] });
    expect(view({ query: 'shed' }).exportScope).toEqual({ kind: 'found', ids: [] });
  });

  it('counts each folder and the whole library, whatever is open or searched', () => {
    const v = view({ query: 'tea' });
    expect(v.counts.get(null)).toBe(4);
    expect(v.counts.get('Gardens')).toBe(2);
    expect(v.counts.get('Houses')).toBe(1);
    expect(v.counts.get('Sheds')).toBeUndefined();
  });

  it('finds the armed blueprint in any folder', () => {
    expect(view({ ui: { armed: 'd', folder: 'Gardens' } }).armed?.name).toBe('Tea House');
    expect(view({ ui: { armed: 'gone' } }).armed).toBeNull();
  });

  it('lists a library never arranged newest saved first, ties by id', () => {
    const tied = [entry('q', 'Q', null, 5), entry('p', 'P', null, 5), entry('r', 'R', null, 9)];
    expect(ids([...tied].sort(newestSaved))).toEqual(['r', 'p', 'q']);
  });
});
