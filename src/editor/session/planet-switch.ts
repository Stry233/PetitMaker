/** Changing the open planet, carrying the build across or starting over: what Change Planet offers
 *  and what its main action does, and the switch itself (`changePlanet`), run once at a time, which
 *  closes the window and announces the arrival for every caller. */
import type { MapTemplate } from '../../core/model/types';
import type { Locale } from '../../core/model/locale';
import { isCustomTemplate } from '../../core/model/planet';
import { MAP_LIST } from '../../config/maps';
import { translate } from '../../i18n/context';
import { onAfterPaint } from '../../platform/async/after-paint';
import { showToast } from '../../platform/channels/toast-bus';
import { planetEntryFor, type PlanetEntry } from './planet-library';
import { shownPlanetName } from './planet-names';
import { useEditorStore } from '../../state/store';
import { clearUnderLandmarks } from '../../tools/repair';
import { cloneGridState } from '../../core/model/grid-model';
import { announceArrival, transferArrival } from './arrival';
import { currentEditor, editorPort, type EditorPort } from './context';
import { openThroughRepair } from './landmark-repair';
import { newMap, transferMap, type TransferOutcome } from '../operations';

/** What carrying the build reported, or null where the planet started over. */
type PlanetChange = TransferOutcome | null;

/** The editor's port with a carried map opened as any loaded map is: through the load's repair and
 *  its gate (`landmark-repair.ts:openThroughRepair`). */
const carryPort: EditorPort = {
  ...editorPort,
  installLoaded: (state, registry) => {
    // The carried map before the clearance, for Export first: its cells and objects copied, the rest shared.
    const asCarried = { ...state, ...cloneGridState(state) };
    const { report } = clearUnderLandmarks(state, registry);
    openThroughRepair(report, state, () => editorPort.installLoaded(state, registry), { kind: 'map', state: asCarried });
  },
};

/** Opens `target`, carrying the build when asked and possible, and puts the armed tool down. */
export function switchPlanet(target: string | MapTemplate, carry: boolean): PlanetChange {
  const kit = carry ? currentEditor() : null;
  const outcome = kit ? transferMap(carryPort, kit, { target, carry: true }) : null;
  if (!outcome) newMap(editorPort, target);
  useEditorStore.getState().setEditMode({ mode: null });
  return outcome;
}

/** One planet the window can choose: a built-in by its template id, a saved one by its entry id, and an
 *  unsaved current planet by its template id with no entry. */
export interface PlanetChoice { key: string; name: string; template: MapTemplate; entry: PlanetEntry | null }

/** The planets the window lists: the built-ins in their order, then My planets. */
function planetChoices(entries: readonly PlanetEntry[], locale: Locale): { builtin: PlanetChoice[]; mine: PlanetChoice[] } {
  return {
    builtin: MAP_LIST.map((template) => ({ key: template.id, name: shownPlanetName(template, locale), template, entry: null })),
    mine: entries.map((entry) => ({ key: entry.entryId, name: entry.name, template: entry.template, entry })),
  };
}

/** What the window reads to know what a switch would do. */
interface PickInputs {
  /** The library's entries as shown. */
  entries: readonly PlanetEntry[];
  locale: Locale;
  /** The planet the map stands on, and its shown name. */
  here: { template: MapTemplate; name: string } | null;
  /** The visitor's pick, null for the planet the map stands on. */
  chosenKey: string | null;
}

interface PlanetPick {
  /** The row for the planet the map stands on where neither list holds it: its saved shape was
   *  edited or deleted, or saving it failed. It still gets its row, so it can be started over. */
  current: PlanetChoice | undefined;
  builtin: PlanetChoice[];
  mine: PlanetChoice[];
  /** The pick, else the planet the map stands on, else the first built-in. */
  chosen: PlanetChoice;
  /** The pick is the planet the map stands on: the switch starts it over. */
  startingOver: boolean;
  /** What the switch opens: a built-in by its id, any other planet by its template, which no id lookup can find. */
  target: string | MapTemplate;
}

