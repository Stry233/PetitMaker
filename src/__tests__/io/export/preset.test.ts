import { describe, it, expect } from 'vitest';
import { applyPreset, isImportable, type ExportOptions } from '../../../io/export/types';

const base: ExportOptions = { title: '', description: '', preset: 'share', showBadge: true, layerPreview: true, card3d: false, grid: true, annotations: true, footer: true, footerTemplate: '{date}{fill} · {dims}', resolution: 'standard' };

describe('export presets', () => {
  it('Share = importable (carries a share code)', () => {
    const o = applyPreset(base, 'share');
    expect(isImportable(o)).toBe(true);
  });
  it('Plain = not importable, no share code', () => {
    const o = applyPreset(base, 'plain');
    expect(isImportable(o)).toBe(false);
  });
});
