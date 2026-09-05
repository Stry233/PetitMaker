/**
 * The flat geometry contract: every shape-taking tool accepts top-level scalar
 * geometry (shape + x1/y1/x2/y2, cx/cy/r, width, nearX/nearY) beside the nested
 * rect/circle/line/cells forms, and both spellings resolve to the same edit.
 * The flat form exists because a guided decoder that compiles the tool schema
 * into a grammar can drop every OPTIONAL compound property (nested object,
 * array, free string) from its emissions while optional scalars come through —
 * so the geometry a tool needs must be reachable through required params and
 * optional scalars alone.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import { TerrainType, ItemCategory, type EditorEvents, type GridState } from '../../core/model/types';
import { getCatalogByCategory } from '../../state/catalog';
import { makeState } from '../rules/_helpers';
import { executeToolCall, TOOL_SCHEMAS, type AgentToolDeps } from '../../agent/tools';
import { describeToolCall } from '../../agent/describe-call';
import { translateFor } from '../../i18n/context';
import { roadLookup } from '../../state/object-index';

function setup(w = 20, h = 20) {
  const state = makeState(w, h);
  const bus = new EventBus<EditorEvents>();
  const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps };
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

/** Terrain fingerprint: every non-empty cell as "x,y:type:elev", order-free. */
function terrainSet(state: GridState): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < state.template.height; y++) {
    for (let x = 0; x < state.template.width; x++) {
      const t = state.cells[y]?.[x]?.terrain;
      if (t) out.add(`${x},${y}:${t.type}:${t.elevation}`);
    }
  }
  return out;
}

