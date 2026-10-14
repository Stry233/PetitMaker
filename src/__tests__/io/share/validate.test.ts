import { describe, it, expect } from 'vitest';
import { importDriftWarnings } from '../../../io/share/validate';
import { getMapTemplate } from '../../../config/maps';
import { templateHash, catalogHash } from '../../../io/save/canonical';
import { planetFixture } from '../../_support/planet';

describe('importDriftWarnings', () => {
  const builtIn = getMapTemplate('hexia');

  it('reports nothing when the code was made by this build', () => {
    expect(importDriftWarnings(builtIn, { templateHash: templateHash(builtIn), catalogHash: catalogHash() })).toEqual([]);
  });
  it('warns on built-in template drift', () => {
    expect(importDriftWarnings(builtIn, { templateHash: (templateHash(builtIn) ^ 1) >>> 0, catalogHash: catalogHash() }))
      .toEqual([{ kind: 'template-drift' }]);
  });
  it('warns on catalog drift', () => {
    expect(importDriftWarnings(builtIn, { templateHash: templateHash(builtIn), catalogHash: (catalogHash() ^ 0xffff) >>> 0 }))
      .toEqual([{ kind: 'catalog-drift' }]);
  });
  it('never reports template drift for a carried planet', () => {
    expect(importDriftWarnings(planetFixture(), { templateHash: 0, catalogHash: catalogHash() })).toEqual([]);
  });
});
