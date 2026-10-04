import { describe, it, expect } from 'vitest';
import { isTextEntry } from '../../../core/runtime/text-entry';

describe('isTextEntry', () => {
  it('treats inputs, text areas and selects as fields', () => {
    for (const tag of ['input', 'textarea', 'select']) expect(isTextEntry(document.createElement(tag)), tag).toBe(true);
  });

  it('treats editable content as a field', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    // jsdom does not compute isContentEditable from the attribute; the browser does.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTextEntry(div)).toBe(true);
  });

  it('leaves the document, an SVG element, a plain element and no target to the editor', () => {
    expect(isTextEntry(document)).toBe(false);
    expect(isTextEntry(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))).toBe(false);
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
  });
});
