/** Carried blueprint cards let go: what each place a release lands on does to the library and to the
 *  carry of a single card to the map. */
import { beforeEach, describe, expect, it } from 'vitest';
import { blueprintLibraryVersion, dropBlueprints, shownBlueprints, watchBlueprintLibrary } from '../../../editor/editing/blueprint';
import type { BlueprintRecord } from '../../../io/blueprint';
import { blueprintEditor } from '../../spec/blueprints/_blueprints';

const { lib, toasts, action } = blueprintEditor();

const BODY = { w: 3, h: 2, cells: Array(6).fill(null), objects: [] } as unknown as BlueprintRecord['body'];

const record = (id: string, name: string, folder: string | null, savedAt: number): BlueprintRecord => ({
  id, name, folder, author: null, origin: null, savedAt, appVersion: '0', body: BODY, thumbs: { flat: '', lifted: '' },
});

/** A carry to the map that writes down how it ended. */
function mapCarry() {
  const ended: string[] = [];
  return { ended, end: { cancel: () => { ended.push('cancel'); }, release: () => { ended.push('release'); } } };
}

const order = () => lib().records().map((r) => r.id);
/** The order every reader of the library shows. */
const shownOrder = () => shownBlueprints().map((r) => r.id);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  await lib().save(record('a', 'Harbour', 'Docks', 4));
  await lib().save(record('b', 'Garden corner', null, 3));
  await lib().save(record('c', 'Pier', 'Docks', 2));
  lib().addFolder('Gardens');
});

describe('dropping carried blueprints', () => {
  it('files them in the folder dropped on and says so, giving up the carry to the map', async () => {
    const carry = mapCarry();
    expect(dropBlueprints(['b'], { on: 'folder', folder: 'Gardens' }, carry.end)).toBeNull();
    await settled();
    expect(lib().records().find((r) => r.id === 'b')?.folder).toBe('Gardens');
    expect(carry.ended).toEqual(['cancel']);
    expect(toasts()).toHaveLength(1);
  });

  it('deletes them on the delete target with an Undo that stores them back', async () => {
    expect(dropBlueprints(['a', 'c'], { on: 'bin' }, null)).toBeNull();
    await settled();
    expect(order()).toEqual(['b']);
    action()!.run();
    await settled();
    expect(order().sort()).toEqual(['a', 'b', 'c']);
  });

  it('moves them among the cards to the slot let go in, the order shown at once and then kept by the library', async () => {
    const carry = mapCarry();
    const told: number[] = [];
    const stop = watchBlueprintLibrary(() => { told.push(blueprintLibraryVersion()); });
    const moved = dropBlueprints(['c'], { on: 'cards', ids: ['a', 'b', 'c'], at: 0 }, carry.end);
    // Shown and told within the release, before the library has written it.
    expect(shownOrder()).toEqual(['c', 'a', 'b']);
    expect(told).toHaveLength(1);
    expect(await moved?.written).toBe(true);
    stop();
    expect(order()).toEqual(['c', 'a', 'b']);
    expect(shownOrder()).toEqual(['c', 'a', 'b']);
    expect(new Set(told).size).toBe(told.length);
    expect(carry.ended).toEqual(['cancel']);
  });

  it('moves them by the cards a folder shows, keeping the rest of the library around them', async () => {
    const moved = dropBlueprints(['c'], { on: 'cards', ids: ['a', 'c'], at: 0 }, null);
    expect(shownOrder()).toEqual(['c', 'a', 'b']);
    await moved?.written;
    expect(order()).toEqual(['c', 'a', 'b']);
  });

  it('shows two moves let go one after the other in the order both leave, while the library writes them', async () => {
    const first = dropBlueprints(['c'], { on: 'cards', ids: ['a', 'b', 'c'], at: 0 }, null);
    const second = dropBlueprints(['a'], { on: 'cards', ids: shownOrder(), at: 3 }, null);
    expect(shownOrder()).toEqual(['c', 'b', 'a']);
    await first?.written;
    expect(shownOrder()).toEqual(['c', 'b', 'a']);
    await second?.written;
    expect(order()).toEqual(['c', 'b', 'a']);
    expect(shownOrder()).toEqual(['c', 'b', 'a']);
  });

  it('hands the carry its own release where the cards would not move, or anywhere else', async () => {
    const among = mapCarry();
    expect(dropBlueprints(['b'], { on: 'cards', ids: ['a', 'b', 'c'], at: 2 }, among.end)).toBeNull();
    expect(among.ended).toEqual(['release']);
    const elsewhere = mapCarry();
    expect(dropBlueprints(['b'], { on: 'elsewhere' }, elsewhere.end)).toBeNull();
    expect(elsewhere.ended).toEqual(['release']);
    await settled();
    expect(order()).toEqual(['a', 'b', 'c']);
  });
});
