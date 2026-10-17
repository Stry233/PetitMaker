import { describe, expect, it } from 'vitest';
import legacy from '../../../fixtures/saves/landmarks-v2.json';
import expected from '../../../fixtures/saves/landmarks-v3.json';
import { CURRENT_VERSION, migrateToCurrent } from '../../../../io/save/format';
import { serialize, decodeSave } from '../../../../io/save/json-codec';
import { clearUnderLandmarks } from '../../../../state/landmark-clearance';
import { parseSave } from '../../../../io/save/parse';
import { inspectImportFile } from '../../../../io/import/file';
import { parseTemplate, readPlanetFile, serializeTemplate } from '../../../../io/save/planet-codec';
import { createDefaultRegistry } from '../../../../rules';
import { LANDMARKS } from '../../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import { planetTemplateId } from '../../../../core/model/planet';
import { createGridState, templateTerrainAt } from '../../../../core/model/template';
import { templateAnchor } from '../../../../core/model/landmarks';
import { footprintTerrain } from '../../../../core/grid/footprint';
import { objectRect } from '../../../../state/object-geometry';
import { TerrainType, type GridState, type MapTemplate } from '../../../../core/model/types';
import { jsonFile } from '../../../_support/json-file';
import { landmarkAt, planetFixture } from '../../../_support/planet';

const STATION = LANDMARKS.find((l) => !l.anchor)!;

/** A save as a load path opens it: decoded as saved, then cleared under its landmarks. */
function load(parsed: ReturnType<typeof parseSave>) {
  const state = decodeSave(parsed);
  return { state, cleared: clearUnderLandmarks(state, createDefaultRegistry()) };
}

/** Every cell the anchor rests on holds exactly the terrain its template lays there. */
function expectTemplateGroundUnderAnchor(state: GridState): void {
  const anchor = state.objects.get(ANCHOR_LANDMARK.id)!;
  const under = footprintTerrain(objectRect(anchor));
  for (let y = under.y; y < under.y + under.h; y++) for (let x = under.x; x < under.x + under.w; x++) {
    const cell = state.cells[y]![x]!;
    expect(cell.terrain, `cell ${x},${y}`).toEqual(templateTerrainAt(state.template, x, y, cell.zone));
  }
}

describe('the v2 to v3 landmark migration', () => {
  it('drops the undo history recorded against the earlier layout and keeps everything else', () => {
    const original = JSON.stringify(legacy);
    const migrated = migrateToCurrent(legacy);
    expect(migrated).toEqual(expected);
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect(migrated).not.toHaveProperty('history');
    expect(JSON.stringify(legacy)).toBe(original);
  });

  it('opens a v2 save with the plaza at its new place and takes off what it now stands over, keeping the mountain its template lays there', () => {
    const { state, cleared } = load(parseSave(legacy));
    expect(state.objects.get(ANCHOR_LANDMARK.id)).toMatchObject(
      { locked: true, position: { x: 79, y: 64 }, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height },
    );
    expect(state.objects.has('tree-in')).toBe(false);
    expect(state.objects.has('tree-out')).toBe(true);
    // Both cells lie under the plaza: the one holding the template's layer-1 mountain stays, the taller one
    // goes back to it, and every other cell under the plaza gets the mountain the save never stored.
    expect(state.cells[89]![98]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(state.cells[90]![97]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(state.cells[100]![60]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expectTemplateGroundUnderAnchor(state);
    expect(cleared).toMatchObject({ objects: 1, cells: 1 });
    expect(cleared.restored).toBeGreaterThan(0);
    expect(createDefaultRegistry().validatePostStroke(state)).toEqual([]);
  });

  it('gives a save written before the ground under the plaza was stored the mountain its template lays there', () => {
    const { state, cleared } = load(parseSave(expected));
    expectTemplateGroundUnderAnchor(state);
    expect(cleared.restored).toBeGreaterThan(0);
    expect(createDefaultRegistry().validatePostStroke(state)).toEqual([]);
  });

  it('lays the station where its template does and never where a save placed one', () => {
    const { state } = load(parseSave(legacy));
    expect(state.objects.has('placed-station')).toBe(false);
    const station = state.objects.get(STATION.id)!;
    expect(station).toMatchObject({ locked: true, catalogId: STATION.id });
    expect(serialize(state)).not.toContain(STATION.id);
  });

  it('reports what it took off when the file is imported', async () => {
    const inspected = await inspectImportFile(jsonFile(JSON.stringify(legacy)), 'old.json');
    expect(inspected.status).toBe('ready');
    if (inspected.status !== 'ready') return;
    const outcome = inspected.commit({ loadMap: () => {}, getSectionDeps: () => ({}) as never });
    expect(outcome.status === 'imported' && outcome.warnings).toContainEqual({ kind: 'landmark-cleared', objects: 1, cells: 1 });
  });

  it('opens a current save without taking anything off', () => {
    const { state } = load(parseSave(legacy));
    const again = JSON.parse(serialize(state));
    expect(load(parseSave(again)).cleared).toEqual({ objects: 0, cells: 0, restored: 0 });
  });

});

describe('custom planets stored before the profile footprint', () => {
  /** A planet as stored with the plaza at its earlier footprint, half a cell wider on every side,
   *  named by its own content. */
  function earlier(): MapTemplate {
    const body = { ...planetFixture(), landmarks: [{ ...landmarkAt(12, 3), width: ANCHOR_LANDMARK.width + 1, height: ANCHOR_LANDMARK.height + 1 }] };
    return { ...body, id: planetTemplateId(body) };
  }

  it('read from a planet file of version 1 with the plaza at the profile footprint and a new id', () => {
    const stored = earlier();
    const { plaza, landmarks: _landmarks, ...rest } = { ...serializeTemplate(stored), plaza: { ...serializeTemplate(stored).landmarks![0]!, id: undefined } };
    const file = JSON.stringify({ format: 'petitmaker.planet', version: 1, name: 'Old', template: { ...rest, plaza } });
    const { template } = readPlanetFile(file);
    expect(templateAnchor(template)).toMatchObject({ x: 12.5, y: 3.5, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height });
    expect(template.id).not.toBe(stored.id);
    expect(template.id).toBe(planetTemplateId(template));
  });

  it('reopen a save made on them under the new id', () => {
    const stored = earlier();
    const raw = JSON.parse(serialize(createGridState(stored)));
    const { template } = parseSave(raw);
    expect(template.id).toBe(parseTemplate(serializeTemplate(stored)).id);
    const { state } = load(parseSave(raw, { template }));
    expect(state.template.id).toBe(template.id);
    expect(templateAnchor(state.template)!.width).toBe(ANCHOR_LANDMARK.width);
  });
});
