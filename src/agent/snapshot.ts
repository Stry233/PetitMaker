/**
 * Module-level snapshot registry (same singleton pattern as
 * renderer/render-scheduler): the PixiJS canvas registers a renderer-backed
 * snapshotter at mount; agent tools call takeMapSnapshot without importing
 * the renderer. Returns a PNG data URL downscaled to <=1024px, or null when
 * no renderer is mounted (headless tests) or extraction fails.
 */
type Snapshotter = () => Promise<string | null>;
let snapshotter: Snapshotter | null = null;

export function registerMapSnapshotter(fn: Snapshotter | null): void {
  snapshotter = fn;
}

export function takeMapSnapshot(): Promise<string | null> {
  return snapshotter ? snapshotter() : Promise.resolve(null);
}
