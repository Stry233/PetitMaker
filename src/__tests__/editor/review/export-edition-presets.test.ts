import { describe, expect, it } from 'vitest';
import type { ExportOptions } from '../../../io/export/types';
import { applyExportPreset as applyWebPreset } from '../../../editor/review/edition-review';
import { applyExportPreset as applyLitePreset } from '../../../editor/review/edition-review-lite';

const options: ExportOptions = {
  title: 'My island', description: 'A river walk', preset: 'share',
  showBadge: false, layerPreview: false, card3d: true, grid: false, footer: false,
  annotations: false, footerTemplate: '{name}', resolution: 'high',
};

describe('edition export presets', () => {
  it('keeps web presentation choices when switching importability', () => {
    const plain = applyWebPreset(options, 'plain');
    expect(plain).toEqual({ ...options, preset: 'plain' });
    expect(applyWebPreset(plain, 'share')).toEqual(options);
  });

  it('applies Lite presentation defaults while preserving text, size and annotation choices', () => {
    const share = applyLitePreset(options, 'share');
    expect(share).toEqual({ ...options, layerPreview: true, grid: true, footer: true, card3d: false });
    expect(applyLitePreset(share, 'plain')).toEqual({ ...options, preset: 'plain', card3d: false });
    expect(options.card3d).toBe(true);
  });
});
