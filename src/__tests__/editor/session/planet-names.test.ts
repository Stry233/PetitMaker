import { describe, it, expect, beforeEach } from 'vitest';
import { adoptPlanet, renamePlanet, settlePlanetName } from '../../../io/storage/planet-library';
import { planetNaming, shownPlanetName } from '../../../editor/session/planet-names';
import { exportableState } from '../../../io/export/exportable';
import { planetFixture } from '../../_support/planet';
import { createGridState } from '../../../core/model/template';

describe('planet names', () => {
  beforeEach(() => localStorage.clear());
  it('names a planet by its library entry once reviewed, and by the default name before', () => {
    const template = { ...planetFixture(), name: { en: 'Bay' } };
    expect(shownPlanetName(template, 'en')).toBe('My planet 1');
    const bay = adoptPlanet(template);
    expect(shownPlanetName(template, 'en')).toBe('My planet 1');
    settlePlanetName(bay.entryId, 'Bay', null);
    expect(shownPlanetName(template, 'en')).toBe('Bay');
    renamePlanet(bay.entryId, 'Reef');
    expect(shownPlanetName(template, 'en')).toBe('Reef');
    const state = createGridState(template);
    expect(exportableState(state, planetNaming('en')).template).toMatchObject({ id: template.id, name: { en: 'Reef' } });
    expect(state.template.name.en).toBe('Bay');
  });
});
