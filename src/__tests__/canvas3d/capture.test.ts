import { describe, it, expect, afterEach, vi } from 'vitest';
import { captureMapStills, buildSmartAngles } from '../../canvas/map3d/capture';
import { __resetWebGL2Probe } from '../../core/runtime/device-quality';
import { makeState, setTerrain } from '../rules/_helpers';
import { TerrainType, type GridState } from '../../core/model/types';

vi.mock('../../canvas/map3d/scene/scene', () => ({
  ThreeScene: class { constructor() { throw new Error('the scene cannot build here'); } },
}));

describe('captureMapStills', () => {
  afterEach(() => { __resetWebGL2Probe(); vi.restoreAllMocks(); });

  it('returns [] instead of throwing when WebGL is unavailable (jsdom)', async () => {
    const urls = await captureMapStills(makeState(8, 8));
    expect(urls).toEqual([]);
  });

  /** The off-screen host the scene draws into is removed even when the scene never builds; a
   *  failed export attempt otherwise leaves a fixed div in the document for the session. */
  it('leaves no off-screen host behind when the scene cannot build', async () => {
    __resetWebGL2Probe();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => (
      kind === 'webgl2' ? { getExtension: () => null } : null)) as never);
    const before = document.body.childElementCount;
    await expect(captureMapStills(makeState(8, 8))).resolves.toEqual([]);
    expect(document.body.childElementCount).toBe(before);
  });
});

/** A map with a tall massif offset toward one corner (a clear hero + relief direction). */
function reliefMap(w = 40, h = 40): GridState {
  const s = makeState(w, h);
  for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) setTerrain(s, x, y, TerrainType.Mountain, 6);
  setTerrain(s, 10, 10, TerrainType.Mountain, 8); // the peak
  return s;
}

describe('buildSmartAngles (export 3D still framing)', () => {
  const POLAR_MIN_EL = 3, POLAR_MAX_EL = 64; // OrbitControls polar limits → valid elevation-from-horizon band

  it('produces 4 shots whose tilts stay inside the camera polar limits', () => {
    for (const s of [makeState(30, 30), reliefMap(), reliefMap(60, 24)]) {
      const angles = buildSmartAngles(s);
      expect(angles).toHaveLength(4);
      for (const a of angles) {
        expect(a.el).toBeGreaterThanOrEqual(POLAR_MIN_EL);
        expect(a.el).toBeLessThanOrEqual(POLAR_MAX_EL);
        expect(a.dist).toBeGreaterThan(0.22);
        expect(a.dist).toBeLessThan(1.9);
      }
    }
  });

  it('orbits from diverse sides — azimuths are well spread, not a narrow fan', () => {
    const az = buildSmartAngles(reliefMap()).map((a) => ((a.az % 360) + 360) % 360).sort((p, q) => p - q);
    // Largest gap around the circle should be well under a hemisphere (shots really do surround the subject).
    let maxGap = 360 - (az[az.length - 1]! - az[0]!);
    for (let i = 1; i < az.length; i++) maxGap = Math.max(maxGap, az[i]! - az[i - 1]!);
    expect(maxGap).toBeLessThan(190);
  });

  it('spans a bold tilt range (a low hero AND a high overview), not one flat height', () => {
    const els = buildSmartAngles(reliefMap()).map((a) => a.el);
    expect(Math.max(...els) - Math.min(...els)).toBeGreaterThan(14);
  });

  it('is deterministic per map (preview == export)', () => {
    expect(buildSmartAngles(reliefMap())).toEqual(buildSmartAngles(reliefMap()));
  });

  it('varies between different maps (dynamic diversity)', () => {
    const a = buildSmartAngles(reliefMap(40, 40)).map((x) => Math.round(x.az));
    const b = buildSmartAngles(reliefMap(52, 33)).map((x) => Math.round(x.az));
    expect(a).not.toEqual(b);
  });
});
