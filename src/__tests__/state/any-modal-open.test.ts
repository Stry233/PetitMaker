import { describe, expect, it } from 'vitest';
import { MODAL_IDS, anyModalOpen, type ModalId } from '../../state/slices/shell';

const closed = () => Object.fromEntries(MODAL_IDS.map((id) => [id, false])) as Record<ModalId, boolean>;

describe('anyModalOpen', () => {
  it('reads every window and none when all are closed', () => {
    expect(anyModalOpen({ modals: closed() })).toBe(false);
    for (const id of MODAL_IDS) expect(anyModalOpen({ modals: { ...closed(), [id]: true } })).toBe(true);
  });

  it('leaves out the window it is told to', () => {
    expect(anyModalOpen({ modals: { ...closed(), whatsNew: true } }, 'whatsNew')).toBe(false);
    expect(anyModalOpen({ modals: { ...closed(), whatsNew: true, share: true } }, 'whatsNew')).toBe(true);
  });
});
