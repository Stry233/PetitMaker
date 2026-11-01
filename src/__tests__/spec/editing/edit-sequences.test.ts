/** Random editing sessions mixing every gesture with undo and redo, each replayed from its seed
 *  (`_sequences.ts`): a failure prints the seed and a shrunk step list. */
import { describe, expect } from 'vitest';
import { MAP_LIST } from '../../../config/maps';
import { declareSessionProperty, sessionProperties } from './_sequences';

describe('random editing sessions', () => {
  sessionProperties({ firstSeed: 1, count: 20, length: 25, templates: MAP_LIST.map((m) => m.id) }, (property, failures) => {
    declareSessionProperty(property, () => { expect(failures().join('\n\n')).toBe(''); });
  });
});
