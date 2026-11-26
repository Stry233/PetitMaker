/** The rail's layer readout, which names the layer a stroke works on beside its arrow plate and opens the layer panel. */
import { veilTransition, group, inGroup } from './RailButton';
import { ActionButton } from '../../primitives/ActionButton';
import { TouchReach } from '../../primitives/TouchReach';
import { mapEdgeAttr } from '../../primitives/map-edge';
import {
  useLayoutEffect, useRef, useState, } from 'react';
import { helpTargetAttr } from '../../session/help-targets';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { layerTileName } from '../../../i18n/terms/layer-name';
import { btnReset, cursors, radii } from '../../design/styles';
import { LAYER_STEP_RIGHT, LAYERS_STACK_SRC, RAIL_TOP, readoutPressLane } from '../frame';
import { useFrameLayout, usePlanGlide, useScaleGlideLine } from '../frame-layout';
import { useDockStage } from '../use-dock';
import { DARK_PLATE, MAP_LABEL } from '../../design/tokens';
import { PANEL_RIGHT } from '../panel-frame';
import { useFrameZoom, useFrameReadableWeight } from '../use-frame-zoom';
import { roleSize } from '../../design/text-weight';
import { EDGE_RIGHT, RAIL } from '../units';
import { visualRect } from '../../design/visual-rect';
import { useMorph } from '../../primitives/morph';
import { useViewportEpoch } from '../../primitives/use-viewport-epoch';

/**
 * The layer readout and panel trigger: the localized name of the layer shown and the arrow plate, one
 * press target measured to keep its press lane clear of the assistant column. The plate only shows
 * which control this is; it steps no layer. It keeps the rail's layer row, so opening the panel
 * replaces this control without moving the rail groups below it.
 */
export function LayerControl({ panelOpen, onOpen, veiled }: { panelOpen: boolean; onOpen: () => void; veiled: boolean }) {
  const morph = useMorph('layer-control');
  const glide = usePlanGlide('frame.layout.adapt');
  const weightAt = useFrameReadableWeight();
  const t = useT();
  const layout = useFrameLayout();
  const shown = useEditorStore((s) => s.displayLayer) ?? 0;
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const { place } = useDockStage();
  const zoom = useFrameZoom();
  const countRef = useRef<HTMLButtonElement>(null);
  const [lane, setLane] = useState<number | null>(null);
  const word = layerTileName(t, shown);
  // The lane is the room between two edges of the window, so a resize moves it with neither the word
  // nor the zoom changing.
  const viewport = useViewportEpoch();
  useLayoutEffect(() => {
    const el = countRef.current;
    if (!el) { setLane(null); return; }
    const box = visualRect(el);
    setLane(readoutPressLane(
      { left: box.left / zoom, width: box.width / zoom },
      // A docked panel is at the other end of the window and the two can never meet, so the lane
      // is the word's own; free, it stands where this measurement is against.
      assistantOpen && place === 'free' ? PANEL_RIGHT : null,
    ));
  }, [place, zoom, word, panelOpen, assistantOpen, viewport]);
  const stands = { top: layout?.railTop ?? RAIL_TOP, right: (layout?.edgeRight ?? EDGE_RIGHT) + LAYER_STEP_RIGHT - EDGE_RIGHT };
  const box = useRef<HTMLDivElement>(null);
  useScaleGlideLine(box, stands);
  return (
    <div
      ref={box}
      data-testid="shell-layer-control"
      {...morph}
      {...helpTargetAttr('layers')}
      {...mapEdgeAttr('right')}
      style={{
        ...group, ...stands, flexDirection: 'row', height: RAIL.layer.h,
        opacity: veiled ? 0 : 1,
        visibility: veiled ? 'hidden' : undefined,
        transition: [veilTransition(veiled), glide(['top'])].filter(Boolean).join(', '),
      }}
    >
      {panelOpen ? null : (
        <>
          <ActionButton
            ref={countRef}
            interaction="tile"
            aria-label={t('layer.title')}
            aria-expanded={false}
            onClick={onOpen}
            // A stadium, which is the yellow pill this count wears once the panel is open: focus
            // shows the shape the press produces.
            style={{
              ...btnReset, ...inGroup, display: 'flex', alignItems: 'center', gap: RAIL.layer.gap,
              borderRadius: radii.pill, cursor: cursors.clickable,
              // Where a panel stands under part of the word the box itself goes deaf and the lane
              // below re-claims what is clear of it. The lane is a child, so a press on it still
              // reaches this button's own `onClick`.
              position: 'relative',
              ...(lane === null ? null : { pointerEvents: 'none' }),
            }}
          >
            {lane === null && <TouchReach h={RAIL.layer.h} zoom={zoom} />}
            <span
              data-testid="shell-layer-readout"
              role="status"
              style={{
                ...MAP_LABEL,
                fontSize: roleSize('title'), fontWeight: weightAt(900, roleSize('title')), lineHeight: 1,
                // Never clipped: at a line height of 1 its outline and descenders overhang the box.
                whiteSpace: 'nowrap',
              }}
            >
              {word}
            </span>
            <span
              data-testid="shell-layer-plate"
              aria-hidden
              style={{
                width: RAIL.layer.w, height: RAIL.layer.h, flex: 'none', display: 'grid', placeItems: 'center',
                background: DARK_PLATE, borderRadius: radii.pill,
              }}
            >
              <img src={LAYERS_STACK_SRC} alt="" draggable={false} style={{ height: RAIL.layer.glyph }} />
            </span>
            {lane !== null && lane > 0 && (
              <span
                data-testid="shell-layer-readout-press"
                aria-hidden
                // Never wider than the word and plate: the air between them and the panel is the
                // map's, exactly as the air inside a rail group is (`group`).
                style={{
                  position: 'absolute', top: 0, bottom: 0, right: 0, width: '100%', maxWidth: lane,
                  pointerEvents: 'auto', cursor: cursors.clickable,
                }}
              />
            )}
          </ActionButton>
        </>
      )}
    </div>
  );
}