export function planetPick({ entries, locale, here, chosenKey }: PickInputs): PlanetPick {
  const choices = planetChoices(entries, locale);
  const hereId = here?.template.id;
  const listed = [...choices.builtin, ...choices.mine].some((c) => c.template.id === hereId);
  const current: PlanetChoice | undefined = listed || !here
    ? undefined
    : { key: here.template.id, name: here.name, template: here.template, entry: null };
  const all = [...(current ? [current] : []), ...choices.builtin, ...choices.mine];
  // A copy shares its original's template id; the entry that names the map's planet is the current one.
  const hereEntryId = here ? planetEntryFor(here.template)?.entryId : undefined;
  const currentChoice = all.find((c) => c.entry !== null && c.entry.entryId === hereEntryId) ?? all.find((c) => c.template.id === hereId);
  const chosen = all.find((c) => c.key === chosenKey) ?? currentChoice ?? choices.builtin[0]!;
  return {
    current, ...choices, chosen,
    startingOver: chosen.template.id === hereId,
    target: isCustomTemplate(chosen.template) ? chosen.template : chosen.key,
  };
}

/** Where the window stands: choosing the planet, or asking whether the build comes along. */
export type SwitchStep = 'pick' | 'carry';

/** What the window's footer offers on `step`: the main action's verb (switch to the pick, start it
 *  over, or go on to the carry question), whether it is unavailable (starting over a map with
 *  nothing on it), and whether Export first stands beside it, which it does wherever the switch
 *  would leave edits not yet exported behind. */
export function switchFooter(f: { step: SwitchStep; startingOver: boolean; hasBuild: boolean; unsaved: boolean }): {
  verb: 'switch' | 'start-over' | 'next'; disabled: boolean; exportFirst: boolean;
} {
  const asks = f.step === 'carry' || !(f.startingOver || f.hasBuild);
  return {
    verb: asks ? 'switch' : f.startingOver ? 'start-over' : 'next',
    disabled: f.step === 'pick' && f.startingOver && !f.hasBuild,
    exportFirst: f.unsaved && (f.step === 'carry' || (f.startingOver && f.hasBuild)),
  };
}

/** What the main action does on the pick step: switch at once where it starts the planet over or
 *  there is nothing to carry, else ask about the carry. */
export function pickStepGoes(startingOver: boolean, hasBuild: boolean): 'switch' | 'carry' {
  return startingOver || !hasBuild ? 'switch' : 'carry';
}

/** How a switch ended: what its carry reported, null where the planet started over, or that it threw. */
type PlanetSwitchEnd = PlanetChange | 'failed';

/**
 * Moves the map to `target` as Change Planet's main action and `planets.switch` both do, one switch
 * at a time, after the busy state paints, since the replay takes the thread. A switch that ran
 * closes Change Planet and announces the arrival (`arrival.ts`) to whichever surface says it; one
 * that throws leaves the visitor where they were with the window working, and says so. `settled`
 * hears how it ended. False when a switch is already under way.
 */
export function changePlanet(target: string | MapTemplate, carry: boolean, settled?: (end: PlanetSwitchEnd) => void): boolean {
  const store = useEditorStore.getState();
  if (store.planetSwitching) return false;
  store.setPlanetSwitching(true);
  onAfterPaint(() => {
    let end: PlanetSwitchEnd = 'failed';
    try {
      end = switchPlanet(target, carry);
    } catch (error) {
      console.error('[planet] switch failed', error);
      showToast(translate('planet.switch_failed'), 'error');
    } finally {
      useEditorStore.getState().setPlanetSwitching(false);
    }
    if (end !== 'failed') {
      useEditorStore.getState().setModal('newProject', false);
      announceArrival(transferArrival(end));
    }
    settled?.(end);
  });
  return true;
}
