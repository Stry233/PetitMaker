/*
 * The column's half of the shared region: the brush toggle, the outline while the panel is open,
 * and one boundary pulse per blocked write. The generate shelf may own the same brush.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { PanelView } from '../../../agent/panel';
import { host } from '../../../editor/host/host';
import {
  clearRegion, releaseAgentRegion, releaseRegionOutline, showRegion, toggleAgentRegion,
} from '../../../editor/editing/region-brush';
import { regionBounds, type RegionBounds } from '../../../core/grid/rect';
import { useEditorStore } from '../../../state/store';
import { amplitude, seconds } from '../../design/motion';
import { RegionVignette } from '../composer/region-chip';
import type { PanelRegionProps } from '../panel-shell-props';

/** Renders the live region at the requested thumbnail size. */
function regionShot(bounds: RegionBounds, width: number, height: number) {
  return <RegionVignette bounds={bounds} width={width} height={height} />;
}

export function usePanelRegion(open: boolean, view: PanelView) {
  // This shared region is both the visible selection and the agent write boundary.
  const region = useEditorStore((s) => s.region);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const liveRegion = useMemo(() => regionBounds(region), [region]);

  /** Whether this panel, rather than the generate shelf, armed the shared region brush. */
  const armedHere = useEditorStore((s) => s.selectingRegion && s.regionSelectionOwner === 'agent');
  // Closing the panel disarms a brush it owns and removes the overlay.
  useEffect(() => {
    if (open || !armedHere) return;
    releaseAgentRegion();
  }, [open, armedHere]);

  // Keep the region outlined while open; preserve an overlay owned by active map scope controls.
  useEffect(() => {
    if (!open) return undefined;
    showRegion(region, false);
    return releaseRegionOutline;
  }, [open, region]);

  // Pulse once per blocked write call to identify the active region boundary.
  const blockedCallId = view.current?.ops.filter((op) => op.status === 'blocked').slice(-1)[0]?.callId;
  const pulsed = useRef<string | null>(null);
  useEffect(() => {
    if (blockedCallId === undefined || pulsed.current === blockedCallId) return;
    pulsed.current = blockedCallId;
    host.buildableRegion.pulse(seconds('panel.region.pulse') * 1000, amplitude('panel.region.pulse') ?? 0);
  }, [blockedCallId]);

  const group: PanelRegionProps = { bounds: liveRegion, marking: selectingRegion, onMarkRegion: toggleAgentRegion, onClearRegion: clearRegion };
  return { region: group, regionShot };
}
