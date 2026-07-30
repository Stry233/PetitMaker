import { describe, it, expect } from 'vitest';
import { validateImportedState, type ImportedStateInfo } from '../../../io/share/validate';
import { deserialize } from '../../../io/json-codec';
import { getMapTemplate } from '../../../config/maps';
import { templateHash, catalogHash } from '../../../io/share/canonical';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';

function fixtureAndInfo() {
  const raw = readFileSync('src/__tests__/io/__fixtures__/petit-planet-hexia-1782022830197.json', 'utf8');
  const tmpl = getMapTemplate((JSON.parse(raw) as { templateId?: string }).templateId);
  const state = deserialize(raw, tmpl);
  const info: ImportedStateInfo = { templateId: tmpl.id, templateHash: templateHash(tmpl), catalogHash: catalogHash() };
  return { state, info };
}

describe('validateImportedState', () => {
  it('accepts a clean map with no warnings', () => {
    const { state, info } = fixtureAndInfo();
    expect(validateImportedState(state, info).warnings).toEqual([]);
  });
  it('rejects an out-of-range object coordinate', () => {
    const { state, info } = fixtureAndInfo();
    const obj = [...state.objects.values()].find((o) => !o.locked);
    if (obj) { obj.position.x = 99999; expect(() => validateImportedState(state, info)).toThrow(); }
  });
  it('rejects an unknown catalog id', () => {
    const { state, info } = fixtureAndInfo();
    const obj = [...state.objects.values()].find((o) => !o.locked);
    if (obj) { obj.catalogId = 'definitely-not-real'; expect(() => validateImportedState(state, info)).toThrow(); }
  });
  it('warns (does not throw) on catalog-hash drift', () => {
    const { state, info } = fixtureAndInfo();
    info.catalogHash = (info.catalogHash ^ 0xffff) >>> 0;
    expect(validateImportedState(state, info).warnings).toContain('catalog-drift');
  });
  it('rejects a template-id that does not exist', () => {
    const { state, info } = fixtureAndInfo();
    info.templateId = 'no-such-template';
    expect(() => validateImportedState(state, info)).toThrow();
  });
});
