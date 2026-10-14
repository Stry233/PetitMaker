import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertFinite } from '../../../../view/map3d/geometry/finite';

afterEach(() => { vi.restoreAllMocks(); });

describe('the 3D scene finite-value check', () => {
  it('reports the first NaN or infinite value and its index', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertFinite('a', [0, 1.5, -2]);
    expect(error).not.toHaveBeenCalled();
    assertFinite('b', new Float32Array([0, Number.NaN, 1]));
    assertFinite('c', [1, 2, Number.POSITIVE_INFINITY, Number.NaN]);
    expect(error.mock.calls.map((call) => call[1])).toEqual([Number.NaN, Number.POSITIVE_INFINITY]);
    expect(String(error.mock.calls[0]![0])).toContain('index 1');
    expect(String(error.mock.calls[1]![0])).toContain('index 2');
  });

  it('names the scene part that received a non-finite value in development builds', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertFinite('sea frame', [0, 1, 2]);
    expect(error).not.toHaveBeenCalled();
    assertFinite('terrain chunk 2,3', [0, Number.NaN]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('terrain chunk 2,3');
  });
});
