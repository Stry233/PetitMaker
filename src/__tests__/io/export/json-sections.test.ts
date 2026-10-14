/** The save file's section choices: their defaults, the switches, the size estimate and the serializer options. */
import { describe, it, expect } from 'vitest';
import { estimatedTotal, exportOptionsFor, initialSections, measuringOptions, sectionsReducer, RECENT_HISTORY_STEPS } from '../../../io/export/json-sections';
import type { SectionSizes } from '../../../io/save/sections';

const SIZES: SectionSizes = {
  core: 100, annotations: 10, notes: 0, generation: 20, provenance: 30, history: 400, session: 5, stats: 6, catalog: 7, manifest: 1,
};
const NONE = { generation: false, provenance: false };
const BOTH = { generation: true, provenance: true };

describe('the save file sections', () => {
  it('open with annotations in, and generation and provenance only where the map has them', () => {
    expect(initialSections(NONE)).toMatchObject({ annotations: true, notes: false, generation: false, provenance: false, history: false, pretty: false, historyDepth: 'all' });
    expect(initialSections(BOTH)).toMatchObject({ generation: true, provenance: true });
  });

  it('sum the carried sections, counting a choice the map cannot honour as off', () => {
    const sections = sectionsReducer(sectionsReducer(initialSections(NONE), { type: 'toggle', key: 'history' }), { type: 'set', key: 'generation', on: true });
    expect(estimatedTotal(SIZES, sections, NONE, 3)).toBe(100 + 1 + 3 + 10 + 400);
    expect(estimatedTotal(SIZES, sections, BOTH, 3)).toBe(100 + 1 + 3 + 10 + 400 + 20);
  });

  it('read the history and session only for sections that travel', () => {
    let read = 0;
    const sections = sectionsReducer(sectionsReducer(initialSections(BOTH), { type: 'toggle', key: 'history' }), { type: 'depth', depth: 'recent' });
    const opts = exportOptionsFor(sections, BOTH, { title: 'Bay' }, { history: () => { read++; return []; }, session: () => { read += 10; return { lockedLayers: [] }; } });
    expect(read).toBe(1);
    expect(opts).toMatchObject({
      carry: { annotations: true, notes: false, generation: true, provenance: true, history: true, session: false, stats: false, catalog: false },
      history: { depth: RECENT_HISTORY_STEPS },
    });
    expect(opts).not.toHaveProperty('notes');
    expect(opts).not.toHaveProperty('session');
  });

  it('carry the notes only when they are switched on and given', () => {
    const notesOn = sectionsReducer(initialSections(NONE), { type: 'toggle', key: 'notes' });
    const read = { history: () => [], session: () => ({ lockedLayers: [] }) };
    expect(exportOptionsFor(notesOn, NONE, { title: 'Bay' }, read)).toMatchObject({ carry: { notes: true }, notes: { title: 'Bay' } });
    expect(exportOptionsFor(notesOn, NONE, null, read).carry.notes).toBe(false);
  });

  it('measure every section but the live-measured notes', () => {
    const opts = measuringOptions(undefined, { lockedLayers: [1] });
    expect(opts.carry).toEqual({
      annotations: true, notes: false, generation: true, provenance: true, history: true, session: true, stats: true, catalog: true,
    });
    expect(opts).toMatchObject({ session: { lockedLayers: [1] }, pretty: false });
    expect(opts).not.toHaveProperty('history');
  });
});
