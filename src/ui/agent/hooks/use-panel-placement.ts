/*
 * Where the panel stands: free inside the frame, or pinned to a window edge where it follows the
 * sheet's parallax. Pin intent persists; a narrow window releases the pin without clearing it.
 */
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { showToast } from '../../../platform/channels/toast-bus';
import type { Translate } from '../../../i18n/keys';
import { useEditorStore } from '../../../state/store';
import { cssMotion } from '../../design/motion';
import { z } from '../../design/styles';
import {
  DOCK_PARALLAX, PANEL_LEFT, PINNED_PANEL, dockEdge, dockTravelSign, panelMaxHeight, panelTop,
} from '../../shell/panel-frame';
import { dockAside, useDockStage, usePinRoom } from '../../shell/use-dock';
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
  // Notify only when an already-usable pin loses room.
  const hadRoom = useRef(pinRoom);
  useEffect(() => {
    const lost = hadRoom.current && !pinRoom;
    hadRoom.current = pinRoom;
    if (lost && pinIntent) showToast(t('agent.pin_no_room'), 'info');
  }, [pinRoom, pinIntent, t]);

  const { place, side, aside } = useDockStage();
  const pinned = place === 'ground';
  const maxHeight = pinned
    ? PINNED_PANEL.height
    : panelMaxHeight(mode, PANEL_LEAST, planGateStanding ? GATE_BORROW : 0);
  const drift = (1 - aside) * DOCK_PARALLAX * dockTravelSign(side) * -1;
  // MotionValue updates transform between React renders; cleanup removes the parallax transform.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return undefined;
    // The listener styles the current element, so the cleanup resets that one.
    const wrap = wrapRef;
    const off = dockAside.on('change', (v) => {
      const el = wrap.current;
      if (!el) return;
      const d = (1 - v) * DOCK_PARALLAX * dockTravelSign(side) * -1;
      el.style.transform = d !== 0 ? `translateX(${d}px)` : '';
    });
    return () => {
      off();
      if (wrap.current) wrap.current.style.transform = '';
    };
  }, [pinned, side]);
  const away = place === 'leaving' || place === 'folded';
  const wrapper: CSSProperties = useMemo(() => ({
    position: 'fixed',
    ...(pinned
      ? { [dockEdge(side)]: PINNED_PANEL.edge, top: PINNED_PANEL.top, bottom: 0 }
      : { left: PANEL_LEFT, top: panelTop(PANEL_LEAST) }),
    display: 'flex',
    // Invisible pin phases must not intercept map input.
    pointerEvents: away ? 'none' : 'auto',
    zIndex: pinned ? z.ground : planGateStanding ? z.column : z.panel,
    // Discrete visibility removes the veiled panel from hit testing and the accessibility tree.
    opacity: veiled ? 0 : 1,
    visibility: veiled ? 'hidden' : 'visible',
    transition: cssMotion(veiled ? 'frame.veil' : 'frame.unveil', ['opacity', 'visibility']),
    ...(pinned && drift !== 0 ? { transform: `translateX(${drift}px)` } : null),
  } as CSSProperties), [pinned, side, drift, planGateStanding, veiled, away]);

  return {
    wrapRef: wrapRef as RefObject<HTMLDivElement>,
    wrapper,
    maxHeight,
    place,
    side,
    pinned,
    pinBlocked: !pinRoom,
    togglePin,
    switchSide,
  };
}
