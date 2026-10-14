import { beforeEach, describe, expect, it } from 'vitest';
import { planetEntryAmong, planetNameStatus, planetNameVerdict, uncheckedPlanetName, type NamedPlanetEntry } from '../../state/planet-name-verdict';
import { __resetTextVerdicts, recordTextVerdict } from '../../state/text-verdicts';
import type { MapTemplate } from '../../core/model/types';

const planet = (id: string, name: string) => ({ id, name: { en: name } }) as MapTemplate;
const entry = (id: string, name: string, nameReviewed: boolean): NamedPlanetEntry => ({ name, nameReviewed, template: { id } });

describe('a custom planet name verdict', () => {
  beforeEach(() => __resetTextVerdicts());

  it('reads a library entry by its review flag, a settled empty name being a refusal', () => {
    const t = planet('custom-a', 'Bay');
    expect(planetNameVerdict(t, [entry('custom-a', 'Bay', false)])).toEqual({ status: 'pending', name: 'Bay', index: 0 });
    expect(planetNameVerdict(t, [entry('custom-b', 'X', true), entry('custom-a', 'Bay', true)])).toEqual({ status: 'approved', name: 'Bay', index: 1 });
    expect(planetNameStatus(t, [entry('custom-a', '', true)])).toBe('refused');
  });

  it('reads a name no entry carries from the page verdict, counting its default name from the library length', () => {
    const t = planet('custom-a', 'Bay');
    expect(uncheckedPlanetName(t, [])).toBe('Bay');
    recordTextVerdict('Bay', true);
    expect(planetNameVerdict(t, [entry('custom-z', 'Other', true)])).toEqual({ status: 'approved', name: 'Bay', index: 1 });
    expect(uncheckedPlanetName(t, [])).toBeNull();
  });

  it('picks the copy carrying the map name among entries of one shape', () => {
    const copies = [entry('custom-a', 'Bay', true), entry('custom-a', 'Bay copy', true)];
    expect(planetEntryAmong(copies, planet('custom-a', 'Bay copy'))).toBe(copies[1]);
    expect(planetEntryAmong(copies, planet('custom-a', 'Renamed'))).toBeNull();
  });

  it('approves every built-in planet', () => {
    expect(planetNameStatus(planet('hexia', ''), [])).toBe('approved');
  });
});
