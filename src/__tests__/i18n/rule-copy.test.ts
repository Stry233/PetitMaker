import { describe, expect, it } from 'vitest';
import { translateFor } from '../../i18n/context';
import { ruleToast } from '../../i18n/rule-copy';
import type { Locale } from '../../core/model/types';

const tFor = (locale: Locale) => (key: string, params?: Record<string, string | number>) => translateFor(locale, key, params);

describe('rule refusal copy', () => {
  it('leads a toast with the category in each locale’s own punctuation', () => {
    expect(ruleToast(tFor('en'), 'error.zone_restricted')).toBe('Placement: zone is not buildable');
    expect(ruleToast(tFor('fr'), 'error.layer_locked')).toBe('Calque : ce calque est verrouillé');
    expect(ruleToast(tFor('zh'), 'error.elevation_limit', { max: 8 })).toBe('高度：最大为8层');
  });

  it('keeps the reason free of its category', () => {
    expect(translateFor('en', 'error.zone_restricted')).toBe('zone is not buildable');
    expect(translateFor('ja', 'error.object_overlap')).toBe('既存のオブジェクトと重なっています');
  });

  it('says a message without a category as it is', () => {
    expect(ruleToast(tFor('en'), 'error.unknown')).toBe('unknown error');
  });
});
