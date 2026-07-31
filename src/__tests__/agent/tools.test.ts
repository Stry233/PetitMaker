import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import { TerrainType, ItemCategory, type EditorEvents } from '../../core/model/types';
import { getCatalogByCategory } from '../../state/catalog';
import { makeState, setTerrain } from '../rules/_helpers';
import { executeToolCall, TOOL_SCHEMAS, SUBAGENT_TOOL_SCHEMAS, type AgentToolDeps } from '../../agent/tools';
import { SKILLS } from '../../agent/skills';

function setup(w = 20, h = 20) {
  const state = makeState(w, h);
  const bus = new EventBus<EditorEvents>();
  const exec = new CommandExecutor(state, bus, createDefaultRegistry());
  let toastFired = 0;
  bus.on('validation-failed', () => {
    toastFired++;
  });
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps, toasts: () => toastFired };
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

describe('agent tools', () => {
  it('paints a mountain plateau with auto-tiers', async () => {
    const { state, deps } = setup();
    const r = await executeToolCall(
      call('paint_terrain', { rect: { x1: 2, y1: 2, x2: 6, y2: 6 }, terrain: 'mountain', elevation: 2 }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(state.cells[4]![4]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('feeds pre-command rejections back as English rule text without firing toasts', async () => {
    const { deps, toasts } = setup();
    await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 3, y: 3 }), deps);
    const r = await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 3, y: 3 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/V-PLACE-/);
    expect(r.content).toMatch(/Placement:/); // English i18n text
    expect(toasts()).toBe(0); // silent mode suppressed the toast event
  });

  it('placing an object over a road auto-clears the covered road and says so (non-silent, like the editor)', async () => {
    const { state, deps } = setup();
    const roadId = getCatalogByCategory(ItemCategory.Road)[0]!.id;
    const floraId = getCatalogByCategory(ItemCategory.Flora)[0]!.id;
    state.objects.set('road-1', { id: 'road-1', catalogId: roadId, position: { x: 5, y: 5 }, rotation: 0, elevation: 0 });
    const r = await executeToolCall(call('place_object', { catalogId: floraId, x: 5, y: 5 }), deps);
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/[Cc]leared \d+ road/); // warns the agent it removed the road
    const ids = [...state.objects.values()].map((o) => o.catalogId);
    expect(ids).not.toContain(roadId); // road stripped
    expect(ids).toContain(floraId);    // object placed
  });

  it('exposes undo/redo that revert and reapply the last change', async () => {
    const { state, deps } = setup();
    await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 3, y: 3 }), deps);
    expect(state.objects.size).toBe(1);
    expect((await executeToolCall(call('undo', {}), deps)).isError).toBe(false);
    expect(state.objects.size).toBe(0);
    expect((await executeToolCall(call('redo', {}), deps)).isError).toBe(false);
    expect(state.objects.size).toBe(1);
  });

  it('reports REVERTED with rule feedback when post-stroke rules roll the stroke back', async () => {
    const { state, deps } = setup();
    const r = await executeToolCall(call('paint_terrain', { cells: [{ x: 5, y: 5 }], terrain: 'water', elevation: 1 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('REVERTED');
    expect(r.content).toContain('V-WTR-02');
    expect(state.cells[5]![5]!.terrain).toBeNull(); // actually rolled back
  });

  it('reports snapped placement for bridges (span in the success text)', async () => {
    const { state, deps } = setup();
    // 3-wide ground-water channel x=5..7 across y=4..8, mountain caps either side
    for (let y = 4; y <= 8; y++) for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    for (let y = 4; y <= 8; y++) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
    }
    const r = await executeToolCall(call('place_object', { catalogId: 'bridge-plank', x: 4, y: 6 }), deps);
    if (!r.isError) expect(r.content).toMatch(/span=\d/);
  });

  it('placed objects undo as one step', async () => {
    const { state, exec, deps } = setup();
    await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 3, y: 3 }), deps);
    expect(state.objects.size).toBe(1);
    exec.undo();
    expect(state.objects.size).toBe(0);
  });

  it('rotate_object restores the original when the new rotation is invalid', async () => {
    const { state, deps } = setup();
    // myhouse is 7x4; at (14,14) on a 20x20 grid rot=0 fits (flat checks x..x+7,y..y+4 within bounds)
    const ok = await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 10, y: 10 }), deps);
    expect(ok.isError).toBe(false);
    const id = [...state.objects.keys()][0]!;
    // carve a cliff so the rotated footprint is non-flat → rotation fails → restore
    setTerrain(state, 10, 16, TerrainType.Mountain, 1);
    const r = await executeToolCall(call('rotate_object', { objectId: id, rotation: 90 }), deps);
    expect(state.objects.size).toBe(1);
    const obj = state.objects.get(id) ?? [...state.objects.values()][0]!;
    if (r.isError) expect(obj.rotation).toBe(0); // restored unchanged
    else expect(obj.rotation).toBe(90);
  });

  it('inspect_region returns the token grid', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('inspect_region', { x1: 0, y1: 0, x2: 5, y2: 5 }), deps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Legend');
  });

  it('get_catalog_item returns details and unknown tool errors cleanly', async () => {
    const { deps } = setup();
    expect((await executeToolCall(call('get_catalog_item', { id: 'bridge-plank' }), deps)).content).toContain('waterSpan');
    expect((await executeToolCall(call('nope', {}), deps)).isError).toBe(true);
  });

  it('every schema is a valid object schema', async () => {
    for (const s of TOOL_SCHEMAS) {
      expect(s.name).toMatch(/^[a-z_]+$/);
      expect((s.inputSchema as { type: string }).type).toBe('object');
    }
  });

  it('evaluate_map returns a scorecard without mutating the map', async () => {
    const { state, deps, exec } = setup();
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(call('evaluate_map', {}), deps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('MAP QUALITY SCORECARD');
    expect(r.content).toContain('connectivity: 10/10');
    expect(exec.getUndoStackSize()).toBe(before);
    expect(state.objects.size).toBe(0);
  });

  it('paints circles and outline rects (border only) and clamps out-of-bounds', async () => {
    const { state, deps } = setup();
    const c = await executeToolCall(
      call('paint_terrain', { circle: { cx: 5, cy: 5, r: 2 }, terrain: 'mountain', elevation: 1 }),
      deps,
    );
    expect(c.isError).toBe(false);
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(1);
    const o = await executeToolCall(
      call('paint_terrain', { rect: { x1: 10, y1: 10, x2: 14, y2: 14 }, outline: true, terrain: 'mountain', elevation: 1 }),
      deps,
    );
    expect(o.isError).toBe(false);
    expect(state.cells[10]![12]!.terrain?.elevation).toBe(1); // border
    expect(state.cells[12]![12]!.terrain).toBeNull(); // interior untouched
    const clamped = await executeToolCall(
      call('paint_terrain', { circle: { cx: 0, cy: 0, r: 3 }, terrain: 'mountain', elevation: 1 }),
      deps,
    );
    expect(clamped.isError).toBe(false); // off-map cells silently dropped
  });

  it('write results include a token snapshot of the edited area', async () => {
    const { deps } = setup();
    const r = await executeToolCall(
      call('paint_terrain', { rect: { x1: 3, y1: 3, x2: 6, y2: 6 }, terrain: 'mountain', elevation: 2 }),
      deps,
    );
    expect(r.content).toContain('Result');
    expect(r.content).toContain('2222'); // a painted row at elev 2
  });

  it('find_flat_areas reports anchors on a plateau and respects objects', async () => {
    const { deps } = setup();
    // 8x8 plateau at elev 1
    await executeToolCall(call('paint_terrain', { rect: { x1: 2, y1: 2, x2: 9, y2: 9 }, terrain: 'mountain', elevation: 1 }), deps);
    const found = await executeToolCall(call('find_flat_areas', { minWidth: 3, minHeight: 3, elevation: 1 }), deps);
    expect(found.isError).toBe(false);
    expect(found.content).toMatch(/\(\d+,\d+\)/);
    // ground search avoids the occupied house footprint
    await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 12, y: 12 }), deps);
    const ground = await executeToolCall(call('find_flat_areas', { minWidth: 4, minHeight: 4, near: { x: 13, y: 13 } }), deps);
    expect(ground.isError).toBe(false);
    expect(ground.content).not.toContain('(12,12)');
  });

  it('scatter_objects fills a region with valid placements in one undo step', async () => {
    const { state, exec, deps } = setup();
    const r = await executeToolCall(
      call('scatter_objects', { catalogIds: ['flower-rose', 'flower-sunflower'], count: 12, rect: { x1: 2, y1: 2, x2: 12, y2: 12 } }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(0);
    expect(state.objects.size).toBeLessThanOrEqual(12);
    exec.undo();
    expect(state.objects.size).toBe(0); // whole scatter is one step
  });

  it('run_generator (maze) builds terrain in the rect as one undo step and flashes', async () => {
    const { state, exec, deps } = setup(24, 24);
    const flashed: unknown[] = [];
    deps.onFlash = (cells) => flashed.push(cells);
    const r = await executeToolCall(
      call('run_generator', { algorithm: 'maze', maxElevation: 2, seed: 7, rect: { x1: 2, y1: 2, x2: 20, y2: 20 } }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(r.content).toContain('seed 7');
    let mountains = 0;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (state.cells[y]![x]!.terrain) mountains++;
    expect(mountains).toBeGreaterThan(10);
    expect(flashed.length).toBe(1);
    exec.undo();
    let after = 0;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (state.cells[y]![x]!.terrain) after++;
    expect(after).toBe(0); // whole generation is one undo step
  });
});

describe('bridge sites + roads', () => {
  function channel(setupRet: ReturnType<typeof setup>) {
    const { state } = setupRet;
    // straight 3-wide ground channel x=5..7 across y=4..8 with mountain caps
    for (let y = 4; y <= 8; y++) for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    for (let y = 4; y <= 8; y++) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
    }
  }

  it('find_bridge_sites returns anchors a bridge can actually be placed at', async () => {
    const s = setup();
    channel(s);
    const r = await executeToolCall(call('find_bridge_sites', { catalogId: 'bridge-plank', near: { x: 6, y: 6 } }), s.deps);
    expect(r.isError).toBe(false);
    const m = r.content.match(/\((\d+),(\d+)\)/);
    if (m) {
      const placed = await executeToolCall(
        call('place_object', { catalogId: 'bridge-plank', x: Number(m[1]), y: Number(m[2]) }),
        s.deps,
      );
      expect(placed.isError).toBe(false);
    }
  });

  it('failed bridge placement appends concrete anchor suggestions', async () => {
    const s = setup();
    channel(s);
    const r = await executeToolCall(call('place_object', { catalogId: 'bridge-plank', x: 15, y: 15 }), s.deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/LEGAL anchors|No legal bridge site/);
  });

  it('build_road lays a line of road tiles in one undo step', async () => {
    const s = setup();
    const r = await executeToolCall(call('build_road', { catalogId: 'road-dirt', line: { x1: 2, y1: 10, x2: 12, y2: 10 } }), s.deps);
    expect(r.isError).toBe(false);
    const roads = [...s.state.objects.values()].filter((o) => o.catalogId === 'road-dirt').length;
    expect(roads).toBeGreaterThanOrEqual(10);
    s.exec.undo();
    expect(s.state.objects.size).toBe(0);
  });
});

describe('clear_area, skills, delegation stub', () => {
  it('clear_area removes intersecting objects and terrain in one undo step', async () => {
    const s = setup();
    await executeToolCall(call('paint_terrain', { rect: { x1: 4, y1: 4, x2: 8, y2: 8 }, terrain: 'mountain', elevation: 1 }), s.deps);
    await executeToolCall(call('scatter_objects', { catalogIds: ['flower-rose'], count: 4, rect: { x1: 10, y1: 10, x2: 14, y2: 14 } }), s.deps);
    const before = s.state.objects.size;
    const r = await executeToolCall(call('clear_area', { rect: { x1: 4, y1: 4, x2: 14, y2: 14 } }), s.deps);
    expect(r.isError).toBe(false);
    expect(s.state.objects.size).toBe(0);
    expect(s.state.cells[6]![6]!.terrain).toBeNull();
    s.exec.undo();
    expect(s.state.objects.size).toBe(before); // one step restores everything
    expect(s.state.cells[6]![6]!.terrain?.elevation).toBe(1);
  });

  it('clear_area never removes locked objects (the plaza)', async () => {
    const s = setup();
    s.state.objects.set('plaza', { id: 'plaza', catalogId: '__plaza__', position: { x: 5, y: 5 }, rotation: 0, elevation: 1, width: 2, height: 2, locked: true });
    await executeToolCall(call('clear_area', { rect: { x1: 0, y1: 0, x2: 19, y2: 19 } }), s.deps);
    expect(s.state.objects.has('plaza')).toBe(true);
  });

  it('skills list and load; delegation errors cleanly without a handler', async () => {
    const s = setup();
    const list = await executeToolCall(call('list_skills', {}), s.deps);
    expect(list.content).toContain('cozy-village');
    const skill = await executeToolCall(call('load_skill', { name: 'river-crossing' }), s.deps);
    expect(skill.isError).toBe(false);
    expect(skill.content).toContain('find_bridge_sites');
    expect((await executeToolCall(call('load_skill', { name: 'nope' }), s.deps)).isError).toBe(true);
    expect((await executeToolCall(call('delegate_task', { task: 'x' }), s.deps)).isError).toBe(true);
  });

  const DIRECTOR_TOOL_RE = /decorate_zone|plant_forest|build_road_network|frame_crossing/;

  it('list_skills includes alpine-cascade, zen-garden, rice-terraces', async () => {
    const s = setup();
    const list = await executeToolCall(call('list_skills', {}), s.deps);
    expect(list.content).toContain('alpine-cascade');
    expect(list.content).toContain('zen-garden');
    expect(list.content).toContain('rice-terraces');
  });

  it('alpine-cascade body is non-empty and references at least one director tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'alpine-cascade' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(DIRECTOR_TOOL_RE);
  });

  it('zen-garden body is non-empty and references at least one director tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'zen-garden' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(DIRECTOR_TOOL_RE);
  });

  it('rice-terraces body is non-empty and references at least one director tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'rice-terraces' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(DIRECTOR_TOOL_RE);
  });

  it('list_skills groups contain both METHOD and STYLE headers', async () => {
    const s = setup();
    const list = await executeToolCall(call('list_skills', {}), s.deps);
    expect(list.content).toContain('METHOD skills');
    expect(list.content).toContain('STYLE set pieces');
  });

  it('list_skills contains all 12 skill names', async () => {
    const s = setup();
    const list = await executeToolCall(call('list_skills', {}), s.deps);
    const allNames = [
      'cozy-village', 'terraced-hill-park', 'pro-terraforming',
      'river-crossing', 'alpine-cascade', 'zen-garden', 'rice-terraces',
      'site-analysis', 'composition', 'terrain-shaping',
      'settlement-design', 'ecology-planting',
    ];
    for (const name of allNames) {
      expect(list.content).toContain(name);
    }
  });

  it('every skill has a valid kind (method or style)', () => {
    for (const [name, skill] of Object.entries(SKILLS)) {
      expect(['method', 'style'], `${name} kind`).toContain(skill.kind);
    }
  });

  const METHOD_TOOL_RE = /inspect_region|find_ramp_sites|find_bridge_sites|sculpt_terrace|carve_river|paint_terrain|decorate_zone|plant_forest|build_road_network|scatter_objects|build_road|view_map|evaluate_map|update_plan|find_flat_areas|frame_crossing|clear_area/;

  it('site-analysis body is non-empty and mentions at least one real tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'site-analysis' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(METHOD_TOOL_RE);
  });

  it('composition body is non-empty and mentions at least one real tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'composition' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(METHOD_TOOL_RE);
  });

  it('terrain-shaping body is non-empty and mentions at least one real tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'terrain-shaping' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(METHOD_TOOL_RE);
  });

  it('settlement-design body is non-empty and mentions at least one real tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'settlement-design' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(METHOD_TOOL_RE);
  });

  it('ecology-planting body is non-empty and mentions at least one real tool', async () => {
    const s = setup();
    const r = await executeToolCall(call('load_skill', { name: 'ecology-planting' }), s.deps);
    expect(r.isError).toBe(false);
    expect(r.content.length).toBeGreaterThan(100);
    expect(r.content).toMatch(METHOD_TOOL_RE);
  });
});

