/**
 * The landmark repair of a map just opened: from the moment a load's compatibility report holds
 * objects to move until the visitor has chosen how they move and, for a hand repair, finished it.
 *
 * Self-contained: no setter here reads another slice.
 */
import type { StateCreator } from 'zustand';
import type { GridState } from '../../core/model/types';
import type { CompatibilityReport } from '../landmark-clearance';
import type { ParkedEditor } from './planet-session';

/** `choose`: the choice is asked over the map that was open, which nothing has touched; the decoded
 *  map waits in `pending`. `hand`: the decoded map is open with the objects where the save had them,
 *  and the visitor moves or deletes each. */
export type RepairPhase = RepairSession['phase'];

/** The map a load brought as it came, before any repair, for Export first: the file opened, as read
 *  and under the name it came with (`file`), or the map as decoded or carried (`map`), written out as
 *  a save file. */
export type LoadedOriginal =
  | { kind: 'file'; file: Blob; name: string; format: 'json' | 'image' }
  | { kind: 'map'; state: GridState };

export type RepairSession =
  | {
    phase: 'choose';
    /** What the load found, with the planner's proposals. */
    report: CompatibilityReport;
    /** The decoded map, off the store; the choice's pictures read it. */
    pending: GridState;
    /** Opens `pending` as the live map, with what the load carries beside it (history, camera, notes). */
    install: () => void;
    /** The map as the load brought it, unrepaired; never the open map. */
    original: LoadedOriginal;
  }
  | {
    phase: 'hand';
    report: CompatibilityReport;
    /** The editor Cancel brings back: the map that was open before this one, as it was. */
    cancelTo: ParkedEditor | null;
    /** The report's objects that still stand against the rules, in report order. */
    left: readonly string[];
  };

/** The modes a hand repair offers: none, so only selection, moving and deleting act. */
export const REPAIR_BUILD_MODES = [] as const;

export interface RepairSessionSlice {
  /** Null when no repair is under way. */
  repairSession: RepairSession | null;
  setRepairSession: (session: RepairSession | null) => void;
}

export const createRepairSessionSlice: StateCreator<RepairSessionSlice, [], [], RepairSessionSlice> = (set) => ({
  repairSession: null,
  setRepairSession: (repairSession) => set({ repairSession }),
});
