import type { CommandExecutor } from '../../core/commands/command-executor';
import type { EditorView, ToolOverlay, ViewProjection } from '../../tools/pointer/runtime';
import { createToolHost, HEADLESS_OVERLAY, type HostedToolContext } from '../../tools/pointer/runtime/host';
import type { ToolArming } from '../../state/editing/arming';
import { ToolType } from '../../state/editing/vocabulary';
import { editorCurves } from '../../editor/session/tool-wiring';
import { headlessViewVerbs } from './tool-manager';
import type { MacroCoord, Rotation } from '../../core/model/types';
import { showPlacementHover, type PlacementGhostPlan } from '../../tools/pointer/objects';

/** A test's context: the host's members may be swapped, the way a view switch or a new map would. */
export type TestToolContext = { -readonly [K in keyof HostedToolContext]: HostedToolContext[K] };

/** What a test overrides: any context member, and any arming field by its own name. */
export type ToolCtxOver = Partial<Omit<TestToolContext, 'arming'>> & Partial<ToolArming>;

/** The arming a headless test starts from: nothing armed, everything visible, the brush up. */
export function testArming(over: Partial<ToolArming> = {}): ToolArming {
  return {
    tool: ToolType.TerrainBrush,
    shape: 'free',
    contentType: 'mountain',
    floor: 1,
    layerPinned: false,   // the store's default: nobody has chosen a layer by hand
    brushSize: 1,
    layerVisibility: {},
    autoEdgeCut: 'off',
    eraserShape: 'free',
    tileMaterial: 'path-overgrown-dirt',
    // A test that names a material means it — the store's own default is `false`, and the road
    // macros read the map's surface under it.
    tileMaterialPicked: true,
    armedItem: null,
    placementRotation: 0,
    armedMacro: null,
    armingEpoch: 0,
    region: [],
    groundEditable: false,
    planetMaterial: 'mountain',
    annotationTool: 'none',
    annotationZoneShape: 'free',
    annotationColor: '#FF8A7A',
    annotationTag: 'homes',
    annotationSize: 'm',
    annotationRouteDashed: true,
    annotationRouteWidth: 1,
    notes: { selection: [], draft: null, historyEpoch: 0, discardPending: false },
    ...over,
  };
}

const ARMING_KEYS: ReadonlySet<string> = new Set(Object.keys(testArming()));

/** Re-arm a test context, as a bar change between two events would. */
export function arm(ctx: { arming: ToolArming }, patch: Partial<ToolArming>): void {
  ctx.arming = { ...ctx.arming, ...patch };
}

/** A hosted tool context over a test map + executor, through the live host builder, with a headless
 *  view (an overlay that draws nothing) and `testArming` at the given brush size and floor. `over`
 *  names only the fields a test is about, applied last so they win. A test may replace `overlay`
 *  or `viewport` afterwards as a view switch would. */
export function makeToolCtx(
  state: any, executor: CommandExecutor, brushSize = 1, floor = 1,
  over: ToolCtxOver = {},
): TestToolContext {
  const { overlay, viewport, ...rest } = over;
  const view = { projection: viewport ?? (null as unknown as ViewProjection), overlay: overlay ?? { ...HEADLESS_OVERLAY }, ...headlessViewVerbs() };
  const host = createToolHost({ state, executor, view: () => view as EditorView, curve: editorCurves });
  Object.defineProperties(host, {
    overlay: { get: () => view.overlay, set: (next: ToolOverlay) => { view.overlay = next; }, enumerable: true },
    viewport: { get: () => view.projection, set: (next: ViewProjection) => { view.projection = next; }, enumerable: true },
  });
  const arming: Partial<ToolArming> = { brushSize, floor };
  const members: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (ARMING_KEYS.has(key)) (arming as Record<string, unknown>)[key] = value;
    else members[key] = value;
  }
  return Object.assign(host as TestToolContext, { arming: testArming(arming) }, members);
}

/** Grid objects with a given catalogId. */
export function objectsByCatalog(state: any, catalogId: string): any[] {
  return [...state.objects.values()].filter((o: any) => o.catalogId === catalogId);
}

/** The placer's hover plan for `itemId` at `coord`, through the hover that draws it on `ctx.overlay`. */
export function placementHover(itemId: string, coord: MacroCoord, ctx: TestToolContext, rotation: Rotation = 0): PlacementGhostPlan | null {
  return showPlacementHover(ctx.overlay, itemId, coord, ctx, rotation);
}
