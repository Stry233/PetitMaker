import { useCallback, useReducer } from 'react';
import {
  initialZone, reduceZone, repairSteps, sameFacts, sendZoneEvent,
  type PanelZone, type RepairAct, type RepairStep, type ZoneEvent, type ZoneFacts,
} from '../../../agent/panel';

/** The job zone's one value; a change in the facts it answers to is applied as it renders. */
export function usePanelZone(facts: ZoneFacts, initial?: PanelZone): {
  zone: PanelZone;
  dispatch(event: ZoneEvent): void;
  /** What a repair does as the zone stands now, in order. */
  repairSteps(act: RepairAct): readonly RepairStep[];
} {
  const [state, reduce] = useReducer(reduceZone, undefined, () => initialZone(facts, initial));
  if (!sameFacts(state.facts, facts)) reduce({ type: 'facts', facts });
  const dispatch = useCallback((event: ZoneEvent) => sendZoneEvent(reduce, event), []);
  return { zone: state.zone, dispatch, repairSteps: (act) => repairSteps(act, state) };
}
