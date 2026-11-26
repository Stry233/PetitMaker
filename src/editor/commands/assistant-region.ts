/**
 * The commands over the region the assistant works inside: arming its brush and clearing what was
 * painted. Both act on the map, so a caller that is offered only the app's commands gets neither.
 */
import { paintsRegion, regionOf } from '../../state/editing/region';
import { useEditorStore } from '../../state/store';
import { clearRegion, toggleAgentRegion } from '../editing/region-brush';
import { type Command, refuse } from './types';

const store = () => useEditorStore.getState();

const OTHER_BRUSH = 'Another surface is marking a region now.';
/** The session puts the brush down behind a closed panel (`editing/region-brush.ts:watchAgentRegionBrush`). */
const NOT_ARMED = `${OTHER_BRUSH.slice(0, -1)}, or the assistant panel is closed, where its brush does not paint.`;

export const ASSISTANT_REGION_COMMANDS: readonly Command[] = [
  {
    id: 'assistant.region_marking', effect: 'change', target: 'map', labelKey: 'agent.region_mark',
    description: 'Whether the assistant\'s region brush paints: the area painted with it is the only place the assistant may edit.',
    args: [{ name: 'on', kind: 'boolean', optional: true, description: 'Whether the brush paints; left out, the command switches it.' }],
    current: () => paintsRegion(store(), 'agent'),
    invoke({ on }) {
      const painting = paintsRegion(store(), 'agent');
      const want = on === undefined ? !painting : on === true;
      if (want !== painting) toggleAgentRegion();
      return paintsRegion(store(), 'agent') === want ? `assistant.region_marking is now ${want ? 'on' : 'off'}.` : refuse(NOT_ARMED);
    },
  },
  {
    id: 'assistant.region_clear', effect: 'change', target: 'map', labelKey: 'agent.region_detach',
    description: 'Clears the region painted for the assistant, so it may edit the whole map again.',
    args: [],
    invoke() {
      clearRegion('agent');
      return regionOf(store(), 'agent').length === 0 ? 'The assistant\'s region was cleared.' : refuse(OTHER_BRUSH);
    },
  },
];
