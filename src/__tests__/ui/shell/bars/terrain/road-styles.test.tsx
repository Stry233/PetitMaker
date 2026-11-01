// @vitest-environment jsdom
/**
 * The road picker: the catalog's path art on its swatches, the hovered surface's name, and the print
 * switch that keeps the chosen pavement.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../../i18n/context';
import { ScaleProvider } from '../../../../../ui/design/scale';
import { RoadStyles } from '../../../../../ui/shell/bars/terrain/RoadStyles';
import { getRoadMaterials } from '../../../../../state/catalog';
import { useEditorStore } from '../../../../../state/store';

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <MotionConfig reducedMotion="never">
          {children}
        </MotionConfig>
      </ScaleProvider>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
  useEditorStore.setState({ locale: 'en', tileMaterial: getRoadMaterials()[0]!.id, placementRotation: 0 });
});

describe('the road picker', () => {
  it('shows the hovered surface name and the icon art', async () => {
    render(<Providers><RoadStyles /></Providers>);
    const cobble = screen.getByRole('button', { name: 'Cobblestone Path' });
    expect(cobble.querySelector('img')?.getAttribute('src')).toContain('path-cobblestone');
    fireEvent.pointerEnter(cobble);
    expect((await screen.findByTestId('shell-card-name')).textContent).toBe('Cobblestone Path');
    fireEvent.pointerLeave(cobble);
  });

  it('offers every road and a leading print switch', () => {
    render(<Providers><RoadStyles /></Providers>);
    const swatches = screen.getAllByRole('button');
    expect(swatches).toHaveLength(getRoadMaterials().length + 1);
    expect(swatches[0]!.getAttribute('aria-label')).toBe('Switch to prints');
    for (const s of swatches.slice(1)) {
      expect(s.querySelector('img')?.getAttribute('src'), s.getAttribute('aria-label') ?? '').toContain('path-');
    }
  });

  it('keeps the switch outside scrolling and transitions and remembers the selected pavement', async () => {
    useEditorStore.setState({ tileMaterial: 'path-simple-brick' });
    render(<Providers><RoadStyles /></Providers>);
    const toggle = screen.getByRole('button', { name: 'Switch to prints' });
    expect(toggle.closest('[role="group"], [data-content-swap]')).toBeNull();
    fireEvent.click(toggle);
    expect(useEditorStore.getState().tileMaterial).toBe(getRoadMaterials(true)[0]!.id);
    await screen.findByRole('group', { name: 'Surface prints' });
    expect(screen.queryByRole('button', { name: 'Rotate right' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to roads' })).toBe(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to roads' }));
    expect(useEditorStore.getState().tileMaterial).toBe('path-simple-brick');
  });

  it('reaches the bubble from the keyboard too, mirroring pointer hover', async () => {
    render(<Providers><RoadStyles /></Providers>);
    const cobble = screen.getByRole('button', { name: 'Cobblestone Path' });
    act(() => { cobble.focus(); });
    expect((await screen.findByTestId('shell-card-name')).textContent).toBe('Cobblestone Path');
    act(() => { cobble.blur(); });
    await waitFor(() => expect(screen.queryByTestId('shell-card-name')).toBeNull());
  });
});