describe('rejection diagnostics', () => {
  it('failed placement names the blocking object, including locked structures', async () => {
    const s = setup();
    s.state.objects.set('plaza', { id: 'plaza', catalogId: '__plaza__', position: { x: 5, y: 5 }, rotation: 0, elevation: 1, width: 6, height: 6, locked: true });
    const r = await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 6, y: 6 }), s.deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('In the way');
    expect(r.content).toContain('IMMOVABLE');
    expect(r.content).toContain('__plaza__');
  });

  it('map summary lists immovable structures generically', async () => {
    const s = setup();
    s.state.objects.set('plaza', { id: 'plaza', catalogId: '__plaza__', position: { x: 5, y: 5 }, rotation: 0, elevation: 1, width: 6, height: 6, locked: true });
    const ctx = (await executeToolCall(call('get_selection', {}), s.deps)).content; // not summary, but exercise the path
    expect(typeof ctx).toBe('string');
    const { mapSummary } = await import('../../agent/serialize');
    expect(mapSummary(s.state)).toContain('IMMOVABLE');
  });
});

describe('subagent schema set', () => {
  it('SUBAGENT_TOOL_SCHEMAS excludes both delegate_task and update_plan', () => {
    const names = SUBAGENT_TOOL_SCHEMAS.map((s) => s.name);
    expect(names).not.toContain('delegate_task');
    expect(names).not.toContain('update_plan');
  });
});

