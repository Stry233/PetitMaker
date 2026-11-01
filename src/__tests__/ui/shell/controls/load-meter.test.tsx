// @vitest-environment jsdom
/**
 * The regional-load disc and the regions window. The limit is per region, so the disc names the
 * region under the pointer and draws a proportion of that region's load, with no number on it (a
 * press opens the window). `map-load.test.ts` holds the naming rule.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EventBus } from '../../../../core/commands/event-bus';
import { bumpObjectsVersion } from '../../../../core/model/grid-model';
import type { EditorEvents } from '../../../../state/editing/events';
import { formatNumber, I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { getMapStats } from '../../../../state/map-stats';
import { ChunkLoadWindow } from '../../../../ui/chrome/modals/load/ChunkLoadWindow';
import { TOP_RIGHT } from '../../../../ui/shell/frame';
import { LoadMeter } from '../../../../ui/shell/controls/LoadMeter';
import { chunkLoad } from '../../../../ui/chrome/modals/load/map-load';
import { makeObject, makeState } from '../../../_support/map-state';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE } from '../../../../core/game/profile';

const ART = TOP_RIGHT.find((a) => a.id === 'load')!;

function mount() {
  return render(<I18nProvider><LoadMeter art={ART} /></I18nProvider>);
}

/** A map three regions across and two down, with something standing in the middle one. */
function mapWithLoad() {
  const state = makeState(CHUNK_SIZE * 3, CHUNK_SIZE * 2);
  const obj = makeObject('building-stall', CHUNK_SIZE + 2, CHUNK_SIZE + 2);
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

  /** With no pointer over the map yet, it reads the middle of the island, where the camera opens. */
  it('rests on the region at the middle of the map, and names it', () => {
    const state = mapWithLoad();
    act(() => { useEditorStore.setState({ gridState: state }); });
    mount();
    const middle = chunkLoad(getMapStats(state), 1, 1)!;
    expect(middle.name).toBe('B2');
    expect(screen.getByTestId('shell-load').getAttribute('aria-label'))
      .toBe(`Regional load: B2, ${formatNumber('en', middle.value)} / ${formatNumber('en', CHUNK_LOAD_LIMIT)}`);
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
    // From twelve o'clock clockwise, as the game draws it, so a part-filled disc reads as a proportion.
    expect(arc.getAttribute('transform')).toBe('rotate(-90 50 50)');
  });

  /** An arc of length zero drawn with a round cap is a dot, and a dot is a reading. */
  it('draws no arc at all for a region carrying nothing', () => {
    const state = makeState(CHUNK_SIZE, CHUNK_SIZE);
    act(() => { useEditorStore.setState({ gridState: state }); });
    mount();
    expect(screen.getByTestId('shell-load').querySelector('circle[stroke-dasharray]')).toBeNull();
  });

  /** `Windows` mounts the window outside the frame's page zoom, so the press only asks for it. */
  it('asks for the regions window rather than putting one up itself', () => {
    act(() => { useEditorStore.setState({ gridState: mapWithLoad() }); });
    mount();
    expect(useEditorStore.getState().modals.regionLoad).toBe(false);
    fireEvent.click(screen.getByTestId('shell-load'));
    expect(useEditorStore.getState().modals.regionLoad).toBe(true);
  });
});

describe('the regions window', () => {
  it('toggles enforcement while keeping overloaded numeric readings visible', () => {
    const state = makeState(CHUNK_SIZE, CHUNK_SIZE);
    for (let i = 0; i < 101; i++) {
      const object = { ...makeObject('flower-protea', i % 12, Math.floor(i / 12)), id: `flower-${i}` };
      state.objects.set(object.id, object);
    }
    const unknown = makeObject('shrub', 14, 14);
    state.objects.set(unknown.id, unknown);
    act(() => {
      useEditorStore.setState({ gridState: state });
      useEditorStore.getState().setModal('regionLoad', true);
    });
    render(<I18nProvider><ChunkLoadWindow /></I18nProvider>);
    const toggle = screen.getByRole('switch', { name: 'Enforce regional load limit' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(state.ignoreChunkLoad).toBe(true);
    expect(screen.getByTestId('shell-region-A1').textContent).toContain('101%');
    expect(screen.getByTestId('shell-region-A1').textContent).toContain('10,100');
  });

  it('marks a region holding an item of unknown load', () => {
    const state = makeState(CHUNK_SIZE * 3, CHUNK_SIZE);
    const known = makeObject('flower-protea', 2, 2);
    const unknown = makeObject('shrub', CHUNK_SIZE + 2, 2);
    const both = [known, { ...makeObject('shrub', 4, 4), id: 'shrub-a1' }];
    for (const obj of [...both, unknown]) state.objects.set(obj.id, obj);
    act(() => {
      useEditorStore.setState({ gridState: state });
      useEditorStore.getState().setModal('regionLoad', true);
    });
    render(<I18nProvider><ChunkLoadWindow /></I18nProvider>);
    expect(screen.getByTestId('shell-region-A1').textContent).toContain('100 + ?');
    expect(screen.getByTestId('shell-region-A2').textContent).toContain('?');
    expect(screen.getByTestId('shell-region-A3').textContent).not.toContain('?');
  });

  it('lays every region out in the shape of the map, empty ones included', () => {
    act(() => {
      useEditorStore.setState({ gridState: mapWithLoad() });
      useEditorStore.getState().setModal('regionLoad', true);
    });
    render(<I18nProvider><ChunkLoadWindow /></I18nProvider>);
    for (const name of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']) {
      expect(screen.getByTestId(`shell-region-${name}`), name).toBeTruthy();
    }
  });
});
