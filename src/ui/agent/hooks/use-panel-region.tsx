/*
 * The column's half of the region: the assistant's own brush toggle and one boundary pulse per
 * blocked write. The map shows its region while the panel is in front (`region-brush.ts:watchRegionOverlay`)
 * and the session puts the brush down as the panel closes; Generate's scope and a blueprint's frame
 * are their surfaces' own, which the panel neither reads nor ends.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { PanelView } from '../../../agent/panel';
import { host } from '../../../editor/host/host';
import { pressCommand } from '../../../editor/commands/run';
import { regionBounds, type RegionBounds } from '../../../core/grid/rect';
import { useEditorStore } from '../../../state/store';
import { paintsRegion, regionOf } from '../../../state/editing/region';
import { amplitude, seconds } from '../../design/motion';
import { RegionVignette } from '../composer/region-chip';
import type { PanelRegionProps } from '../panel-shell-props';

/** Renders the live region at the requested thumbnail size. */
function regionShot(bounds: RegionBounds, width: number, height: number) {
  return <RegionVignette bounds={bounds} width={width} height={height} />;
}

const markRegion = (): void => pressCommand('assistant.region_marking');
const clearRegion = (): void => pressCommand('assistant.region_clear');

export function usePanelRegion(view: PanelView) {
  // The assistant's region is both what the panel outlines and the agent's write boundary.
  const region = useEditorStore((s) => regionOf(s, 'agent'));
  const liveRegion = useMemo(() => regionBounds(region), [region]);

  /** Whether the panel's own brush is painting, rather than another surface's. */
  const armedHere = useEditorStore((s) => paintsRegion(s, 'agent'));

  // Pulse once per blocked write call to identify the active region boundary.
  const blockedCallId = view.current?.ops.filter((op) => op.status === 'blocked').slice(-1)[0]?.callId;
  const pulsed = useRef<string | null>(null);
  useEffect(() => {
    if (blockedCallId === undefined || pulsed.current === blockedCallId) return;
    pulsed.current = blockedCallId;
    host.buildableRegion.pulse(seconds('panel.region.pulse') * 1000, amplitude('panel.region.pulse') ?? 0);
  }, [blockedCallId]);

  const group: PanelRegionProps = { bounds: liveRegion, marking: armedHere, onMarkRegion: markRegion, onClearRegion: clearRegion };
  return { region: group, regionShot };
}
