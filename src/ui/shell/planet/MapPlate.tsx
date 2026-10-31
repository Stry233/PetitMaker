/**
 * A plate over the map below the nameplate's row: a title, a rule and whatever the task shows. It
 * stands under the mode row, over the work, and moves the toast band below it. A task over the map
 * (the hand repair of a map's landmarks) wears one.
 */
import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { ShapeEdge, isWebKitEngine } from '../../design/shape-edge';
import { font, radii, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { INK, LINE, PLATE, PLATE_INK } from '../../design/tokens';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { useChromeLayer, useChromeLayerZoom } from '../../primitives/chrome-layer';
import { fromChromePx, useToastBandShift } from '../../chrome/floating/toast-band';
import { PANEL_GAP, PLATE_ROW, nameplateTop, toastBandShift } from './nameplate-layout';
import { useGlidingChromeScale } from '../../design/scale';
import { useFrameZoom } from '../use-frame-zoom';
import { useFrameLayout } from '../frame-layout';
import { EDGE, RAIL } from '../units';
import { useMorph } from '../../primitives/morph';

/** Each control on a plate, in css px. */
export const PLATE_BUTTON = 44;
const PAD = 4;
const SEGMENT_PAD = 14;
const GAP = 8;

/** The thin rule between a plate's segments. */
export const plateRule: CSSProperties = { width: 1, alignSelf: 'stretch', margin: '12px 2px', background: LINE, flex: 'none' };
/** A count or a fact on a plate. */
export const plateLabel: CSSProperties = { ...roleFont('label'), color: PLATE_INK, whiteSpace: 'nowrap' };
/** A plate's pill button. */
export const plateButton: CSSProperties = {
  flex: 'none', height: PLATE_BUTTON, paddingBlock: 0, paddingInline: '14px 18px', borderRadius: radii.pill,
  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};

/** A plate's body on the map's top edge: the cream plate drawn behind one row of `PLATE_ROW`, which
 *  holds `children` `gap` px apart inside `padding`. */
export function PlateBody({ bodyRef, testId, gap, padding, style, children }: {
  bodyRef?: Ref<HTMLDivElement>;
  testId?: string;
  gap: number;
  padding: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div ref={bodyRef} data-testid={testId} {...mapEdgeAttr('top')}
      style={{ position: 'relative', fontFamily: font.family, color: INK, pointerEvents: 'auto', maxWidth: '100%', ...style }}>
      <ShapeEdge style={{ position: 'absolute', inset: 0 }}>
        <span style={{ position: 'absolute', inset: 0, background: PLATE, borderRadius: (PLATE_ROW / 2) * (isWebKitEngine() ? 2 : 1) }} />
      </ShapeEdge>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap, height: PLATE_ROW, padding }}>
        {children}
      </div>
    </div>
  );
}

export function MapPlate({ title, testId, motionProps, children }: {
  title: string;
  testId: string;
  motionProps?: Record<string, unknown>;
  children: ReactNode;
}) {
  // A finger presses the plate's buttons, so touch mode draws them at a fingertip's size.
  const layer = useChromeLayer({ control: PLATE_BUTTON });
  const zoom = useChromeLayerZoom(PLATE_BUTTON);
  const chrome = useGlidingChromeScale();
  // Below the nameplate's row, which the mode row's icons cross on a map, at the zoom the nameplate
  // draws at too; the toast band is placed in chrome px.
  const frameZoom = useFrameZoom();
  const top = nameplateTop(frameZoom, zoom) + PLATE_ROW + 2 * PANEL_GAP;
  useToastBandShift(toastBandShift(top + PLATE_ROW, zoom, chrome));
  // Upright, the right-hand column runs down past the plate's row, so the plate keeps to the map
  // left of it, between the frame's left margin and the column's group gap.
  const layout = useFrameLayout();
  const across: CSSProperties = layout?.shape === 'portrait'
    ? { left: (EDGE * frameZoom) / zoom, width: ((layout.width - layout.edgeRight - RAIL.button - RAIL.groupMin - EDGE) * frameZoom) / zoom }
    : { left: `calc(50% + ${fromChromePx('(var(--pin-dock-left, 0px) - var(--pin-dock-right, 0px)) / 2', chrome / zoom)})`, x: '-50%', maxWidth: '100%' };
  const morph = useMorph(testId);
  return createPortal(
    <motion.div {...motionProps} {...morph} data-testid={testId}
      style={{
        ...layer, top, ...across, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: z.panel,
      }}>
      <PlateBody gap={GAP} padding={`0 ${PAD}px 0 ${SEGMENT_PAD + PAD}px`}>
        <span style={{ ...roleFont('head'), color: PLATE_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {title}
        </span>
        <span aria-hidden style={plateRule} />
        {children}
      </PlateBody>
    </motion.div>,
    document.body,
  );
}
