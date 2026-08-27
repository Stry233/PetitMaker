/**
 * The terrain bar: what a cell arms, what the slider spans, what a badge says, and smart build.
 *
 * The cell assertions are on the RESOLVED tool, never on the inputs the click wrote. The row names
 * a tool and a shape; `resolveEditMode` decides what the map actually arms, and the four shape
 * cells all resolve to one tool that multiplexes the figure internally — so a test that checked the
 * inputs would pass while the map was armed with something else entirely.
 *
 * The road-action test runs the REAL macro (the mock keeps the implementation and only watches the
 * arguments), because the flow rests on a macro being exactly one undo entry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('../../../tools/macros', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../tools/macros')>();
  return { ...actual, applyMacro: vi.fn(actual.applyMacro) };
});

import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { ToolType, type EditorEvents, type GridState } from '../../../core/model/types';
import { COMMAND_META, effectiveCombo, useKeybinds } from '../../../core/runtime/keybindings';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { applyMacro } from '../../../tools/macros';
import { setToastPresenter } from '../../../core/runtime/toast-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { useEditorStore } from '../../../state/store';
import { ScaleProvider } from '../../../ui/design/scale';
import { apparentSize, type GlyphInk } from '../../../ui/shell/frame';
import { SCALE } from '../../../ui/shell/units';
import { prettyCombo } from '../../../core/runtime/keybindings';
import { SLIDER_LIFT, TerrainBar } from '../../../ui/shell/bars/TerrainBar';
import { CELL_BOX } from '../../../ui/shell/bars/ToolCell';
import { SMART } from '../../../ui/shell/bars/smart-menu';
import {
  BADGE, BRUSH, CELL, GLYPH, PLATE_PAD, TOOL_CELLS,
  plateRight, plateShape, type TerrainSurface,
} from '../../../ui/shell/bars/terrain-cells';
import { getRoadMaterials } from '../../../state/catalog';
import { localizedName } from '../../../i18n/context';
import { makeState } from '../../rules/_helpers';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';

/** Mounted at REST inside the surface: nothing armed, so a press on any cell arms it. A cell is a
 *  toggle, and the free brush is the store's own default, so a bar mounted with it already armed
 *  would answer the first press on that cell by putting it away. */
function mount(surface: TerrainSurface) {
  useEditorStore.getState().setEditMode({ mode: surface, tool: 'none', shape: 'free' });
  return render(
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <TerrainBar surface={surface} />
      </ScaleProvider>
    </I18nProvider>,
  );
}

/** A live map in the store, which is where `currentKit()` reads the editor from. */
function installMap(): { state: GridState; exec: CommandExecutor } {
  const state = makeState(32, 32);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  useEditorStore.setState({ gridState: state, commandExecutor: exec });
  return { state, exec };
}

beforeEach(() => {
  // A FRESH APP: the catalog's first road armed and nobody having chosen it, which is what makes
  // the smart press read the map's own surface instead.
  useEditorStore.setState({
    locale: 'en', brushSize: 1, tileMaterial: getRoadMaterials()[0]!.id, tileMaterialPicked: false,
  });
  useKeybinds.getState().resetAll();
  vi.mocked(applyMacro).mockClear();
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [], autoEdgeCut: 'off' });
  useEditorStore.getState().setEditMode({ mode: null, tool: 'brush', shape: 'free' });
  useKeybinds.getState().resetAll();
});

