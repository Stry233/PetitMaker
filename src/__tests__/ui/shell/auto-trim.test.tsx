/**
 * Auto trim, riding inside the active build cell's pill.
 *
 * It is a SETTING that the row otherwise has no shape for: every cell of that row arms a tool, and
 * this one arms nothing. So what is worth pinning is where it can be reached from, that a press
 * walks the three states rather than toggling two, and that it says which state it is in with a
 * word rather than with a key: an accessible name assembled as `'edgecut.' + mode` is a lookup no
 * test can enumerate, and it announces the raw key the day it misses.
 *
 * The chip has room for ONE word, and which word is a choice rather than a lookup: doing something
 * it names what it does, doing nothing it names itself, since "off" is the absence of a thing and
 * says nothing on its own. The accessible name reads the state out in full in every case.
 *
 * WHERE IT CAN BE REACHED FROM is the one fact here that is derivable rather than chosen: the pass
 * runs from `DrawingTool.finishStroke`, so the setting belongs to exactly the cells that arm that
 * tool. The first test states it that way, against the RESOLVED tool, so a cell added to the row
 * with the wrong flag fails rather than quietly hiding a setting its strokes obey.
 *
 * jsdom lays nothing out, so the pill's own geometry is not asserted here; it was checked in a
 * browser, in the seven languages, against the row it grows out of. What jsdom does carry is the
 * FOLD's two end states, which are inline widths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import { contentArming, resolveEditMode } from '../../../core/model/edit-mode';
import { ToolType, type AutoEdgeCut } from '../../../core/model/types';
import { I18nProvider, translate, translateFor } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { ScaleProvider } from '../../../ui/design/scale';
import { EC_NEXT, EC_STATE_KEY } from '../../../ui/shell/bars/edge-cut-glyph';
import { TerrainBar } from '../../../ui/shell/bars/TerrainBar';
import { TOOL_CELLS, type TerrainSurface } from '../../../ui/shell/bars/terrain-cells';

const SURFACES: TerrainSurface[] = ['mountain', 'water', 'road'];

function mount(surface: TerrainSurface, reduced?: boolean) {
  return render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <TerrainBar surface={surface} />
        </ScaleProvider>
      </I18nProvider>
    </MotionConfig>,
  );
}

/** The control, by the name a screen reader would read out. */
function trim(mode: AutoEdgeCut): HTMLElement | null {
  return screen.queryByLabelText(`${translate('edgecut.auto')}: ${translate(EC_STATE_KEY[mode])}`);
}

/** The box the word unfolds out of: what the fold animates, and the only geometry jsdom holds. */
function fold(el: HTMLElement): HTMLElement {
  return el.lastElementChild as HTMLElement;
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', autoEdgeCut: 'off' });
  useEditorStore.getState().setEditMode({ mode: 'mountain', tool: 'brush', shape: 'free' });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ autoEdgeCut: 'off' });
  useEditorStore.getState().setEditMode({ mode: null, tool: 'brush', shape: 'free' });
});

