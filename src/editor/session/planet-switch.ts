/** Changing the open planet, carrying the build across or starting over. */
import type { MapTemplate } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { currentEditor, editorPort } from './context';
import { newMap, transferMap, type TransferOutcome } from '../operations';

/** What carrying the build reported, or null where the planet started over. */
export type PlanetChange = TransferOutcome | null;

/** Opens `target`, carrying the build when asked and possible, and puts the armed tool down. */
export function switchPlanet(target: string | MapTemplate, carry: boolean): PlanetChange {
  const kit = carry ? currentEditor() : null;
  const outcome = kit ? transferMap(editorPort, kit, { target, carry: true }) : null;
  if (!outcome) newMap(editorPort, target);
  useEditorStore.getState().setEditMode({ mode: null });
  return outcome;
}
