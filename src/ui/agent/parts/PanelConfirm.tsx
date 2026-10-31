import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useSurfaceZoom, useWeightVars } from '../../design/scale';
import { AnchoredConfirm } from '../../primitives/AnchoredConfirm';
import type { ConfirmationContentProps } from '../../primitives/ConfirmationContent';

/** Card width in frame px: the panel's own column less its gutters. */
const CONFIRM_W = 300;

/**
 * A panel question that unrolls from the control that asked it, the control itself unchanged.
 * Mount it under `AnimatePresence`; Escape, a press outside or Cancel answer `onCancel`.
 */
export function PanelConfirm({ anchor, help, testId, ...content }: ConfirmationContentProps & {
  anchor: RefObject<HTMLElement | null>;
  /** The Help page the card's What's this answers with. */
  help: string;
  testId?: string;
}) {
  const zoom = useSurfaceZoom();
  const weights = useWeightVars();
  // Portalled out of the panel, whose zoom and clipping would otherwise scale and cut the card.
  return createPortal(
    <AnchoredConfirm {...content} anchor={anchor} trigger={anchor} align="end" zoom={zoom} width={CONFIRM_W}
      helpTarget={{ page: help }} style={{ zoom, ...weights }} {...(testId ? { testId } : {})} />,
    document.body,
  );
}
