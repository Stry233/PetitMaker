import { describe, expect, it } from 'vitest';
import { spec } from '../../_support/spec';
import { layoutShapeFor, type ShapeSignals } from '../../../platform/device/layout-shape';

const base: ShapeSignals = { orientation: null, coarse: false, width: 1200, height: 800, textFocused: false, previous: 'landscape' };

describe('layoutShapeFor', () => {
  spec('UI-28', 'a software keyboard opening on a portrait phone keeps the portrait shape', () => {
    const phone: ShapeSignals = { ...base, coarse: true, orientation: 'portrait', width: 390, height: 844, previous: 'portrait' };
    expect(layoutShapeFor({ ...phone, height: 300, textFocused: true })).toBe('portrait');
  });

  spec('UI-28', 'a phone turned upright while a text field has focus takes the portrait arrangement', () => {
    const phone: ShapeSignals = { ...base, coarse: true, orientation: 'portrait', width: 390, height: 300, previous: 'landscape' };
    expect(layoutShapeFor({ ...phone, textFocused: true })).toBe('portrait');
  });

  it('a desktop window taller than wide is portrait', () => {
    expect(layoutShapeFor({ ...base, width: 700, height: 900 })).toBe('portrait');
    expect(layoutShapeFor({ ...base, width: 900, height: 700 })).toBe('landscape');
  });

  spec('UI-28', 'a window resized near square keeps the arrangement it has', () => {
    expect(layoutShapeFor({ ...base, width: 1000, height: 1040, previous: 'landscape' })).toBe('landscape');
    expect(layoutShapeFor({ ...base, width: 1040, height: 1000, previous: 'portrait' })).toBe('portrait');
    expect(layoutShapeFor({ ...base, width: 1000, height: 1200, previous: 'landscape' })).toBe('portrait');
    expect(layoutShapeFor({ ...base, width: 1200, height: 1000, previous: 'portrait' })).toBe('landscape');
  });

  it('a desktop window follows a resize while a text field has focus', () => {
    expect(layoutShapeFor({ ...base, width: 700, height: 900, textFocused: true })).toBe('portrait');
  });

  it('a coarse device reports its physical orientation over the window aspect', () => {
    expect(layoutShapeFor({ ...base, coarse: true, orientation: 'landscape', width: 400, height: 700 })).toBe('landscape');
    expect(layoutShapeFor({ ...base, coarse: true, orientation: 'portrait', width: 900, height: 400 })).toBe('portrait');
  });

  it('a fine-pointer device ignores screen.orientation', () => {
    expect(layoutShapeFor({ ...base, orientation: 'portrait', width: 900, height: 400 })).toBe('landscape');
  });
});
