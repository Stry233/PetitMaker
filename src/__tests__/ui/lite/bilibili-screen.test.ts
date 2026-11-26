// @vitest-environment jsdom
/**
 * The Bilibili Toy build's screen: on start it listens to the container and then asks for landscape and
 * immersive mode, lays the page out by the container's viewport, safe area and top bar once a state
 * shows that mode, and keeps the window's own layout when none does. The bridge is the one the build
 * aliases (`scripts/edition-build.mts`), with a `window.toy` double.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../platform/host/host-bridge', () => import('../../../platform/host/host-bridge-bilibili'));

type State = Record<string, unknown>;
const PORTRAIT: State = { deviceType: 'phone', orientation: 'portrait', immersive: false, viewport: { width: 1000, height: 600 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, changedFields: [] };
const LANDSCAPE: State = {
  deviceType: 'phone', orientation: 'landscape', immersive: true, viewport: { width: 900, height: 400 },
  safeArea: { top: 10, right: 30, bottom: 12, left: 30 }, capsule: { top: 8, left: 780, width: 90, height: 32 },
  changedFields: ['orientation', 'immersive', 'viewport', 'safeArea'],
};

/** The container double: what the app asked in order, and a way to send it a state. */
function containerDouble() {
  const asked: string[] = [];
  let listener: ((state: State) => void) | null = null;
  const toy = {
    onContainerChange: vi.fn((next: (state: State) => void) => { asked.push('listen'); listener = next; next(PORTRAIT); return () => { listener = null; }; }),
    setContainerMode: vi.fn(async (_mode: unknown) => { asked.push('set'); }),
  };
  (window as { toy?: unknown }).toy = toy;
  return { toy, asked, send: (state: State) => listener?.(state) };
}

/** Installs the Lite page fit as the app's start does, and reads the room it gives the layout. */
async function start() {
  const { installLiteSafeArea } = await import('../../../ui/lite/safe-area');
  const { viewportSize } = await import('../../../platform/device/viewport-space');
  installLiteSafeArea();
  return viewportSize;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('CSS', { supports: () => false });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  document.body.removeAttribute('style');
});
afterEach(() => { delete (window as { toy?: unknown }).toy; vi.unstubAllGlobals(); });

describe('[UI-25] the Bilibili container\'s landscape mode', () => {
  it('listens to the container before it asks for landscape and immersive mode', async () => {
    const double = containerDouble();
    await start();
    expect(double.asked).toEqual(['listen', 'set']);
    expect(double.toy.setContainerMode).toHaveBeenCalledWith({ orientation: 'landscape', immersive: true });
  });

  it('lays the page out by the container once a state shows the mode, clear of the top bar', async () => {
    const double = containerDouble();
    const viewportSize = await start();
    // The answer to the request is no sign the mode holds: the window keeps its own layout meanwhile.
    await Promise.resolve();
    expect(viewportSize()).toEqual({ width: 1000, height: 600 });
    double.send(LANDSCAPE);
    // The width between the side insets; the height below the top bar, which reaches lower than the top inset.
    expect(viewportSize()).toEqual({ width: 840, height: 348 });
    expect(document.body.style.transform).toBe('translate(30px,40px)');
    double.send({ ...LANDSCAPE, viewport: { width: 800, height: 380 }, changedFields: ['viewport'] });
    expect(viewportSize()).toEqual({ width: 740, height: 328 });
  });

  it('keeps the window\'s own layout when the mode never holds or stops holding', async () => {
    const double = containerDouble();
    const viewportSize = await start();
    double.send({ ...PORTRAIT, viewport: { width: 400, height: 800 }, changedFields: ['viewport'] });
    expect(viewportSize()).toEqual({ width: 1000, height: 600 });
    double.send(LANDSCAPE);
    double.send({ ...LANDSCAPE, immersive: false, changedFields: ['immersive'] });
    expect(viewportSize()).toEqual({ width: 1000, height: 600 });
    expect(document.body.style.transform).toBe('translate(0px,0px)');
  });

  it('keeps the window\'s own layout where the container has no screen mode, as on the web', async () => {
    (window as { toy?: unknown }).toy = {
      onContainerChange: () => { throw new Error('[ToySDK] not supported'); },
      setContainerMode: () => Promise.reject(new Error('[ToySDK] not supported')),
    };
    const viewportSize = await start();
    expect(viewportSize()).toEqual({ width: 1000, height: 600 });
    delete (window as { toy?: unknown }).toy;
    vi.resetModules();
    expect((await start())()).toEqual({ width: 1000, height: 600 });
  });
});
