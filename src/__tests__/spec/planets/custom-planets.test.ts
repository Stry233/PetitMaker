/** Custom planets: an identity that follows the shape, and planet files read into My planets. */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { readPlanetFile, writePlanetFile } from '../../../io/save/planet-codec';
import { listPlanets } from '../../../io/storage/planet-library';
import { importPlanetFile } from '../../../editor/session/planet-library';
import { planetTemplateId } from '../../../core/model/planet';
import { CellZone } from '../../../core/game/zones';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { translateFor } from '../../../i18n/context';
import { planetFixture } from '../../_support/planet';
import { exportJson, importCode, preview, shareCode } from '../files/_files';
import { mapOn } from './_planets';

let toasts: string[] = [];
let stop = (): void => {};
beforeEach(() => { localStorage.clear(); toasts = []; stop = setToastPresenter((text) => { toasts.push(text); }); });
afterEach(() => { stop(); localStorage.clear(); });

describe('custom planets', () => {
  spec('PLAN-06', 'have one identity for one shape in a planet file, a map file and a share code, whatever their name, and a new one for any edit', async () => {
    const planet = planetFixture();
    expect(readPlanetFile(writePlanetFile('Bay', planet)).template.id).toBe(planet.id);
    expect(readPlanetFile(writePlanetFile('Harbour', planet)).template.id).toBe(planet.id);

    const map = mapOn(planet);
    expect((await preview(exportJson(map))).preview.state.template.id).toBe(planet.id);
    const shared = await importCode(await shareCode(map));
    expect(shared.ok && shared.state.template.id).toBe(planet.id);

    const { id: _id, name: _name, ...body } = planet;
    const zones = body.zones.map((row) => [...row]);
    const shore = zones[2]!.findIndex((z, x) => z === CellZone.Void && zones[3]![x] === CellZone.Grass);
    expect(shore).toBeGreaterThanOrEqual(0);
    zones[2]![shore] = CellZone.Grass;
    expect(planetTemplateId({ ...body, zones })).not.toBe(planet.id);
    expect(planetTemplateId(body)).toBe(planet.id);
  });

  spec('PLAN-20', 'adds an imported planet file to My planets once, and refuses a file that is not one with a message', async () => {
    const planet = planetFixture();
    const entry = await importPlanetFile(new File([writePlanetFile('Bay', planet)], 'bay.planet.json'), 'en');
    expect(entry).toMatchObject({ name: 'Bay', template: { id: planet.id } });
    expect(listPlanets().map((e) => e.template.id)).toEqual([planet.id]);

    const again = await importPlanetFile(new File([writePlanetFile('Cove', planet)], 'cove.planet.json'), 'en');
    expect(again?.entryId).toBe(entry!.entryId);
    expect(listPlanets()).toHaveLength(1);

    const map = new File([exportJson(mapOn(planet))], 'map.json');
    expect(await importPlanetFile(map, 'en')).toBeNull();
    expect(toasts).toEqual([translateFor('en', 'planet.import_failed')]);
    expect(listPlanets()).toHaveLength(1);
  });
});
