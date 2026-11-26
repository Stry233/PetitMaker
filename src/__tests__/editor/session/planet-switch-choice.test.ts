/**
 * What Change Planet offers and what its main action does: which planet a switch opens and whether it
 * starts the map's own planet over, when the main action asks about the carry, the footer's verb and
 * Export first, and the switch every caller runs: one at a time, closing the window and announcing
 * the arrival, with a failed one leaving the window working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAP_LIST, getMapTemplate } from '../../../config/maps';
import { savePlanet } from '../../../io/storage/planet-library';
import { listPlanets } from '../../../editor/session/planet-library';
import { __resetArrivals, subscribeArrival, type Arrival } from '../../../editor/session/arrival';
import { editorPort } from '../../../editor/session/context';
import { newMap } from '../../../editor/operations';
import {
  changePlanet, pickStepGoes, planetPick, switchFooter,
} from '../../../editor/session/planet-switch';
import { useEditorStore } from '../../../state/store';
import { planetFixture } from '../../_support/planet';

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../../../platform/channels/toast-bus', async (actual) => ({
  ...await actual<typeof import('../../../platform/channels/toast-bus')>(),
  showToast: (text: string) => { toasts.push(text); },
}));

const builtIn = MAP_LIST[0]!;
const other = MAP_LIST[1]!;

beforeEach(() => { localStorage.clear(); toasts.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('the planet a switch opens', () => {
  it('starts the planet the map stands on over when nothing else is picked', () => {
    const pick = planetPick({ entries: [], locale: 'en', here: { template: builtIn, name: 'Here' }, chosenKey: null });
    expect(pick.current, 'a listed planet needs no row of its own').toBeUndefined();
    expect(pick.chosen.key).toBe(builtIn.id);
    expect(pick.startingOver).toBe(true);
    expect(pick.target).toBe(builtIn.id);
  });

  it('opens a built-in by its id and a saved planet by its template', () => {
    expect(planetPick({ entries: [], locale: 'en', here: { template: builtIn, name: 'Here' }, chosenKey: other.id }))
      .toMatchObject({ startingOver: false, target: other.id });
    const saved = savePlanet('Harbour', planetFixture(), { nameReviewed: true });
    if (!saved.ok) throw new Error('fixture save failed');
    const pick = planetPick({ entries: listPlanets(), locale: 'en', here: { template: builtIn, name: 'Here' }, chosenKey: saved.entry.entryId });
    expect(pick.target).toEqual(saved.entry.template);
    expect(pick.mine.map((c) => c.key)).toEqual([saved.entry.entryId]);
  });

  it('gives a map on a planet no list holds a row of its own, so it can be started over', () => {
    const unlisted = planetFixture();
    const pick = planetPick({ entries: [], locale: 'en', here: { template: unlisted, name: 'Lost' }, chosenKey: null });
    expect(pick.current).toMatchObject({ key: unlisted.id, name: 'Lost', entry: null });
    expect(pick.chosen).toBe(pick.current);
    expect(pick.startingOver).toBe(true);
    expect(pick.target).toBe(unlisted);
  });

  it('falls back to the first built-in when there is no map', () => {
    expect(planetPick({ entries: [], locale: 'en', here: null, chosenKey: 'gone' }).chosen.key).toBe(builtIn.id);
    expect(getMapTemplate(builtIn.id)).toBe(builtIn);
  });
});

describe("the window's main action", () => {
  it('switches at once where it starts over or nothing would come along, else asks about the carry', () => {
    expect(pickStepGoes(true, true)).toBe('switch');
    expect(pickStepGoes(false, false)).toBe('switch');
    expect(pickStepGoes(false, true)).toBe('carry');
  });

  it('names its verb, refuses starting over an empty map and offers Export first before unexported edits go', () => {
    expect(switchFooter({ step: 'pick', startingOver: false, hasBuild: true, unsaved: true }))
      .toEqual({ verb: 'next', disabled: false, exportFirst: false });
    expect(switchFooter({ step: 'pick', startingOver: true, hasBuild: true, unsaved: true }))
      .toEqual({ verb: 'start-over', disabled: false, exportFirst: true });
    expect(switchFooter({ step: 'pick', startingOver: true, hasBuild: false, unsaved: false }))
      .toEqual({ verb: 'start-over', disabled: true, exportFirst: false });
    expect(switchFooter({ step: 'carry', startingOver: false, hasBuild: true, unsaved: true }))
      .toEqual({ verb: 'switch', disabled: false, exportFirst: true });
    expect(switchFooter({ step: 'carry', startingOver: false, hasBuild: true, unsaved: false }).exportFirst).toBe(false);
  });

});

describe('the switch every caller runs', () => {
  const s = () => useEditorStore.getState();
  let heard: Arrival[];

  beforeEach(() => {
    vi.useFakeTimers();
    __resetArrivals();
    heard = [];
    subscribeArrival((arrival) => { heard.push(arrival); });
    newMap(editorPort, builtIn.id);
    s().setModal('newProject', true);
  });
  afterEach(() => { s().setModal('newProject', false); vi.restoreAllMocks(); });

  it('runs one at a time after the busy state paints, keeps Change planet open until it lands, then closes it and announces the arrival', async () => {
    const ended = vi.fn();
    expect(changePlanet(other.id, false, ended)).toBe(true);
    expect(useEditorStore.getState().planetSwitching).toBe(true);
    expect(changePlanet(builtIn.id, false), 'a second press while one runs').toBe(false);
    s().setModal('newProject', false);
    expect(s().modals.newProject, 'nothing closes the window under a running switch').toBe(true);
    expect(s().gridState!.template.id, 'the busy state paints first').toBe(builtIn.id);
    await vi.advanceTimersByTimeAsync(50);
    expect(s().gridState!.template.id).toBe(other.id);
    expect(useEditorStore.getState().planetSwitching).toBe(false);
    expect(s().modals.newProject).toBe(false);
    expect(heard).toEqual([{ kind: 'boot' }]);
    expect(ended).toHaveBeenCalledExactlyOnceWith(null);
    expect(toasts).toEqual([]);
  });

  it('a switch that throws says so, announces nothing and leaves the map and the window as they were', async () => {
    const map = s().gridState;
    vi.spyOn(editorPort, 'install').mockImplementation(() => { throw new Error('transfer threw'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ended = vi.fn();
    expect(changePlanet(other.id, false, ended)).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(ended).toHaveBeenCalledExactlyOnceWith('failed');
    expect(useEditorStore.getState().planetSwitching).toBe(false);
    expect(s().gridState).toBe(map);
    expect(s().modals.newProject).toBe(true);
    expect(heard).toEqual([]);
    expect(toasts).toHaveLength(1);
  });
});
