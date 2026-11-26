import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useChromeLift } from './chrome-layer';
import { useSurfaceZoom, useWeightVars } from '../design/scale';
import { AnchoredConfirm } from './AnchoredConfirm';
import { CONFIRM_ACTION_HEIGHT, type ConfirmationContentProps } from './ConfirmationContent';
import type { HelpTarget } from './help-target';

/**
 * A question anchored under the control that asked it, aligned to that control's far edge and
 * portalled to the body: a window's or a bar's confirmation, a rename or a name card.
 * Mount it under `AnimatePresence`; Escape, a press outside or Cancel answer `onCancel`.
 */
export function ControlConfirm({ anchor, trigger, floor = true, helpTarget, prefer, lockSide, width = 360, testId, ...content }: ConfirmationContentProps & {
  anchor: RefObject<HTMLElement | null>;
  /** The control that asked; defaults to the anchor. */
  trigger?: RefObject<HTMLElement | null>;
  /** Over the map a fingertip gets answers of at least `TOUCH_TARGET` on screen; inside a window the
   *  card follows the window's own scale. */
  floor?: boolean;
  /** The Help page the card's What's this answers with. */
  helpTarget: HelpTarget;
  prefer?: 'above' | 'below';
  /** A card whose field feedback lengthens it keeps the side it opened on. */
  lockSide?: boolean;
  /** The card's width in css px before its zoom. */
  width?: number;
  testId?: string;
}) {
  const lift = useChromeLift(CONFIRM_ACTION_HEIGHT);
  const surface = useSurfaceZoom();
  const within = useWeightVars();
  const { zoom, weights } = floor ? lift : { zoom: surface, weights: within };
  // Portalled out of the frame, whose zoom and layout containment would otherwise scale and place
  // the card a second time and scope its rung below the rail.
  return createPortal(
    <AnchoredConfirm {...content} anchor={anchor} trigger={trigger ?? anchor} align="end" zoom={zoom} prefer={prefer} lockSide={lockSide}
      width={width} helpTarget={helpTarget} style={{ zoom, ...weights }} {...(testId ? { testId } : {})} />,
    document.body,
  );
}
