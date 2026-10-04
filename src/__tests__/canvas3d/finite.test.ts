import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertFinite, firstNonFinite } from '../../canvas/map3d/core/finite';

afterEach(() => { vi.restoreAllMocks(); });

describe('the 3D scene finite-value check', () => {
  it('finds the first NaN or infinite value', () => {
    expect(firstNonFinite([0, 1.5, -2])).toBe(-1);
    expect(firstNonFinite(new Float32Array([0, Number.NaN, 1]))).toBe(1);
    expect(firstNonFinite([1, 2, Number.POSITIVE_INFINITY])).toBe(2);
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
