import { describe, expect, it } from 'vitest';
import { STORAGE_NAMES } from '../_support/storage-names';
import { LEGAL } from '../../legal/config';
import { docBody } from '../../legal/registry';

describe('public privacy documentation boundary', () => {
  it('describes stored data without exposing implementation key names', () => {
    for (const language of ['en', 'zh'] as const) {
      const privacy = docBody('privacy', language, LEGAL);
      for (const key of STORAGE_NAMES) expect(privacy, `${language}: ${key}`).not.toContain(key);
    }
  });
});
