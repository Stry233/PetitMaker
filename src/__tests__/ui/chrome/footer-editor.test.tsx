// The footer field is a contentEditable line, so a paste is the one way foreign markup could
// reach it. Pinning: only the clipboard's plain text lands, and the template still round-trips.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FooterEditor } from '../../../ui/chrome/modals/export/FooterEditor';

function pasteInto(el: Element, data: Record<string, string>): Event {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: (type: string) => data[type] ?? '' } });
  fireEvent(el, ev);
  return ev;
}

function mount(value = '') {
  const onChange = vi.fn();
  const { container } = render(
    <FooterEditor value={value} onChange={onChange} samples={{ name: 'Map' }} t={(k) => k} />,
  );
  return { field: container.querySelector('.ppfe-field')!, onChange };
}

afterEach(() => vi.unstubAllGlobals());

describe('FooterEditor paste', () => {
  it('inserts the clipboard plain text and no markup', () => {
    const { field, onChange } = mount();
    const ev = pasteInto(field, { 'text/plain': 'My map', 'text/html': '<b onclick="x()">My map</b>' });
    expect(ev.defaultPrevented).toBe(true);
    expect(field.querySelector('b')).toBeNull();
    expect(field.textContent).toBe('My map');
    expect(onChange).toHaveBeenCalledWith('My map');
  });

  it('routes through execCommand insertText when the browser offers it', () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    const { field } = mount();
    pasteInto(field, { 'text/plain': 'Text' });
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'Text');
    expect(field.querySelector('b')).toBeNull();
    delete (document as unknown as Record<string, unknown>).execCommand;
  });

  it('keeps an existing token chip intact', () => {
    const { field, onChange } = mount('{name}');
    expect(field.querySelector('[data-tok="name"]')).not.toBeNull();
    pasteInto(field, { 'text/plain': ' by me' });
    expect(field.querySelector('[data-tok="name"]')).not.toBeNull();
    expect(onChange).toHaveBeenCalledWith('{name} by me');
  });

  it('drops brace characters that would forge a token', () => {
    const { field, onChange } = mount();
    pasteInto(field, { 'text/plain': '{name}' });
    expect(field.querySelector('[data-tok]')).toBeNull();
    expect(onChange).toHaveBeenCalledWith('name');
  });
});
