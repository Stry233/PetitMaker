// @vitest-environment jsdom
/**
 * A subtree that throws while rendering would otherwise unmount the whole tree, so the boundary is
 * pinned on what stays on screen: the child while it works, the fallback when it does not, and the
 * child again once its surface is opened afresh or the fallback retries.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RenderBoundary } from '../../../ui/primitives/RenderBoundary';
import { ChunkNotice, SurfaceNotice } from '../../../ui/chrome/guards/FailureNotice';
import { I18nProvider } from '../../../i18n/context';
import { translateFor } from '../../../i18n/context';

const FAILED = translateFor('en', 'boot.chunk_failed');
const RELOAD = translateFor('en', 'boot.reload');
const SURFACE_FAILED = translateFor('en', 'guard.surface_failed');
const RETRY = translateFor('en', 'guard.retry');

function Boom(): ReactNode {
  throw new Error('Failed to fetch dynamically imported module');
}

/** Throws while `broken.now` holds, so a test can mend it between attempts. */
const broken = { now: true };
function Flaky(): ReactNode {
  if (broken.now) throw new Error('flaky');
  return <p data-testid="child">Mended</p>;
}

function show(node: ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

// React in development rethrows a caught render error as a window event, which jsdom reports;
// the boundary's own behavior is the subject here.
const swallow = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  broken.now = true;
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
    show(<RenderBoundary fallback={<ChunkNotice />}><p data-testid="child">Help</p></RenderBoundary>);
    expect(screen.getByTestId('child').textContent).toBe('Help');
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('offers a reload when the chunk fails', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    show(<RenderBoundary fallback={<ChunkNotice />}><Boom /></RenderBoundary>);
    expect(screen.getByText(FAILED)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: RELOAD }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tries again when its surface is opened afresh', () => {
    const view = show(<RenderBoundary resetKey={false} fallback={<ChunkNotice />}><Boom /></RenderBoundary>);
    expect(screen.getByText(FAILED)).not.toBeNull();
    view.rerender(
      <I18nProvider>
        <RenderBoundary resetKey fallback={<ChunkNotice />}><p data-testid="child">Help</p></RenderBoundary>
      </I18nProvider>,
    );
    expect(screen.getByTestId('child').textContent).toBe('Help');
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});

describe('a boundary whose fallback retries', () => {
  const retrying = (retry: () => void) => <SurfaceNotice onRetry={retry} />;

  it('mounts the subtree again on retry and keeps the fallback while it still throws', () => {
    show(<RenderBoundary fallback={retrying}><Flaky /></RenderBoundary>);
    expect(screen.getByText(SURFACE_FAILED)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(screen.getByText(SURFACE_FAILED), 'still broken, so the fallback stands').not.toBeNull();
    broken.now = false;
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(screen.getByTestId('child').textContent).toBe('Mended');
    expect(screen.queryByText(SURFACE_FAILED)).toBeNull();
  });

  it('reports each failure once', () => {
    const onError = vi.fn();
    show(<RenderBoundary fallback={retrying} onError={onError}><Flaky /></RenderBoundary>);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('flaky');
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(onError, 'the retry failed afresh').toHaveBeenCalledTimes(2);
  });
});
