import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatMenu } from '../../../ui/primitives/FloatMenu';
import { ModalShell } from '../../../ui/primitives/ModalShell';

function Fixture({ close, pick = () => {} }: { close(): void; pick?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return <ModalShell open onClose={close} ariaLabel="Dialog">
    <FloatMenu row="Pick" open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onPick={pick}
      items={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Disabled', disabled: true }, { id: 'c', label: 'Gamma' }]} activeId="a" />
    <button type="button">After</button>
  </ModalShell>;
}

describe('menus owned by a modal', () => {
  it('dismisses a portaled search menu before a React ancestor handles Escape', () => {
    const fold = vi.fn();
    function Panel() {
      const [open, setOpen] = useState(false);
      return <div onKeyDown={event => { if (event.key === 'Escape') fold(); }}>
        <FloatMenu row="Models" open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)}
          body={<input aria-label="Search models" />} />
      </div>;
    }
    render(<Panel />);
    const trigger = screen.getByRole('button', { name: 'Models' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(fold).not.toHaveBeenCalled();
  });

  it('lets a field consume Escape before its owning surface', () => {
    const close = vi.fn();
    const cancel = vi.fn();
    render(<ModalShell open onClose={close}><input aria-label="Field" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } }} /></ModalShell>);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('focuses the selected item, skips disabled entries, and returns focus after selection', () => {
    const pick = vi.fn();
    render(<Fixture close={() => {}} pick={pick} />);
    const trigger = screen.getByRole('button', { name: 'Pick' });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Alpha' }));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Gamma' }));
    fireEvent.click(document.activeElement!);
    expect(pick).toHaveBeenCalledWith('c');
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses only the foreground surface on each Escape', () => {
    const close = vi.fn();
    render(<Fixture close={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('continues tab order from the trigger when leaving a portaled menu', () => {
    render(<Fixture close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
  });
});
