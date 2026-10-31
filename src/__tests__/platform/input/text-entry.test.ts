// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isTextEntry, raisesKeyboard } from '../../../platform/input/text-entry';

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

describe('raisesKeyboard', () => {
  const input = (type: string): HTMLInputElement => Object.assign(document.createElement('input'), { type });

  it('is true for the fields a finger types into', () => {
    expect(raisesKeyboard(document.createElement('textarea'))).toBe(true);
    for (const type of ['text', 'search', 'number']) expect(raisesKeyboard(input(type)), type).toBe(true);
  });

  it('is false for a select, a slider, a checkbox and anything that is not a field', () => {
    expect(raisesKeyboard(document.createElement('select'))).toBe(false);
    for (const type of ['range', 'checkbox', 'color']) expect(raisesKeyboard(input(type)), type).toBe(false);
    expect(raisesKeyboard(document.createElement('button'))).toBe(false);
    expect(raisesKeyboard(null)).toBe(false);
  });
});
