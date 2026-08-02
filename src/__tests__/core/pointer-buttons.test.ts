/**
 * Which mouse buttons navigate the camera. Three call sites answered this with their own literal
 * before it lived here, so the value and its meaning are pinned together.
 */
import { describe, it, expect } from 'vitest';
import { PRIMARY_BUTTON, NAV_BUTTONS, isNavButton } from '../../core/interaction/pointer-buttons';

describe('pointer buttons', () => {
  it('names the primary button', () => {
    expect(PRIMARY_BUTTON).toBe(0);
  });

  it('treats middle and right as navigation', () => {
    expect(isNavButton(1)).toBe(true);
    expect(isNavButton(2)).toBe(true);
    expect(NAV_BUTTONS).toEqual([1, 2]);
  });

  it('leaves the primary and the extra buttons alone', () => {
    expect(isNavButton(0)).toBe(false);
    expect(isNavButton(3)).toBe(false);
    expect(isNavButton(4)).toBe(false);
  });
});
