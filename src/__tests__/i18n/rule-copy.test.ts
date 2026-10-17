import { describe, expect, it } from 'vitest';
import { translateFor, translatorFor } from '../../i18n/context';
import { ruleReason, ruleToast } from '../../i18n/terms/rule-copy';
import type { Locale } from '../../core/model/locale';
import type { TextKey } from '../../i18n/keys';
import { ELEVATION_MAX, layerNumber } from '../../core/game/profile';

const tFor = (locale: Locale) => (key: TextKey, params?: Record<string, string | number>) => translateFor(locale, key, params);

describe('rule refusal copy', () => {
  it('leads a toast with the category in each locale’s own punctuation', () => {
    expect(ruleToast(tFor('en'), 'error.zone_restricted')).toBe('Placement: zone is not buildable');
    expect(ruleToast(tFor('fr'), 'error.layer_locked')).toBe('Calque : ce calque est verrouillé');
    expect(ruleToast(tFor('zh'), 'error.elevation_limit', { max: layerNumber(ELEVATION_MAX) })).toBe(`高度：最高为第 ${layerNumber(ELEVATION_MAX)} 层`);
  });

  it('writes a refusal\'s quantities in the translator\'s own number format', () => {
    expect(ruleReason(translatorFor('fr'), 'error.chunk_full', { max: 12000 })).toContain('12\u202f000');
    expect(ruleToast(translatorFor('en'), 'error.chunk_full', { max: 12000 })).toContain('12,000');
    // A bare stub carries no locale and leaves the numbers as written.
    expect(ruleReason(tFor('en'), 'error.chunk_full', { max: 12000 })).toContain('12000');
  });

  it('keeps the reason free of its category', () => {
    expect(translateFor('en', 'error.zone_restricted')).toBe('zone is not buildable');
    expect(translateFor('ja', 'error.object_overlap')).toBe('既存のオブジェクトと重なっています');
  });

  it('fills the ramp refusal with the height its trait asks for', () => {
    expect(translateFor('en', 'error.ramp_wrong_height', { n: 1 })).toContain('1');
  });

  it('says a message without a category as it is', () => {
    expect(ruleToast(tFor('en'), 'error.unknown')).toBe('unknown error');
  });
});