describe('the terrain bar arms the tool the map uses', () => {
  const cases: [string, ToolType, string][] = [
    ['Free Brush', ToolType.TerrainBrush, 'brush'],
    ['Eraser', ToolType.Eraser, 'eraser'],
    ['Edge Cut', ToolType.EdgeCut, 'edge-cut'],
    ['Line Brush', ToolType.TerrainBrush, 'line'],
    ['Curve Brush', ToolType.TerrainBrush, 'curve'],
    ['Rect Brush', ToolType.TerrainBrush, 'rect'],
    ['Circle Brush', ToolType.TerrainBrush, 'circle'],
  ];

  for (const [label, tool, mode] of cases) {
    it(`${label} arms ${mode}`, () => {
      mount('mountain');
      fireEvent.click(screen.getByLabelText(label));
      const s = useEditorStore.getState();
      expect(s.activeTool).toBe(tool);
      expect(s.designMode).toBe(mode);
      expect(screen.getByLabelText(label).getAttribute('aria-pressed')).toBe('true');
    });
  }

  /**
   * A cell is a TOGGLE, the way a mode block is, and what it toggles off is not the same thing.
   *
   * Pressing a block again clears the mode and takes the bar with it. Pressing the active CELL again
   * puts the tool away and leaves the mode standing: the bar is still up, the surface is still the
   * one that was chosen, and the map is on the hand with nothing armed.
   */
  it('puts the active tool away on a second press, and keeps the mode it lives in', () => {
    mount('water');
    fireEvent.click(screen.getByLabelText('Rect Brush'));
    expect(useEditorStore.getState().activeTool).toBe(ToolType.TerrainBrush);
    fireEvent.click(screen.getByLabelText('Rect Brush'));
    const s = useEditorStore.getState();
    expect(s.activeTool).toBe(ToolType.Hand);
    expect(s.designMode).toBe('hand');
    // The mode is untouched, so the bar is still the water bar and the next mark lays water.
    expect(s.editMode.mode).toBe('water');
    expect(s.contentType).toBe('water');
    expect(screen.getByLabelText('Rect Brush').getAttribute('aria-pressed')).toBe('false');
    // And the figure is remembered: picking the cell back up gives the rectangle, not a free brush.
    fireEvent.click(screen.getByLabelText('Rect Brush'));
    expect(useEditorStore.getState().designMode).toBe('rect');
  });

  it('lays the surface its bar is showing', () => {
    mount('water');
    fireEvent.click(screen.getByLabelText('Free Brush'));
    expect(useEditorStore.getState().contentType).toBe('water');
    cleanup();
    mount('road');
    fireEvent.click(screen.getByLabelText('Free Brush'));
    expect(useEditorStore.getState().contentType).toBe('tile');
  });
});

/**
 * What one glyph measures on screen once the row has sized it, in design px. `ratio` over a set is
 * the whole test: nothing here asserts a number the design chose, only that the members of a row
 * come out within reach of each other.
 */
function drawn(ink: GlyphInk): { span: number; area: number } {
  const k = GLYPH / apparentSize(ink);
  return { span: Math.hypot(ink.w * k, ink.h * k), area: ink.area * k * k };
}

const ratio = (xs: number[]) => Math.max(...xs) / Math.min(...xs);

const SURFACES: TerrainSurface[] = ['mountain', 'water', 'road'];

describe('the row of tool glyphs reads as one set', () => {
  // The bounds are headroom over what the eleven drawings currently measure, so they move when a
  // drawing does. With the line and curve handles drawn, spans measure 1.22 and weights 1.48,
  // because a stroke with a blob at either end covers a lot of box for
  // the ink it carries, and the drawing at the other end of the row is a solid mountain mass.
  it('brings every cell within a quarter of one size and half of one weight, on all three surfaces', () => {
    for (const surface of SURFACES) {
      const marks = TOOL_CELLS.map((c) => drawn(c.glyph[surface].ink));
      expect(ratio(marks.map((m) => m.span))).toBeLessThan(1.25);
      expect(ratio(marks.map((m) => m.area))).toBeLessThan(1.55);
    }
  });

  it('draws the same tool at the same size whichever surface is open', () => {
    // Unnormalized, 绘制山体 is one mass 106 x 81 and 绘制地形 four shapes spanning 85 x 60,
    // so the mountain bar's brush would read a third bigger than the road bar's.
    for (const cell of TOOL_CELLS) {
      expect(ratio(SURFACES.map((s) => drawn(cell.glyph[s].ink).span))).toBeLessThan(1.15);
    }
  });

  it('is the improvement over drawing each glyph at the size the design gave it', () => {
    // The line cell's bar is masked to make room for two handles the document hides; a glyph
    // measuring the bar minus the two bites would be the smallest thing here by a wide margin
    // (a ratio of 2.5). Drawn whole it is an ordinary member of the row, and the widest and
    // narrowest of the design's own drawings are the mountain mass and the trim scissors.
    const asDrawn = SURFACES.flatMap((s) => TOOL_CELLS.map((c) => Math.hypot(c.glyph[s].ink.w, c.glyph[s].ink.h)));
    expect(ratio(asDrawn)).toBeGreaterThan(1.6);
  });
});

