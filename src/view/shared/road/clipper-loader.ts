import type ClipperLib from 'clipper-lib';

/** The polygon clipper loads on first use, in its own chunk outside the startup bundle. */
export async function loadClipper(): Promise<typeof ClipperLib> {
  const module = await import('clipper-lib');
  return (module as { default?: typeof ClipperLib }).default ?? (module as unknown as typeof ClipperLib);
}