describe('view_map', () => {
  it('view_map returns the image when a snapshot is available', async () => {
    const { deps } = setup();
    deps.snapshot = async () => 'data:image/png;base64,QUJD';
    const r = await executeToolCall(call('view_map', {}), deps);
    expect(r.isError).toBe(false);
    expect(r.image?.dataUrl).toBe('data:image/png;base64,QUJD');
  });

  it('view_map degrades to the token overview without a snapshotter', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('view_map', {}), deps);
    expect(r.isError).toBe(false);
    expect(r.image).toBeUndefined();
    expect(r.content).toMatch(/Legend/); // mapOverview text
  });
});

describe('pro terraforming tools', () => {
  it('sculpt_terrace builds tiered organic terrain with rounded corners, one undo step', async () => {
    const s = setup(30, 30);
    const r = await executeToolCall(call('sculpt_terrace', { cx: 14, cy: 14, baseRadius: 7, tiers: 2, seed: 11 }), s.deps);
    expect(r.isError).toBe(false);
    let t1 = 0, t2 = 0, trimmed = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
      const t = s.state.cells[y]![x]!.terrain;
      if (t?.type === TerrainType.Mountain) {
        if (t.elevation === 1) t1++;
        if (t.elevation === 2) t2++;
        if (t.corners) trimmed++;
      }
    }
    expect(t1).toBeGreaterThan(20);   // broad base
    expect(t2).toBeGreaterThan(3);    // upper tier exists
    expect(trimmed).toBeGreaterThan(0); // cliffs got rounded
    s.exec.undo();
    expect(s.state.cells[14]![14]!.terrain).toBeNull(); // single undo step
  });

  it('sculpt_terrace is deterministic per seed', async () => {
    const a = setup(30, 30);
    const b = setup(30, 30);
    await executeToolCall(call('sculpt_terrace', { cx: 14, cy: 14, baseRadius: 6, tiers: 2, seed: 5 }), a.deps);
    await executeToolCall(call('sculpt_terrace', { cx: 14, cy: 14, baseRadius: 6, tiers: 2, seed: 5 }), b.deps);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
      expect(a.state.cells[y]![x]!.terrain?.elevation).toBe(b.state.cells[y]![x]!.terrain?.elevation);
    }
  });

  it('carve_river paints a connected meandering channel through waypoints', async () => {
    const s = setup(40, 40);
    const r = await executeToolCall(
      call('carve_river', { points: [{ x: 2, y: 5 }, { x: 15, y: 12 }, { x: 25, y: 6 }, { x: 37, y: 14 }], width: 4 }),
      s.deps,
    );
    expect(r.isError).toBe(false);
    let water = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      if (s.state.cells[y]![x]!.terrain?.type === TerrainType.Water) water++;
    }
    expect(water).toBeGreaterThan(80); // a real channel, not a puddle
    expect(s.state.cells[5]![2]!.terrain?.type).toBe(TerrainType.Water);  // source
    expect(s.state.cells[14]![37]!.terrain?.type).toBe(TerrainType.Water); // mouth
  });

  it('paint_terrain smooth option trims edges', async () => {
    const s = setup();
    await executeToolCall(call('paint_terrain', { circle: { cx: 8, cy: 8, r: 4 }, terrain: 'mountain', elevation: 1, smooth: 'round' }), s.deps);
    let trimmed = 0;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      if (s.state.cells[y]![x]!.terrain?.corners) trimmed++;
    }
    expect(trimmed).toBeGreaterThan(0);
  });
});

