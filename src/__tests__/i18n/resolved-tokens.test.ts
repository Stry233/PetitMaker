import { describe, expect, it } from 'vitest';
import { localizedName, translateFor } from '../../i18n/context';
import { landmarkItem } from '../../state/catalog';
import type { Locale } from '../../core/model/types';

const LOCALES: readonly Locale[] = ['en', 'zh', 'ja', 'ru', 'th', 'id', 'fr'];

describe('translator-filled tokens', () => {
  it.each(LOCALES)('{landmark} becomes the landmark catalog name in %s', (locale) => {
    const text = translateFor(locale, 'agent3.sketch_lane_order', { dir: 'north' });
    expect(text).toContain(localizedName(landmarkItem().name, locale));
    expect(text).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
  });
});
