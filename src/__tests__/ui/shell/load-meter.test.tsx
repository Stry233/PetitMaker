/**
 * The regional-load disc: what it reads, and what it refuses to say.
 *
 * The reading is about a PLACE. The limit is per region, so the control answers "how full is the
 * region I am about to build in", and the two things a test can hold it to are that the region it
 * names is the one under the pointer and that the drawing is a proportion of that region's own
 * load. The third is a negative: there is no text and no number ON the control, because the figure
 * is a four-digit thing standing where the eye passes constantly, and the press is what opens it.
 *
 * `map-load.ts` pins the naming rule and the gate that keeps a provisional figure out of a release;
 * these pin what the drawing does with what it is handed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EventBus } from '../../../core/commands/event-bus';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE } from '../../../core/model/constants';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import type { EditorEvents } from '../../../core/model/types';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { getMapStats } from '../../../state/map-stats';
import { ChunkLoadWindow } from '../../../ui/shell/windows/ChunkLoadWindow';
import { TOP_RIGHT } from '../../../ui/shell/frame';
import { LoadMeter } from '../../../ui/shell/windows/LoadMeter';
import { chunkLoad } from '../../../ui/shell/windows/map-load';
import { makeObject, makeState } from '../../rules/_helpers';

const ART = TOP_RIGHT.find((a) => a.id === 'load')!;

function mount() {
  return render(<I18nProvider><LoadMeter art={ART} /></I18nProvider>);
}

/** A map three regions across and two down, with something standing in the middle one. */
function mapWithLoad() {
  const state = makeState(CHUNK_SIZE * 3, CHUNK_SIZE * 2);
  const obj = makeObject('building-fluorite-cabin', CHUNK_SIZE + 2, CHUNK_SIZE + 2);
  state.objects.set(obj.id, obj);
  bumpObjectsVersion(state, { added: [obj] });
  return state;
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null });
  useEditorStore.getState().setModal('regionLoad', false);
});
afterEach(cleanup);

describe('the regional load disc', () => {
  it('is absent while there is no map to read', () => {
    mount();
    expect(screen.queryByTestId('shell-load')).toBeNull();
  });

  /** Before the pointer has been over the map there is no region under it, and the control still
   *  has to read somewhere real: it reads the middle of the island, where the camera opens. */
  it('rests on the region at the middle of the map, and names it', () => {
    const state = mapWithLoad();
    act(() => { useEditorStore.setState({ gridState: state }); });
    mount();
    const middle = chunkLoad(getMapStats(state), 1, 1)!;
    expect(middle.name).toBe('B2');
    expect(screen.getByTestId('shell-load').getAttribute('aria-label'))
      .toBe(`Regional load: B2, ${middle.value} / ${CHUNK_LOAD_LIMIT}`);
  });

  it('carries no text and no figure of its own', () => {
    act(() => { useEditorStore.setState({ gridState: mapWithLoad() }); });
    mount();
    expect(screen.getByTestId('shell-load').textContent).toBe('');
  });

  it('turns that region\'s load into an arc of the same fraction of the disc', () => {
    const state = mapWithLoad();
    act(() => { useEditorStore.setState({ gridState: state }); });
    mount();

    const reading = chunkLoad(getMapStats(state), 1, 1)!;
    expect(reading.value, 'the fixture puts something in the middle region').toBeGreaterThan(0);
    const arc = screen.getByTestId('shell-load').querySelector('circle[stroke-dasharray]')!;
    const [drawn, whole] = arc.getAttribute('stroke-dasharray')!.split(' ').map(Number);
    expect(drawn! / whole!).toBeCloseTo(reading.value / CHUNK_LOAD_LIMIT, 5);
    // Twelve o'clock, clockwise: the game's own start, and the only thing that makes a part-filled
    // disc readable as a proportion rather than as an arbitrary arc.
    expect(arc.getAttribute('transform')).toBe('rotate(-90 50 50)');
  });

  /** An arc of length zero drawn with a round cap is a dot, and a dot is a reading. */
  it('draws no arc at all for a region carrying nothing', () => {
    const state = makeState(CHUNK_SIZE, CHUNK_SIZE);
    act(() => { useEditorStore.setState({ gridState: state }); });
    mount();
    expect(screen.getByTestId('shell-load').querySelector('circle[stroke-dasharray]')).toBeNull();
  });

  /** The window is a WINDOW: mounted by `Windows` outside the frame's own page zoom, so what the
   *  press does is open one, the same call a keyboard command or a menu row would make. */
  it('asks for the regions window rather than putting one up itself', () => {
    act(() => { useEditorStore.setState({ gridState: mapWithLoad() }); });
    mount();
    expect(useEditorStore.getState().modals.regionLoad).toBe(false);
    fireEvent.click(screen.getByTestId('shell-load'));
    expect(useEditorStore.getState().modals.regionLoad).toBe(true);
  });
});

describe('the regions window', () => {
  it('lays every region out in the shape of the map, empty ones included', () => {
    act(() => {
      useEditorStore.setState({ gridState: mapWithLoad() });
      useEditorStore.getState().setModal('regionLoad', true);
    });
    render(<I18nProvider><ChunkLoadWindow /></I18nProvider>);
    for (const name of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']) {
      expect(screen.getByTestId(`shell-region-${name}`), name).toBeTruthy();
    }
    // Three regions across, which is what makes the grid the island's own shape.
    const grid = screen.getByTestId('shell-region-A1').parentElement!;
    expect(grid.style.gridTemplateColumns).toContain('repeat(3,');
  });
});