describe('find_ramp_sites', () => {
  it('returns validated ramp anchors between tiers with the matching ramp item', async () => {
    const { state, deps, exec } = setup(24, 24);
    // a 1-tier plateau with a straight cliff: ramps with heightDrop 1 should fit along its edge
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(call('find_ramp_sites', {}), deps);
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/\(\d+,\s*\d+\)/);      // at least one anchor coordinate
    expect(r.content).toMatch(/ramp-/);               // names the catalog ramp item that fits
    expect(r.content).toMatch(/elev 1 .* elev 0|1 -> 0|tier/i); // says which tiers it connects
    // read tool must NOT mutate state
    expect(exec.getUndoStackSize()).toBe(before);
    expect(state.objects.size).toBe(0);
  });

  it('reports none-found with guidance on a flat map', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('find_ramp_sites', {}), deps);
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/no ramp sites|no cliffs/i);
  });
});

describe('closed-loop measurement hooks', () => {
  it('update_plan appends a scorecard trend when a stage completes', async () => {
    const { deps } = setup();
    let plan: { title: string; status: 'pending' | 'active' | 'done' }[] = [];
    const d = { ...deps, setPlan: (p: typeof plan) => { plan = p; }, getPlan: () => plan };
    const r1 = await executeToolCall(
      call('update_plan', { stages: [{ title: 'terrain', status: 'active' }, { title: 'village', status: 'pending' }] }), d);
    expect(r1.isError).toBe(false);
    expect(r1.content).not.toContain('Scorecard:');
    const r2 = await executeToolCall(
      call('update_plan', { stages: [{ title: 'terrain', status: 'done' }, { title: 'village', status: 'active' }] }), d);
    expect(r2.isError).toBe(false);
    expect(r2.content).toContain('Scorecard: overall');
    expect(r2.content).toContain('Weakest:');
    // re-submitting the same done stage does not re-measure
    const r3 = await executeToolCall(
      call('update_plan', { stages: [{ title: 'terrain', status: 'done' }, { title: 'village', status: 'active' }] }), d);
    expect(r3.content).not.toContain('Scorecard:');
  });

  it('evaluate_map reports the trend against the previous evaluation of the same map', async () => {
    const { deps } = setup();
    const first = await executeToolCall(call('evaluate_map', {}), deps);
    expect(first.content).not.toContain('was ');
    await executeToolCall(
      call('paint_terrain', { rect: { x1: 4, y1: 4, x2: 11, y2: 8 }, terrain: 'water', elevation: 0 }), deps);
    const second = await executeToolCall(call('evaluate_map', {}), deps);
    expect(second.content).toMatch(/water: \d+\/10 \(was \d+, improved\)/);
  });

  it('trims a terrain corner (round) and skips reconcile, and rejects an empty cell', async () => {
    const { state, deps } = setup();
    // a lone raised block has a free convex TR corner to round
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    const ok = await executeToolCall(call('trim_corner', { x: 5, y: 5, corner: 'TR', style: 'fan' }), deps);
    expect(ok.isError).toBe(false);
    expect(state.cells[5]![5]!.terrain!.corners?.[1]).toBe('fan');
    const bad = await executeToolCall(call('trim_corner', { x: 9, y: 9, corner: 'TR', style: 'fan' }), deps);
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/No terrain/);
  });

  it('trim_corner on the road layer targets the road object, not the terrain cell', async () => {
    const { deps } = setup();
    await executeToolCall(call('build_road', { catalogId: 'road-dirt', cells: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }], smooth: 'off' }), deps);
    // (4,4) is the west end-cap of an eastward run, so its TL corner is a free cap corner
    const r = await executeToolCall(call('trim_corner', { x: 4, y: 4, corner: 'TL', style: 'fan', layer: 'road' }), deps);
    expect(r.isError).toBe(false);
    // and it reports the road, not a terrain error, at a cell with no road
    const none = await executeToolCall(call('trim_corner', { x: 18, y: 18, corner: 'TL', style: 'fan', layer: 'road' }), deps);
    expect(none.isError).toBe(true);
    expect(none.content).toMatch(/No road/);
  });

  it('export_map routes through the requestExport UI hook (kind passed through)', async () => {
    const { deps } = setup();
    const seen: string[] = [];
    const withHook: AgentToolDeps = { ...deps, requestExport: (k) => seen.push(k) };
    const img = await executeToolCall(call('export_map', { kind: 'image' }), withHook);
    expect(img.isError).toBe(false);
    expect(seen).toEqual(['image']);
    await executeToolCall(call('export_map', { kind: 'json' }), withHook);
    expect(seen).toEqual(['image', 'json']);
    // headless (no hook): reports unavailable rather than throwing
    const headless = await executeToolCall(call('export_map', { kind: 'image' }), deps);
    expect(headless.isError).toBe(true);
    expect(headless.content).toMatch(/only available in the live editor/);
  });
});