describe('the auto-trim control', () => {
  it('stands in the plate of every cell whose stroke it shapes, and no others', () => {
    for (const surface of SURFACES) {
      for (const cell of TOOL_CELLS) {
        // From REST, because a cell is a toggle: mounted with the free brush already armed, the
        // press below would put that cell away rather than arm it.
        useEditorStore.getState().setEditMode({ mode: surface, tool: 'none', shape: 'free' });
        mount(surface);
        fireEvent.click(screen.getByLabelText(translate(cell.labelKey)));
        // The pass runs from the drawing tool's stroke end, so the cells that offer the setting are
        // exactly the cells that arm that tool: the brush and the four shapes. The eraser takes
        // content away and the trim cell IS the manual trimmer.
        const arms = resolveEditMode({
          mode: surface,
          arming: contentArming(cell.edit.tool, cell.edit.shape ?? 'free'),
          tool: cell.edit.tool,
          shape: cell.edit.shape ?? 'free',
        });
        expect(cell.autoTrim ?? false).toBe(arms.toolType === ToolType.TerrainBrush);
        expect(trim('off') !== null).toBe(cell.autoTrim ?? false);
        cleanup();
      }
    }
  });

  it('walks all three states and comes back to off', () => {
    mount('mountain');
    const seen: AutoEdgeCut[] = ['off'];
    for (let i = 0; i < 3; i += 1) {
      const from = seen[seen.length - 1]!;
      fireEvent.click(trim(from)!);
      const now = useEditorStore.getState().autoEdgeCut;
      expect(now).toBe(EC_NEXT[from]);
      seen.push(now);
    }
    expect(seen).toEqual(['off', 'rect', 'round', 'off']);
  });

  it('names the setting and the state it is in, never the key that holds it', () => {
    mount('mountain');
    for (const mode of ['off', 'rect', 'round'] as const) {
      act(() => { useEditorStore.setState({ autoEdgeCut: mode }); });
      const name = trim(mode)!.getAttribute('aria-label')!;
      expect(name).not.toContain('edgecut.');
      expect(name).toContain(translate(EC_STATE_KEY[mode]));
    }
  });

  /**
   * ONE WORD, AND IT IS THE STATE. The chip has room for a single word and nothing beside it says
   * what that word is about, so each state name has to carry its own subject: the off state is
   * "No Trim" and not "Off", which is off WHAT. Named that way there is nothing for the chip to
   * introduce and nothing for it to cross to, which is the whole of what it shows.
   */
  it('shows the state it is in, and only that', () => {
    mount('mountain');
    for (const mode of ['off', 'rect', 'round'] as const) {
      act(() => { useEditorStore.setState({ autoEdgeCut: mode }); });
      const chip = within(trim(mode)!);
      expect(chip.getByText(translate(EC_STATE_KEY[mode]))).toBeTruthy();
      // The setting's own name is the accessible one, never a word on the chip.
      expect(chip.queryByText(translate('edgecut.auto'))).toBeNull();
    }
  });

  /**
   * A state word stands alone here, so none of them may be the bare "off" the chip cannot explain.
   *
   * Stated against each language's plain word for a switch being off, held here as data.
   * Trailing punctuation is dropped first: Russian abbreviates with a period, and a test that let
   * that difference through would pass on the word it exists to fail.
   */
  it('names the off state after the setting, not after nothing, in every language', () => {
    const PLAIN_OFF: Record<keyof typeof translations, string> = {
      en: 'Off', zh: '关闭', ja: 'オフ', ru: 'Выкл.', th: 'ปิด', id: 'Mati', fr: 'Désactivées',
    };
    const bare = (s: string) => s.trim().replace(/[.。]+$/, '').toLocaleLowerCase();
    for (const locale of Object.keys(translations) as (keyof typeof translations)[]) {
      const off = translateFor(locale, EC_STATE_KEY.off);
      expect(off.trim(), locale).toBeTruthy();
      expect(bare(off), locale).not.toBe(bare(PLAIN_OFF[locale]));
    }
  });

  it('has a word for every state in every language', () => {
    for (const locale of Object.keys(translations) as (keyof typeof translations)[]) {
      for (const key of ['edgecut.auto', ...Object.values(EC_STATE_KEY)]) {
        expect(translations[locale][key]?.trim()).toBeTruthy();
        expect(translateFor(locale, key)).not.toBe(key);
      }
    }
  });
});

describe('the word holds long enough to read, then folds away', () => {
  // Only the HOLD's own timer is faked: the animation frames have to keep running, since what these
  // assertions read is the inline width Framer writes once its transition has landed.
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  const frame = async () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
  // One `act` per frame: a hover arrives through a native listener, so the render it causes is
  // committed on an act boundary and only the frames after that one can see the new target.
  const settle = async () => { for (let i = 0; i < 6; i += 1) await frame(); };

  it('arrives folded, unfolds on a press, folds again on its own, and a hover brings it back', async () => {
    mount('mountain', true);
    await settle();
    // Mounting is not a change: the control moves from cell to cell as the tool does, and a word at
    // every tool switch is noise.
    expect(fold(trim('off')!).style.width).toBe('0px');

    fireEvent.click(trim('off')!);
    await settle();
    expect(fold(trim('rect')!).style.width).not.toBe('0px');

    act(() => { vi.advanceTimersByTime(4000); });
    await settle();
    expect(fold(trim('rect')!).style.width).toBe('0px');

    // THE BOUNDARY CROSSING IS NOT THE HOVER. The chip is revealed by the cell beside it opening
    // into a pill, and that sweeps the chip sideways under whatever the pointer is resting on: a
    // press at the cell's right edge lands the pointer on the chip without the pointer having moved.
    // Read as a hover it opens the word, which widens the chip, which moves the edge the pointer is
    // judged against, which fires the opposite event — the fold pumps for as long as the pointer
    // stands still. An enter on its own therefore says nothing.
    act(() => { fireEvent.pointerEnter(trim('rect')!, { pointerType: 'mouse' }); });
    await settle();
    expect(fold(trim('rect')!).style.width, 'an enter with no movement is the chip arriving, not the pointer').toBe('0px');

    act(() => { fireEvent.pointerMove(trim('rect')!, { pointerType: 'mouse' }); });
    await settle();
    expect(fold(trim('rect')!).style.width).not.toBe('0px');

    act(() => { fireEvent.pointerLeave(trim('rect')!, { pointerType: 'mouse' }); });
    await settle();
    expect(fold(trim('rect')!).style.width).toBe('0px');
  });

  it('reaches both ends of the fold with no travel when motion is reduced', async () => {
    // Width is not a transform, so Framer's own gate does not collapse it and the component has to
    // branch its transition. The tell is that ONE frame is enough to land the end state, where a
    // spring is still on its way there.
    mount('mountain', true);
    await settle();
    fireEvent.click(trim('off')!);
    await frame();
    const landed = fold(trim('rect')!).style.width;
    expect(landed).not.toBe('0px');
    cleanup();

    act(() => { useEditorStore.setState({ autoEdgeCut: 'off' }); });
    mount('mountain', false);
    await settle();
    fireEvent.click(trim('off')!);
    await frame();
    expect(fold(trim('rect')!).style.width).not.toBe(landed);
  });
});
