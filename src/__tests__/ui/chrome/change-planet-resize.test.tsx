/**
 * The change-planet window's card eases its height whenever its content changes: choosing the planet
 * you are on takes the carry row away and puts the start-over warning up, a language change rewraps
 * every line in it, and the verb's busy dots stand where a sentence stood.
 *
 * WHAT THIS FILE IS FOR is the COVERAGE of that "whenever": the glide runs off a named change
 * (`useSizeGlide`'s `change`), so a height change the name does not carry both snaps and leaves the
 * hook measuring from a size the box no longer has, which starts the NEXT glide from the wrong
 * place. So there is one case per fact that can change the card's height.
 *
 * A FILE OF ITS OWN because arriving is read off the glide having finished, and a glide runs on
 * Framer's frame loop, which stops running for the rest of any file that has installed fake timers
 * even once — the change-planet suite does, for the transfer that throws.
 *
 * jsdom lays nothing out, so the card's heights are stubbed: what is pinned is that the window asks
 * for the glide at all, that it leaves no inline height behind, and that reduced motion takes the
 * new height outright.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { ChangePlanetModal } from '../../../ui/chrome/modals/ChangePlanetModal';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { createGrid } from '../../../core/model/grid-model';
import { MAP_TEMPLATES } from '../../../config/maps';
import { roadLookup } from '../../../state/object-index';
import { CommandType, TerrainType, type EditorEvents, type GridState, type MapTemplate } from '../../../core/model/types';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;

/** The stubbed card height, changed between renders. */
let height = 400;

function grid(template: MapTemplate): GridState {
  return { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
}

/** A planet with something built on it, so the carry row is on screen to begin with. */
function worldWithBuild(template: MapTemplate = HEXIA) {
  const state = grid(template);
  const cell = state.cells[60]?.[60];
  if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: 2 };
  act(() => { useEditorStore.setState({ gridState: state, commandExecutor: null, exportedAt: null, locale: 'en' }); });
  return state;
}

function show(reduced = false) {
  return render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider>
        <ChangePlanetModal onSwitch={() => {}} onClose={() => {}} />
      </I18nProvider>
    </MotionConfig>,
  );
}

const body = () => screen.getByTestId('planet-body');

/** Choosing the planet you are already on: the carry row goes, the start-over warning arrives. */
function chooseHere(nextHeight: number) {
  height = nextHeight;
  fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`));
}

/** The card is a different height now — and it travelled there rather than jumping. Clipping is the
 *  signal: the window puts it on for exactly as long as the glide runs. */
async function expectGlide(nextHeight: number, change: () => void) {
  height = nextHeight;
  change();
  expect(body().style.overflow).toBe('hidden');
  await waitFor(() => expect(body().style.overflow).toBe(''), { timeout: 3000 });
  expect(body().style.height).toBe('');
}

beforeEach(() => {
  height = 400;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });
  worldWithBuild();
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  useEditorStore.setState({ gridState: null, commandExecutor: null, exportedAt: null, locale: 'en' });
});

describe('the change-planet card', () => {
  it('eases to its new height when the choice changes what it holds', async () => {
    show();
    expect(body().style.overflow).toBe('');
    chooseHere(520);
    // The content really did change: this is the row the glide exists for.
    expect(screen.getByTestId('planet-start-over-hint')).toBeTruthy();
    // Clipped while it travels, so no row re-lays itself out on the way.
    expect(body().style.overflow).toBe('hidden');
    await waitFor(() => expect(body().style.height).not.toBe(''), { timeout: 3000 });
    // And it arrives carrying nothing: a leftover inline height would make the next measurement
    // describe this glide rather than the card's own content.
    await waitFor(() => expect(body().style.height).toBe(''), { timeout: 3000 });
    expect(body().style.overflow).toBe('');
  });

  it('takes the new height outright under reduced motion', () => {
    show(true);
    chooseHere(520);
    expect(screen.getByTestId('planet-start-over-hint')).toBeTruthy();
    expect(body().style.overflow).toBe('');
    expect(body().style.height).toBe('');
  });

  it('eases when a destination is picked at all, and again when the choice moves', async () => {
    show();
    await expectGlide(460, () => fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`)));
    await expectGlide(520, () => fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`)));
  });

  it('eases when the unsaved-work row arrives', async () => {
    show();
    // The row reads the undo stack, which the window sees through the executor the store holds.
    const state = useEditorStore.getState().gridState!;
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    act(() => {
      executor.execute({
        type: CommandType.PaintTerrain, timestamp: 1, cells: [{ x: 40, y: 60 }],
        terrainType: TerrainType.Mountain, elevation: 1,
      });
    });
    await expectGlide(470, () => { act(() => { useEditorStore.setState({ commandExecutor: executor }); }); });
    expect(screen.getByText('Unexported changes will be lost.')).toBeTruthy();
  });

  it('eases when the language changes under it', async () => {
    show();
    // Every line in the card is a different length in Russian, so the card is a different card.
    await expectGlide(540, () => { act(() => { useEditorStore.setState({ locale: 'ru' }); }); });
    expect(screen.getByText('Вы здесь')).toBeTruthy();
  });

  it('eases when the busy dots take the verb', async () => {
    show();
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await waitFor(() => expect(body().style.overflow).toBe(''), { timeout: 3000 });
    await expectGlide(380, () => fireEvent.click(screen.getByTestId('planet-switch')));
  });

  it('eases when the planet under the visitor changes while their choice stands', async () => {
    show();
    // Choosing here is starting over: the carry row goes.
    chooseHere(520);
    await waitFor(() => expect(body().style.overflow).toBe(''), { timeout: 3000 });
    expect(screen.queryByText('What you have built')).toBeNull();
    // The map is replaced under the window and the same choice is now a destination elsewhere, so
    // the carry row comes back with the choice itself unmoved.
    await expectGlide(600, () => { worldWithBuild(TAFA); });
    expect(screen.getByText('What you have built')).toBeTruthy();
  });
});
