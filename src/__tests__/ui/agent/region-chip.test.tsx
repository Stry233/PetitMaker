// @vitest-environment jsdom
/**
 * The region chip and marking state are views of the editor store's one region, driven here through
 * the store with the whole column mounted, so a panel-local copy of the region would fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import { EventBus } from '../../../core/commands/event-bus';
import { setRegionBrushHandler } from '../../../tools/pointer/region';
import type { GridState, MacroCoord } from '../../../core/model/types';
import type { EditorEvents } from '../../../state/editing/events';
import { createDefaultRegistry } from '../../../rules';
import { useEditorStore } from '../../../state/store';
import { I18nProvider } from '../../../i18n/context';
import { append } from '../../../agent/core/log';
import { useAgentSession, panelView } from '../../../agent/session/store';
import { seaFrame } from '../../../view/map2d/capture/thumbnail';
import { regionBounds } from '../../../core/grid/rect';
import { host } from '../../../editor/host/host';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { Shell } from '../../../ui/shell/Shell';
import { OPTION_THUMB } from '../../../ui/agent/record/OptionPick';
import { CHIP_VIGNETTE } from '../../../ui/agent/composer/region-chip';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { makeState } from '../../_support/map-state';
import { createExecutor } from '../../../state/executor';
import { panelProps } from '../../_support/agent-panel';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

// jsdom has no 2D renderer; this keeps the async capture out of the way (`MapShot` draws an empty box).
vi.mock('../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../view/map2d/capture/thumbnail')>(),
  renderThumbnail: async () => null,
}));

/** A rect of macro cells. */
function rect(x1: number, y1: number, x2: number, y2: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push({ x, y });
  return out;
}

/** Connects Claude with a model, so the panel shows the record rather than setup. `connectKey` is the
 *  only writer of the keyring `keyed` projects. */
function connect(): void {
  const model = Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
  model.claude = 'claude-sonnet-4-5';
  useAgentConnection.setState({
    provider: 'claude', model, oversight: 'checkpoint', customBaseUrl: '', hydrated: true,
  });
  useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-region-chip-fixture');
}

function installMap(): GridState {
  const gs = makeState(24, 24) as GridState;
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(gs, createDefaultRegistry(), bus);
  useEditorStore.setState({
    gridState: gs, commandExecutor: executor, eventBus: bus, region: [], selectingRegion: false,
  });
  return gs;
}

/** Mounts the column; `fold` re-renders it closed, as the shell does. */
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

