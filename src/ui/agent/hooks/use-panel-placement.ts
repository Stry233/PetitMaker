/*
 * Where the panel stands: free inside the frame, or pinned to a window edge where it follows the
 * sheet's parallax. Pin intent persists; a narrow window releases the pin without clearing it. On an
 * upright window the open panel always stands at the foot, as deep as the dock's depth.
 */
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { showToast } from '../../../platform/channels/toast-bus';
import type { Translate } from '../../../i18n/keys';
import { useEditorStore } from '../../../state/store';
import { cssMotion } from '../../design/motion';
import { z } from '../../design/styles';
import {
  PINNED_PANEL, bottomDockHeight, dockDrift, dockEdge, panelMaxHeight, panelTop,
} from '../../shell/panel-frame';
import { axisOf, dockAside, useDockDepth, useDockStage, usePinRoom } from '../../shell/use-dock';
import { useFrameLayout } from '../../shell/frame-layout';
import { LANDSCAPE_BAR, LANDSCAPE_PANEL } from '../../shell/frame-plan';
import { GATE_BORROW, JOB_ZONE_FLOOR, PINNED_HEIGHT } from '../desk/plate';

/** Minimum usable height: fixed panel chrome plus the minimum job zone. */
const PANEL_LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;

export function usePanelPlacement({ t, veiled, planGateStanding }: {
  t: Translate;
  veiled: boolean;
  /** Only an actionable plan gate borrows extra vertical space. */
  planGateStanding: boolean;
}) {
  const mode = useEditorStore((s) => s.editMode.mode);
  const pinRoom = usePinRoom();
  const pinIntent = useEditorStore((s) => s.assistantPinned);
  const setPinned = useEditorStore((s) => s.setAssistantPinned);
  const setSide = useEditorStore((s) => s.setAssistantDockSide);
  const togglePin = useCallback(() => { setPinned(!useEditorStore.getState().assistantPinned); }, [setPinned]);
  const switchSide = useCallback(() => {
    setSide(useEditorStore.getState().assistantDockSide === 'left' ? 'right' : 'left');
  }, [setSide]);
  const { place, edge, aside } = useDockStage();
  const axis = axisOf(edge);
  const depth = useDockDepth();
  // Notify only when an already-usable pin loses room on a wide window; an upright one docks at its
  // foot whatever the width, so a turn to it loses nothing.
  const hadRoom = useRef(pinRoom);
  useEffect(() => {
    const lost = hadRoom.current && !pinRoom;
    hadRoom.current = pinRoom;
    if (lost && pinIntent && axis === 'x') showToast(t('agent.pin_no_room'), 'info');
  }, [pinRoom, pinIntent, axis, t]);

  const layout = useFrameLayout();
  const { left, top } = layout?.panel ?? LANDSCAPE_PANEL;
  const tabsTop = (layout?.bar ?? LANDSCAPE_BAR).tabsTop;
  const pinned = place === 'ground';
  const maxHeight = !pinned
    ? panelMaxHeight(mode, PANEL_LEAST, planGateStanding ? GATE_BORROW : 0, { top, tabsTop })
    : edge === 'bottom' ? bottomDockHeight(depth) : PINNED_PANEL.height;
  const drift = dockDrift(aside, edge);
  // MotionValue updates transform between React renders; cleanup removes the parallax transform.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return undefined;
    // The listener styles the current element, so the cleanup resets that one.
    const wrap = wrapRef;
    const off = dockAside.on('change', (v) => {
      const el = wrap.current;
      if (!el) return;
      el.style.transform = dockDrift(v, edge);
    });
    return () => {
      off();
      if (wrap.current) wrap.current.style.transform = '';
    };
  }, [pinned, edge]);
  const away = place === 'leaving' || place === 'folded';
  const wrapper: CSSProperties = useMemo(() => ({
    position: 'fixed',
    ...(!pinned ? { left, top: panelTop(PANEL_LEAST, top) }
      : edge === 'bottom' ? { left: 0, right: 0, bottom: 0, height: maxHeight, flexDirection: 'column' }
      : { [dockEdge(edge)]: PINNED_PANEL.edge, top: PINNED_PANEL.top, bottom: 0 }),
    display: 'flex',
    // Invisible pin phases must not intercept map input.
    pointerEvents: away ? 'none' : 'auto',
    zIndex: pinned ? z.ground : planGateStanding ? z.column : z.panel,
    // Discrete visibility removes the veiled panel from hit testing and the accessibility tree.
    opacity: veiled ? 0 : 1,
    visibility: veiled ? 'hidden' : 'visible',
    transition: cssMotion(veiled ? 'frame.veil' : 'frame.unveil', ['opacity', 'visibility']),
    ...(pinned && drift !== '' ? { transform: drift } : null),
  } as CSSProperties), [pinned, edge, maxHeight, left, top, drift, planGateStanding, veiled, away]);

  return {
    wrapRef: wrapRef as RefObject<HTMLDivElement>,
    wrapper,
    maxHeight,
    place,
    edge,
    pinned,
    pinBlocked: !pinRoom,
    togglePin,
    switchSide,
  };
}
