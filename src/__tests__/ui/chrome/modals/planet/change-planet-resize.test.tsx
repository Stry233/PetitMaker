// @vitest-environment jsdom
/**
 * The change-planet card eases its height whenever its content changes. The glide runs off a named
 * change (`useSizeGlide`'s `change`); a change the name misses snaps and leaves the next glide a stale
 * size, so each fact that can change the height has a case. Heights are stubbed.
 *
 * A separate file because Framer's frame loop stops for the rest of any file that installs fake
 * timers, as the change-planet suite does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { ChangePlanetModal } from '../../../../../ui/chrome/modals/planet/ChangePlanetModal';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { createGrid } from '../../../../../core/model/grid-model';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { TerrainType, type GridState, type MapTemplate } from '../../../../../core/model/types';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;

/** The stubbed card height, changed between renders. */
let height = 400;

function grid(template: MapTemplate): GridState {
  return { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

/** A planet with something built on it, so choosing another one leads to the next step. */
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
        <ChangePlanetModal open onSwitch={() => {}} onClose={() => {}} />
      </I18nProvider>
    </MotionConfig>,
  );
}

const body = () => screen.getByTestId('planet-body');
const verb = () => screen.getByTestId('planet-switch');

/** Choose another planet and press the verb. */
function nextStep(nextHeight: number) {
  height = nextHeight;
  fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
  fireEvent.click(verb());
}

/** The card glides to `nextHeight`; clipping is on exactly while the glide runs. */
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
  it('eases to its new height when the next step replaces the list', async () => {
    show();
    expect(body().style.overflow).toBe('');
    nextStep(220);
    expect(screen.getByRole('radio', { name: 'Start fresh' })).toBeTruthy();
    expect(body().style.overflow).toBe('hidden');
    expect(body().style.height).toBe('400px');
    // A leftover inline height would make the next measurement describe this glide.
    await waitFor(() => expect(body().style.height).toBe(''), { timeout: 3000 });
    expect(body().style.overflow).toBe('');
  });

  it('takes the new height outright under reduced motion', () => {
    show(true);
    nextStep(220);
    expect(screen.getByRole('radio', { name: 'Start fresh' })).toBeTruthy();
    expect(body().style.overflow).toBe('');
    expect(body().style.height).toBe('');
  });

  it('eases back when the visitor returns to the list', async () => {
    show();
    nextStep(220);
    await waitFor(() => expect(body().style.overflow).toBe(''), { timeout: 3000 });
    await expectGlide(560, () => fireEvent.click(screen.getByRole('button', { name: 'Back' })));
    expect(screen.getByTestId(`planet-${TAFA.id}`)).toBeTruthy();
  });

  it('eases when the language changes under it', async () => {
    show();
    await expectGlide(540, () => { act(() => { useEditorStore.setState({ locale: 'ru' }); }); });
    expect(screen.getByRole('dialog', { name: 'Сменить планету' })).toBeTruthy();
  });

  it('eases when the busy dots take the verb', async () => {
    show();
    nextStep(220);
    await waitFor(() => expect(body().style.overflow).toBe(''), { timeout: 3000 });
    await expectGlide(210, () => fireEvent.click(verb()));
  });
});