/** A job in flight, so the job zone holds a ticket for the marking state to fold. */
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

    await paint(rect(4, 7, 6, 8));
    expect(getByTestId('composer-region-chip').getAttribute('title')).toBe('In this region, 6 cells');
    expect(getByTestId('composer-region-mark').getAttribute('data-lit')).toBe('true');

    await paint([]);
    expect(queryByTestId('composer-region-chip')).toBeNull();
    expect(getByTestId('composer-region-mark').getAttribute('data-lit')).toBe('false');
  });

  it('docks for a region the store was already holding when the panel opened', async () => {
    await act(async () => { useEditorStore.getState().setRegion(rect(4, 7, 6, 8)); });
    const { getByTestId } = await mountColumn();
    expect(getByTestId('composer-region-chip').getAttribute('title')).toBe('In this region, 6 cells');
    expect(getByTestId('composer-region-mark').getAttribute('data-lit')).toBe('true');
  });

  /** The count cannot show a bounds error, so the vignette mark's percentages are compared with
   *  `regionBounds` plus the capture's sea framing. */
  it('draws the mark on the box the shared derivation names', async () => {
    // A scatter whose box is much larger than the paint, so an off-by-one or swapped axis shows.
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

  /** The brush owns the region's undo stack, so the cross clears through it. */
  it('detaches through the region brush\'s own clear, so the stroke stays undoable', async () => {
    const clear = vi.fn();
    setRegionBrushHandler({ paint: () => {}, done: () => {}, clear });
    const { getByTestId } = await mountColumn();
    await paint(rect(2, 2, 5, 5));

    await act(async () => { fireEvent.click(getByTestId('region-chip-clear')); });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('falls back to emptying the store where no brush handler is mounted', async () => {
    const { getByTestId, queryByTestId } = await mountColumn();
    await paint(rect(2, 2, 5, 5));

    await act(async () => { fireEvent.click(getByTestId('region-chip-clear')); });
    expect(useEditorStore.getState().region).toEqual([]);
    expect(queryByTestId('composer-region-chip')).toBeNull();
  });
});

/** The panel's frame button opens the app's one region screen, the generate shelf's `ScopeScreen`
 *  (figures, brush size, Clear, Done), and never a second one over a marking the shelf armed. */
describe('the marking state', () => {
  it('opens the map\'s own region screen, folds the job zone and hands the field over', async () => {
    orderInFlight();
    const { getByTestId, queryByTestId } = await mountColumn(true);
    expect(queryByTestId('job-ticket')).not.toBeNull();
    expect(queryByTestId('shell-scope-screen')).toBeNull();

    await act(async () => { fireEvent.click(getByTestId('composer-region-mark')); });

    expect(useEditorStore.getState().selectingRegion).toBe(true);
    const scope = getByTestId('shell-scope-screen');
    expect(scope.querySelectorAll('[data-testid^="tool-cell"], button').length).toBeGreaterThan(1);
    expect(scope.textContent).toContain('Done');
    const field = getByTestId('composer-input') as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.placeholder).toBe('The map has the pencil');
    expect(queryByTestId('job-ticket')).toBeNull();
    expect(getByTestId('panel-job-zone').querySelector('[data-scroll-content]')!.childElementCount).toBe(0);
    // The way out stays pressable.
    expect((getByTestId('composer-region-mark') as HTMLButtonElement).disabled).toBe(false);
  });

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

  /** The shelf mounts its own screen for markings it arms. */
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

  /** Choosing a build mode puts the region brush away (`edit.ts`), and the panel follows the store. */
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

  /** `selectingRegion` outranks every tool in `resolvePress`, so a marking left behind a closed panel
   *  would capture every press on the map. */
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

  /** The map's scope screen sets the same store flag, so the panel tracks which marking it armed. */
  it('leaves a marking the map\'s own tools armed exactly where it is', async () => {
    const { fold } = await mountColumn();
    await act(async () => { useEditorStore.getState().setSelectingRegion(true); });

    await fold();

    expect(useEditorStore.getState().selectingRegion).toBe(true);
  });

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
    // A job in flight puts the composer on the steer route, with the long placeholder.
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

/** The order stamps its region when filed, so repainting the store moves the chip and not the ticket
 *  head. */
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
          <PanelShell {...panelProps({
            view,
            connected: true,
            bounds: { count: 6, x1: 0, y1: 0, x2: 2, y2: 1 },
            regionShot: shot,
            onMarkRegion: () => {},
            onClearRegion: () => {},
            onSend: () => {},
            onStop: () => {},
            onPause: () => {},
            onGateAnswer: () => {},
          })}
          />
        </I18nProvider>
      </MotionConfig>,
    );

    expect(getByTestId('ticket-region').textContent).toContain('in the marked region');
    const counts = shot.mock.calls.map((c) => c[0].count);
    expect(counts).toContain(1128);
    expect(counts).toContain(6);

    shot.mockClear();
    rerender(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell {...panelProps({
            view,
            connected: true,
            bounds: { count: 40, x1: 10, y1: 10, x2: 17, y2: 14 },
            regionShot: shot,
            onMarkRegion: () => {},
            onClearRegion: () => {},
            onSend: () => {},
            onStop: () => {},
            onPause: () => {},
            onGateAnswer: () => {},
          })}
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

/** Gate and option thumbs show the whole island with the option's rect marked, since crops of
 *  similar ground would look alike. */
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
    const first = OPTIONS[0]!.rect;
    expect(Number.parseFloat(marks[0]!.style.left))
      .toBeCloseTo(((sea.dx + first.x1) / sea.width) * 100, 4);
  });
});
