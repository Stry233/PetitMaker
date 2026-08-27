/**
 * The bars are SOLID to the pointer wherever they are visible: the dark plate band the shelves
 * stand on, and every row that answers the wheel, all carry `pointerEvents: 'auto'`.
 *
 * The bars' roots are full-width fixed strips with `pointerEvents: 'none'` so the map stays
 * reachable around them, and each control opts back in — which leaves any DECORATIVE surface that
 * does not passing input through to the canvas underneath: a wheel between two road tiles zooms the
 * map, and a drag across the shelf plate pans the map below the dock. The plates and
 * the wheel rows are the opt-in sites, and this pins them: jsdom does no hit-testing, so the pin
 * is the property that decides one.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { ScaleProvider } from '../../../ui/design/scale';
import { RoadStyles } from '../../../ui/shell/bars/RoadStyles';
import { ObjectShelf } from '../../../ui/shell/bars/ObjectShelf';
import { GenerateShelf } from '../../../ui/shell/bars/GenerateShelf';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_store';

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <ScaleProvider value={0.5}>{children}</ScaleProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  setStoreState({ locale: 'en' });
});

afterEach(cleanup);

/** Every plate band the mounted bar draws, by the marker each one carries. */
function plates(): HTMLElement[] {
  return screen.getAllByTestId('bar-plate');
}

describe('the pointer cannot reach the map through a bar', () => {
  it('the road row is solid, gaps between tiles included', () => {
    render(<Providers><RoadStyles /></Providers>);
    const row = screen.getByRole('group', { name: 'Road Surface' });
    expect(row.style.pointerEvents).toBe('auto');
  });

  it('the object shelf: the plate band and the row of names are solid', () => {
    useEditorStore.getState().setEditMode({ mode: 'object' });
    render(<Providers><ObjectShelf /></Providers>);
    for (const plate of plates()) expect(plate.style.pointerEvents).toBe('auto');
    expect(screen.getByRole('tablist').style.pointerEvents).toBe('auto');
  });

  it('the generate shelf: the plate band and the candidate row are solid', () => {
    useEditorStore.getState().setEditMode({ mode: 'generate' });
    render(<Providers><GenerateShelf /></Providers>);
    for (const plate of plates()) expect(plate.style.pointerEvents).toBe('auto');
    expect(screen.getByTestId('gen-cards-row').style.pointerEvents).toBe('auto');
  });
});
