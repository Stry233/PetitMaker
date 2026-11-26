// @vitest-environment jsdom
/**
 * Lite's map views swap as the web edition's do: the 2D view fades out over the view crossfade
 * before it stops taking input, rather than vanishing in one frame.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import LiteApp from '../../../ui/lite/LiteApp';

// jsdom draws neither map; each view stands as a marked box in the place the root gives it.
vi.mock('../../../view/map2d/PixiCanvas', () => ({ PixiCanvas: () => <div data-testid="view-2d" /> }));
vi.mock('../../../view/map3d/Editor3DCanvas', () => ({ Editor3DCanvas: () => <div data-testid="view-3d" /> }));
vi.mock('../../../ui/app/EditorRoot', () => ({ EditorRoot: ({ children }: { children: ReactNode }) => <>{children}</> }));

afterEach(() => { cleanup(); useEditorStore.setState({ viewMode: '2d' }); });

describe('Lite\'s map views', () => {
  it('fades the 2D view out when the 3D view takes over', () => {
    render(<I18nProvider><LiteApp /></I18nProvider>);
    const holder = screen.getByTestId('view-2d').parentElement!;
    expect(holder.style.opacity).toBe('1');
    act(() => { useEditorStore.setState({ viewMode: '3d' }); });
    expect(holder.style.opacity).toBe('0');
    expect(holder.style.transition).toMatch(/opacity/);
    expect(holder.style.visibility).toBe('hidden');
  });
});
