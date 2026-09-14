/**
 * region-chip.test.tsx — the region attachment, and the one fact it is a view of.
 *
 * THE PANEL OWNS NO REGION. Everything here is driven through the editor's own store — paint the
 * region and the chip docks, empty it and the chip leaves, arm the brush and the panel wears the
 * marking state, switch build mode and the store puts the brush away and the panel folds back with
 * it. A panel-local copy of any of those would pass a test that set it directly and fail every one
 * of these.
 *
 * The whole column is mounted (no `PanelShell` stub) because what is under test is the round trip:
 * the store, the derivation, the composer's own seat, and the verbs coming back the other way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { setRegionBrushHandler } from '../../../core/runtime/region-brush';
import type { EditorEvents, GridState, MacroCoord } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { useEditorStore } from '../../../state/store';
import { I18nProvider } from '../../../i18n/context';
import { append } from '../../../agent/core/log';
import { useAgentSession } from '../../../agent/session/store';
import { seaFrame } from '../../../canvas/thumbnail';
import { regionBounds } from '../../../state/region-bounds';
import { host } from '../../../kit/host';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { Shell } from '../../../ui/shell/Shell';
import { OPTION_THUMB } from '../../../ui/agent/OptionPick';
import { CHIP_VIGNETTE } from '../../../ui/agent/region-chip';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { panelView } from '../../../agent/session/store';
import { makeState } from '../../rules/_helpers';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

// The chip's picture is a real capture off the live 2D renderer, which no jsdom run has. `MapShot`
// already answers "no renderer yet" with an empty box, so this only keeps the async capture out of
// the way of the facts under test.
vi.mock('../../../canvas/thumbnail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../canvas/thumbnail')>(),
  renderThumbnail: async () => null,
}));

/** A rect of macro cells, as the region brush would have collected them. */
function rect(x1: number, y1: number, x2: number, y2: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push({ x, y });
  return out;
}

/** A key held for Claude and a model armed: the one difference between a panel showing the setup
 *  screen and a panel showing the record. Filed through the real door, since `keyed` is a projection
 *  of a keyring only `connectKey` writes. */
function connect(): void {
  const model = Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
  model.claude = 'claude-sonnet-4-5';
  useAgentPanelSettings.setState({
    provider: 'claude', model, oversight: 'checkpoint', customBaseUrl: '', hydrated: true,
  });
  useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-region-chip-fixture');
}

function installMap(): GridState {
  const gs = makeState(24, 24) as GridState;
  const bus = new EventBus<EditorEvents>();
  const executor = new CommandExecutor(gs, bus, createDefaultRegistry(), roadLookup(gs));
  useEditorStore.setState({
    gridState: gs, commandExecutor: executor, eventBus: bus, region: [], selectingRegion: false,
  });
  return gs;
}

/** The column in a tree, with a re-render that can put the panel AWAY: a fold is a prop change here,
 *  the same one the shell makes when the assistant block is pressed a second time. */
async function mountColumn(withShell = false): Promise<ReturnType<typeof render> & { fold(): Promise<void> }> {
  const { default: PanelColumn } = await import('../../../ui/agent/PanelColumn');
  if (withShell) useEditorStore.getState().setAssistantOpen(true);
  const tree = (open: boolean) => (
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        {withShell ? <Shell onRestoreSession={() => {}}><div /></Shell> : <PanelColumn open={open} />}
      </I18nProvider>
    </MotionConfig>
  );
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(tree(true));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  return Object.assign(out, {
    async fold() {
      await act(async () => {
        if (withShell) useEditorStore.getState().setAssistantOpen(false);
        out.rerender(tree(false));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      });
    },
  });
}

const paint = async (cells: MacroCoord[]) => {
  await act(async () => { useEditorStore.getState().setRegion(cells); });
};

/** A job in flight, so the job zone holds a ticket the marking state can be seen to fold. */
function orderInFlight(): void {
  const l = useAgentSession.getState().log;
  append(l, { kind: 'order', text: 'Build a fishing village on the south shore', mapContext: 'Hexia' });
  append(l, { kind: 'checkpoint', undoIndex: 0, label: 'job' });
}

beforeEach(() => {
  backing.clear();
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setAssistantOpen(false);
  installMap();
  connect();
  useAgentSession.getState().clearSession();
  setRegionBrushHandler(null);
});

