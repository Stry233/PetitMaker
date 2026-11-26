// @vitest-environment jsdom
/** `TextField`: the one field box, which wears the focus ring, holds its glyph and slot, and passes
 *  Enter on only outside IME composition. */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TextField } from '../../../ui/primitives/TextField';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../../ui/design/focus-source';

afterEach(cleanup);

function Field(props: Partial<Parameters<typeof TextField>[0]>) {
  const [text, setText] = useState('');
  return <TextField label="Name" value={text} onChange={setText} {...props} />;
}

describe('TextField', () => {
  it('rings its box, never the bare text, with the glyph and the slot inside it', () => {
    render(<Field leading={<svg data-testid="glyph" />} trailing={<button type="button">Clear</button>} />);
    const text = screen.getByRole('textbox', { name: 'Name' });
    const box = text.closest(`.${FIELD_WRAP_CLASS}`)!;
    expect(text.classList.contains(FIELD_INPUT_CLASS)).toBe(true);
    expect(box).not.toBeNull();
    expect(box.contains(screen.getByTestId('glyph'))).toBe(true);
    expect(screen.getByTestId('glyph').closest('[aria-hidden]'), 'the glyph is not read aloud').not.toBeNull();
    expect(box.contains(screen.getByRole('button', { name: 'Clear' }))).toBe(true);
  });

  it('passes Enter on once a composition has finished, and reports the composition', () => {
    const onEnter = vi.fn();
    const composing: boolean[] = [];
    render(<Field onEnter={onEnter} onComposingChange={(c) => composing.push(c)} />);
    const text = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.compositionStart(text);
    fireEvent.keyDown(text, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(text, { key: 'Enter', keyCode: 229 });
    fireEvent.compositionEnd(text);
    expect(onEnter).not.toHaveBeenCalled();
    expect(composing).toEqual([true, false]);
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('reports typing, takes none while disabled, and offers a multi-line field', () => {
    render(<><Field /><Field label="Notes" rows={3} /><Field label="Locked" disabled /></>);
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Mira' } });
    expect(name.value).toBe('Mira');
    expect(screen.getByRole('textbox', { name: 'Notes' }).tagName).toBe('TEXTAREA');
    expect((screen.getByRole('textbox', { name: 'Locked' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('names a search field as a search box', () => {
    render(<Field label="Search" type="search" />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeTruthy();
  });
});
