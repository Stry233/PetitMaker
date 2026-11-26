/**
 * The commands over the generate shelf's batch: landing one of its cards on the map and clearing
 * what the last run generated. Each calls the verb the shelf's control calls, so a card lands as the
 * one undo step a press makes and says on the shelf what a press says.
 */
import { CANDIDATES } from '../../tools/generation/facts';
import { clearLastRun, landCard, type CardLanding } from '../editing/generate-batch';
import { type Command, refuse, NO_MAP } from './types';


/** Why a card's run did not land, for each way it does not. */
const NOT_LANDED: Readonly<Record<Exclude<CardLanding, 'landed'>, string>> = {
  closed: 'Generate is not open, so no batch of cards is on show.',
  unavailable: 'That card cannot be generated now: its picture is still being made, or it has no recipe.',
  busy: 'Another card is being generated.',
  cancelled: 'The run was cancelled or had nothing it could build; the map is as it was.',
  failed: 'The run did not build; the map is as it was.',
};

export const GENERATE_COMMANDS: readonly Command[] = [
  {
    id: 'generate.land', effect: 'change', target: 'map', labelKey: 'menu.generate',
    description: 'Generates one card of the batch Generate shows onto the map, as one undo step, in place of the card that stands.',
    args: [{
      name: 'card', kind: 'number', min: 0, max: CANDIDATES, integer: true,
      description: `The card in the row, counted from 0; ${CANDIDATES} is the user's own card after the dealt ones.`,
    }],
    async invoke({ card }) {
      const landing = await landCard(Number(card));
      return landing === 'landed' ? `Card ${Number(card)} was generated onto the map as one undo step.` : refuse(NOT_LANDED[landing]);
    },
  },
  {
    id: 'generate.clear', effect: 'change', target: 'map', labelKey: 'generate.clear_generated',
    description: 'Clears what Generate built within the last run\'s area, keeping what was placed by hand there.',
    args: [],
    invoke: () => (clearLastRun() ? 'What Generate built was cleared.' : refuse(NO_MAP)),
  },
];
