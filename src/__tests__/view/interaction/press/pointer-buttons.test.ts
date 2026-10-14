/** Which mouse buttons navigate the camera. */
import { describe, it, expect } from 'vitest';
import { isNavButton } from '../../../../view/interaction/press/pointer-buttons';

describe('pointer buttons', () => {
  it('treats middle and right as navigation', () => {
    expect(isNavButton(1)).toBe(true);
    expect(isNavButton(2)).toBe(true);
  });

  it('leaves the primary and the extra buttons alone', () => {
    expect(isNavButton(0)).toBe(false);
    expect(isNavButton(3)).toBe(false);
    expect(isNavButton(4)).toBe(false);
  });
});
