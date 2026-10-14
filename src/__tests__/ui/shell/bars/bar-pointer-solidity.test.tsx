// @vitest-environment jsdom
/** Solid shelf plates receive input; floating controls leave their surrounding canvas reachable. */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { ScaleProvider } from '../../../../ui/design/scale';
import { RoadStyles } from '../../../../ui/shell/bars/terrain/RoadStyles';
import { ObjectShelf } from '../../../../ui/shell/bars/objects/ObjectShelf';
import { GenerateShelf } from '../../../../ui/shell/bars/generate/GenerateShelf';
import { useEditorStore } from '../../../../state/store';
import { setStoreState } from '../../../_support/store';

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

describe('bar pointer surfaces', () => {
  it('the entire road row receives input, including gaps between swatches', () => {
    render(<Providers><RoadStyles /></Providers>);
    const row = screen.getByRole('group', { name: 'Road Surface' });
    expect(row.style.pointerEvents).toBe('auto');
    for (const button of within(row).getAllByRole('button')) expect(button.style.pointerEvents).toBe('auto');
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
