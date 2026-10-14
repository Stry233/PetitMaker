/*
 * Choosing a letter's item is the item shelf standing in for the generate shelf, as a chooser (`pick`)
 * that arms nothing. It offers only items that can tile (`tilesAShape`: no `maxCount`), dropping
 * categories left empty.
 */
import { tilesAShape } from '../../../../tools/generation/stencil';
import { ObjectShelf } from '../objects/ObjectShelf';

export function ItemPickScreen({ current, onPicked }: {
  /** The item the generator is already set to, so the row can show which one that is. */
  current: string | null;
  /** Called with the chosen catalog id. The screen closes itself by reporting; it holds no state, and
   *  the press on the card was the confirmation, so there is nothing else to press. */
  onPicked: (catalogId: string) => void;
}) {
  return <ObjectShelf only={tilesAShape} pick={{ current, onPick: onPicked }} />;
}
