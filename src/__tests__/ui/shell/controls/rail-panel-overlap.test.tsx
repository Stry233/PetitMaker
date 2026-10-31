// @vitest-environment jsdom
/**
 * On a narrow window at a high UI zoom the layer count, a rung higher (`z.column` over `z.panel`), can
 * cover the assistant panel's gear. The count keeps only the part of itself clear of the column, and
 * the part over the panel is the panel's to answer. The boxes are the live app's at 1280x800 and
 * uiZoom 1.8, in frame px (divided by `ZOOM` 1.25 times uiZoom 1.8, so 2.25).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { Rail } from '../../../../ui/shell/Rail';
import { readoutPressLane } from '../../../../ui/shell/frame';
import { PANEL_RIGHT } from '../../../../ui/shell/panel-frame';

afterEach(() => { cleanup(); useEditorStore.setState({ assistantOpen: false }); });

/** CSS px per frame px at uiZoom 1.8. */
const F = 2.25;
const READOUT_18 = { left: 862 / F, width: 187 / F };
const GEAR_18 = { left: 903 / F, width: 63 / F };
/** The same count at uiZoom 1, far right of the column. */
const READOUT_10 = { left: 1048 / 1.25, width: 104 / 1.25 };

describe('the press the layer count takes while the assistant panel stands under it', () => {
  it('is the whole word wherever the panel is not there', () => {
    expect(readoutPressLane(READOUT_18, null)).toBeNull();
    expect(readoutPressLane(READOUT_10, PANEL_RIGHT)).toBeNull();
  });

  it('is only the part clear of the column where the panel reaches it', () => {
    const lane = readoutPressLane(READOUT_18, PANEL_RIGHT);
    expect(lane).not.toBeNull();
    // What is left is the word's own right end, past the panel's right edge.
    expect(lane!).toBeCloseTo(READOUT_18.left + READOUT_18.width - PANEL_RIGHT, 1);
    expect(lane!).toBeGreaterThan(0);
    expect(lane!).toBeLessThan(READOUT_18.width);
  });

  it('leaves the gear its own box, centre included', () => {
    const lane = readoutPressLane(READOUT_18, PANEL_RIGHT)!;
    const pressFrom = READOUT_18.left + READOUT_18.width - lane;
    const gearCentre = GEAR_18.left + GEAR_18.width / 2;
    expect(gearCentre).toBeLessThan(pressFrom);
    expect(GEAR_18.left + GEAR_18.width).toBeLessThanOrEqual(pressFrom);
  });

  it('is nothing at all where the column covers the word entirely', () => {
    expect(readoutPressLane({ left: 100, width: 40 }, PANEL_RIGHT)).toBe(0);
  });

  it('is the whole word for a box nothing has laid out yet', () => {
    expect(readoutPressLane({ left: 0, width: 0 }, PANEL_RIGHT)).toBeNull();
  });
});

describe('the count as rendered', () => {
  it('takes its own press where no panel stands under it', () => {
    render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
    const button = screen.getByTestId('shell-layer-readout').closest('button')!;
    expect(button.style.pointerEvents).not.toBe('none');
    expect(screen.queryByTestId('shell-layer-readout-press')).toBeNull();
  });
});
