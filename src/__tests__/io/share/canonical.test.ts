import { describe, it, expect } from 'vitest';
import { canonicalize, canonicalBytes, toSaveJSON, templateHash, catalogHash } from '../../../io/share/canonical';
import { deserialize } from '../../../io/json-codec';
import { getMapTemplate } from '../../../config/maps';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';

function loadFixture() {
  const raw = readFileSync('src/__tests__/io/__fixtures__/petit-planet-hexia-1782022830197.json', 'utf8');
  const id = (JSON.parse(raw) as { templateId?: string }).templateId;
  return deserialize(raw, getMapTemplate(id));
}

describe('canonicalize', () => {
  it('is deterministic — same state → identical canonical bytes', () => {
    const s = loadFixture();
    expect(canonicalBytes(canonicalize(s))).toEqual(canonicalBytes(canonicalize(s)));
  });
  it('round-trips through deserialize and re-canonicalizes identically (exactness anchor)', () => {
    const s = loadFixture();
    const c = canonicalize(s);
    const reloaded = deserialize(toSaveJSON(c), getMapTemplate(c.templateId));
    expect(canonicalBytes(canonicalize(reloaded))).toEqual(canonicalBytes(c));
  });
  it('normalizes object ids to o0,o1,... in sorted order', () => {
    const c = canonicalize(loadFixture());
    c.objects.forEach((o, i) => expect(o.id).toBe(`o${i}`));
  });
  it('templateHash and catalogHash are stable u32', () => {
    const t = getMapTemplate('hexia');
    expect(templateHash(t)).toBe(templateHash(t));
    expect(catalogHash()).toBe(catalogHash());
    expect(templateHash(t)).toBeLessThanOrEqual(0xffffffff);
  });
});
