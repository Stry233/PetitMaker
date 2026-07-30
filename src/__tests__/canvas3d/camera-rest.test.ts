/**
 * The camera rest detector: orbit damping decays exponentially and never truly
 * reaches zero, so for a second-plus after every gesture the camera applies
 * sub-visible motion that re-antialiases every thin silhouette per frame
 * (strobing borders on small models). The detector declares rest once per-frame
 * motion stays below visibility for a few consecutive frames, letting the scene
 * freeze the controls until the next gesture.
 */
import { describe, it, expect } from 'vitest';
import { CameraRestDetector, REST_ANGLE, REST_TRAVEL_RATIO, REST_FRAMES } from '../../canvas/map3d/scene/camera-rest';

type Quat = [number, number, number, number];
const IDENT: Quat = [0, 0, 0, 1];
/** Quaternion for a rotation of `a` radians about Y. */
const rotY = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

describe('CameraRestDetector', () => {
  it('stays awake while the camera moves visibly', () => {
    const d = new CameraRestDetector();
    let angle = 0;
    for (let i = 0; i < 20; i++) {
      angle += REST_ANGLE * 50; // clearly visible per-frame rotation
      expect(d.update([0, 5, 10], rotY(angle), 10)).toBe(false);
    }
  });

  it('declares rest after enough consecutive still frames, even with sub-visible drift', () => {
    const d = new CameraRestDetector();
    let angle = 0;
    const results: boolean[] = [];
    for (let i = 0; i < REST_FRAMES + 2; i++) {
      angle += REST_ANGLE * 0.1; // decaying damping tail: nonzero but invisible
      results.push(d.update([0, 5, 10], rotY(angle), 10));
    }
    expect(results[0]).toBe(false);           // first frame has no baseline yet
    expect(results[results.length - 1]).toBe(true);
    expect(d.isResting()).toBe(true);
  });

  it('one visible move resets the still-frame count', () => {
    const d = new CameraRestDetector();
    for (let i = 0; i < REST_FRAMES - 1; i++) d.update([0, 5, 10], IDENT, 10);
    d.update([0, 5, 10], rotY(REST_ANGLE * 50), 10); // kick
    expect(d.update([0, 5, 10], rotY(REST_ANGLE * 50), 10)).toBe(false);
  });

  it('translation tolerance scales with orbit distance', () => {
    const near = new CameraRestDetector();
    const far = new CameraRestDetector();
    // The same absolute travel per frame: invisible from far away, visible up close.
    const step = 100 * REST_TRAVEL_RATIO * 0.5;
    for (let i = 0; i < REST_FRAMES + 2; i++) {
      near.update([i * step, 5, 10], IDENT, 1);
      far.update([i * step, 5, 10], IDENT, 100);
    }
    expect(near.isResting()).toBe(false);
    expect(far.isResting()).toBe(true);
  });

  it('wake() ends rest until stillness re-accumulates', () => {
    const d = new CameraRestDetector();
    for (let i = 0; i < REST_FRAMES + 2; i++) d.update([0, 5, 10], IDENT, 10);
    expect(d.isResting()).toBe(true);
    d.wake();
    expect(d.isResting()).toBe(false);
    expect(d.update([0, 5, 10], IDENT, 10)).toBe(false); // needs REST_FRAMES again
  });
});
