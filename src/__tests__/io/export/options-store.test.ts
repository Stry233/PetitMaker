import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS, openingExportOptions, rememberExportOptions } from '../../../io/export/options-store';
import { DEFAULT_FOOTER } from '../../../io/export/footer-template';
import { EXPORT_PRESETS, RESOLUTION_KEYS, type ExportOptions } from '../../../io/export/types';
import { PREFS } from '../../../platform/storage/prefs';

const base: ExportOptions = { title: 'My island', description: 'notes', preset: 'plain', showBadge: false, layerPreview: true, card3d: true, grid: false, footer: true, annotations: false, footerTemplate: 'made {date}', resolution: 'high' };

/** The window's opening options with `partial` remembered over the defaults. */
const opening = (partial: Partial<ExportOptions>): ExportOptions => ({ ...DEFAULT_EXPORT_OPTIONS, ...partial });

describe('the export window remembers its choices', () => {
  beforeEach(() => localStorage.clear());

  it('remembers nothing until something was chosen', () => {
    expect(openingExportOptions()).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it('remembers a change from what the window opened with, and nothing before one', () => {
    rememberExportOptions(base, base);
    expect(localStorage.getItem(PREFS.exportOptions.key)).toBeNull();
    rememberExportOptions({ ...base, title: 'Other' }, base);
    expect(localStorage.getItem(PREFS.exportOptions.key)).toBeNull();
    rememberExportOptions({ ...base, grid: true }, base);
    expect(openingExportOptions()).toEqual({ ...base, grid: true, title: '', description: '' });
  });

  it('round-trips every choice but the map\'s own words', () => {
    rememberExportOptions(base);
    expect(openingExportOptions()).toEqual({ ...base, title: '', description: '' });
    expect(JSON.parse(localStorage.getItem(PREFS.exportOptions.key)!)).not.toHaveProperty('title');
    expect(JSON.parse(localStorage.getItem(PREFS.exportOptions.key)!)).not.toHaveProperty('description');
  });

  it('drops values the window cannot offer and keeps the rest', () => {
    localStorage.setItem(PREFS.exportOptions.key, JSON.stringify({ preset: 'poster', resolution: '8k', grid: 'yes', card3d: true, footerTemplate: 'x'.repeat(401) }));
    expect(openingExportOptions()).toEqual(opening({ card3d: true }));
  });

  it('keeps every size and preset the window offers', () => {
    for (const resolution of RESOLUTION_KEYS) for (const preset of EXPORT_PRESETS) {
      rememberExportOptions({ ...base, resolution, preset });
      expect(openingExportOptions()).toMatchObject({ resolution, preset });
    }
  });

  it('reads an older record\'s share-code switch as the preset it drew, and stops storing it', () => {
    localStorage.setItem(PREFS.exportOptions.key, JSON.stringify({ preset: 'plain', importable: true, grid: true }));
    expect(openingExportOptions()).toEqual(opening({ preset: 'share', grid: true }));
    localStorage.setItem(PREFS.exportOptions.key, JSON.stringify({ preset: 'share', importable: false }));
    expect(openingExportOptions()).toEqual(opening({ preset: 'plain' }));
    rememberExportOptions({ ...base, preset: 'share' });
    expect(JSON.parse(localStorage.getItem(PREFS.exportOptions.key)!)).not.toHaveProperty('importable');
  });

  it('survives junk in the slot', () => {
    localStorage.setItem(PREFS.exportOptions.key, '{not json');
    expect(openingExportOptions()).toEqual(DEFAULT_EXPORT_OPTIONS);
    localStorage.setItem(PREFS.exportOptions.key, '[1,2]');
    expect(openingExportOptions().footerTemplate).toBe(DEFAULT_FOOTER);
  });
});
