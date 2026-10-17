import { describe, expect, it } from 'vitest';
import { localizedName, translateFor } from '../../i18n/context';
import { landmarkItem } from '../../state/catalog';
import { LOCALES } from '../../core/model/locale';
import { brandName, GLYPH_NAME } from '../../i18n/terms/brand';


describe('translator-filled tokens', () => {
  it.each(LOCALES)('{landmark} becomes the landmark catalog name in %s', (locale) => {
    const text = translateFor(locale, 'agent.sketch_lane_order', { dir: 'north' });
    expect(text).toContain(localizedName(landmarkItem().name, locale));
    expect(text).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
  });

  it.each(LOCALES)('names the app and its map code from terms/brand.ts in %s', (locale) => {
    expect(translateFor(locale, 'app.name')).toBe(brandName(locale));
    expect(translateFor(locale, 'export.code_failed')).toContain(GLYPH_NAME);
  });
});
