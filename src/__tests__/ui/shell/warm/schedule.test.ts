import { afterEach, describe, expect, it, vi } from 'vitest';

/** Every warm item the run starts, by name, in the order it started, and how many ran at once. */
const started = vi.hoisted(() => ({ log: [] as string[], running: 0, peak: 0, fail: new Set<string>() }));
const item = vi.hoisted(() => (name: string) => vi.fn(async () => {
  started.log.push(name); started.running++; started.peak = Math.max(started.peak, started.running);
  await new Promise((r) => setTimeout(r, 5));
  started.running--;
  if (started.fail.has(name)) throw new Error('chunk failed');
}));
vi.mock('../../../../ui/shell/edition-surfaces', () => Object.fromEntries(
  ['loadPanelColumn', 'loadStylizeWindow', 'loadHelpModal', 'loadWhatsThisLayer'].map((name) => [name, item(name)]),
));
vi.mock('../../../../pipelines/stylize/loaders', () => ({ loadProcRenderer: item('loadProcRenderer'), loadNeuralSession: item('loadNeuralSession') }));
vi.mock('../../../../view/shared/road/material', () => ({ roadMaterialSettled: item('roadMaterialSettled') }));
vi.mock('../../../../view/map3d/scene/preload', () => ({ loadScene3D: item('loadScene3D') }));
vi.mock('../../../../ui/chrome/loaders', () => Object.fromEntries(
  ['loadMapRenderer', 'loadPreview3D', 'loadPlanetImportWindow', 'loadLegalDocView']
    .map((name) => [name, item(name)]),
));
vi.mock('../../../../ui/shell/warm/loaders', () => ({ loadNewTagCard: item('loadNewTagCard') }));
const files = vi.hoisted(() => ({ counted: ['/a.bin', '/b.bin'], background: ['/runtime.wasm'] }));
vi.mock('../../../../ui/shell/warm/files', () => ({ warmFiles: vi.fn(async () => files) }));
const fetched = vi.hoisted(() => [] as string[]);
vi.mock('../../../../platform/async/http-cache', () => ({ prefetchIntoCache: vi.fn(async (url: string) => { fetched.push(url); return true; }) }));
const device = vi.hoisted(() => ({ webgl2: true, tier: 'full' as 'full' | 'core' | 'minimal' | 'none' }));
vi.mock('../../../../platform/device/device-quality', () => ({ hasWebGL2: () => device.webgl2, warmTier: () => device.tier }));

import { startWarm, __resetWarm } from '../../../../ui/shell/warm/schedule';
import { loadHelpModal, loadWhatsThisLayer } from '../../../../ui/shell/edition-surfaces';
import * as windowLoaders from '../../../../ui/chrome/loaders';
import * as frameLoaders from '../../../../ui/shell/warm/loaders';

const loaders = { ...windowLoaders, ...frameLoaders, loadHelpModal, loadWhatsThisLayer };

/** The full tier's code, in the order the normal flow reaches it. */
const FULL = [
  'loadScene3D', 'roadMaterialSettled',
  'loadHelpModal', 'loadWhatsThisLayer', 'loadMapRenderer',
  'loadPanelColumn',
  'loadPreview3D', 'loadStylizeWindow', 'loadProcRenderer', 'loadNeuralSession',
  'loadPlanetImportWindow',
  'loadLegalDocView', 'loadNewTagCard',
];

/** The code items a fresh run of `tier` starts, in order, once it has settled. */
async function codeStarted(tier: typeof device.tier): Promise<string[]> {
  __resetWarm(); started.log.length = 0;
  device.tier = tier;
  await startWarm().settled;
  return [...started.log];
}

afterEach(() => {
  device.webgl2 = true; device.tier = 'full'; fetched.length = 0; __resetWarm();
  started.log.length = 0; started.running = 0; started.peak = 0; started.fail.clear();
});

describe('the warm schedule', () => {
  it('warms the 3D view first, then Help, the assistant, export and illustration, the video import and the rest', async () => {
    expect(await codeStarted('full')).toEqual(FULL);
    expect(await codeStarted('core')).toEqual(FULL);
  });

  it('schedules every interface loader', async () => {
    const scheduled = new Set(await codeStarted('full'));
    for (const name of Object.keys(loaders)) expect(scheduled.has(name), name).toBe(true);
  });

  it('keeps a slow connection to the 3D view and Help, and skips the scene without WebGL2', async () => {
    expect(await codeStarted('minimal')).toEqual(['loadScene3D', 'loadHelpModal', 'loadWhatsThisLayer', 'loadMapRenderer']);
    device.webgl2 = false;
    expect(await codeStarted('minimal')).toEqual(['loadHelpModal', 'loadWhatsThisLayer', 'loadMapRenderer']);
    expect(await codeStarted('none')).toEqual([]);
  });

  it('runs at most two at a time, in order, and survives a failing item', async () => {
    started.fail.add('roadMaterialSettled');
    const run = startWarm();
    await run.settled;
    expect(started.peak).toBe(2);
    expect(started.log).toEqual(FULL);
    expect(run.done()).toBe(run.total());
  });

  it('starts the first item at once and waits for an idle moment before each later one', async () => {
    const run = startWarm();
    await run.planned;
    expect(started.log).toEqual(['loadScene3D']);
    await run.settled;
    expect(started.log).toEqual(FULL);
  });

  it('is one run per page that counts code and files, then fetches the background files', async () => {
    const run = startWarm();
    expect(startWarm()).toBe(run);
    await run.planned;
    expect(run.total()).toBe(FULL.length + files.counted.length);
    await run.settled;
    expect(run.done()).toBe(run.total());
    await vi.waitFor(() => expect(fetched).toEqual([...files.counted, ...files.background]));
  });
});
