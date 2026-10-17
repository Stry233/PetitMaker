// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionButton } from '../../../ui/primitives/ActionButton';
import { Pill } from '../../../ui/primitives/Pill';

describe('ActionButton', () => {
  it.each([['ActionButton', ActionButton], ['Pill', Pill]] as const)('%s keeps native button semantics and exposes the focus target', (_name, Button) => {
    const ref = createRef<HTMLButtonElement>();
    const activate = vi.fn();
    const { getByRole } = render(<Button ref={ref} onClick={activate}>Apply</Button>);
    const button = getByRole('button');
    expect(button.getAttribute('type')).toBe('button');
    expect(ref.current).toBe(button);
    ref.current!.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(activate).toHaveBeenCalledOnce();
  });

  it.each(['disabled', 'busy'] as const)('rejects activation while %s and resumes when available', (state) => {
    const activate = vi.fn();
    const { getByRole, rerender } = render(<ActionButton {...{ [state]: true }} onClick={activate}>Apply</ActionButton>);
    const button = getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    if (state === 'busy') expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(activate).not.toHaveBeenCalled();
    rerender(<ActionButton onClick={activate}>Apply</ActionButton>);
    fireEvent.click(button);
    expect(activate).toHaveBeenCalledOnce();
  });

  it('returns a hover to the current fill, not to the one it started from', async () => {
    const { getByRole, rerender } = render(<ActionButton interaction="row" fill="rgba(0, 0, 0, 0)" hoverFill="#EAE8CD" fillTransition={{ duration: 0 }}>Row</ActionButton>);
    const button = getByRole('button');
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    await waitFor(() => expect(button.style.backgroundColor).not.toMatch(/^rgba\(0, 0, 0, 0\)$/));
    rerender(<ActionButton interaction="row" fill="#FFDA7E" fillTransition={{ duration: 0 }}>Row</ActionButton>);
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    await waitFor(() => expect(button.style.backgroundColor).toMatch(/^rgba?\(255, 218, 126(, 1)?\)$/));
    await new Promise((r) => setTimeout(r, 300));
    expect(button.style.backgroundColor).toMatch(/^rgba?\(255, 218, 126(, 1)?\)$/);
  });

  /** After one hover, Framer owns the fill; a resting fill that later changes must still be drawn. */
  const settledFill = async (button: HTMLElement, rgb: string) => {
    await waitFor(() => expect(button.style.backgroundColor).toMatch(new RegExp(`^rgba?\\(${rgb}(, 1)?\\)$`)));
    await new Promise((r) => setTimeout(r, 300));
    expect(button.style.backgroundColor).toMatch(new RegExp(`^rgba?\\(${rgb}(, 1)?\\)$`));
  };

  it('draws a pill\'s new variant after a hover tinted it', async () => {
    const { getByRole, rerender } = render(<Pill hoverFill="#FFDA7E">Go</Pill>);
    const button = getByRole('button');
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    await waitFor(() => expect(button.style.backgroundColor).toMatch(/255, 218, 126/));
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    rerender(<Pill hoverFill="#FFDA7E" variant="danger">Go</Pill>);
    const danger = render(<Pill variant="danger">Ref</Pill>).getAllByRole('button')[1]!.style.backgroundColor;
    const [, r, g, b] = /rgba?\((\d+), (\d+), (\d+)/.exec(danger)!;
    await settledFill(button, `${r}, ${g}, ${b}`);
  });

  it('follows a style fill once its hover fill is withdrawn', async () => {
    const { getByRole, rerender } = render(<ActionButton hoverFill="#EAE8CD" fill="#FFFEE3">Row</ActionButton>);
    const button = getByRole('button');
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    rerender(<ActionButton style={{ background: '#FFDA7E' }}>Row</ActionButton>);
    await settledFill(button, '255, 218, 126');
  });
});

describe('the hover fill guard', () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { error = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { error.mockRestore(); cleanup(); });
  const reported = () => (error.mock.calls as unknown[][]).filter(([m]) => String(m).includes('draws its resting fill'));

  it.each([
    ['background', { background: '#FFDA7E' }],
    ['backgroundColor', { backgroundColor: '#FFDA7E' }],
  ])('names a hover-tinted button whose resting fill comes through style.%s', (_key, style) => {
    render(<ActionButton data-testid="stale" hoverFill="#EAE8CD" style={style}>Row</ActionButton>);
    expect(reported()).toHaveLength(1);
    expect(String(reported()[0]![0])).toContain('stale');
  });

  it.each([
    ['a fill', <ActionButton key="a" hoverFill="#EAE8CD" fill="#FFDA7E">Row</ActionButton>],
    ['an appearance', <ActionButton key="b" appearance="tertiary" hoverFill="#EAE8CD">Row</ActionButton>],
    ['no hover fill', <ActionButton key="c" style={{ background: '#FFDA7E' }}>Row</ActionButton>],
    ['a pill', <Pill key="d" hoverFill="#FFDA7E">Row</Pill>],
  ])('stays quiet for %s', (_case, element) => {
    render(element);
    expect(reported()).toEqual([]);
  });
});
