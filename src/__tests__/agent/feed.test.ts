/**
 * Feed mapping (spec §5 "Mapping the loop to entries"): pure translation of
 * the existing tool surface into Site Log vocabulary — verb icons, palette
 * tiles (never blue), human ticket titles, ticks/steps from results, revert
 * copy that never leaks the raw REVERTED prefix, vitals bumps, and the
 * oversight gate matrix.
 */
import { describe, it, expect } from 'vitest';
import {
  verbIconFor, tileColorFor, ticketTitleFor, resultToTick, revertCopy,
  stepFromResult, vitalsDelta, shouldGate, WIDE_TOOLS, USER_SKIP,
} from '../../agent/feed';
import { translateFor } from '../../i18n/context';
import { translations } from '../../i18n/translations';
import type { Locale } from '../../core/model/types';

// The real table, so a key the panel asks for but no locale defines shows up here
// as the raw key rather than as copy.
const tr = (loc: Locale = 'en') => (k: string, p?: Record<string, string | number>) => translateFor(loc, k, p);
const en = tr();

describe('verbIconFor / tileColorFor', () => {
  it('maps tools onto the eight verb glyphs', () => {
    expect(verbIconFor('paint_terrain', { terrain: 'mountain' })).toBe('terrain');
    expect(verbIconFor('paint_terrain', { terrain: 'water' })).toBe('water');
    expect(verbIconFor('carve_river', {})).toBe('water');
    expect(verbIconFor('sculpt_terrace', {})).toBe('terrain');
    expect(verbIconFor('build_road', {})).toBe('road');
    expect(verbIconFor('build_road_network', {})).toBe('road');
    expect(verbIconFor('place_object', { catalogId: 'tree-pine' })).toBe('tree');
    expect(verbIconFor('place_object', { catalogId: 'flora-tulip' })).toBe('flower');
    expect(verbIconFor('place_object', { catalogId: 'building-mill' })).toBe('build');
    expect(verbIconFor('scatter_objects', { catalogIds: ['flora-a'] })).toBe('flower');
    expect(verbIconFor('evaluate_map', {})).toBe('eval');
    expect(verbIconFor('run_generator', {})).toBe('plan');
    expect(verbIconFor('decorate_zone', {})).toBe('build');
  });
  it('tiles come from the cozy palette and never use blue', () => {
    for (const i of ['terrain', 'water', 'tree', 'road', 'build', 'flower', 'eval', 'plan'] as const) {
      expect(tileColorFor(i).toUpperCase()).not.toContain('B8E3F0');
    }
  });
});

describe('ticketTitleFor', () => {
  it('renders human copy, not tool names', () => {
    const t = ticketTitleFor({ name: 'paint_terrain', input: { terrain: 'water', elevation: 0, rect: { x1: 1, y1: 2, x2: 4, y2: 5 } } }, en);
    expect(t.title.toLowerCase()).toContain('water');
    expect(t.title).not.toContain('paint_terrain');
    expect(t.sub).toBeTruthy();
  });
  it('every title the tools can produce is real copy in every locale, not a bare key', () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [
      { name: 'paint_terrain', input: { terrain: 'water' } },
      { name: 'paint_terrain', input: { terrain: 'mountain' } },
      { name: 'erase_terrain', input: {} }, { name: 'sculpt_terrace', input: {} },
      { name: 'carve_river', input: {} }, { name: 'clear_area', input: {} },
      { name: 'build_road', input: {} }, { name: 'build_road_network', input: {} },
      { name: 'frame_crossing', input: {} },
      { name: 'place_object', input: { catalogId: 'building-mill' } },
      { name: 'place_object', input: {} },
      { name: 'remove_object', input: {} }, { name: 'rotate_object', input: {} },
      { name: 'scatter_objects', input: { count: 6 } }, { name: 'scatter_objects', input: {} },
      { name: 'plant_forest', input: {} },
      ...['orchard', 'farm', 'garden', 'hamlet', 'waterfront', 'peak', 'nonesuch']
        .map((theme) => ({ name: 'decorate_zone', input: { theme } })),
      { name: 'run_generator', input: {} }, { name: 'trim_corner', input: {} },
      { name: 'undo', input: {} }, { name: 'inspect_region', input: {} },
    ];
    for (const loc of Object.keys(translations) as Locale[]) {
      for (const call of calls) {
        expect({ loc, call: call.name, title: ticketTitleFor(call, tr(loc)).title })
          .not.toMatchObject({ title: expect.stringContaining('agent2.') });
      }
    }
  });
  it('the localized panel never borrows the English table', () => {
    const zh = ticketTitleFor({ name: 'build_road', input: {} }, tr('zh')).title;
    expect(zh).toBe('道路已铺设');
  });
});

