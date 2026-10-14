import { useCallback } from 'react';
import { useEditorStore, type ModalId } from '../../../state/store';

/** What a window may be handed in place of its store flag: a Help figure or a test pictures it open. */
export interface WindowProps {
  open?: boolean;
  onClose?: () => void;
}

/** A window's open state and its way out: its own flag in the store's `modals`, unless the caller
 *  hands it both. Every window mounts this way, so the shell renders each one without wiring. */
export function useWindow(id: ModalId, { open, onClose }: WindowProps = {}): { open: boolean; close: () => void } {
  const stored = useEditorStore((s) => s.modals[id]);
  const setModal = useEditorStore((s) => s.setModal);
  const close = useCallback(() => { if (onClose) onClose(); else setModal(id, false); }, [onClose, setModal, id]);
  return { open: open ?? stored, close };
}
