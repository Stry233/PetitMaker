// @vitest-environment jsdom
import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
