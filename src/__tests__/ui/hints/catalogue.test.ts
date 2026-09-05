import { describe, expect, it } from 'vitest';
import { COMMAND_BY_ID } from '../../../kit/commands';
import { translations } from '../../../i18n/translations';
import { rowsFor, SCENARIO_ROWS } from '../../../ui/hints/catalogue';
import { effectiveCombo, prettyCombo } from '../../../core/runtime/keybindings';
import type { CameraCaps } from '../../../core/interaction/camera-verbs';

const CAPS_2D: CameraCaps = { canOrbit: false, wheelZooms: true };
const CAPS_3D: CameraCaps = { canOrbit: true, wheelZooms: true };
const en = translations.en;

describe('hint catalogue', () => {
  it('every cmd token names a registered command', () => {
    for (const rows of Object.values(SCENARIO_ROWS)) {
      for (const row of rows) {
        for (const t of row.tokens) {
          if (t.kind === 'cmd') expect(COMMAND_BY_ID.has(t.id), t.id).toBe(true);
        }
      }
    }
  });

  it('every text key exists in the en locale, camera keys included', () => {
    for (const rows of Object.values(SCENARIO_ROWS)) {
      for (const row of rows) {
        if (row.textKey) expect(en[row.textKey], row.textKey).toBeTruthy();
      }
    }
    for (const key of ['hint.camera.pan', 'hint.camera.orbit', 'hint.camera.dolly', 'hint.camera.yaw']) {
      expect(en[key]).toBeTruthy();
    }
  });

  it('every scenario yields rows under the default bindings', () => {
    for (const id of Object.keys(SCENARIO_ROWS) as (keyof typeof SCENARIO_ROWS)[]) {
      const caps = id === 'map-3d' ? CAPS_3D : CAPS_2D;
      expect(rowsFor(id, {}, caps, 'full').length, id).toBeGreaterThan(0);
    }
  });

  it('keys render from the live bindings', () => {
    // Brush sizing has no default key under the game layout, so this exercises the override path.
    const rows = rowsFor('build', { 'brush.smaller': '[', 'brush.bigger': ']' }, CAPS_2D, 'full');
    const size = rows.find((r) => r.textKey === 'hint.build.size')!;
    expect(size.tokens).toEqual([
      { kind: 'cap', label: '[' },
      { kind: 'cap', label: ']' },
    ]);
  });

  // The two move caps are ONE token, stacked by the renderer, so a map row keeps to one line.
  it('a rebind reaches the caps and the stacked pan token', () => {
    const rows = rowsFor('map-2d', { 'camera.pan_up': 'i', 'camera.pan_left': 'j', 'camera.pan_down': 'k', 'camera.pan_right': 'l' }, CAPS_2D, 'full');
    const move = rows[0]!;
    expect(move.tokens.some((t) => t.kind === 'pan-stack' && t.letters === 'IJKL')).toBe(true);
    // One token, not a cap beside an alias cap: nothing else in the row is a plain cap.
    expect(move.tokens.filter((t) => t.kind === 'cap')).toEqual([]);
  });

  it('an unbound pan key drops the whole row', () => {
    const rows = rowsFor('map-2d', { 'camera.pan_left': null }, CAPS_2D, 'full');
    expect(rows.some((r) => r.textKey === 'hint.camera.pan')).toBe(false);
  });

  it('an unbound command drops its whole row', () => {
    const rows = rowsFor('build', { 'brush.bigger': null }, CAPS_2D, 'full');
    expect(rows.some((r) => r.textKey === 'hint.build.size')).toBe(false);
  });

  it('the rotate row survives under the default keymap even though only cw is bound', () => {
    // rotate_ccw has no default combo under the game keymap; the row must keep its bound half
    // rather than go down with its unbound sibling.
    const rows = rowsFor('placer', {}, CAPS_2D, 'full');
    const rotate = rows.find((r) => r.textKey === 'hint.placer.rotate');
    expect(rotate).toBeDefined();
    const cw = effectiveCombo({}, 'selection.rotate_cw');
    expect(cw).not.toBeNull();
    expect(rotate!.tokens).toEqual([{ kind: 'cap', label: prettyCombo(cw) }]);
  });

  it('a held modifier renders only its held key segment', () => {
    const rows = rowsFor('build', { 'selection.multi': 'ctrl+m' }, CAPS_2D, 'full');
    const sel = rows.find((r) => r.textKey === 'hint.build.select')!;
    expect(sel.tokens[0]).toEqual({ kind: 'cap', label: 'M' });
  });

  it('a multi-segment discrete combo renders every segment joined by plus', () => {
    const rows = rowsFor('region', {}, CAPS_2D, 'full');
    const undo = rows.find((r) => r.textKey === 'hint.region.undo')!;
    expect(undo.tokens).toEqual([
      { kind: 'cap', label: 'Ctrl' },
      { kind: 'sep', sep: 'plus' },
      { kind: 'cap', label: 'Z' },
    ]);
  });

  it('camera rows speak the verbs of the caps they are given', () => {
    const drag2d = rowsFor('map-2d', {}, CAPS_2D, 'full')[0]!;
    expect(drag2d.textKey).toBe('hint.camera.pan');
    const rows3d = rowsFor('map-3d', {}, CAPS_3D, 'full');
    expect(rows3d[0]!.textKey).toBe('hint.camera.orbit');
    expect(rows3d.some((r) => r.textKey === 'hint.camera.dolly')).toBe(true);
    expect(rows3d.some((r) => r.textKey === 'hint.camera.yaw')).toBe(true);
  });

  it('a 2d camera cannot yaw, so the yaw row never appears there', () => {
    const rows = rowsFor('map-3d', {}, CAPS_2D, 'full');
    expect(rows.some((r) => r.textKey === 'hint.camera.yaw')).toBe(false);
  });

  it('concise keeps the top three of the same list', () => {
    const full = rowsFor('map-2d', {}, CAPS_2D, 'full');
    const concise = rowsFor('map-2d', {}, CAPS_2D, 'concise');
    expect(concise).toEqual(full.slice(0, 3));
  });

  it('a fact row carries no tokens and survives resolution', () => {
    const rows = rowsFor('span-placer', {}, CAPS_2D, 'full');
    const auto = rows.find((r) => r.textKey === 'hint.span.auto')!;
    expect(auto.tokens).toEqual([]);
  });
});
