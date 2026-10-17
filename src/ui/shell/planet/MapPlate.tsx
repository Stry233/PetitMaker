/**
 * A plate over the map below the nameplate's row: a title, a rule and whatever the task shows. It
 * stands under the mode row, over the work, and moves the toast band below it. A task over the map
 * (the hand repair of a map's landmarks) wears one.
 */
import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShapeEdge, isWebKitEngine } from '../../design/shape-edge';
import { font, radii, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { INK, LINE, PLATE, PLATE_INK } from '../../design/tokens';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { useChromeLayer } from '../../primitives/chrome-layer';
import { useRootCssVars } from '../../primitives/use-root-css-vars';
import { TOAST_BAND_SHIFT_VAR, TOAST_BAND_TOP } from '../../chrome/floating/toast-band';
import { PANEL_GAP, PLATE_ROW, nameplateTop } from './nameplate-layout';
import { useChromeScale } from '../../design/scale';
import { useFrameZoom } from '../use-frame-zoom';

const BUTTON = 44;
const PAD = 4;
const SEGMENT_PAD = 14;
const GAP = 8;

/** The thin rule between a plate's segments. */
export const plateRule: CSSProperties = { width: 1, alignSelf: 'stretch', margin: '12px 2px', background: LINE, flex: 'none' };
/** A count or a fact on a plate. */
export const plateLabel: CSSProperties = { ...roleFont('label'), color: PLATE_INK, whiteSpace: 'nowrap' };
/** A plate's pill button. */
export const plateButton: CSSProperties = {
  flex: 'none', height: BUTTON, paddingBlock: 0, paddingInline: '14px 18px', borderRadius: radii.pill,
  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};

export function MapPlate({ title, testId, motionProps, children }: {
  title: string;
  testId: string;
  motionProps?: Record<string, unknown>;
  children: ReactNode;
}) {
  const layer = useChromeLayer();
  // Below the nameplate's row, which the mode row's icons cross on a map.
  const top = nameplateTop(useFrameZoom(), useChromeScale()) + PLATE_ROW + 2 * PANEL_GAP;
  useRootCssVars({ [TOAST_BAND_SHIFT_VAR]: `${Math.max(0, top + PLATE_ROW + PANEL_GAP - TOAST_BAND_TOP)}px` });
  return createPortal(
    <motion.div {...motionProps} data-testid={testId}
      style={{
        ...layer, top, left: 'calc(50% + (var(--pin-dock-left, 0px) - var(--pin-dock-right, 0px)) / 2)', x: '-50%',
        maxWidth: '100%', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: z.panel,
      }}>
      <div {...mapEdgeAttr('top')} style={{ position: 'relative', fontFamily: font.family, color: INK, pointerEvents: 'auto', maxWidth: '100%' }}>
        <ShapeEdge style={{ position: 'absolute', inset: 0 }}>
          <span style={{ position: 'absolute', inset: 0, background: PLATE, borderRadius: (PLATE_ROW / 2) * (isWebKitEngine() ? 2 : 1) }} />
        </ShapeEdge>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: GAP, height: PLATE_ROW, padding: `0 ${PAD}px 0 ${SEGMENT_PAD + PAD}px` }}>
          <span style={{ ...roleFont('head'), color: PLATE_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {title}
          </span>
          <span aria-hidden style={plateRule} />
          {children}
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
