import { Suspense, type ReactNode } from 'react';
import { RenderBoundary } from '../../primitives/RenderBoundary';
import { ChunkNotice } from '../../chrome/guards/FailureNotice';
import { useLatch } from '../../primitives/use-latch';

/**
 * A window whose code is a lazy chunk, mounted from its first opening inside its chunk's boundary.
 * `keep` holds it mounted once opened, so a close plays the window's exit; without it the window
 * leaves with its flag.
 */
export function LazyWindow({ open, keep = false, children }: { open: boolean; keep?: boolean; children: ReactNode }) {
  const opened = useLatch(open);
  if (!(keep ? opened : open)) return null;
  return (
    <RenderBoundary resetKey={open} fallback={<ChunkNotice />}>
      <Suspense fallback={null}>{children}</Suspense>
    </RenderBoundary>
  );
}
