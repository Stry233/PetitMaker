import { FNV_BASIS, fnv1aStep } from '../../../core/base/hash';

/** A compact lookup key, not encryption or a security boundary. */
export function fingerprint(text: string): string {
  let first = FNV_BASIS; let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first = fnv1aStep(first, code);
    second = Math.imul(second ^ code, 0x85ebca77);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
