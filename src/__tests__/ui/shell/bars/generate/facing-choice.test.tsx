// @vitest-environment jsdom
/** The Letter and Picture facing: four arrows, each drawn where its map direction lies on screen. */
import { afterEach, describe, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { spec } from '../../../../_support/spec';
import { I18nProvider, translate } from '../../../../../i18n/context';
import { setActiveView } from '../../../../../view/active-view';
import type { ActiveView } from '../../../../../tools/pointer/runtime';
import { mapPoint } from '../../../../../core/grid/grids';
import { FacingChoice } from '../../../../../ui/shell/bars/generate/FacingChoice';

/** A flat view 10 px a cell, turned a quarter turn clockwise: the map's north points right. */
const quarterTurnClockwise = {
  projection: {
    screenToPoint: (sx: number, sy: number) => mapPoint({ x: (sy - 300) / 10, y: (500 - sx) / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: 500 - y * 10, y: 300 + x * 10, scale: 10 }),
  },
} as unknown as ActiveView;

const arrowAngle = (name: string): number => {
  const svg = screen.getByRole('button', { name }).querySelector('svg')!;
  return Number(/rotate\((-?[\d.]+)deg\)/.exec(svg.style.transform)?.[1]);
};

afterEach(() => { cleanup(); setActiveView(null); });

describe('the facing choice', () => {
  spec('GEN-23', 'draws each arrow where its map direction lies on screen, and sends the direction chosen', () => {
    setActiveView(quarterTurnClockwise);
    const choose = vi.fn();
    render(<I18nProvider><FacingChoice value={0} onChange={choose} at={{ x: 20, y: 20 }} /></I18nProvider>);
    expect(arrowAngle(translate('generate.facing_0'))).toBeCloseTo(90, 6);
    expect(arrowAngle(translate('generate.facing_90'))).toBeCloseTo(180, 6);
    fireEvent.click(screen.getByRole('button', { name: translate('generate.facing_90') }));
    expect(choose).toHaveBeenCalledWith(90);
  });

  spec('GEN-23', 'draws north up where no view is shown', () => {
    render(<I18nProvider><FacingChoice value={180} onChange={() => {}} at={null} /></I18nProvider>);
    expect(arrowAngle(translate('generate.facing_0'))).toBeCloseTo(0, 6);
    expect(screen.getByRole('button', { name: translate('generate.facing_180') }).getAttribute('aria-pressed')).toBe('true');
  });
});
