/**
 * The layer count and the assistant's panel, where the two reach the same pixels.
 *
 * The count hangs off the window's RIGHT edge and grows leftward as its word gets longer; the
 * assistant's column hangs off the LEFT edge and grows rightward with the frame's zoom. On a window
 * too narrow for both at the user's UI zoom the word is therefore drawn over the panel, and standing
 * a rung higher (`z.column` over `z.panel`) it also answers every press that lands there. Measured on
 * the live app at 1280x800, uiZoom 1.8: the word covered the panel's gear entirely, so a press at the
 * gear opened the LAYER STACK and the one door to the manage screen, the model and forget-key could
 * not be reached at all.
 *
 * What holds here is the rule that settles it: the count keeps the part of itself that is CLEAR of the
 * column, and the part standing over the panel is the panel's to answer. Nothing changes where there
 * is no collision, which is every window at uiZoom 1.
 *
 * The boxes are the ones the live app was measured at, carried into the frame's own px (css ÷ the
 * frame's zoom, `ZOOM` 1.25 x uiZoom 1.8 = 2.25), so the fixture is a reading rather than a guess.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Rail } from '../../../ui/shell/Rail';
import { readoutPressLane } from '../../../ui/shell/frame';
import { PANEL_RIGHT } from '../../../ui/shell/panel-frame';

afterEach(() => { cleanup(); useEditorStore.setState({ assistantOpen: false }); });

/** css px at uiZoom 1.8 on the reference window, in the frame's own px. */
const F = 2.25;
/** The three boxes the live app answered with, in frame px. */
const READOUT_18 = { left: 862 / F, width: 187 / F };
const GEAR_18 = { left: 903 / F, width: 63 / F };
/** The same count at uiZoom 1: the column is far to its left, so there is no collision to settle. */
const READOUT_10 = { left: 1048 / 1.25, width: 104 / 1.25 };

describe('the press the layer count takes while the assistant panel stands under it', () => {
  it('is the whole word wherever the panel is not there', () => {
    expect(readoutPressLane(READOUT_18, null)).toBeNull();
    expect(readoutPressLane(READOUT_10, PANEL_RIGHT)).toBeNull();
  });

  it('is only the part clear of the column where the panel reaches it', () => {
    const lane = readoutPressLane(READOUT_18, PANEL_RIGHT);
    expect(lane).not.toBeNull();
    // The panel's right edge is the mode row's, and the word crosses it: what is left is the word's
    // own right end.
    expect(lane!).toBeCloseTo(READOUT_18.left + READOUT_18.width - PANEL_RIGHT, 1);
    expect(lane!).toBeGreaterThan(0);
    expect(lane!).toBeLessThan(READOUT_18.width);
  });

  it('leaves the gear its own box, centre included', () => {
    const lane = readoutPressLane(READOUT_18, PANEL_RIGHT)!;
    // Where the count still answers: its rightmost `lane` px.
    const pressFrom = READOUT_18.left + READOUT_18.width - lane;
    const gearCentre = GEAR_18.left + GEAR_18.width / 2;
    expect(gearCentre).toBeLessThan(pressFrom);
    // The whole gear, not merely its middle.
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
