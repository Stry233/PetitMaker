/** Changing the open planet, carrying the build across or starting over. */
import type { MapTemplate } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { clearUnderLandmarks } from '../../state/landmark-clearance';
import { cloneGridState } from '../../core/model/grid-model';
import { currentEditor, editorPort, type EditorPort } from './context';
import { openThroughRepair } from './landmark-repair';
import { newMap, transferMap, type TransferOutcome } from '../operations';

/** What carrying the build reported, or null where the planet started over. */
export type PlanetChange = TransferOutcome | null;

/** The editor's port with a carried map opened as any loaded map is: through the load's repair and
 *  its gate (`landmark-repair.ts:openThroughRepair`). */
const carryPort: EditorPort = {
  ...editorPort,
  installLoaded: (state, registry) => {
    // The carried map before the clearance, for Export first: its cells and objects copied, the rest shared.
    const asCarried = { ...state, ...cloneGridState(state) };
    const { report } = clearUnderLandmarks(state, registry);
    openThroughRepair(report, state, () => editorPort.installLoaded(state, registry), { kind: 'map', state: asCarried });
  },
};

/** Opens `target`, carrying the build when asked and possible, and puts the armed tool down. */
export function switchPlanet(target: string | MapTemplate, carry: boolean): PlanetChange {
  const kit = carry ? currentEditor() : null;
  const outcome = kit ? transferMap(carryPort, kit, { target, carry: true }) : null;
  if (!outcome) newMap(editorPort, target);
  useEditorStore.getState().setEditMode({ mode: null });
  return outcome;
}
