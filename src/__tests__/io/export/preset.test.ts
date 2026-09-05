import { describe, it, expect } from 'vitest';
import { applyPreset, hasShareCode, type ExportOptions } from '../../../io/export/types';

const base: ExportOptions = { title: '', description: '', preset: 'share', importable: true, showBadge: true, layerPreview: true, card3d: false, grid: true, annotations: true, footer: true, footerTemplate: '{date}{fill} · {dims}', resolution: 'standard' };

describe('export presets', () => {
  it('Share = importable (carries a share code)', () => {
    const o = applyPreset(base, 'share');
    expect(o.importable).toBe(true);
    expect(hasShareCode(o)).toBe(true);
  });
  it('Plain = not importable, no share code', () => {
    const o = applyPreset(base, 'plain');
    expect(o.importable).toBe(false);
    expect(hasShareCode(o)).toBe(false);
  });
  it('hasShareCode mirrors importable directly', () => {
    expect(hasShareCode({ ...base, importable: true })).toBe(true);
    expect(hasShareCode({ ...base, importable: false })).toBe(false);
  });
});
