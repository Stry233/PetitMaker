/**
 * A lazy chunk that never arrives throws where React would otherwise unmount the whole tree, so
 * the boundary is pinned on what stays on screen: the child while it works, a reload offer when it
 * does not, and the child again once the surface is opened afresh.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ChunkBoundary } from '../../../ui/primitives/ChunkBoundary';
import { I18nProvider } from '../../../i18n/context';
import { translateFor } from '../../../i18n/context';

const FAILED = translateFor('en', 'boot.chunk_failed');
const RELOAD = translateFor('en', 'boot.reload');

function Boom(): ReactNode {
  throw new Error('Failed to fetch dynamically imported module');
}

function show(node: ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

// React in development rethrows a caught render error as a window event, which jsdom reports;
// the boundary's own behavior is the subject here.
const swallow = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  window.addEventListener('error', swallow);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener('error', swallow);
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a boundary around a lazily loaded surface', () => {
  it('keeps a working child exactly as it is', () => {
    show(<ChunkBoundary><p data-testid="child">Help</p></ChunkBoundary>);
    expect(screen.getByTestId('child').textContent).toBe('Help');
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('offers a reload when the chunk fails', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    show(<ChunkBoundary><Boom /></ChunkBoundary>);
    expect(screen.getByText(FAILED)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: RELOAD }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tries again when its surface is opened afresh', () => {
    const view = show(<ChunkBoundary resetKey={false}><Boom /></ChunkBoundary>);
    expect(screen.getByText(FAILED)).not.toBeNull();
    view.rerender(
      <I18nProvider>
        <ChunkBoundary resetKey><p data-testid="child">Help</p></ChunkBoundary>
      </I18nProvider>,
    );
    expect(screen.getByTestId('child').textContent).toBe('Help');
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
