import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationModal } from '../../../ui/primitives/ConfirmationModal';

const copy = { title: 'Remove this item?', message: 'The item will be removed.', cancelLabel: 'Cancel', confirmLabel: 'Remove' };

describe('confirmation decisions', () => {
  it('routes each choice to its own callback', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmationModal open {...copy} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('blocks dismissal and repeated confirmation while the operation is running', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmationModal open busy {...copy} onCancel={onCancel} onConfirm={onConfirm} />);
    const dialog = screen.getByRole('dialog', { name: copy.title });
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
