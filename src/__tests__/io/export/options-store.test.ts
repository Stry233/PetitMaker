import { beforeEach, describe, expect, it } from 'vitest';
import { loadRememberedExportOptions, rememberExportOptions } from '../../../io/export/options-store';
import { DEFAULT_FOOTER } from '../../../io/export/footer-template';
import type { ExportOptions } from '../../../io/export/types';
import { PREFS } from '../../../core/runtime/prefs';

const base: ExportOptions = { title: 'My island', description: 'notes', preset: 'plain', importable: false, showBadge: false, layerPreview: true, card3d: true, grid: false, footer: true, annotations: false, footerTemplate: 'made {date}', resolution: 'high' };

describe('the export window remembers its choices', () => {
  beforeEach(() => localStorage.clear());

  it('remembers nothing until something was chosen', () => {
    expect(loadRememberedExportOptions()).toEqual({});
  });

  it('round-trips every choice but the map\'s own words', () => {
    rememberExportOptions(base);
    const got = loadRememberedExportOptions();
    expect(got).toEqual({ preset: 'plain', importable: false, showBadge: false, layerPreview: true, card3d: true, grid: false, footer: true, annotations: false, footerTemplate: 'made {date}', resolution: 'high' });
    expect('title' in got).toBe(false);
    expect('description' in got).toBe(false);
  });

  it('drops values the window cannot offer and keeps the rest', () => {
    localStorage.setItem(PREFS.exportOptions.key, JSON.stringify({ preset: 'poster', resolution: '8k', grid: 'yes', card3d: true, footerTemplate: 'x'.repeat(401) }));
    expect(loadRememberedExportOptions()).toEqual({ card3d: true });
  });

  it('survives junk in the slot', () => {
    localStorage.setItem(PREFS.exportOptions.key, '{not json');
    expect(loadRememberedExportOptions()).toEqual({});
    localStorage.setItem(PREFS.exportOptions.key, '[1,2]');
    expect(loadRememberedExportOptions().footerTemplate ?? DEFAULT_FOOTER).toBe(DEFAULT_FOOTER);
  });
});
