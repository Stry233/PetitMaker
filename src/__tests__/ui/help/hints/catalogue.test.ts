import { describe, expect, it } from 'vitest';
import { resolveTokenSpecs, type TokenSpec } from '../../../../ui/help/hints/catalogue';
import { effectiveCombo } from '../../../../state/keymap/resolve';
import { prettyCombo } from '../../../../platform/input/combo';

const cmd = (id: string, o?: { held?: boolean }): TokenSpec => ({ kind: 'cmd', id, ...o });
const PAN_ROW: TokenSpec[] = [{ kind: 'mouse', button: 'right', mark: 'drag' }, { kind: 'sep', sep: 'or' }, { kind: 'pan-keys' }];

describe('token resolution against the live keymap', () => {
  it('renders keys from the live bindings', () => {
    // Brush sizing has no default key under the game layout, so this exercises the override path.
    expect(resolveTokenSpecs([cmd('brush.smaller'), cmd('brush.bigger')], { 'brush.smaller': '[', 'brush.bigger': ']' })).toEqual([
      { kind: 'cap', label: '[' },
      { kind: 'cap', label: ']' },
    ]);
  });

  // The two move caps are one token, stacked by the renderer, so a map row keeps to one line.
  it('carries a rebind into the stacked pan token', () => {
    const tokens = resolveTokenSpecs(PAN_ROW, { 'camera.pan_up': 'i', 'camera.pan_left': 'j', 'camera.pan_down': 'k', 'camera.pan_right': 'l' })!;
    expect(tokens.some((t) => t.kind === 'pan-stack' && t.letters === 'IJKL')).toBe(true);
    // One token, not a cap beside an alias cap: nothing else in the row is a plain cap.
    expect(tokens.filter((t) => t.kind === 'cap')).toEqual([]);
  });

  it('drops the whole row when its pan key is unbound', () => {
    expect(resolveTokenSpecs(PAN_ROW, { 'camera.pan_left': null })).toBeNull();
  });

  it('drops the whole row when none of its commands is bound', () => {
    expect(resolveTokenSpecs([cmd('brush.smaller'), cmd('brush.bigger')], { 'brush.bigger': null })).toBeNull();
  });

  it('keeps the bound half of a pair whose other half is unbound', () => {
    // rotate_ccw has no default combo under the game keymap; the row keeps its bound half rather
    // than go down with its unbound sibling.
    const cw = effectiveCombo({}, 'selection.rotate_cw');
    expect(cw).not.toBeNull();
    expect(resolveTokenSpecs([cmd('selection.rotate_cw'), cmd('selection.rotate_ccw')], {})).toEqual([{ kind: 'cap', label: prettyCombo(cw) }]);
  });

  it('strips a separator its dropped neighbour leaves dangling', () => {
    expect(resolveTokenSpecs([cmd('selection.rotate_cw'), { kind: 'sep', sep: 'or' }, cmd('selection.rotate_ccw')], {}))
      .toEqual([{ kind: 'cap', label: prettyCombo(effectiveCombo({}, 'selection.rotate_cw')) }]);
  });

  it('renders only the held key segment of a held modifier', () => {
    const tokens = resolveTokenSpecs([cmd('selection.multi', { held: true }), { kind: 'sep', sep: 'plus' }, { kind: 'mouse', button: 'left', mark: 'drag' }], { 'selection.multi': 'ctrl+m' })!;
    expect(tokens[0]).toEqual({ kind: 'cap', label: 'M' });
  });

  it('renders every segment of a multi-segment discrete combo, joined by plus', () => {
    expect(resolveTokenSpecs([cmd('history.undo')], {})).toEqual([
      { kind: 'cap', label: 'Ctrl' },
      { kind: 'sep', sep: 'plus' },
      { kind: 'cap', label: 'Z' },
    ]);
  });

  it('keeps a row that carries no tokens', () => {
    expect(resolveTokenSpecs([], {})).toEqual([]);
  });
});