afterEach(() => {
  cleanup();
  setRegionBrushHandler(null);
  useEditorStore.setState({
    gridState: null, commandExecutor: null, region: [], selectingRegion: false,
  });
});

describe('the chip is a view of the store\'s painted region', () => {
  it('docks with the region\'s own count the moment the store holds one, and leaves when it empties', async () => {
    const { queryByTestId, getByTestId } = await mountColumn();
    expect(queryByTestId('composer-region-chip')).toBeNull();

    // 3x2 = six cells, painted by anything at all: the panel is not told, it is subscribed.
    await paint(rect(4, 7, 6, 8));
    expect(getByTestId('composer-region-chip').getAttribute('title')).toBe('In this region, 6 cells');
    // The frame button reads the SAME fact rather than a second one.
    expect(getByTestId('composer-region-mark').getAttribute('data-lit')).toBe('true');

    await paint([]);
    expect(queryByTestId('composer-region-chip')).toBeNull();
    expect(getByTestId('composer-region-mark').getAttribute('data-lit')).toBe('false');
  });

  /**
   * A REGION PAINTED BEFORE THE PANEL EVER OPENED still docks, which is the case that proves the
   * chip is a SUBSCRIPTION rather than a prop handed down at open time. The scope tools can paint
   * one at any point; the panel arriving afterwards has to find it already there.
   */
  it('docks for a region the store was already holding when the panel opened', async () => {
    await act(async () => { useEditorStore.getState().setRegion(rect(4, 7, 6, 8)); });
    const { getByTestId } = await mountColumn();
    expect(getByTestId('composer-region-chip').getAttribute('title')).toBe('In this region, 6 cells');
    expect(getByTestId('composer-region-mark').getAttribute('data-lit')).toBe('true');
  });

  /**
   * THE MARK IS DRAWN ON THE CELLS `regionBounds` NAMES, and nothing else observed that.
   *
   * The chip's count is `region.length` whichever way the box is derived, so it survives any bounds
   * bug; the BOX reaches the screen only as four percentages inside the vignette. A local min/max at
   * the derivation site with `x2`/`y2` off by one therefore passed the whole agent suite. This reads
   * the rendered percentages back and compares them with the shared derivation plus the same
   * sea-framing the capture is composed with, so the chip's box and the refusal's box are pinned to
   * one reading of one list.
   */
  it('draws the mark on the box the shared derivation names', async () => {
    // A SCATTER, not a rect: three cells whose bounding box is much larger than the paint, so an
    // off-by-one or a swapped axis moves the mark by a visible share of the picture.
    const scatter: MacroCoord[] = [{ x: 3, y: 2 }, { x: 11, y: 4 }, { x: 7, y: 9 }];
    const { getByTestId } = await mountColumn();
    await paint(scatter);

    const bounds = regionBounds(scatter)!;
    const sea = seaFrame(24, 24, CHIP_VIGNETTE.width / CHIP_VIGNETTE.height);
    const mark = getByTestId('composer-region-chip').querySelector<HTMLElement>('[data-testid="region-vignette-mark"]')!;
    const pct = (v: string) => Number.parseFloat(v);

    expect(pct(mark.style.left)).toBeCloseTo(((sea.dx + bounds.x1) / sea.width) * 100, 6);
    expect(pct(mark.style.top)).toBeCloseTo(((sea.dy + bounds.y1) / sea.height) * 100, 6);
    expect(pct(mark.style.width)).toBeCloseTo(((bounds.x2 - bounds.x1 + 1) / sea.width) * 100, 6);
    expect(pct(mark.style.height)).toBeCloseTo(((bounds.y2 - bounds.y1 + 1) / sea.height) * 100, 6);
  });

  it('says the singular for one cell', async () => {
    const { getByTestId } = await mountColumn();
    await paint([{ x: 9, y: 9 }]);
    expect(getByTestId('composer-region-chip').getAttribute('title')).toBe('In this region, 1 cell');
  });

  /** THE CROSS CLEARS THE PAINT, through the brush's own channel: the region carries an undo stack
   *  the brush owns, and a store write behind its back leaves that stack holding a region the map
   *  no longer has. */
  it('detaches through the region brush\'s own clear, so the stroke stays undoable', async () => {
    const clear = vi.fn();
    setRegionBrushHandler({ paint: () => {}, done: () => {}, clear });
    const { getByTestId } = await mountColumn();
    await paint(rect(2, 2, 5, 5));

    await act(async () => { fireEvent.click(getByTestId('region-chip-clear')); });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  /** And with no brush mounted the store write is the fallback, so the cross is never a dead press
   *  on a shell that armed no handler. */
  it('falls back to emptying the store where no brush handler is mounted', async () => {
    const { getByTestId, queryByTestId } = await mountColumn();
    await paint(rect(2, 2, 5, 5));

    await act(async () => { fireEvent.click(getByTestId('region-chip-clear')); });
    expect(useEditorStore.getState().region).toEqual([]);
    expect(queryByTestId('composer-region-chip')).toBeNull();
  });
});

/**
 * THERE IS ONE REGION-SELECTION UI IN THE APP, and the panel's frame button is a CALLER of it.
 *
 * The screen is the generate shelf's own (`ui/shell/bars/ScopeScreen`): the figure cells, the brush
 * slider, Clear and Done. Arming the brush alone left the user a live pencil with no figure to choose
 * and no verb to finish with, so what is asserted here is the ENTRY — the press opens that screen, its
 * Done comes back to the panel with the region standing, and the panel never stands a second one over
 * a marking the shelf armed.
 */
describe('the marking state', () => {
  it('opens the map\'s own region screen, folds the job zone and hands the field over', async () => {
    orderInFlight();
    const { getByTestId, queryByTestId } = await mountColumn(true);
    expect(queryByTestId('job-ticket')).not.toBeNull();
    expect(queryByTestId('shell-scope-screen')).toBeNull();

    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });

    expect(useEditorStore.getState().selectingRegion).toBe(true);
    // The screen the generator uses, with its own figures and its own way to finish.
    const scope = getByTestId('shell-scope-screen');
    expect(scope.querySelectorAll('[data-testid^="tool-cell"], button').length).toBeGreaterThan(1);
    expect(scope.textContent).toContain('Done');
    const field = getByTestId('composer-input') as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.placeholder).toBe('The map has the pencil');
    expect(queryByTestId('job-ticket')).toBeNull();
    expect(getByTestId('panel-job-zone').childElementCount).toBe(0);
    // The way out has to stay pressable, or the state can only be left with a key.
    expect((getByTestId('composer-region-mark') as HTMLButtonElement).disabled).toBe(false);
  });

  /** DONE COMES BACK TO THE PANEL WITH THE REGION STANDING, which is the whole contract of the entry:
   *  the screen edits the store's one region fact and the chip is a view of it. */
  it('returns to the panel on the screen\'s own Done, with what was painted attached', async () => {
    const { getByTestId, queryByTestId } = await mountColumn(true);
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });
    await paint(rect(1, 1, 3, 3));

    const done = [...getByTestId('shell-scope-screen').querySelectorAll('button')]
      .find((el) => el.textContent === 'Done')!;
    await act(async () => { fireEvent.click(done); });

    expect(useEditorStore.getState().selectingRegion).toBe(false);
    expect(queryByTestId('shell-scope-screen')).toBeNull();
    expect(getByTestId('composer-region-chip').getAttribute('title')).toBe('In this region, 9 cells');
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(false);
  });

  it('finishes on a second press of the same button, and takes the screen with it', async () => {
    const { getByTestId, queryByTestId } = await mountColumn();
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });

    expect(useEditorStore.getState().selectingRegion).toBe(false);
    expect(queryByTestId('shell-scope-screen')).toBeNull();
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(false);
  });

  /** AND ONLY FOR A MARKING THIS PANEL ARMED. The shelf mounts its own screen for the ones it arms,
   *  so a second here would be two sets of the same controls on one bottom bar. */
  it('stands no screen over a marking the map\'s own tools armed', async () => {
    const { queryByTestId } = await mountColumn();
    await act(async () => { useEditorStore.getState().setSelectingRegion(true); });
    expect(queryByTestId('shell-scope-screen')).toBeNull();
  });

  it('finishes on Escape before the panel folds, since marking is the outer layer', async () => {
    const { getByTestId } = await mountColumn();
    await act(async () => { useEditorStore.getState().setAssistantOpen(true); });
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });

    await act(async () => { fireEvent.keyDown(getByTestId('panel-shell'), { key: 'Escape' }); });
    expect(useEditorStore.getState().selectingRegion).toBe(false);
    expect(useEditorStore.getState().assistantOpen).toBe(true);
  });

  /**
   * THE `setEditMode` GOTCHA. Choosing what to build puts the region brush away (`edit.ts`'s own
   * rule: the region outranks the tool, so leaving it armed would hand every press to a scope brush
   * while the bar showed a terrain one). A panel holding its own marking flag would then stand with
   * the composer disabled and the record folded over a brush that is no longer listening.
   */
  it('folds back when a mode switch puts the brush away under it', async () => {
    orderInFlight();
    const { getByTestId, queryByTestId } = await mountColumn();
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });
    expect(useEditorStore.getState().selectingRegion).toBe(true);
    expect(queryByTestId('job-ticket')).toBeNull();

    await act(async () => { useEditorStore.getState().setEditMode({ mode: 'mountain' }); });

    expect(useEditorStore.getState().selectingRegion).toBe(false);
    const field = getByTestId('composer-input') as HTMLInputElement;
    expect(field.disabled).toBe(false);
    expect(field.placeholder).toBe('Add a note for the next step');
    expect(queryByTestId('job-ticket')).not.toBeNull();
  });

  /**
   * A FOLD ENDS A MARKING THE PANEL ARMED.
   *
   * `selectingRegion` outranks every tool in `resolvePress`, so a marking left standing behind a
   * closed panel hands every press on the map to the region brush under whatever mode is showing,
   * with the outline up and nothing on screen saying why. Nothing is destroyed by it, but the pencil
   * is somewhere the user cannot see they put it.
   */
  it('peels the marking it armed when the panel folds, and takes the outline with it', async () => {
    const clearOutline = vi.spyOn(host.buildableRegion, 'clear');
    const { getByTestId, fold } = await mountColumn();
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });
    expect(useEditorStore.getState().selectingRegion).toBe(true);
    clearOutline.mockClear();

    await fold();

    expect(useEditorStore.getState().selectingRegion).toBe(false);
    expect(clearOutline).toHaveBeenCalled();
    clearOutline.mockRestore();
  });

  /** AND ONLY THE ONE IT ARMED. The store's flag cannot say who holds the pencil, and the map's own
   *  scope screen sets the same one: a fold that peeled it unconditionally would put away a brush
   *  the panel never picked up. */
  it('leaves a marking the map\'s own tools armed exactly where it is', async () => {
    const { fold } = await mountColumn();
    await act(async () => { useEditorStore.getState().setSelectingRegion(true); });

    await fold();

    expect(useEditorStore.getState().selectingRegion).toBe(true);
  });

  /** And the chip comes back with whatever the marking left behind, which is the store's own list
   *  and not a remembered one. */
  it('re-docks the chip with what the marking painted', async () => {
    const { getByTestId, queryByTestId } = await mountColumn();
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });
    expect(queryByTestId('composer-region-chip')).toBeNull();

    await paint(rect(1, 1, 3, 3));
    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });

    expect(getByTestId('composer-region-chip').getAttribute('title')).toBe('In this region, 9 cells');
  });
});

