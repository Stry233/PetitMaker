/** Many more and longer random editing sessions than the fast tier's, on seeds of their own
 *  (`_sequences.ts`): a failure prints the seed and a shrunk step list. */
import { describe, expect } from 'vitest';
import { MAP_LIST } from '../../../config/maps';
import { declareSessionProperty, sessionProperties } from './_sequences';

describe('random editing sessions, many seeds', () => {
  sessionProperties({ firstSeed: 1000, count: 240, length: 40, templates: MAP_LIST.map((m) => m.id) }, (property, failures) => {
    declareSessionProperty(property, () => { expect(failures().join('\n\n')).toBe(''); }, 600_000);
  });
});
