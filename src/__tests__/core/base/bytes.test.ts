import { describe, it, expect } from 'vitest';
import { base64ToBytes, bytesToBase64, concatBytes } from '../../../core/base/bytes';

describe('concatBytes', () => {
  it('joins chunks in order, with or without a counted total', () => {
    const parts = [Uint8Array.of(1, 2), new Uint8Array(0), Uint8Array.of(3)];
    expect([...concatBytes(parts)]).toEqual([1, 2, 3]);
    expect([...concatBytes(parts, 3)]).toEqual([1, 2, 3]);
    expect(concatBytes([]).length).toBe(0);
  });
});

describe('base64', () => {
  it('round-trips bytes larger than one chunk in both alphabets', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 37) & 255);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
    expect([...base64ToBytes(bytesToBase64(bytes, { url: true }))]).toEqual([...bytes]);
  });

  it('writes the standard alphabet with padding and the URL alphabet without', () => {
    const bytes = Uint8Array.of(251, 255, 191, 1);
    expect(bytesToBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
    expect(bytesToBase64(bytes, { url: true })).toBe('-_-_AQ');
  });
});
