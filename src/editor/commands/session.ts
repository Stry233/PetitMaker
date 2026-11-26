/**
 * The commands over the session this browser saved: the answers to the welcome-back offer. Both act
 * on the map, since resuming replaces it and declining lets the saved one go, so no job is offered them.
 */
import { restoreOfferShown } from '../../state/greetings';
import { useEditorStore } from '../../state/store';
import { acceptRestoreOffer, declineRestoreOffer, restoreOffer } from '../session/restore';
import { type Command, refuse } from './types';

const NO_OFFER = 'No saved session is on offer: the offer stands once, as the page opens, until it is answered or the user sets to work.';

export const SESSION_COMMANDS: readonly Command[] = [
  {
    id: 'session.restore', effect: 'destroy', target: 'map', labelKey: 'restore.resume',
    description: 'Resumes the session this browser saved, as Resume does on the welcome-back offer: the saved map takes the open map\'s place, with its undo history and its camera, and the open map is not kept. It runs only while that offer is on screen.',
    args: [],
    invoke() {
      if (!restoreOffer()) return refuse(NO_OFFER);
      const s = useEditorStore.getState();
      if (!restoreOfferShown(s, { inSession: s.planetSession !== null })) return refuse('The welcome-back offer is not on screen now; it waits behind the welcome tips, the assistant\'s panel, What\'s new or a repair.');
      acceptRestoreOffer();
      return useEditorStore.getState().repairSession
        ? 'The saved session changes what stands under a landmark, so it opens once the user has chosen in the repair window.'
        : 'The saved session is open in place of the map that was.';
    },
  },
  {
    id: 'session.decline_restore', effect: 'destroy', target: 'map', labelKey: 'restore.fresh',
    description: 'Declines the welcome-back offer, as Start fresh does: the open map stays, and the saved session is let go for good, with the assistant\'s conversation about it.',
    args: [],
    invoke() {
      if (!restoreOffer()) return refuse(NO_OFFER);
      declineRestoreOffer();
      return 'The saved session was let go; the open map stays.';
    },
  },
];
