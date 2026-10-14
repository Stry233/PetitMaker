/**
 * The lint has no baseline: every ESLint violation is fixed or carries an inline disable with its
 * reason. ESLint applies `eslint-suppressions.json` from the working directory whenever the file
 * exists, with no flag, so its presence alone would silence every violation it lists.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

describe('the lint has no baseline', () => {
  it('keeps no bulk-suppression file', () => {
    expect(existsSync('eslint-suppressions.json')).toBe(false);
  });

  it('runs ESLint without suppressing violations', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(Object.values(pkg.scripts).filter((command) => /--suppress|suppressions-location/.test(command))).toEqual([]);
  });
});
