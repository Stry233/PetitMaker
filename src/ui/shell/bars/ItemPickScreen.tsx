/*
 * ItemPickScreen.tsx — choosing what a LETTER is built out of, which is the item shelf standing in
 * for the generate shelf.
 *
 * IT IS THAT SHELF, NOT A LIST OF OUR OWN, for the same reason `ScopeScreen` wears the terrain bar's
 * layout: the item row already scrolls, searches, tabs by category and reads an item's colours, and a
 * second one here would be a second thing to keep in step with the catalog.
 *
 * IT IS NOT THE PLACEMENT TOOL, THOUGH, any more than the scope screen is really the terrain bar. A
 * press here REPORTS the item (`ObjectShelf`'s `pick`) instead of writing `editMode`, so nothing is
 * armed, the map is not left under a placement cursor, and the object block in the mode row does not
 * light up for a press that was answering the generator's question.
 *
 * IT OFFERS ONLY WHAT CAN TILE. A letter needs the same item many times over, so every unique cabin
 * (`maxCount: 1`) is unusable: pick one and the letter's second cell onward is refused, for a reason
 * nothing on screen explains. `tilesAShape` reads the ITEM rather than a list of ids, so a catalog
 * addition is offered or excluded on its own terms — and the categories left holding nothing are
 * dropped from the row of names with it.
 */
import { tilesAShape } from '../../../tools/generation/stencil';
import { ObjectShelf } from './ObjectShelf';

export function ItemPickScreen({ current, onPicked }: {
  /** The item the generator is already set to, so the row can show which one that is. */
  current: string | null;
  /** Called with the chosen catalog id. The screen closes itself by reporting; it holds no state, and
   *  the press on the card WAS the confirmation, so there is nothing else to press. */
  onPicked: (catalogId: string) => void;
}) {
  return <ObjectShelf only={tilesAShape} pick={{ current, onPick: onPicked }} />;
}
