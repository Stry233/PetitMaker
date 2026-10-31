/*
 * What a finger's object menu starts from the object it was opened on: each selects that object
 * alone first, as the selection card's actions act on the selection, and publishes one update.
 */
import { batchStore, useEditorStore } from '../../state/store';
import { pickSelection } from './pick-selection';
import { rotateSelection } from './group-edit';

const selectAlone = (id: string): void => useEditorStore.getState().setSelection([{ kind: 'object', id }]);

/** Arms what object `id` is made of, as Pick on the selection card does. */
export function pickObject(id: string): void {
  batchStore(() => {
    selectAlone(id);
    pickSelection();
  });
}

/** Turns object `id` a quarter clockwise, as Rotate on the selection card does. */
export function turnObjectQuarter(id: string): void {
  batchStore(() => {
    selectAlone(id);
    rotateSelection(90);
  });
}

/** Selects object `id` and latches the next one-finger drag to move it, wherever the drag starts. */
export function latchMove(id: string): void {
  batchStore(() => {
    selectAlone(id);
    useEditorStore.getState().setMoveLatched(true);
  });
}

/** Selects object `id` and latches multi-select, so taps add and remove and a drag bands. */
export function latchMultiSelect(id: string): void {
  batchStore(() => {
    selectAlone(id);
    useEditorStore.getState().setMultiSelectLatched(true);
  });
}
