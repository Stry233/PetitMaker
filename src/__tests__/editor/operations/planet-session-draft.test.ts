/** A planet read from a video opens in the planet session as a new planet with its cells to check. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { enterPlanetSession, finishPlanetSession, leavePlanetSession, sessionPlanet } from '../../../editor/operations/planet-session';
import { host } from '../../../editor/host/host';
import { isGrassZone, CellZone } from '../../../core/game/zones';
import { objectRect } from '../../../state/object-geometry';
import { CHUNK_SIZE } from '../../../core/game/profile';
import { planPaint } from '../../../tools/pointer/paint/paint-plan';
import { makeToolCtx } from '../../_support/tool-ctx';
import { planetFixture } from '../../_support/planet';

const store = () => useEditorStore.getState();

describe('a planet session opened from a draft', () => {
  beforeEach(() => { localStorage.clear(); newMap(editorPort, 'hexia'); });
  afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

  it('opens as a new planet with the draft ground and its review cells on the canvas', () => {
    const template = planetFixture();
    const cells = [0, template.width + 3, template.width * 5 + 7];
    enterPlanetSession(editorPort, { template, review: { cells, landmark: true } });
    const session = store().planetSession!;
    expect(session.entryId).toBeNull();
    expect(session.name).toBe('');
    expect(session.nameReviewed).toBe(true);
    expect(session.review!.landmark).toBe(true);
    const at = session.review!.cells;
    expect(at).toHaveLength(3);
    // Each review cell keeps its offset from the others: the draft is embedded by one translation.
    const ox = at[0]!.x, oy = at[0]!.y;
    expect(at.map((c) => [c.x - ox, c.y - oy])).toEqual([[0, 0], [3, 1], [7, 5]]);
    // Cell 0 is the draft's corner, embedded on a chunk line.
    expect([ox % CHUNK_SIZE, oy % CHUNK_SIZE]).toEqual([0, 0]);
    const cut = sessionPlanet(store().gridState!)!.template;
    expect([cut.width, cut.height]).toEqual([template.width, template.height]);
    const grass = (t: typeof template) => t.zones.flat().filter((z) => isGrassZone(z)).length;
    expect(grass(cut)).toBe(grass(template));
    expect(store().planetReviewShown).toBe(true);
  });

  it('saves the same planet a drawn session of that ground saves', () => {
    const template = planetFixture();
    enterPlanetSession(editorPort, { template, review: { cells: [], landmark: false } });
    const drafted = sessionPlanet(store().gridState!)?.template ?? null;
    leavePlanetSession(editorPort);
    enterPlanetSession(editorPort, { template });
    expect(sessionPlanet(store().gridState!)!.template.id).toBe(drafted!.id);
    expect(store().planetSession!.review).toBeUndefined();
    const done = finishPlanetSession(editorPort, 'Bay');
    expect(done.ok).toBe(true);
  });

  it('edits only the ground, as a drawn planet does, and takes ponds on its grass', () => {
    const template = planetFixture();
    enterPlanetSession(editorPort, { template, review: { cells: [], landmark: false } });
    const exec = store().commandExecutor!;
    const grid = store().gridState!;
    let at: { x: number; y: number } | null = null;
    for (let y = 0; y < grid.template.height && !at; y++) for (let x = 0; x < grid.template.width && !at; x++) {
      const near = [-2, -1, 0, 1, 2].every(
        (dy) => [-2, -1, 0, 1, 2, 3, 4].every((dx) => grid.cells[y + dy]?.[x + dx]?.zone === CellZone.Grass && !grid.cells[y + dy]![x + dx]!.terrain),
      );
      if (near && ![...grid.objects.values()].some(
        (o) => { const r = objectRect(o); return x + 3 > r.x - 1 && x < r.x + r.w + 1 && y + 1 > r.y - 1 && y < r.y + r.h + 1; },
      )) at = { x, y };
    }
    expect(at).not.toBeNull();
    const { x, y } = at!;
    // The tools plan against the session as against any planet session: the ground stays flat.
    const ctx = makeToolCtx(grid, exec, 1, 3, { groundEditable: store().planetSession !== null, planetMaterial: 'mountain' });
    expect(ctx.arming.groundEditable).toBe(true);
    expect(planPaint([{ x, y }], ctx, 'mountain', new Set()).commands).toEqual([]);
    const before = sessionPlanet(store().gridState!)!.template;
    const pond = planPaint([{ x: x + 1, y }, { x: x + 2, y }], ctx, 'water', new Set());
    const start = exec.beginStroke();
    for (const cmd of pond.commands) expect(exec.execute(cmd).success).toBe(true);
    expect(start.commit()).toEqual([]);
    const after = sessionPlanet(store().gridState!)!.template;
    expect(after.zones).toEqual(before.zones);
    expect(after.water?.reduce((n, v) => n + v, 0)).toBe(2);
  });
});
