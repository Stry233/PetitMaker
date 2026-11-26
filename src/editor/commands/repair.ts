/**
 * The commands that answer the editor's two standing questions over a map: the repair a map asks as
 * it opens (the choice, then a hand repair's plate) and what becomes of an unfinished note when
 * something would end it. Each calls the verb its control calls, so a caller that opened a map into
 * the repair's choice can answer it and leave a hand repair.
 */
import type { RelocationResult } from '../../tools/repair';
import { useEditorStore } from '../../state/store';
import { cancelRepair, finishRepair, repairAutomatically, repairByHand, repairTheRest } from '../session/landmark-repair';
import { type Command, refuse } from './types';

const store = () => useEditorStore.getState();

const REPAIR_WAYS = ['automatic', 'by_hand'] as const;
const DISCARD_ANSWERS = ['save', 'discard', 'cancel'] as const;

const NO_HAND_REPAIR = 'No map is under a hand repair.';

/** What a landed plan did, as a caller reads it. */
const landed = ({ moved, removed, unplanned }: RelocationResult): string => (
  `${moved} moved, ${removed} removed${unplanned > 0 ? `, ${unplanned} left for the user to place` : ''}`
);

export const REPAIR_COMMANDS: readonly Command[] = [
  {
    id: 'repair.apply', effect: 'outward', target: 'map', labelKey: 'repair.title',
    description: 'Answers the repair a map asks as it opens, and opens that map in place of the open one. automatic lands the planned moves as one undo step; by_hand opens it with the objects where the file had them, for the user to move or delete each, and applies only to a map whose repair moves objects. The map that was open comes back only by cancelling a hand repair.',
    args: [{
      name: 'how', kind: 'enum', values: REPAIR_WAYS, labels: { automatic: 'repair.auto', by_hand: 'repair.hand' },
      description: 'How the map is repaired.',
    }],
    invoke({ how }) {
      if (store().repairSession?.phase !== 'choose') return refuse('No map is waiting for its repair to be chosen.');
      if (how === 'by_hand') {
        return repairByHand()
          ? 'The map is open under a hand repair, its objects where the file had them.'
          : refuse('This map\'s repair moves no objects, so it has only the automatic repair.');
      }
      const result = repairAutomatically();
      return `The map is open, repaired automatically${result ? `: ${landed(result)}` : ''}.`;
    },
  },
  {
    id: 'repair.cancel', effect: 'destroy', target: 'map', labelKey: 'delete.cancel',
    description: 'Drops the map that asked a repair, with whatever a hand repair did to it, and leaves or brings back the map that was open before, with its history.',
    args: [],
    invoke() {
      const session = store().repairSession;
      if (!session) return refuse('No repair is under way.');
      cancelRepair();
      return session.phase === 'choose'
        ? 'The map that asked the repair was not opened; the open map is as it was.'
        : 'The hand repair was dropped and the map that was open before it is back.';
    },
  },
  {
    id: 'repair.rest', effect: 'change', target: 'map', labelKey: 'repair.rest',
    description: 'Repairs automatically, as one undo step, the objects a hand repair still has to place.',
    args: [],
    invoke() {
      const result = repairTheRest();
      return result ? `The rest was repaired: ${landed(result)}.` : refuse(NO_HAND_REPAIR);
    },
  },
  {
    id: 'repair.finish', effect: 'outward', target: 'map', labelKey: 'repair.finish',
    description: 'Ends a hand repair once every object stands within the rules: the map opens with a fresh history, and the map that was open before the repair is let go.',
    args: [],
    invoke() {
      if (store().repairSession?.phase !== 'hand') return refuse(NO_HAND_REPAIR);
      if (finishRepair()) return 'The hand repair is finished and the map is open.';
      const session = store().repairSession;
      const left = session?.phase === 'hand' ? session.left.length : 0;
      if (left === 0) return refuse('The map does not pass the rules yet.');
      return refuse(left === 1 ? 'One object still stands against the rules.' : `${left} objects still stand against the rules.`);
    },
  },
  {
    id: 'notes.discard_answer', effect: 'outward', target: 'map', labelKey: 'annot.discard_title',
    description: 'Answers what becomes of the unfinished note when something would end it: save keeps it on the map and goes on, discard drops it for good and goes on, cancel keeps writing it and drops what asked.',
    args: [{
      name: 'answer', kind: 'enum', values: DISCARD_ANSWERS, labels: { save: 'annot.save', discard: 'annot.discard', cancel: 'delete.cancel' },
      description: 'The answer to give.',
    }],
    invoke({ answer }) {
      const s = store();
      if (s.annotationDiscardAction === null) return refuse('No unfinished note is waiting for an answer.');
      if (answer === 'save') s.confirmAnnotationSave();
      else if (answer === 'discard') s.confirmAnnotationDiscard();
      else s.cancelAnnotationDiscard();
      return answer === 'cancel' ? 'The note is still being written.' : `The unfinished note was ${answer === 'save' ? 'saved' : 'discarded'}.`;
    },
  },
];
