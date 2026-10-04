/**
 * The planet editor opened on a planet read from a video: a new planet under the default name with
 * its cells to check on the map behind a switch, saved, renamed and left as a drawn planet is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider, translate } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { newMap } from '../../../../kit/operations/map';
import { host } from '../../../../kit/host';
import type { PlanetDraft } from '../../../../kit/operations/planet-session';
import { listPlanets } from '../../../../io/planet-library';
import { Shell } from '../../../../ui/shell/Shell';
import { startPlanetEditing, stopPlanetEditing } from '../../../../ui/shell/planet/planet-editing';
import { setStoreState } from '../../../_store';
import { planetFixture } from '../../../fixtures/planet';

vi.mock('../../../../io/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../../io/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const store = () => useEditorStore.getState();
const t = (key: string, params?: Record<string, string | number>) => translate(key, params);

const draft = (cells: number[] = [2, 3, 40], landmark = true): PlanetDraft => ({ template: planetFixture(), review: { cells, landmark } });

function mount() {
  return render(<Shell onRestoreSession={() => {}}><div /></Shell>, { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> });
}

const plate = () => screen.getByTestId('planet-nameplate');

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en' });
  newMap('hexia');
  store().setAssistantOpen(false);
  store().setTourRunning(false);
  store().setModal('newProject', false);
  store().setPlanetReturn(null);
});

afterEach(() => {
  act(() => { stopPlanetEditing(); });
  host.camera.takeQueued();
  cleanup();
  vi.restoreAllMocks();
});

describe('a planet session opened from a video', () => {
  it('shows the count of cells to check and draws them until the switch turns them off', () => {
    const show = vi.spyOn(host.planetReview, 'show');
    mount();
    act(() => { store().setTourRunning(false); startPlanetEditing(draft()); });
    expect(screen.getByTestId('planet-review-count').textContent).toBe(t('planet.review_short', { n: 4 }));
    expect(screen.getByTestId('planet-review').getAttribute('title')).toBe(t('planet.review_count_landmark', { n: 3 }));
    const cells = store().planetSession!.review!.cells;
    const last = () => show.mock.calls[show.mock.calls.length - 1]!;
    expect(last()[0]).toBe(cells);
    expect(last()[1]).not.toBeNull();
    const toggle = within(screen.getByTestId('planet-review')).getByRole('switch', { name: t('planet.review_toggle') });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(last()).toEqual([null, null]);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(last()[0]).toBe(cells);
  });

  it('counts one cell in the singular and leaves the landmark out when it was found', () => {
    mount();
    act(() => { store().setTourRunning(false); startPlanetEditing(draft([5], false)); });
    expect(screen.getByTestId('planet-review-count').textContent).toBe(t('planet.review_short', { n: 1 }));
    expect(screen.getByTestId('planet-review').getAttribute('title')).toBe(t('planet.review_count_one', { n: 1 }));
  });

  it('has no review segment on a drawn planet', () => {
    mount();
    act(() => { store().setTourRunning(false); startPlanetEditing(null); });
    expect(screen.queryByTestId('planet-review')).toBeNull();
  });

  it('saves to My planets as a new planet under the default name, renamed through the name check', async () => {
    mount();
    act(() => { store().setTourRunning(false); startPlanetEditing(draft()); });
    expect(within(plate()).getByText(t('planet.default_name', { n: 1 }))).toBeTruthy();
    fireEvent.click(within(plate()).getByRole('button', { name: t('planet.done') }));
    const panel = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: 'Tafa scan' } });
    const save = within(panel).getByRole('button', { name: t('planet.save_title_new') }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    expect(listPlanets().map((e) => e.name)).toEqual(['Tafa scan']);
    expect(store().planetSession).toBeNull();
  });

  it('asks before Back discards a planet read from a video, even unedited', async () => {
    mount();
    act(() => { store().setTourRunning(false); startPlanetEditing(draft()); });
    fireEvent.click(within(plate()).getByRole('button', { name: t('planet.back') }));
    expect(store().planetSession).not.toBeNull();
    const ask = await screen.findByRole('dialog', { name: t('planet.discard_title') });
    fireEvent.click(within(ask).getByRole('button', { name: t('planet.discard') }));
    expect(store().planetSession).toBeNull();
    expect(listPlanets()).toEqual([]);
  });

  it('leaves a blank drawn planet at once with Back', () => {
    mount();
    act(() => { store().setTourRunning(false); startPlanetEditing(null); });
    fireEvent.click(within(plate()).getByRole('button', { name: t('planet.back') }));
    expect(store().planetSession).toBeNull();
  });

  it('stands the review segment on the plate between the name and Done, at its own width', () => {
    mount();
    act(() => { store().setTourRunning(false); startPlanetEditing(draft()); });
    const segment = screen.getByTestId('planet-review');
    expect(screen.getByTestId('planet-nameplate-plate').contains(segment)).toBe(true);
    expect(segment.parentElement).toBe(screen.getByTestId('planet-done').parentElement);
    const order = [...segment.parentElement!.children];
    expect(order.indexOf(screen.getByTestId('planet-name'))).toBeLessThan(order.indexOf(segment));
    expect(order.indexOf(segment)).toBeLessThan(order.indexOf(screen.getByTestId('planet-done')));
    expect(segment.style.flex).toMatch(/^(none|0 0 auto)$/);
  });
});
