/**
 * The generate commands over the live map: a card of the open shelf's batch lands by its place in
 * the row as one undo step, and Clear takes what the run built back off the map.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCommand } from '../../../editor/commands/run';
import { createGenerateBatch } from '../../../editor/editing/generate-batch';
import { createGenerateRecipe } from '../../../editor/editing/generate-recipe';
import { serialize } from '../../../io/save/json-codec';
import { createDefaultRegistry } from '../../../rules';
import { useEditorStore } from '../../../state/store';
import { CANDIDATES } from '../../../tools/generation/facts';
import { makeTemplate } from '../../_support/map-state';

const s = () => useEditorStore.getState();

/** The map by value without object ids, which are minted per placement. */
function mapValue(): string {
  const parsed = JSON.parse(serialize(s().gridState!));
  return JSON.stringify({ cells: parsed.cells, objects: (parsed.objects as Record<string, unknown>[]).map(({ id: _id, ...rest }) => rest) });
}

let putAway = (): void => {};

/** The shelf's sessions as it opens them at the maze, whose cards are recipe numbers. */
function openShelf(): void {
  const recipe = createGenerateRecipe(['maze'], 'maze', { richness: 50, corridorWidth: 1, contrast: 100 });
  const batch = createGenerateBatch({ shotSize: { px: 64, aspect: 1 }, failedMs: 4000, recipe });
  const takeDown = batch.show();
  putAway = () => { takeDown(); batch.dispose(); };
}

beforeEach(() => {
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
});

afterEach(() => {
  putAway();
  putAway = () => {};
});

describe('the generate commands', () => {
  it('land a card of the open shelf as one undo step', async () => {
    const empty = mapValue();
    openShelf();
    expect(await runCommand('generate.land', { card: 2 })).toMatchObject({ ok: true });
    expect(mapValue(), 'the maze stands on the map').not.toBe(empty);
    expect(s().generateApplied?.card).toBe(2);
    expect(await runCommand('history.undo')).toMatchObject({ ok: true });
    expect(mapValue()).toBe(empty);
  });

  it('clear what the landed run built', async () => {
    const empty = mapValue();
    openShelf();
    await runCommand('generate.land', { card: 0 });
    expect(mapValue()).not.toBe(empty);
    expect(await runCommand('generate.clear')).toMatchObject({ ok: true });
    expect(mapValue()).toBe(empty);
    expect(s().generateApplied, 'the card no longer stands as the landed one').toBeNull();
  });

  it('refuse a card with no shelf open, and a place the row does not have', async () => {
    const empty = mapValue();
    expect(await runCommand('generate.land', { card: 0 })).toMatchObject({ ok: false, reason: expect.stringContaining('not open') });
    openShelf();
    expect(await runCommand('generate.land', { card: CANDIDATES + 1 })).toMatchObject({ ok: false });
    expect(await runCommand('generate.land', { card: CANDIDATES }), 'the own card has no recipe yet').toMatchObject({ ok: false });
    expect(mapValue()).toBe(empty);
  });
});
