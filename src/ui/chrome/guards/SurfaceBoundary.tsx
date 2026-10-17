/**
 * The boundary around a shell surface that renders on its own: a throw inside it leaves the map and
 * every other surface working, logs once under the surface's name, and stands the slot's fallback in
 * its place until a retry or `resetKey` mounts it again.
 */
import { useCallback, type ErrorInfo, type ReactNode } from 'react';
import { RenderBoundary } from '../../primitives/RenderBoundary';
import { SurfaceNotice } from './FailureNotice';

/** The default stand-in: a notice over the window's foot with a retry. */
const notice = (retry: () => void) => <SurfaceNotice onRetry={retry} />;

export function SurfaceBoundary({ name, resetKey, fallback = notice, children }: {
  /** The surface as a developer would look for it, for the console. */
  name: string;
  /** Changes when the user moves to another view of the surface, which mounts it afresh. */
  resetKey?: unknown;
  /** The slot's own stand-in, given the retry; the notice when omitted. */
  fallback?: (retry: () => void) => ReactNode;
  children: ReactNode;
}) {
  const report = useCallback((error: unknown, info: ErrorInfo) => {
    // React logs the error itself; this line names the surface that now shows its fallback.
    if (import.meta.env.DEV) console.error(`The ${name} failed to render and shows its fallback.`, error, info.componentStack);
  }, [name]);
  return <RenderBoundary resetKey={resetKey} fallback={fallback} onError={report}>{children}</RenderBoundary>;
}
