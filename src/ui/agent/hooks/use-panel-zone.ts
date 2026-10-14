import { useReducer } from 'react';
import {
  initialZone, keyNeedsDropping, reduceZone, sameFacts,
  type PanelZone, type ZoneEvent, type ZoneFacts,
} from '../derive/zone';

/** The job zone's one value; a change in the facts it answers to is applied as it renders. */
export function usePanelZone(facts: ZoneFacts, initial?: PanelZone): {
  zone: PanelZone;
  dispatch(event: ZoneEvent): void;
  /** Asking for a key now means the caller must first drop the held one. */
  keyNeedsDropping: boolean;
} {
  const [state, dispatch] = useReducer(reduceZone, undefined, () => initialZone(facts, initial));
  if (!sameFacts(state.facts, facts)) dispatch({ type: 'facts', facts });
  return { zone: state.zone, dispatch, keyNeedsDropping: keyNeedsDropping(state) };
}