describe('the placeholder shortens while the chip is docked', () => {
  it('swaps the long steer placeholder for its short form, and only while the chip stands', async () => {
    const { getByTestId } = await mountColumn();
    // A job in flight puts the composer on the steer route, whose placeholder is the long one.
    await act(async () => {
      const l = useAgentSession.getState().log;
      append(l, { kind: 'order', text: 'Build a fishing village on the south shore', mapContext: 'Hexia' });
      append(l, { kind: 'checkpoint', undoIndex: 0, label: 'job' });
    });
    const field = () => getByTestId('composer-input') as HTMLInputElement;
    expect(field().placeholder).toBe('Add a note for the next step');

    await paint(rect(4, 4, 8, 8));
    expect(field().placeholder).toBe('Add a note');

    await paint([]);
    expect(field().placeholder).toBe('Add a note for the next step');
  });
});

/**
 * THE TICKET HEAD IS THE FILED COPY, and the chip is the live one. The order stamps the region it
 * was filed under at push time; repainting the store afterwards moves the chip and must not move
 * the record, because the record's whole job is to say which region HELD.
 */
describe('the ticket head reads the region as filed', () => {
  it('keeps the filed bounds while the live region is repainted underneath it', async () => {
    const filed = { count: 1128, x1: 2, y1: 3, x2: 48, y2: 44 };
    const l = useAgentSession.getState().log;
    append(l, { kind: 'order', text: 'Lay a boardwalk along the cove', mapContext: 'Hexia', region: filed });
    append(l, { kind: 'checkpoint', undoIndex: 0, label: 'job' });

    const shot = vi.fn((b: { count: number }, w: number, h: number) =>
      <span data-testid="shot" data-count={b.count} data-w={w} data-h={h} />);

    const view = panelView(useAgentSession.getState());
    const { getByTestId, rerender } = render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell
            view={view}
            connected
            region={{ count: 6, x1: 0, y1: 0, x2: 2, y2: 1 }}
            regionShot={shot}
            onMarkRegion={() => {}}
            onClearRegion={() => {}}
            onSend={() => {}}
            onStop={() => {}}
            onPause={() => {}}
            onGateAnswer={() => {}}
          />
        </I18nProvider>
      </MotionConfig>,
    );

    expect(getByTestId('ticket-region').textContent).toContain('in the marked region');
    // The head's picture is of the FILED box; the chip's is of the live one. Two calls, two boxes.
    const counts = shot.mock.calls.map((c) => c[0].count);
    expect(counts).toContain(1128);
    expect(counts).toContain(6);

    // Repaint the live region: the chip follows, the head does not.
    shot.mockClear();
    rerender(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell
            view={view}
            connected
            region={{ count: 40, x1: 10, y1: 10, x2: 17, y2: 14 }}
            regionShot={shot}
            onMarkRegion={() => {}}
            onClearRegion={() => {}}
            onSend={() => {}}
            onStop={() => {}}
            onPause={() => {}}
            onGateAnswer={() => {}}
          />
        </I18nProvider>
      </MotionConfig>,
    );
    const after = shot.mock.calls.map((c) => c[0].count);
    expect(after).toContain(1128);
    expect(after).toContain(40);
    expect(after).not.toContain(6);
  });
});

