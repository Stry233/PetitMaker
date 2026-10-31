// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { sourceFiles, repoRelative } from '../../_support/source-graph';
import { InputModeProvider, useTouchMode } from '../../../ui/design/input-mode';
import type { InputMode } from '../../../platform/device/input-mode';

const under = (inputMode: InputMode) => ({ children }: { children: ReactNode }) => (
  <InputModeProvider inputMode={inputMode}>{children}</InputModeProvider>
);

describe('the input-mode context', () => {
  it('reads PC mode outside a provider', () => {
    expect(renderHook(() => useTouchMode()).result.current).toBe(false);
    expect(renderHook(() => useTouchMode(), { wrapper: under('touch') }).result.current).toBe(true);
  });

  it('leaves the coarse-pointer query to the input-mode detector', () => {
    const readers = sourceFiles()
      .filter((path) => repoRelative(path) !== 'src/platform/device/input-mode.ts')
      .filter((path) => readFileSync(path, 'utf8').includes('pointer: coarse'))
      .map(repoRelative);
    expect(readers).toEqual([]);
  });
});
