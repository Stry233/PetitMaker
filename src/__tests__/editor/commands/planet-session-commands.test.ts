// @vitest-environment jsdom
/**
 * The planet editor's session by command, as any caller runs it: each does what its control does
 * (Change planet's Edit shape and New planet, the nameplate's Back and Done), and a refusal changes
 * nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAP_LIST } from '../../../config/maps';
import { CellZone } from '../../../core/game/zones';
import { CommandType, TerrainType, type MacroCoord } from '../../../core/model/types';
import { runCommand } from '../../../editor/commands/run';
import { host } from '../../../editor/host/host';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { stopPlanetEditing, whenAssistantJobRuns } from '../../../editor/session/planet-editing';
import { PLANET_NAME_MAX } from '../../../io/save/planet-codec';
import { listPlanets, savePlanet } from '../../../io/storage/planet-library';
import { useEditorStore } from '../../../state/store';
import { planetFixture } from '../../_support/planet';

const review = vi.hoisted(() => ({ refused: new Set<string>() }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async (parts: readonly { text: string }[]) => ({ allowed: !parts.some((p) => review.refused.has(p.text)) })),
}));

const s = () => useEditorStore.getState();
const run = (id: string, args: Record<string, unknown> = {}) => runCommand(id, args);
const ran = async (id: string, args: Record<string, unknown> = {}): Promise<void> => {
  expect(await run(id, args), `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: true });
};
const refused = async (id: string, args: Record<string, unknown> = {}): Promise<void> => {
  expect(await run(id, args), `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: false });
};

/** Draws an island on the session's canvas, one undo step. */
function drawIsland(): void {
  const cells: MacroCoord[] = [];
  for (let y = 100; y < 140; y++) for (let x = 100; x < 150; x++) cells.push({ x, y });
  s().commandExecutor!.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
}

const saved = () => listPlanets().map((e) => [e.name, e.nameReviewed]);

describe('the planet editor by command', () => {
  let harbour: string;

  beforeEach(() => {
    localStorage.clear();
    review.refused.clear();
    newMap(editorPort, MAP_LIST[0]!.id);
    const made = savePlanet('Harbour', planetFixture(), { nameReviewed: true });
    if (!made.ok) throw new Error('fixture save failed');
    harbour = made.entry.entryId;
    s().setTourRunning(false);
    s().setModal('newProject', true);
  });
  afterEach(() => {
    stopPlanetEditing({ discard: true });
    host.camera.takeQueued();
    s().setModal('newProject', false);
  });

  it('[PLAN-09] planet.edit opens a saved planet or a new one and closes Change planet, as Edit shape and New planet do', async () => {
    const map = s().gridState;
    await ran('planet.edit', { planet: harbour });
    expect(s().planetSession).toMatchObject({ entryId: harbour, name: 'Harbour' });
    expect(s().modals.newProject).toBe(false);
    await ran('planet.leave');
    expect(s().gridState).toBe(map);
    expect(s().modals.newProject, 'leaving comes back to Change planet').toBe(true);

    await ran('planet.edit');
    expect(s().planetSession).toMatchObject({ entryId: null });
  });

  it('[PLAN-09] planet.edit opens nothing for a built-in or unknown planet, over the welcome tips, an assistant job or a planet already open', async () => {
    const map = s().gridState;
    await refused('planet.edit', { planet: MAP_LIST[1]!.id });
    await refused('planet.edit', { planet: 'no-such-planet' });
    s().setTourRunning(true);
    await refused('planet.edit');
    s().setTourRunning(false);
    const release = whenAssistantJobRuns(() => true);
    await refused('planet.edit', { planet: harbour });
    release();
    expect(s().planetSession).toBeNull();
    expect(s().gridState).toBe(map);
    expect(s().modals.newProject, 'a refusal leaves the window standing').toBe(true);

    await ran('planet.edit');
    const canvas = s().gridState;
    await refused('planet.edit', { planet: harbour });
    expect(s().gridState).toBe(canvas);
  });

  it('[PLAN-18] planet.leave leaves a planet nothing was drawn on, and one with edits only with the discard word', async () => {
    const map = s().gridState;
    await refused('planet.leave');
    await ran('planet.edit');
    drawIsland();
    const canvas = s().gridState;
    await refused('planet.leave');
    await refused('planet.leave', { discard: false });
    expect(s().planetSession).not.toBeNull();
    expect(s().gridState).toBe(canvas);
    await ran('planet.leave', { discard: true });
    expect(s().planetSession).toBeNull();
    expect(s().gridState).toBe(map);
    expect(saved()).toEqual([['Harbour', true]]);
  });

  it('[PLAN-17] planet.finish saves the planet under the name shown or a given one, in place or as a copy, as Done does', async () => {
    const map = s().gridState;
    await refused('planet.finish');
    await ran('planet.edit');
    await refused('planet.finish', { name: 'Bay' });
    expect(s().planetSession, 'a planet with no ground stays open').not.toBeNull();
    drawIsland();
    await ran('planet.finish', { name: '  Bay ' });
    expect(s().planetSession).toBeNull();
    expect(s().gridState).toBe(map);
    expect(saved()).toEqual([['Harbour', true], ['Bay', true]]);

    await ran('planet.edit', { planet: harbour });
    await ran('planet.finish', { copy: true });
    expect(saved()).toEqual([['Harbour', true], ['Bay', true], ['Harbour', true]]);
    await ran('planet.edit', { planet: harbour });
    await ran('planet.finish', { name: 'Quay' });
    expect(saved()).toEqual([['Quay', true], ['Bay', true], ['Harbour', true]]);
  });

  it('[PLAN-17, PLAN-22] planet.finish saves nothing under a blank, overlong or refused name and keeps the planet open', async () => {
    review.refused.add('Refused planet');
    await ran('planet.edit');
    drawIsland();
    const canvas = s().gridState;
    await refused('planet.finish', { name: '   ' });
    await refused('planet.finish', { name: 'x'.repeat(PLANET_NAME_MAX + 1) });
    await refused('planet.finish', { name: 'Refused planet' });
    expect(s().planetSession).not.toBeNull();
    expect(s().gridState).toBe(canvas);
    expect(saved()).toEqual([['Harbour', true]]);
  });

  it('[PLAN-22] planet.finish with no name keeps a stored name the check has not answered for, unchecked', async () => {
    const waiting = savePlanet('Lagoon', planetFixture(), { nameReviewed: false });
    if (!waiting.ok) throw new Error('fixture save failed');
    await ran('planet.edit', { planet: waiting.entry.entryId });
    await ran('planet.finish');
    expect(saved()).toEqual([['Harbour', true], ['Lagoon', false]]);
  });
});