/**
 * THE SAME MARK, ONE RUNG DOWN: the gate family's own pictures.
 *
 * A gate thumb and an option thumb draw the region vignette's own reading — the island entire with
 * the option's own rect marked on it. A CROP framed on the rect (`MapShot box=…`) fills its frame
 * edge to edge with whatever ground happens to be there, so three option cards come back as three
 * near-identical crops of the same green field and the picture that exists to distinguish the
 * choices distinguishes none of them.
 */
describe('the gate family\'s pictures mark their place rather than cropping to it', () => {
  const OPTIONS = [
    { cap: 'A cove on the west shore, sheltered', rect: { x1: 2, y1: 3, x2: 6, y2: 8 } },
    { cap: 'A highland lake above the terraces', rect: { x1: 15, y1: 4, x2: 20, y2: 9 } },
    { cap: 'A river delta along the south sand', rect: { x1: 6, y1: 16, x2: 12, y2: 21 } },
  ];

  it('gives each option a mark of its own geometry', async () => {
    const l = useAgentSession.getState().log;
    append(l, { kind: 'order', text: 'Put the water somewhere it belongs', mapContext: 'Hexia' });
    append(l, {
      kind: 'gateAsked', gateId: 'gate-1', scope: 'tool', callId: 'c1',
      summary: 'carve_river: three places it could go', options: OPTIONS,
    });
    const { getAllByTestId } = await mountColumn();
    const marks = getAllByTestId('option-shot-mark');
    expect(marks.length).toBe(OPTIONS.length);

    const sea = seaFrame(24, 24, OPTION_THUMB.width / OPTION_THUMB.height);
    const placed = marks.map((m) => `${m.style.left}|${m.style.top}|${m.style.width}`);
    expect(new Set(placed).size, 'three options, three different pictures').toBe(3);
    // And each is placed by the option's OWN rect, through the shared sea-framing math.
    const first = OPTIONS[0]!.rect;
    expect(Number.parseFloat(marks[0]!.style.left))
      .toBeCloseTo(((sea.dx + first.x1) / sea.width) * 100, 4);
  });
});
