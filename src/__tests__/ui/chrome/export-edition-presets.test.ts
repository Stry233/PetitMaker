import { describe, expect, it } from 'vitest';
import type { ExportOptions } from '../../../io/export/types';
import { applyExportPreset as applyWebPreset } from '../../../ui/chrome/modals/export/edition-export';
import { applyExportPreset as applyLitePreset } from '../../../ui/lite/edition-export';

const options: ExportOptions = {
  title: 'My island', description: 'A river walk', preset: 'share', importable: true,
  showBadge: false, layerPreview: false, card3d: true, grid: false, footer: false,
  annotations: false, footerTemplate: '{name}', resolution: 'high',
};

describe('edition export presets', () => {
  it('keeps web presentation choices when switching importability', () => {
    const plain = applyWebPreset(options, 'plain');
    expect(plain).toEqual({ ...options, preset: 'plain', importable: false });
    expect(applyWebPreset(plain, 'share')).toEqual(options);
  });

  it('applies Lite presentation defaults while preserving text, size and annotation choices', () => {
    const share = applyLitePreset(options, 'share');
    expect(share).toEqual({ ...options, importable: true, layerPreview: true, grid: true, footer: true, card3d: false });
    expect(applyLitePreset(share, 'plain')).toEqual({ ...options, preset: 'plain', importable: false, card3d: false });
    expect(options.card3d).toBe(true);
  });
});
