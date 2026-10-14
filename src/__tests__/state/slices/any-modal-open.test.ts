import { describe, expect, it } from 'vitest';
import { anyModalOpen, type ModalId } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';

/** Every window flag the store holds, all closed. */
const closed = () => ({ ...useEditorStore.getInitialState().modals });
const MODAL_IDS = Object.keys(closed()) as ModalId[];

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
