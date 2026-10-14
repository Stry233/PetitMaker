// @vitest-environment jsdom
/**
 * The carry step's two pictures are one choice between two planets, so they share scale and centre:
 * both receive the same fit box, the union of the destination's land and the cells that do not fit.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { getMapTemplate } from '../../../../../config/maps';
import { createGridState } from '../../../../../core/model/template';
import { I18nProvider } from '../../../../../i18n/context';
import type { TransferPreview } from '../../../../../tools/generation/run/planet-preview';
import { planetBounds } from '../../../../../view/map2d/capture/planet-painter';
import type { PlanetPreviewProps } from '../../../../../ui/chrome/modals/planet/PlanetPreview';

const seen: PlanetPreviewProps[] = [];
vi.mock('../../../../../ui/chrome/modals/planet/PlanetPreview', () => ({
  PlanetPreview: (props: PlanetPreviewProps) => { seen.push(props); return null; },
}));

const { PlanetCarryStep } = await import('../../../../../ui/chrome/modals/planet/PlanetCarryStep');

describe('the carry step fit', () => {
  it('gives both previews one fit, the box the painter gives the destination with the dropped cells', () => {
    const target = getMapTemplate('tafa');
    const dropped = [{ x: -30, y: -20 }, { x: target.width + 10, y: target.height + 5 }];
    const preview: TransferPreview = {
      state: createGridState(target), dropped, moved: { cells: 0, objects: 0 }, droppedCounts: { cells: 2, objects: 0 },
    };
    seen.length = 0;
    render(<I18nProvider><PlanetCarryStep target={target} preview={preview} carry="carry" onCarry={() => {}} labelledBy="x" /></I18nProvider>);
    const fits = seen.map((p) => p.fit);
    expect(fits).toHaveLength(2);
    expect(fits[0]).toBeDefined();
    expect(fits[1]).toEqual(fits[0]);
    expect(fits[0]).toEqual(planetBounds({ template: target, dropped }));
    cleanup();
  });

  it('holds both pictures pending, with no fit, until the transfer is worked out', () => {
    seen.length = 0;
    render(<I18nProvider><PlanetCarryStep target={getMapTemplate('tafa')} preview={null} carry="carry" onCarry={() => {}} labelledBy="x" /></I18nProvider>);
    expect(seen.map((p) => [p.pending, p.fit])).toEqual([[true, undefined], [true, undefined]]);
    cleanup();
  });
});