describe('resultToTick / revertCopy / stepFromResult', () => {
  const name = 'paint_terrain';
  it('ok results tick green, reverted and errors tick amber', () => {
    expect(resultToTick(name, { isError: false, content: 'Painted.' }, {}, en).s).toBe('ok');
    expect(resultToTick(name, { isError: true, content: 'REVERTED: rolled back' }, {}, en).s).toBe('revert');
    expect(resultToTick(name, { isError: true, content: 'All commands rejected' }, {}, en).s).toBe('revert');
  });
  it('revertCopy is one short human sentence: no raw prefix, rule tag, or coordinates', () => {
    const c = revertCopy('REVERTED: the edit violated post-stroke rules and was rolled back. The map is unchanged.\n[V-WTR-02] Water: must be contained by mountains at (3,4). Hint: POST-CHECK, WHOLE-MAP — every water cell...', en);
    expect(c).toBe('Undid that: the water was not walled in on both sides.');
    expect(revertCopy('All commands rejected', en)).toBe('Undid that, trying another way.');
  });
  it('the model-facing rule text never reaches the card: no tag, coordinates, or Hint', () => {
    const raw = 'REVERTED: rolled back.\n[V-MTN-03] Base rule: need 3x3 support at (12,7) (9,4). Hint: POST-CHECK — build pyramids, not 1-wide towers.';
    for (const loc of Object.keys(translations) as Locale[]) {
      const c = revertCopy(raw, tr(loc));
      expect(c).not.toContain('V-MTN-03');
      expect(c).not.toContain('Hint');
      expect(c).not.toMatch(/\(\d+,\s*\d+\)/);
      expect(c).not.toContain('agent2.');
    }
  });
  it('every rule that can revert a stroke has its own reason in every locale', () => {
    const RULES = [
      'V-ZONE-01', 'V-MTN-01', 'V-MTN-02', 'V-MTN-03', 'V-WTR-01', 'V-WTR-02', 'V-WTR-03',
      'V-PLACE-TRAIT', 'V-PLACE-OVERLAP', 'V-PLACE-MAX', 'V-PLACE-BLOCK',
      'V-LOCK-01', 'V-LOCK-02', 'V-CHUNK-01',
    ];
    for (const loc of Object.keys(translations) as Locale[]) {
      const seen = new Set<string>();
      for (const id of RULES) {
        const c = revertCopy(`REVERTED:\n[${id}] whatever the model was told.`, tr(loc));
        expect({ loc, id, generic: c === tr(loc)('agent2.rv_generic') }).toMatchObject({ generic: false });
        seen.add(c);
      }
      expect({ loc, distinct: seen.size }).toEqual({ loc, distinct: RULES.length });
    }
  });
  it('a declined write reads as the user\'s choice, never as an undo the agent made', () => {
    expect(revertCopy(USER_SKIP, en)).toBe('Skipped at your request.');
    expect(resultToTick(name, { isError: true, content: USER_SKIP }, {}, en).t).toBe('Skipped');
  });
  it('steps summarize outcomes for the card back', () => {
    expect(stepFromResult(name, { isError: false, content: 'Painted water elev 0 on 38 cell(s).' }, {}, en).s).toBe('ok');
    expect(stepFromResult(name, { isError: true, content: 'REVERTED: x' }, {}, en).s).toBe('revert');
  });
});

describe('vitalsDelta', () => {
  it('bumps the matching vital on success only', () => {
    expect(vitalsDelta('carve_river', {}, true)).toEqual({ water: 1 });
    expect(vitalsDelta('carve_river', {}, false)).toEqual({});
    expect(vitalsDelta('place_object', { catalogId: 'tree-oak' }, true)).toEqual({ tree: 1 });
    expect(vitalsDelta('place_object', { catalogId: 'building-mill' }, true)).toEqual({ build: 1 });
    expect(vitalsDelta('scatter_objects', { catalogIds: ['flora-x'], count: 12 }, true)).toEqual({ flower: 12 });
    expect(vitalsDelta('inspect_region', {}, true)).toEqual({});
  });
});

describe('shouldGate (oversight matrix)', () => {
  it('strict gates every write tool unless Always was chosen', () => {
    expect(shouldGate('place_object', 'strict', { planApproved: false, allowAll: false })).toBe(true);
    expect(shouldGate('place_object', 'strict', { planApproved: false, allowAll: true })).toBe(false);
    expect(shouldGate('inspect_region', 'strict', { planApproved: false, allowAll: false })).toBe(false);
  });
  it('checkpoint gates only wide/destructive tools, and an approved plan covers them', () => {
    expect(shouldGate('place_object', 'checkpoint', { planApproved: false, allowAll: false })).toBe(false);
    for (const w of WIDE_TOOLS) {
      expect(shouldGate(w, 'checkpoint', { planApproved: false, allowAll: false })).toBe(true);
    }
    expect(shouldGate('clear_area', 'checkpoint', { planApproved: true, allowAll: false })).toBe(false);
    expect(shouldGate('run_generator', 'checkpoint', { planApproved: false, allowAll: true })).toBe(false);
  });
  it('yolo never gates', () => {
    expect(shouldGate('run_generator', 'yolo', { planApproved: false, allowAll: false })).toBe(false);
    expect(shouldGate('clear_area', 'yolo', { planApproved: false, allowAll: false })).toBe(false);
  });
});
