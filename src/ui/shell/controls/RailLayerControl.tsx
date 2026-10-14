/** The rail's layer stepper and the count that opens the layer panel. */
import { veilTransition, group, inGroup } from './RailButton';
import { ActionButton } from '../../primitives/ActionButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import {
  useLayoutEffect, useRef, useState, } from 'react';
import { helpTargetAttr } from '../../session/help-targets';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { layerName } from '../../session/layer-name';
import { btnReset, cursors, radii, UNAVAILABLE } from '../../design/styles';
import {
  LAYER_STEP_RIGHT,
  LAYERS_STACK_SRC, RAIL_TOP, readoutPressLane, } from '../frame';
import { useFrameLayout } from '../frame-layout';
import { cssMotion } from '../../design/motion';
import { useDockStage } from '../use-dock';
import { DARK_PLATE, MAP_LABEL } from '../../design/tokens';
import { PANEL_RIGHT } from '../panel-frame';
import { useFrameZoom, useFrameReadableWeight } from '../use-frame-zoom';
import { EDGE_RIGHT, RAIL, TEXT } from '../units';
import { visualRect } from '../../design/visual-rect';
import { ELEVATION_MAX } from '../../../core/game/profile';
import { useRunCommand } from '../use-shell-commands';

/**
 * One step of the layer control: the top or the bottom half of the plate's single drawing.
 *
 * The design source draws both arrows as one shape, so each button shows its own half of that
 * drawing through a window. Halving it is exact — the two blobs meet at the drawing's midline — and
 * it is what lets a spent step dim on its own while the pair stays one picture.
 */
function LayerStep({ label, half, disabled, onPress }: {
  label: string;
  half: 'top' | 'bottom';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <ActionButton
      interaction="tile"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPress}
      style={{
        ...btnReset, ...inGroup, flex: 1, width: '100%', position: 'relative', overflow: 'hidden',
        // Its own half of the plate's pill, so a focus ring follows the dome the eye sees rather
        // than boxing half a capsule. The pill's cap is a semicircle of half its width.
        borderRadius: half === 'top'
          ? `${RAIL.layer.w / 2}px ${RAIL.layer.w / 2}px 0 0`
          : `0 0 ${RAIL.layer.w / 2}px ${RAIL.layer.w / 2}px`,
        opacity: disabled ? UNAVAILABLE : 1,
        cursor: disabled ? cursors.blocked : cursors.clickable,
      }}
    >
      <img
        src={LAYERS_STACK_SRC}
        alt=""
        draggable={false}
        style={{
          position: 'absolute', left: '50%', height: RAIL.layer.glyph,
          // Measured from the plate's own edge, not the half's, so the drawing crosses the seam
          // between the two buttons exactly where its two blobs part.
          [half === 'top' ? 'top' : 'bottom']: (RAIL.layer.h - RAIL.layer.glyph) / 2,
          transform: 'translateX(-50%)',
        }}
      />
    </ActionButton>
  );
}
/**
 * Layer stepper and panel trigger. The localized count sits outside the narrow arrow plate and is
 * measured to keep its press lane clear of the assistant column. Opening the panel replaces this
 * control without moving the rail groups below it.
 */
export function LayerControl({ panelOpen, onOpen, veiled }: { panelOpen: boolean; onOpen: () => void; veiled: boolean }) {
  const weightAt = useFrameReadableWeight();
  const t = useT();
  const layout = useFrameLayout();
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const displayLayer = useEditorStore((s) => s.displayLayer);
  const run = useRunCommand();
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const { place } = useDockStage();
  const shown = displayLayer ?? activeLayer;
  const zoom = useFrameZoom();
  const countRef = useRef<HTMLButtonElement>(null);
  const [lane, setLane] = useState<number | null>(null);
  const word = layerName(t, shown);
  useLayoutEffect(() => {
    const measure = () => {
      const el = countRef.current;
      if (!el) { setLane(null); return; }
      const box = visualRect(el);
      setLane(readoutPressLane(
        { left: box.left / zoom, width: box.width / zoom },
        // A docked panel is at the other end of the window and the two can never meet, so the lane
        // is the word's own; free, it stands where this measurement is against.
        assistantOpen && place === 'free' ? PANEL_RIGHT : null,
      ));
    };
    measure();
    // The lane is the room between two edges of the window, so a resize moves it with neither the
    // word nor the zoom changing.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [place, zoom, word, panelOpen, assistantOpen]);
  return (
    <div
      data-testid="shell-layer-control"
      {...helpTargetAttr('layers')}
      {...mapEdgeAttr('right')}
      style={{
        ...group, top: layout?.railTop ?? RAIL_TOP, right: (layout?.edgeRight ?? EDGE_RIGHT) + LAYER_STEP_RIGHT - EDGE_RIGHT, flexDirection: 'row', gap: RAIL.layer.gap,
        opacity: veiled ? 0 : 1,
        visibility: veiled ? 'hidden' : 'visible',
        transition: [veilTransition(veiled), cssMotion('frame.layout.adapt', ['top'])].join(', '),
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
              ...btnReset, ...inGroup, display: 'flex', borderRadius: radii.pill, cursor: cursors.clickable,
              // Where a panel stands under part of the word the box itself goes deaf and the lane
              // below re-claims what is clear of it. The lane is a child, so a press on it still
              // reaches this button's own `onClick`.
              ...(lane === null ? null : { position: 'relative', pointerEvents: 'none' }),
            }}
          >
            <span
              data-testid="shell-layer-readout"
              role="status"
              style={{
                ...MAP_LABEL,
                fontSize: TEXT.readout, fontWeight: weightAt(900, TEXT.readout), lineHeight: 1,
                whiteSpace: 'nowrap',
                ...(layout?.compact ? { maxWidth: RAIL.button * 2.5, overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
              }}
            >
              {word}
            </span>
            {lane !== null && lane > 0 && (
              <span
                data-testid="shell-layer-readout-press"
                aria-hidden
                // Never wider than the word itself: the air between the word and the panel is the
                // map's, exactly as the air inside a rail group is (`group`).
                style={{
                  position: 'absolute', top: 0, bottom: 0, right: 0, width: '100%', maxWidth: lane,
                  pointerEvents: 'auto', cursor: cursors.clickable,
                }}
              />
            )}
          </ActionButton>
          <div
            style={{
              width: RAIL.layer.w, height: RAIL.layer.h, flex: 'none',
              display: 'flex', flexDirection: 'column',
              // No clip here: each step already clips its own half of the drawing, and a clip on
              // the plate would take a focused step's ring with it.
              background: DARK_PLATE, borderRadius: radii.pill,
            }}
          >
            <LayerStep
              label={t('a11y.add_layer')}
              half="top"
              disabled={activeLayer >= ELEVATION_MAX}
              onPress={() => run('layer.up')}
            />
            <LayerStep
              label={t('a11y.remove_layer')}
              half="bottom"
              disabled={activeLayer <= 0}
              onPress={() => run('layer.down')}
            />
          </div>
        </>
      )}
    </div>
  );
}