describe('the road surfaces', () => {
  it('are the catalog\'s own, name and picture and all, and only 路面 offers them', () => {
    const items = getRoadMaterials();
    expect(items.length).toBeGreaterThan(1);

    mount('road');
    const group = screen.getByRole('group');
    const swatches = within(group).getAllByRole('button');
    expect(swatches.map((b) => b.getAttribute('aria-label')))
      .toEqual(items.map((i) => localizedName(i.name, 'en')));
    // A style attribute reads back as `rgb(...)`, so the catalog's hex is put in those terms.
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    // The catalog's own icon is what the swatch shows; only the plain dirt road carries none,
    // and it falls back to the flat colour a sprite-less item is drawn with everywhere else.
    items.forEach((item, i) => {
      const swatch = swatches[i]!;
      if (item.icon) {
        expect(swatch.querySelector('img')?.getAttribute('src')).toContain(item.icon);
      } else {
        expect(swatch.querySelector('img')).toBeNull();
        expect((swatch.lastElementChild as HTMLElement).style.background).toBe(rgb(item.color!));
      }
    });

    cleanup();
    mount('mountain');
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('arm the surface the tile brush lays, and open on the one it is already laying', () => {
    const first = getRoadMaterials()[0]!;
    const second = getRoadMaterials()[1]!;
    expect(useEditorStore.getState().tileMaterial).toBe(first.id);

    mount('road');
    const named = (id: string) => screen.getByLabelText(
      localizedName(getRoadMaterials().find((i) => i.id === id)!.name, 'en'),
    );
    expect(named(first.id).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(named(second.id));
    expect(useEditorStore.getState().tileMaterial).toBe(second.id);
    expect(named(second.id).getAttribute('aria-pressed')).toBe('true');
    expect(named(first.id).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the brush slider', () => {
  /**
   * Bottom-aligned, the slider reads as the low thing on the bar: its box shares a bottom
   * edge with the cells and measures equal there, but a cell plate is 115 design px and the groove
   * 79, so the knob riding it — a cream disc among cream pills — hangs past the line every plate
   * stops at. Boxes are not what the eye compares; the two drawings are.
   */
  it('stands its own middle on the middle of the cells, not its bottom on their bottom', () => {
    const cellMid = (CELL.h / 2) * SCALE;
    const sliderMid = (BRUSH.centreY - BRUSH.track.y) * SCALE + SLIDER_LIFT;
    expect(sliderMid).toBeCloseTo(cellMid, 6);
    // Lifted, not dropped: the groove is the shorter of the two.
    expect(SLIDER_LIFT).toBeGreaterThan(0);
    expect(BRUSH.track.h).toBeLessThan(CELL.h);
  });

  /**
   * A CONTROL THAT CANNOT BE MOVED SAYS SO. A rectangle and a circle are laid to the size they are
   * dragged out to and the trimmer takes one corner, so the width has nothing to set while one of
   * those is armed: an inert slider that still looks live gets dragged, does nothing, and reads as
   * the app being broken. It stays on the row — removing it would reflow the row on every tool
   * change — and it refuses.
   */
  it.each(['rect', 'circle', 'trim'])('refuses while %s is armed, and stays on the row', (id) => {
    mount('mountain');
    fireEvent.click(screen.getByLabelText(translations.en[TOOL_CELLS.find((c) => c.id === id)!.labelKey]!));
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-disabled')).toBe('true');
    expect(slider.getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(slider, { key: 'End' });
    expect(useEditorStore.getState().brushSize).toBe(1);
  });

  /** The eraser is the one cell that is sized in one of its states and not in the others: its DAB
   *  takes the width, its two drag shapes are taken at whatever size they were dragged out to. */
  it.each(['rect', 'circle'] as const)('refuses while the eraser is set to %s', (shape) => {
    mount('mountain');
    fireEvent.click(screen.getByLabelText(translations.en[TOOL_CELLS.find((c) => c.id === 'erase')!.labelKey]!));
    expect(screen.getByRole('slider').getAttribute('aria-disabled')).toBeNull(); // the dab takes a width

    act(() => { useEditorStore.getState().setEraserShape(shape); });
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-disabled')).toBe('true');

    act(() => { useEditorStore.getState().setEraserShape('dot'); });
    expect(screen.getByRole('slider').getAttribute('aria-disabled')).toBeNull();
  });

  it('is live for the tools that lay to a width, and at rest', () => {
    mount('mountain');
    expect(screen.getByRole('slider').getAttribute('aria-disabled')).toBeNull();

    for (const id of ['draw', 'erase', 'line', 'curve']) {
      fireEvent.click(screen.getByLabelText(translations.en[TOOL_CELLS.find((c) => c.id === id)!.labelKey]!));
      expect(screen.getByRole('slider').getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('spans 1 to 5 and clamps at both ends', () => {
    mount('mountain');
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuemin')).toBe('1');
    expect(slider.getAttribute('aria-valuemax')).toBe('5');
    expect(slider.getAttribute('aria-valuenow')).toBe('1');

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useEditorStore.getState().brushSize).toBe(1);

    fireEvent.keyDown(slider, { key: 'End' });
    expect(useEditorStore.getState().brushSize).toBe(5);

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useEditorStore.getState().brushSize).toBe(5);
  });

  /** The reading rides the slider's own KNOB, shown while a hand is on it, so what is asserted is
   *  the value the slider REPORTS rather than a number standing permanently beside the track. One
   *  cell is the size the bar opens at, so the singular is the FIRST thing anybody reads here. The
   *  count carries its own word in every locale, and only the two that inflect have a second form
   *  of it: the others repeat the one line deliberately, since a language with no plural must not
   *  be given a fake one. */
  it('reads a single cell in the singular, and takes the plural from there', () => {
    mount('mountain');
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('1 cell');

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('5 cells');

    for (const locale of ['zh', 'ja', 'th', 'id', 'ru'] as const) {
      expect(translations[locale]['agent2.n_cells_one']).toBe(translations[locale]['agent2.n_cells']);
    }
    for (const locale of ['en', 'fr'] as const) {
      expect(translations[locale]['agent2.n_cells_one']).not.toBe(translations[locale]['agent2.n_cells']);
    }
  });
});

describe('the shortcut badges', () => {
  /** The badge hangs off the CELL, not off the button inside it: hung off the button it would ride
   *  the hover pop, and a key is a label on the cell. The cell is the button's parent. */
  const cell = (label: string) => screen.getByLabelText(label).parentElement!;
  /** The badge's own box: the plate and the keys inside the anchor laid over the cell. */
  const badge = (label: string, keys: string) => within(cell(label)).getByText(keys).parentElement!;

  it('read the live binding, so a rebind shows on the bar', () => {
    mount('mountain');
    expect(within(cell('Free Brush')).getByText('1')).toBeTruthy();

    act(() => { expect(useKeybinds.getState().rebind('tool.brush', 'k').ok).toBe(true); });
    expect(within(cell('Free Brush')).getByText('K')).toBeTruthy();
  });

  /**
   * THE BADGE COVERS THE PLATE'S CORNER, which a stadium does not have as a point.
   *
   * Its right edge is the plate's, and either number to its side reads wrong.
   * The design's is 19 design px PAST the cell, and by the badge's row a corner rounded to
   * half the cell's height has curved well away, so the badge floats clear of the shape it belongs
   * to. Pulling it back to where the arc reaches the badge's bottom edge is the furthest right it
   * can stand and only TOUCH the plate, so it stops short of the corner instead. On the plate's own
   * edge the badge's bottom-right corner lands outside the arc and the badge sits over the corner.
   */
  it('covers the corner rather than floating past it or stopping short', () => {
    const r = CELL.h / 2;
    const cap = { x: CELL.w - r, y: r };
    const bottom = BADGE.h - BADGE.rise;
    /** How far the badge's bottom-right corner is from the cap's centre, for a given right edge. */
    const fromCap = (right: number) => Math.hypot(right - cap.x, bottom - cap.y);
    /** Where the arc reaches at the badge's bottom edge: a tangent-only placement. */
    const tangent = cap.x + Math.sqrt(r * r - (r - bottom) ** 2);

    // On the plate's edge the corner is OUTSIDE the arc, so the badge overlaps the shape.
    expect(fromCap(CELL.w)).toBeGreaterThan(r);
    // Not so far out that it leaves the plate: the drawing's own right edge (141 + 44) does.
    expect(fromCap(185) - r).toBeGreaterThan(3 * (fromCap(CELL.w) - r));
    // And a tangent-only placement stops short of the plate's own edge.
    expect(fromCap(tangent)).toBeCloseTo(r, 6);
    expect(tangent).toBeLessThan(CELL.w);
  });

  /**
   * THE BADGE FOLLOWS THE PLATE'S RIGHT EDGE, and that edge is the one thing about a cell that
   * moves: the plate grows when the cell is chosen and opens into a pill around the auto-trim
   * setting. Placed from the left at any constant the badge would simply stay where it was as the
   * pill opened.
   *
   * The following is css: the badge hangs off the CELL BOX, which is as wide as the cell plus the
   * control it is holding, so a pill of any width carries it along with nothing measured. What is
   * checked here is that nothing stands between the two pinning it to a constant, and that the
   * offset it takes is the plate's own.
   */
  it('hangs off the plate edge, so a pill of any width carries it along', () => {
    mount('mountain');
    const box = () => badge('Free Brush', '1');
    expect(box().parentElement).toBe(cell('Free Brush'));
    expect(box().style.left).toBe('');

    // The plate and the badge read ONE description of that edge, so they cannot drift apart.
    for (const [active, grown] of [[false, false], [true, false], [true, true]] as const) {
      expect(plateShape(active, grown).right).toBe(plateRight(active, grown));
    }
    // At rest and as a pill the edge is the cell box's own; chosen without a control the plate
    // stands proud of it, and the badge stands out with it.
    expect(plateRight(false, false)).toBe(0);
    expect(plateRight(true, true)).toBe(0);
    expect(plateRight(true, false)).toBe(-PLATE_PAD.x);
    expect(PLATE_PAD.x).toBeGreaterThan(0);
  });

  /** Smart build is the last cell of the row and wears what the other seven wear. It draws its own
   *  button rather than going through the shared one, so it picks up no badge by itself. */
  it('reach the smart-build cell too, on the command that opens it', () => {
    expect(COMMAND_META.find((c) => c.id === SMART.commandId), 'no command opens smart build').toBeTruthy();
    mount('mountain');
    const combo = effectiveCombo({}, SMART.commandId)!;
    expect(within(cell('Smart build')).getByText(prettyCombo(combo))).toBeTruthy();

    act(() => { expect(useKeybinds.getState().rebind(SMART.commandId, 'y').ok).toBe(true); });
    expect(within(cell('Smart build')).getByText('Y')).toBeTruthy();
  });
});

/**
 * THE ROW IS ONE HEIGHT, whatever any cell is doing.
 *
 * Choosing the free brush grows its plate into a pill around the auto-trim setting. Taking that
 * growth as the wrapper's own height pulled back by a bottom margin alone leaves the half above
 * unaccounted and lifts the whole tool row three px. Everything the plate does past the cell box is
 * an absolute span, so the box the row is laid out from cannot move.
 */
describe('a cell that grows changes its width and nothing else', () => {
  const box = (label: string) => screen.getByLabelText(label).parentElement as HTMLElement;

  it('keeps the cell box at one height through the pill', () => {
    mount('mountain');
    expect(box('Free Brush').style.height).toBe(`${CELL_BOX.h}px`);

    fireEvent.click(screen.getByLabelText('Free Brush'));
    expect(box('Free Brush').style.height).toBe(`${CELL_BOX.h}px`);
    // Nor is there a margin quietly putting a taller box back on the line.
    expect(box('Free Brush').style.marginTop).toBe('');
    expect(box('Free Brush').style.marginBottom).toBe('');
  });

  it('draws the plate as a span that reaches outside the box rather than as the box', () => {
    mount('mountain');
    const plate = box('Free Brush').firstElementChild as HTMLElement;
    expect(plate.style.position).toBe('absolute');
    expect(plate.tagName).toBe('SPAN');
    // The one description of the shape, at each state, is what a press animates between.
    expect(plateShape(false, false).left).toBeCloseTo(0, 10);
    expect(plateShape(true, false).left).toBeLessThan(0);
    expect(plateShape(true, false).right).toBe(plateShape(true, false).left);
    // A grown pill ENDS at the control it holds, so its right edge is the cell's own box edge.
    expect(plateShape(true, true).right).toBeCloseTo(0, 10);
  });
});

/**
 * SMART BUILD ARMS A TOOL. The store's one tool fact is what the row and the map both read, so a
 * row with one choice and a press that means one thing are properties of `setEditMode`, held here
 * against the resolved state. What a PRESS ON THE MAP does belongs to the macro tool and is held
 * in `tools/macros/macro-tool.test.ts`, not here: this bar only chooses.
 */
describe('smart build', () => {
  it('arms the macro tool with its first action, and puts the chosen tool away', () => {
    installMap();
    mount('mountain');

    fireEvent.click(screen.getAllByRole('button', { name: 'Free Brush' })[0]!);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.TerrainBrush);

    fireEvent.click(screen.getByLabelText('Smart build'));
    const store = useEditorStore.getState();
    expect(store.editMode.tool).toBe('smart');
    expect(store.armedMacro).toBe('raise');
    expect(store.activeTool).toBe(ToolType.Macro);
  });

  it('and choosing a tool puts IT away', () => {
    installMap();
    mount('mountain');

    fireEvent.click(screen.getByLabelText('Smart build'));
    expect(useEditorStore.getState().armedMacro).toBe('raise');

    fireEvent.click(screen.getAllByRole('button', { name: 'Free Brush' })[0]!);
    const store = useEditorStore.getState();
    expect(store.armedMacro).toBeNull();
    expect(store.activeTool).toBe(ToolType.TerrainBrush);
  });

  it('pressing the armed star closes the pill and puts the brush back', () => {
    installMap();
    mount('mountain');

    fireEvent.click(screen.getByLabelText('Smart build'));
    fireEvent.click(screen.getByLabelText('Smart build'));
    const store = useEditorStore.getState();
    expect(store.armedMacro).toBeNull();
    expect(store.editMode.tool).toBe('brush');
  });

  /**
   * A WHOLE-MAP action has nothing to aim, so its press RUNS: each press is one edit and one undo
   * entry, with a fresh seed, and undo is how you decline — the press-again-for-another grammar
   * the aimed macros have at a cell.
   */
  it('runs the road action on press, one undo entry each, with a fresh seed after a press that changed something', () => {
    const { state, exec } = installMap();
    // Something for the router to connect: the seed advancing at all rests on THIS press laying a
    // network — a press that changes nothing reuses its seed instead (see the empty-press case
    // below), so an empty fixture could not tell the two apart.
    const stall = { id: generateObjectId(), catalogId: 'building-stall', position: { x: 10, y: 10 }, rotation: 0 as const, elevation: 0 };
    expect(exec.execute(objectPlacementCommand(stall)).success).toBe(true);
    const depth = exec.getUndoStackSize();
    mount('road');

    fireEvent.click(screen.getByLabelText('Smart build'));
    expect(vi.mocked(applyMacro).mock.calls.map((c) => c[1])).toEqual(['roads']);
    expect(useEditorStore.getState().armedMacro, 'nothing to aim, so nothing armed').toBeNull();
    expect(vi.mocked(applyMacro).mock.results[0]!.value.changes, 'the first press laid the stall\'s spur').toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('Smart build'));
    const seeds = vi.mocked(applyMacro).mock.calls.map((c) => c[2].seed);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(exec.getUndoStackSize()).toBeGreaterThanOrEqual(depth);
    void state;
  });

  /**
   * PRESSING AGAIN IS AN ALTERNATIVE, NOT AN ADDITION. The second press hands the first one's own
   * object ids back to the macro, which takes them off the map before laying the next candidate —
   * and says so, because two road layouts on a large island are easy to mistake for one.
   */
  it('a second press takes the first press\'s own work back, and names the plan it laid instead', () => {
    const { exec } = installMap();
    const stall = { id: generateObjectId(), catalogId: 'building-stall', position: { x: 10, y: 10 }, rotation: 0 as const, elevation: 0 };
    expect(exec.execute(objectPlacementCommand(stall)).success).toBe(true);
    const toasts: string[] = [];
    setToastPresenter((text) => { toasts.push(text); });
    mount('road');

    fireEvent.click(screen.getByLabelText('Smart build'));
    const laid = vi.mocked(applyMacro).mock.results[0]!.value.ownedIds ?? [];
    expect(laid.length, 'the first press laid nothing to take back').toBeGreaterThan(0);
    expect(vi.mocked(applyMacro).mock.calls[0]![2].replace, 'a first press has nothing of its own').toBeUndefined();
    expect(toasts, 'the first press announced itself').toEqual([]);

    fireEvent.click(screen.getByLabelText('Smart build'));
    expect(vi.mocked(applyMacro).mock.calls[1]![2].replace).toEqual(laid);
    expect(toasts, 'the second press said nothing about the layout it replaced')
      .toEqual([translations.en['smart.roads_another']!.replace('{n}', '2')]);
  });

  it('reuses the seed on a press that changes nothing, rather than dressing it up as another plan', () => {
    installMap();
    mount('road');

    // Nothing stands on the map to connect: every press reports the same refusal, and rerolling a
    // seed nothing used would promise a variety the router never had.
    fireEvent.click(screen.getByLabelText('Smart build'));
    fireEvent.click(screen.getByLabelText('Smart build'));
    const seeds = vi.mocked(applyMacro).mock.calls.map((c) => c[2].seed);
    expect(seeds).toEqual([1, 1]);
  });

  it('binds the press to the painted region and the live Auto Trim setting', () => {
    installMap();
    const region = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
    useEditorStore.setState({ region, autoEdgeCut: 'round' });
    mount('road');

    fireEvent.click(screen.getByLabelText('Smart build'));
    const opts = vi.mocked(applyMacro).mock.calls[0]![2];
    expect(opts.region).toEqual(region);
    expect(opts.trim).toBe('round');
  });

  it('drops the region field entirely when nothing is painted, rather than passing an empty array', () => {
    installMap();
    useEditorStore.setState({ region: [] });
    mount('road');

    fireEvent.click(screen.getByLabelText('Smart build'));
    const opts = vi.mocked(applyMacro).mock.calls[0]![2];
    expect('region' in opts).toBe(false);
  });

  /**
   * THE MAP'S OWN SURFACE, WHEN NOBODY HAS PICKED ONE. `readRoadStyle` works out what the island is
   * already paved with so a new lane matches the street it grows from, and the bar must not override
   * it on every press: `tileMaterial` is seeded with the catalog's first road because the tile brush
   * needs something armed, so a press that passes that seed on as a decision overrides the reading
   * for every caller but the agent, the one that never names a material.
   */
  it('names no surface until a hand picks one, so the run reads the map', () => {
    installMap();
    mount('road');

    fireEvent.click(screen.getByLabelText('Smart build'));
    expect('material' in vi.mocked(applyMacro).mock.calls[0]![2]).toBe(false);
  });

  it('names the surface a hand picked, and that pick wins over the map', () => {
    installMap();
    mount('road');
    const second = getRoadMaterials()[1]!;
    fireEvent.click(screen.getByLabelText(localizedName(second.name, 'en')));

    fireEvent.click(screen.getByLabelText('Smart build'));
    expect(vi.mocked(applyMacro).mock.calls[0]![2].material).toBe(second.id);
  });

  it('offers a surface every one of its actions as visible segments', () => {
    installMap();
    // The road surface, because it is the one with two: the mountain surface has ONE verb now, and
    // a row of one cannot show that a choice is read rather than discovered by cycling. Armed
    // through the store rather than through the star, whose first road action RUNS rather than arms.
    mount('road');
    act(() => { useEditorStore.getState().setEditMode({ tool: 'smart', macro: 'road-link' }); });

    // Both stand in the pill at once, the armed one filled.
    const connect = screen.getByRole('button', { name: 'Connect all' });
    expect(screen.getByRole('button', { name: 'Draw a road' }).getAttribute('aria-pressed')).toBe('true');
    expect(connect.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByLabelText('Switch action')).toBeNull();
  });

  it('arms the mountain surface with the one verb it offers', () => {
    installMap();
    mount('mountain');
    fireEvent.click(screen.getByLabelText('Smart build'));

    expect(screen.getByRole('button', { name: 'Raise the ground' }).getAttribute('aria-pressed')).toBe('true');
    expect(useEditorStore.getState().armedMacro).toBe('raise');
    expect(vi.mocked(applyMacro), 'arming builds nothing until the map is pressed').not.toHaveBeenCalled();
  });
});
