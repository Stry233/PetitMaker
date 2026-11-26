import { describe, expect, it } from 'vitest';
import { listMove, movedBeside, movedTo, placeOf } from '../../../core/base/list-move';
import { makeRng, shuffled } from '../../../core/base/rng';

const LIST = ['a', 'b', 'c', 'd', 'e'];

describe('moving items of a list together', () => {
  it('sets the moving items down together at the slot, in the order they stood', () => {
    expect(movedTo(LIST, ['d', 'b'], 0)).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(movedTo(LIST, ['a'], 3)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(movedTo(LIST, ['a', 'c'], 5)).toEqual(['b', 'd', 'e', 'a', 'c']);
    expect(movedTo(LIST, ['z'], 2)).toEqual(LIST);
  });

  it('names the place by an item that stays: before the next one, else after the last before it', () => {
    expect(placeOf(LIST, ['a'], 3)).toEqual({ before: 'd' });
    expect(placeOf(LIST, ['d', 'e'], 4)).toEqual({ after: 'c' });
    expect(placeOf(['a', 'b'], ['a', 'b'], 1)).toBeNull();
  });

  it('reads a move that changes nothing as none', () => {
    expect(listMove(LIST, ['b'], 1)).toBeNull();
    expect(listMove(LIST, ['b'], 2)).toBeNull();
    expect(listMove(LIST, ['b', 'c'], 2)).toBeNull();
    expect(listMove(['a', 'b'], ['a', 'b'], 0)).toBeNull();
    expect(listMove(LIST, ['b'], 0)).toEqual({ order: ['b', 'a', 'c', 'd', 'e'], place: { before: 'a' } });
  });

  it('lands the order a slot shows wherever a list stores the move by its place', () => {
    const rng = makeRng(7);
    for (let trial = 0; trial < 500; trial++) {
      const list = shuffled(rng, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).slice(0, 1 + rng.int(8));
      const moving = shuffled(rng, list).slice(0, 1 + rng.int(list.length));
      const at = rng.int(list.length + 1);
      const move = listMove(list, moving, at);
      const shown = movedTo(list, moving, at);
      if (!move) { expect(shown).toEqual(list); continue; }
      expect(move.order).toEqual(shown);
      // The same move stored in a longer list, whose other items stand around it, keeps that order.
      const stored = movedBeside(['x', ...list, 'y'], moving, move.place);
      expect(stored.filter((id) => id !== 'x' && id !== 'y')).toEqual(shown);
      expect(stored.slice().sort()).toEqual(['x', ...list, 'y'].sort());
    }
  });

  it('sets the moving items down just before or just after the item named', () => {
    expect(movedBeside(LIST, ['e', 'a'], { before: 'c' })).toEqual(['b', 'a', 'e', 'c', 'd']);
    expect(movedBeside(LIST, ['b'], { after: 'e' })).toEqual(['a', 'c', 'd', 'e', 'b']);
  });
});
