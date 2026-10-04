import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { touchFloorZoom, useChromeScale, useTouchPrimary, useWeightVars } from '../../../design/scale';
import { AnchoredConfirm } from '../../../primitives/AnchoredConfirm';
import { CONFIRM_ACTION_HEIGHT, type ConfirmationContentProps } from '../../../primitives/ConfirmationContent';

/**
 * A planet question anchored under the control that asked it, aligned to that control's far edge.
 * Mount it under `AnimatePresence`; Escape, a press outside or Cancel answer `onCancel`.
 */
export function PlanetConfirm({ anchor, trigger, floor = true, ...content }: ConfirmationContentProps & {
  anchor: RefObject<HTMLElement | null>;
  /** The control that asked; defaults to the anchor. */
  trigger?: RefObject<HTMLElement | null>;
  /** Over the map a fingertip gets answers of at least `TOUCH_TARGET` on screen; inside a window the
   *  card follows the window's own scale. */
  floor?: boolean;
}) {
  const touch = useTouchPrimary();
  const scale = useChromeScale();
  const zoom = touchFloorZoom(scale, touch && floor, CONFIRM_ACTION_HEIGHT);
  const weights = useWeightVars();
  // Portalled out of the frame, whose zoom and layout containment would otherwise scale and place
  // the card a second time and scope its rung below the rail.
  return createPortal(
    <AnchoredConfirm {...content} anchor={anchor} trigger={trigger ?? anchor} align="end" zoom={zoom}
      width={360} helpTarget={{ page: 'planet' }} style={{ zoom, ...weights }} />,
    document.body,
  );
}