describe('flat geometry: both spellings, one edit', () => {
  it('shape:"rect" + x1..y2 paints the same cells as the nested rect', async () => {
    const nested = setup();
    const flat = setup();
    const rn = await executeToolCall(call('paint_terrain', { rect: { x1: 2, y1: 3, x2: 7, y2: 6 }, terrain: 'mountain', elevation: 2 }), nested.deps);
    const rf = await executeToolCall(call('paint_terrain', { shape: 'rect', x1: 2, y1: 3, x2: 7, y2: 6, terrain: 'mountain', elevation: 2 }), flat.deps);
    expect(rn.isError).toBe(false);
    expect(rf.isError).toBe(false);
    expect(terrainSet(flat.state)).toEqual(terrainSet(nested.state));
    expect(terrainSet(flat.state).size).toBeGreaterThan(0);
  });

  it('shape:"circle" + cx,cy,r matches the nested circle, outline included', async () => {
    const nested = setup();
    const flat = setup();
    await executeToolCall(call('paint_terrain', { circle: { cx: 9, cy: 9, r: 4 }, outline: true, terrain: 'mountain', elevation: 1 }), nested.deps);
    await executeToolCall(call('paint_terrain', { shape: 'circle', cx: 9, cy: 9, r: 4, outline: true, terrain: 'mountain', elevation: 1 }), flat.deps);
    expect(terrainSet(flat.state)).toEqual(terrainSet(nested.state));
    expect(terrainSet(flat.state).size).toBeGreaterThan(0);
  });

  it('shape:"line" + x1..y2 + width matches the nested line', async () => {
    const nested = setup();
    const flat = setup();
    await executeToolCall(call('paint_terrain', { line: { x1: 2, y1: 2, x2: 14, y2: 8, width: 2 }, terrain: 'mountain', elevation: 1 }), nested.deps);
    await executeToolCall(call('paint_terrain', { shape: 'line', x1: 2, y1: 2, x2: 14, y2: 8, width: 2, terrain: 'mountain', elevation: 1 }), flat.deps);
    expect(terrainSet(flat.state)).toEqual(terrainSet(nested.state));
    expect(terrainSet(flat.state).size).toBeGreaterThan(0);
  });

  it('shape:"cells" reads the cells array', async () => {
    const { state, deps } = setup();
    const r = await executeToolCall(call('paint_terrain', { shape: 'cells', cells: [{ x: 4, y: 4 }, { x: 5, y: 4 }], terrain: 'mountain', elevation: 1 }), deps);
    expect(r.isError).toBe(false);
    expect(state.cells[4]![4]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 1 });
    expect(state.cells[4]![5]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('flat corners with no shape default to a rect for the area tools', async () => {
    const nested = setup();
    const flat = setup();
    await executeToolCall(call('paint_terrain', { rect: { x1: 2, y1: 2, x2: 5, y2: 5 }, terrain: 'mountain', elevation: 1 }), nested.deps);
    await executeToolCall(call('paint_terrain', { x1: 2, y1: 2, x2: 5, y2: 5, terrain: 'mountain', elevation: 1 }), flat.deps);
    expect(terrainSet(flat.state)).toEqual(terrainSet(nested.state));
  });

  it('cx,cy,r with no shape infer a circle', async () => {
    const nested = setup();
    const flat = setup();
    await executeToolCall(call('paint_terrain', { circle: { cx: 9, cy: 9, r: 3 }, terrain: 'mountain', elevation: 1 }), nested.deps);
    await executeToolCall(call('paint_terrain', { cx: 9, cy: 9, r: 3, terrain: 'mountain', elevation: 1 }), flat.deps);
    expect(terrainSet(flat.state)).toEqual(terrainSet(nested.state));
  });

  it('the nested form wins when both spellings are present', async () => {
    const { state, deps } = setup();
    const r = await executeToolCall(
      call('paint_terrain', { rect: { x1: 2, y1: 2, x2: 3, y2: 3 }, shape: 'rect', x1: 10, y1: 10, x2: 15, y2: 15, terrain: 'mountain', elevation: 1 }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
    expect(state.cells[12]![12]!.terrain).toBeNull();
  });

  it('erase_terrain and clear_area take the flat form', async () => {
    const { state, deps } = setup();
    await executeToolCall(call('paint_terrain', { shape: 'rect', x1: 2, y1: 2, x2: 6, y2: 6, terrain: 'mountain', elevation: 1 }), deps);
    const er = await executeToolCall(call('erase_terrain', { shape: 'rect', x1: 2, y1: 2, x2: 4, y2: 4 }), deps);
    expect(er.isError).toBe(false);
    expect(state.cells[3]![3]!.terrain).toBeNull();
    const cl = await executeToolCall(call('clear_area', { shape: 'rect', x1: 5, y1: 5, x2: 6, y2: 6 }), deps);
    expect(cl.isError).toBe(false);
    expect(state.cells[6]![6]!.terrain).toBeNull();
  });

  it('build_road lays the same road from flat x1..y2 as from the nested line', async () => {
    const roadId = getCatalogByCategory(ItemCategory.Road)[0]!.id;
    const nested = setup();
    const flat = setup();
    const rn = await executeToolCall(call('build_road', { catalogId: roadId, line: { x1: 2, y1: 5, x2: 12, y2: 5 } }), nested.deps);
    const rf = await executeToolCall(call('build_road', { catalogId: roadId, shape: 'line', x1: 2, y1: 5, x2: 12, y2: 5 }), flat.deps);
    expect(rn.isError).toBe(false);
    expect(rf.isError).toBe(false);
    const roadCells = (s: GridState) => new Set([...s.objects.values()].map((o) => `${o.position.x},${o.position.y}`));
    expect(roadCells(flat.state)).toEqual(roadCells(nested.state));
    expect(roadCells(flat.state).size).toBeGreaterThan(0);
  });

  it('build_road treats bare flat corners as the line, not a rect', async () => {
    const roadId = getCatalogByCategory(ItemCategory.Road)[0]!.id;
    const { state, deps } = setup();
    const r = await executeToolCall(call('build_road', { catalogId: roadId, x1: 2, y1: 2, x2: 8, y2: 8 }), deps);
    expect(r.isError).toBe(false);
    // a diagonal LINE of ~7-13 cells, nowhere near the 49-cell rect fill
    expect(state.objects.size).toBeLessThan(20);
    expect(state.objects.size).toBeGreaterThan(5);
  });

  it('scatter_objects takes flat rect corners', async () => {
    const treeId = getCatalogByCategory(ItemCategory.Tree)[0]!.id;
    const { deps } = setup();
    const r = await executeToolCall(call('scatter_objects', { catalogIds: [treeId], count: 3, x1: 2, y1: 2, x2: 15, y2: 15 }), deps);
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/^Scattered [1-3]\/3/);
  });

  it('the site finders take nearX/nearY as the flat near point', async () => {
    const a = setup();
    const b = setup();
    const flatArgs = { minWidth: 2, minHeight: 2 };
    const rn = await executeToolCall(call('find_flat_areas', { ...flatArgs, near: { x: 3, y: 3 } }), a.deps);
    const rf = await executeToolCall(call('find_flat_areas', { ...flatArgs, nearX: 3, nearY: 3 }), b.deps);
    expect(rf.content).toEqual(rn.content);
    const bn = await executeToolCall(call('find_bridge_sites', { near: { x: 5, y: 5 } }), a.deps);
    const bf = await executeToolCall(call('find_bridge_sites', { nearX: 5, nearY: 5 }), b.deps);
    expect(bf.content).toEqual(bn.content);
    const gn = await executeToolCall(call('find_ramp_sites', { near: { x: 5, y: 5 } }), a.deps);
    const gf = await executeToolCall(call('find_ramp_sites', { nearX: 5, nearY: 5 }), b.deps);
    expect(gf.content).toEqual(gn.content);
  });
});

describe('flat geometry: the refusal teaches the flat contract', () => {
  it('no geometry at all shows the flat rect example first', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('paint_terrain', { terrain: 'mountain', elevation: 1 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('shape: "rect", x1: 10, y1: 10, x2: 20, y2: 18');
  });

  it('shape:"rect" with missing corners names exactly the absent scalars', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('paint_terrain', { shape: 'rect', x1: 2, y1: 2, terrain: 'mountain', elevation: 1 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/missing x2, y2/);
    expect(r.content).toContain('shape: "rect"');
  });

  it('shape:"circle" with missing center/radius names them', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('paint_terrain', { shape: 'circle', cx: 5, terrain: 'mountain', elevation: 1 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/missing cy, r/);
    expect(r.content).toContain('shape: "circle"');
  });

  it('shape:"line" with missing endpoints names them', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('paint_terrain', { shape: 'line', x1: 2, y1: 2, terrain: 'mountain', elevation: 1 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/missing x2, y2/);
    expect(r.content).toContain('shape: "line"');
  });

  it('shape:"cells" with no cells array asks for it', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('paint_terrain', { shape: 'cells', terrain: 'mountain', elevation: 1 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('cells: [{"x":10,"y":10}');
  });

  it('build_road with no geometry shows the flat line example', async () => {
    const roadId = getCatalogByCategory(ItemCategory.Road)[0]!.id;
    const { deps } = setup();
    const r = await executeToolCall(call('build_road', { catalogId: roadId }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('shape: "line", x1: 10, y1: 10, x2: 20, y2: 10');
  });
});

describe('flat geometry: the schema stays emittable', () => {
  /** Every name in a `required` list must map to a property a guided decoder
   *  emits under pressure: anything but a nested object. (Required arrays and
   *  required scalars are proven emittable; OPTIONAL compounds are the ones a
   *  guided decoder drops, so a tool's geometry must never hide only there.) */
  function assertNoRequiredObject(schema: Record<string, unknown>, path: string): void {
    const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
    const required = (schema.required as string[] | undefined) ?? [];
    for (const name of required) {
      const p = props?.[name];
      expect(p, `${path}.${name} is required but undeclared`).toBeDefined();
      expect(p!.type, `${path}.${name} must not be a required nested object`).not.toBe('object');
    }
    for (const [name, p] of Object.entries(props ?? {})) {
      if (p.type === 'object') assertNoRequiredObject(p, `${path}.${name}`);
      const items = p.items as Record<string, unknown> | undefined;
      if (p.type === 'array' && items?.type === 'object') assertNoRequiredObject(items, `${path}.${name}[]`);
    }
  }

  it('no tool requires a nested object anywhere', () => {
    for (const t of TOOL_SCHEMAS) assertNoRequiredObject(t.inputSchema, t.name);
  });

  it('every shape-taking tool advertises its flat scalar geometry', () => {
    const props = (name: string) => (TOOL_SCHEMAS.find((t) => t.name === name)!.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;
    for (const name of ['paint_terrain', 'erase_terrain', 'clear_area']) {
      const p = props(name);
      expect(p.shape?.enum).toEqual(['rect', 'circle', 'line', 'cells']);
      for (const k of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width']) {
        expect(p[k]?.type, `${name}.${k}`).toBe('integer');
      }
    }
    const road = props('build_road');
    expect(road.shape?.enum).toEqual(['line', 'cells']);
    for (const k of ['x1', 'y1', 'x2', 'y2', 'width']) expect(road[k]?.type, `build_road.${k}`).toBe('integer');
    {
      const p = props('scatter_objects');
      for (const k of ['x1', 'y1', 'x2', 'y2']) expect(p[k]?.type, `scatter_objects.${k}`).toBe('integer');
    }
    for (const name of ['find_flat_areas', 'find_bridge_sites', 'find_ramp_sites']) {
      const p = props(name);
      for (const k of ['nearX', 'nearY']) expect(p[k]?.type, `${name}.${k}`).toBe('integer');
    }
  });
});

describe('flat geometry: the approval line reads it', () => {
  const en = (k: string, p?: Record<string, string | number>) => translateFor('en', k, p);

  it('a flat paint_terrain call describes with the same area phrase as the nested one', () => {
    const nested = describeToolCall({ name: 'paint_terrain', input: { rect: { x1: 2, y1: 3, x2: 7, y2: 6 }, terrain: 'mountain', elevation: 2 } }, en);
    const flat = describeToolCall({ name: 'paint_terrain', input: { shape: 'rect', x1: 2, y1: 3, x2: 7, y2: 6, terrain: 'mountain', elevation: 2 } }, en);
    expect(flat).toEqual(nested);
    expect(flat).toContain('(2,3)');
  });

  it('a flat scatter_objects rect reaches the description', () => {
    const nested = describeToolCall({ name: 'scatter_objects', input: { catalogIds: ['tree-a'], count: 5, rect: { x1: 0, y1: 0, x2: 9, y2: 9 } } }, en);
    const flat = describeToolCall({ name: 'scatter_objects', input: { catalogIds: ['tree-a'], count: 5, x1: 0, y1: 0, x2: 9, y2: 9 } }, en);
    expect(flat).toEqual(nested);
  });
});
