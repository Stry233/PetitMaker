import { describe, it } from 'vitest';
import { LEGAL } from '../../legal/config';
import { assertDocParity } from './parity-helpers';

// Translation parity. The generic helper in
// parity-helpers.ts is shared across docs — this file grows a case per
// bilingual authored doc as they are written.
describe('translation parity — bilingual legal docs', () => {
  it('privacy: en and zh are material equivalents', () => {
    assertDocParity('privacy', LEGAL);
  });

  it('terms: en and zh are material equivalents', () => {
    assertDocParity('terms', LEGAL);
  });

  it('about: en and zh are material equivalents', () => {
    assertDocParity('about', LEGAL);
  });

  it('contact: en and zh are material equivalents', () => {
    assertDocParity('contact', LEGAL);
  });
});
