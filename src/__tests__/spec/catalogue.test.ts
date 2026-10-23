/**
 * The specification's own shape: every requirement has one id of its area, every rule the editor
 * enforces has its requirement, and a test cites only requirements that exist and still hold.
 * Uncovered requirements never fail a run; `npm run spec:report` lists them.
 */
import { describe, it, expect } from 'vitest';
import { createDefaultRegistry, createPlanetRegistry } from '../../rules';
import { AREAS, citations, citedIds, readCatalogue } from '../_support/spec-catalogue';

describe('the behaviour specification', () => {
  const { requirements, problems } = readCatalogue();

  it('gives every requirement one well-formed id of its area', () => {
    expect(problems).toEqual([]);
    expect(requirements.size).toBeGreaterThan(0);
  });

  it('states a requirement for every rule the editor enforces', () => {
    const enforced = new Set([...createDefaultRegistry().getRules(), ...createPlanetRegistry().getRules()].map((r) => r.id));
    expect([...enforced].filter((id) => requirements.get(id)?.area !== 'rules')).toEqual([]);
    const stated = [...requirements.values()].filter((r) => r.area === 'rules' && !r.retired).map((r) => r.id);
    expect(stated.filter((id) => !enforced.has(id))).toEqual([]);
  });

  it('is cited only by id it states and has not retired', () => {
    const wrong = [...citations()].filter(([id]) => !requirements.has(id) || requirements.get(id)!.retired)
      .map(([id, files]) => `${id} in ${files.join(', ')}`);
    expect(wrong).toEqual([]);
  });
});

describe('reading citations', () => {
  // Built at run time, so this file's own source cites nothing.
  const call = (head: string, ids: string, rest: string): string => `${head}('[${ids}] ${rest}', fn)`;

  it('reads a bracketed id list opening a test title and the spec helper', () => {
    expect(citedIds(call('it', 'AREA-01', 'one'))).toEqual(['AREA-01']);
    expect(citedIds(call('test', 'V-RULE-ID, AREA-02', 'two'))).toEqual(['V-RULE-ID', 'AREA-02']);
    expect(citedIds(call('it.each(rows)', 'AREA-03', 'each %s'))).toEqual(['AREA-03']);
    expect(citedIds(`${'spec'}('AREA-04', 'helper', fn)`)).toEqual(['AREA-04']);
  });

  it('ignores brackets that do not open a title', () => {
    expect(citedIds(`it('keeps [${'AREA-01'}] in the middle', fn)`)).toEqual([]);
    expect(citedIds(`const x = '[${'AREA-01'}]'`)).toEqual([]);
  });

  it('knows an id grammar for every area', () => {
    expect(Object.keys(AREAS).sort()).toEqual(['assistant', 'editing', 'files', 'generation', 'interface', 'planets', 'rules']);
  });
});
