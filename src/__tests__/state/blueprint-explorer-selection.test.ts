import { describe, expect, it } from 'vitest';
import { boxBase, boxPicks, carriedWith, pressPicks, type ExplorerPicks, type ExplorerPress } from '../../state/blueprint-explorer-selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];

const press = (id: string, over: Partial<ExplorerPress> = {}): ExplorerPress => ({ id, toggle: false, extend: false, repeat: false, ...over });
const at = (over: Partial<ExplorerPicks> = {}): ExplorerPicks => ({ selected: [], order: ORDER, anchor: null, picking: false, touch: false, ...over });

/** Runs presses one after another as the explorer does, carrying the selection and the anchor. */
function run(presses: readonly ExplorerPress[], over: Partial<ExplorerPicks> = {}): { selected: readonly string[]; taken: string[] } {
  let state = at(over);
  const taken: string[] = [];
  for (const p of presses) {
    const out = pressPicks(p, state);
    if ('take' in out) taken.push(out.take);
    else state = { ...state, selected: out.select, anchor: out.anchor };
  }
  return { selected: state.selected, taken };
}

describe('picking blueprints in the explorer', () => {
  it('selects the one card pressed', () => {
    expect(run([press('b'), press('d')]).selected).toEqual(['d']);
  });

  it('toggles a card with Ctrl or Cmd, keeping the others', () => {
    expect(run([press('b'), press('d', { toggle: true }), press('a', { toggle: true })]).selected).toEqual(['b', 'd', 'a']);
    expect(run([press('b'), press('d', { toggle: true }), press('b', { toggle: true })]).selected).toEqual(['d']);
  });

  it('reaches with Shift from the last card pressed or toggled, in the order shown, either way', () => {
    expect(run([press('b'), press('d', { extend: true })]).selected).toEqual(['b', 'c', 'd']);
    expect(run([press('d'), press('a', { extend: true })]).selected).toEqual(['a', 'b', 'c', 'd']);
    expect(run([press('a'), press('e', { toggle: true }), press('c', { extend: true })]).selected).toEqual(['c', 'd', 'e']);
    // Shift keeps where it reaches from, so a second Shift press reaches from the same card.
    expect(run([press('b'), press('e', { extend: true }), press('c', { extend: true })]).selected).toEqual(['b', 'c']);
  });

  it('reads Shift with nothing pressed yet as a plain press', () => {
    expect(run([press('c', { extend: true })]).selected).toEqual(['c']);
  });

  it('follows the order the view shows, not the selection', () => {
    expect(run([press('e'), press('a', { extend: true })], { order: ['e', 'd', 'a', 'b', 'c'] }).selected).toEqual(['e', 'd', 'a']);
  });

  it('ignores Ctrl and Shift under touch, where a press selects one', () => {
    expect(run([press('b'), press('d', { toggle: true }), press('e', { extend: true })], { touch: true }).selected).toEqual(['e']);
  });

  it('toggles a card on each press while a finger picks, whatever is held', () => {
    expect(run([press('b'), press('d'), press('b', { extend: true })], { picking: true, touch: true }).selected).toEqual(['d']);
  });

  it('takes a card pressed again in quick succession, unless a key is held or a finger picks', () => {
    expect(run([press('b'), press('b', { repeat: true })]).taken).toEqual(['b']);
    expect(run([press('b'), press('b', { repeat: true, toggle: true })]).taken).toEqual([]);
    expect(run([press('b'), press('b', { repeat: true, extend: true })]).taken).toEqual([]);
    expect(run([press('b'), press('b', { repeat: true })], { picking: true }).taken).toEqual([]);
  });

  it('carries the whole selection from any card in it, else the card alone', () => {
    expect(carriedWith('b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(carriedWith('d', ['a', 'b', 'c'])).toEqual(['d']);
    expect(carriedWith('b', ['b'])).toEqual(['b']);
    expect(carriedWith('b', [])).toEqual(['b']);
  });

  it('selects what a box touches, added to the selection only when Ctrl or Cmd started it', () => {
    expect(boxPicks(boxBase(false, ['a', 'b']), ['b', 'c'])).toEqual(['b', 'c']);
    expect(boxPicks(boxBase(true, ['a', 'b']), ['c', 'b', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(boxPicks(boxBase(false, ['a']), [])).toEqual([]);
  });
});
