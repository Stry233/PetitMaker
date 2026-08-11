/*
 * AssistantBody — the assistant's CONNECTED face, and the only part of the panel that pulls the LLM
 * SDKs in. It is loaded lazily for that reason, so the character, its plate and the not-connected
 * card can be drawn from the main bundle.
 *
 * It is the Site Log, mounted UNCHANGED — the header row, the dock, the log and the composer, with
 * every entry kind the turn runner can produce — inside an `AgentFrame` that gives it this column's
 * rect and the two surface colours the design paints it in. Nothing about the session, the runner or
 * the tool bridge is repeated here; the panel is a place for them to stand.
 */
import { useEditorStore } from '../../../state/store';
import { host } from '../../../kit/host';
import { AgentFrameProvider } from '../../agent/frame';
import { SiteLogSection } from '../../agent/SiteLogSection';
import { PLATE } from '../../design/tokens';
import { COMPOSER_FOOT, CONTENT_W, PAD_X } from './assistant-frame';

/** Design px of breathing room between the plate's edge and the column's content. */
const PAD_Y = 30;

export interface AssistantBodyProps {
  /** Design height of the plate, which is what the section fills. */
  plateHeight: number;
}

export function AssistantBody({ plateHeight }: AssistantBodyProps) {
  const region = useEditorStore((s) => s.region);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setRegion = useEditorStore((s) => s.setRegion);
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  const height = plateHeight - PAD_Y * 2;
  return (
    <AgentFrameProvider
      value={{
        x: PAD_X,
        w: CONTENT_W,
        height,
        composerTop: height - COMPOSER_FOOT,
        paper: PLATE,
        pad: '#FFFFFF',
      }}
    >
      <SiteLogSection
        top={PAD_Y}
        regionSize={region.length}
        isSelecting={selectingRegion}
        onSelectRegion={() => { setSelectingRegion(true); setRegion([]); }}
        onClearRegion={() => { setRegion([]); setSelectingRegion(false); host.buildableRegion.clear(); }}
      />
    </AgentFrameProvider>
  );
}
