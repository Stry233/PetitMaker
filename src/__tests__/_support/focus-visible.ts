/** The browser's verdict on whether a focus shows as the keyboard's (`:focus-visible`), which jsdom
 *  answers yes for any focused element. Restore with `vi.restoreAllMocks()`. */
import { vi } from 'vitest';

export function focusLooksKeyboard(keyboard: boolean): void {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? keyboard : matches.call(this, selector);
  });
}
