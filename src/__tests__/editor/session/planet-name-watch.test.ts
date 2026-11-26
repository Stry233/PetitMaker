/**
 * A planet name the text check has not settled is checked in the background, whatever window shows
 * it: as the editor starts, after a library write brings one, and as a map opens on a planet no entry
 * names.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { savePlanet, settlePlanetName } from '../../../io/storage/planet-library';
import { watchUncheckedPlanetNames } from '../../../editor/session/planet-library';
import { createGridState } from '../../../core/model/template';
import { planetFixture } from '../../_support/planet';
import { makeState } from '../../_support/map-state';

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({ gridState: makeState(10, 10) });
});

describe('the background planet name check', () => {
  it('runs as the editor starts on a library holding an unchecked name', () => {
    savePlanet('Harbour', planetFixture(), { nameReviewed: false });
    const review = vi.fn();
    const stop = watchUncheckedPlanetNames(review);
    expect(review).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs after a library write brings an unchecked name, and not for checked ones', () => {
    const review = vi.fn();
    const stop = watchUncheckedPlanetNames(review);
    savePlanet('Checked', planetFixture(), { nameReviewed: true });
    expect(review).not.toHaveBeenCalled();
    const saved = savePlanet('Harbour', planetFixture(), { nameReviewed: false });
    expect(review).toHaveBeenCalledTimes(1);
    if (saved.ok) settlePlanetName(saved.entry.entryId, 'Harbour', null);
    stop();
    savePlanet('Later', planetFixture(), { nameReviewed: false });
    expect(review, 'nothing once stopped').toHaveBeenCalledTimes(1);
  });

  it('runs as a map opens on a custom planet no entry names', () => {
    const review = vi.fn();
    const stop = watchUncheckedPlanetNames(review);
    const planet = planetFixture();
    useEditorStore.setState({ gridState: createGridState({ ...planet, name: { en: 'Unseen Isle' } }) });
    expect(review).toHaveBeenCalledTimes(1);
    stop();
  });
});