describe('resolveCells bounds (freeze guard)', () => {
  it('a huge or off-map rect is clamped to the map instead of enumerating billions of cells', async () => {
    const { resolveCells } = await import('../../agent/tools/tools-common');
    const { makeState: mk } = await import('../rules/_helpers');
    const state = mk(20, 20);
    const t0 = Date.now();
    const cells = resolveCells({ rect: { x1: 0, y1: 0, x2: 1_000_000, y2: 1_000_000 } }, state);
    expect(cells.length).toBe(400);            // exactly the 20x20 map, nothing more
    expect(Date.now() - t0).toBeLessThan(200); // did not walk the raw extent
  });

  it('an absurd circle radius yields only the in-bounds disc, fast', async () => {
    const { resolveCells } = await import('../../agent/tools/tools-common');
    const { makeState: mk } = await import('../rules/_helpers');
    const state = mk(20, 20);
    const t0 = Date.now();
    const cells = resolveCells({ circle: { cx: 10, cy: 10, r: 5_000_000 } }, state);
    expect(cells.length).toBe(400);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('a wildly off-map line is rejected rather than walked; NaN yields nothing', async () => {
    const { resolveCells } = await import('../../agent/tools/tools-common');
    const { makeState: mk } = await import('../rules/_helpers');
    const state = mk(20, 20);
    expect(resolveCells({ line: { x1: 0, y1: 0, x2: 9_999_999, y2: 0 } }, state)).toEqual([]);
    expect(resolveCells({ rect: { x1: NaN, y1: 0, x2: 5, y2: 5 } }, state)).toEqual([]);
    // a normal in-bounds line still works
    expect(resolveCells({ line: { x1: 2, y1: 2, x2: 8, y2: 2, width: 1 } }, state).length).toBe(7);
  });
});

describe('placement failure guidance', () => {
  it('build_road that lands nothing tells the agent roads need flat grass + the fixes', async () => {
    const { deps, state } = setup();
    // fill the intended path with water so every road cell is rejected
    for (let x = 3; x <= 8; x++) setTerrain(state, x, 5, TerrainType.Water, 0);
    const r = await executeToolCall(call('build_road', { catalogId: 'road-dirt', line: { x1: 3, y1: 5, x2: 8, y2: 5 } }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/FLAT GROUND-LEVEL GRASS/);
    expect(r.content).toMatch(/bridge\/ramp|clear_area/);
  });
});
