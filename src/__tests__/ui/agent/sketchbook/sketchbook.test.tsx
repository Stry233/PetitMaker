// @vitest-environment jsdom
/** Sketchbook behavior, lifecycle, and reduced-motion coverage. jsdom has no Web Animations, so
 * the suite installs an `Element.prototype.animate` spy to observe whether animation was requested. */
import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import type { PanelView } from '../../../../agent/core/project-view';
import { I18nProvider, translateFor } from '../../../../i18n/context';
import { translations } from '../../../../i18n/translations';
import { useEditorStore } from '../../../../state/store';
import { DreamOffice } from '../../../../ui/agent/desk/DreamOffice';
import { PanelShell } from '../../../../ui/agent/PanelShell';
import { Character } from '../../../../ui/agent/character/Character';
import { Sketchbook } from '../../../../ui/agent/sketchbook/Sketchbook';
import type { SketchIdea } from '../../../../ui/agent/sketchbook/propose';
import { makeState } from '../../../_support/map-state';
import type { GridState } from '../../../../core/model/types';
import { panelProps } from '../../../_support/agent-panel';

// jsdom has no 2D renderer; `MapShot` shows its placeholder, and this keeps the async capture out of the way.
vi.mock('../../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../view/map2d/capture/thumbnail')>(),
  renderThumbnail: async () => null,
}));

const LANE: SketchIdea = {
  kind: 'lane',
  capKey: 'agent.sketch_lane_cap',
  orderKey: 'agent.sketch_lane_order',
  dir: 'south', dirKey: 'agent.sketch_dir_south',
  params: { n: 34 },
  art: { shape: 'lane', from: { x: 4, y: 4 }, via: { x: 9, y: 11 }, to: { x: 15, y: 17 }, width: 2 },
};

const POND: SketchIdea = {
  kind: 'pond',
  capKey: 'agent.sketch_pond_cap',
  orderKey: 'agent.sketch_pond_order',
  dir: 'east', dirKey: 'agent.sketch_dir_east',
  params: { n: 12 },
  art: { shape: 'pond', cx: 14, cy: 8, rx: 6, ry: 4 },
};

const GROVE: SketchIdea = {
  kind: 'grove',
  capKey: 'agent.sketch_grove_cap',
  orderKey: 'agent.sketch_grove_order',
  dir: 'north', dirKey: 'agent.sketch_dir_north',
  params: { n: 3 },
  art: {
    shape: 'grove',
    pips: [
      { x: 5.5, y: 5.5, r: 1.1, standing: true },
      { x: 8.5, y: 6.5, r: 1.1, standing: true },
      { x: 6.5, y: 9.5, r: 0.9, standing: false },
    ],
  },
};

/** The words the card says for an idea, resolved exactly as the card resolves them. */
function said(idea: SketchIdea, which: 'capKey' | 'orderKey'): string {
  return translateFor('en', idea[which], { dir: translateFor('en', idea.dirKey), ...idea.params });
}

let animate: ReturnType<typeof vi.fn>;
const REAL_ANIMATE = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

function mount(ideas: readonly SketchIdea[], onOrder = () => {}, reduced = false) {
  return render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider>
        <Sketchbook ideas={ideas} onOrder={onOrder} />
      </I18nProvider>
    </MotionConfig>,
  );
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', gridState: makeState(24, 24) as GridState });
  animate = vi.fn(() => ({ onfinish: null, cancel: () => {}, finished: Promise.resolve() }));
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  if (REAL_ANIMATE) Object.defineProperty(Element.prototype, 'animate', REAL_ANIMATE);
  else delete (Element.prototype as unknown as Record<string, unknown>).animate;
  useEditorStore.setState({ gridState: null });
});

describe('the card only stands where there is something to say', () => {
  it('renders nothing at all for a map that offers nothing', () => {
    const { queryByTestId } = mount([]);
    expect(queryByTestId('sketchbook')).toBeNull();
    expect(queryByTestId('sketch-card')).toBeNull();
  });

  it('draws the first idea with its caption', () => {
    const { getByTestId } = mount([LANE, POND]);
    expect(getByTestId('sketch-card').getAttribute('data-kind')).toBe('lane');
    expect(getByTestId('sketch-caption').textContent).toBe(said(LANE, 'capKey'));
  });

  it('waits on the real capture rather than drawing a stand-in island', () => {
    const { getByTestId } = mount([LANE]);
    const shot = within(getByTestId('sketch-thumb')).getByTestId('map-shot');
    expect(shot.getAttribute('data-shot')).toBe('pending');
    expect(shot.querySelector('img')).toBeNull();
    expect(shot.childElementCount, 'the house loader stands in the empty frame').toBeGreaterThan(0);
  });

});

describe('a press hands the order over', () => {
  it('gives the composer the standing idea\'s own words, and sends nothing', () => {
    const onOrder = vi.fn();
    const { getByTestId } = mount([LANE, POND], onOrder);

    fireEvent.click(getByTestId('sketch-card'));
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onOrder).toHaveBeenCalledWith(said(LANE, 'orderKey'));
    // The order, not the caption: the caption says what she sees, the order is what the user would type.
    expect(onOrder.mock.calls[0]![0]).not.toBe(said(LANE, 'capKey'));
  });
});

describe('the figure', () => {
  /** Each family's figure is drawn through a mask that reveals it tip-first. */
  it('draws each family, every stroke behind a reveal mask', () => {
    for (const idea of [LANE, POND, GROVE]) {
      const view = mount([idea]);
      const figure = view.getByTestId('sketch-figure');
      expect(figure.getAttribute('data-kind')).toBe(idea.kind);
      const masks = figure.querySelectorAll('mask');
      const drawn = [...figure.querySelectorAll('path[mask]')];
      expect(masks.length, idea.kind).toBeGreaterThan(0);
      expect(drawn.length, idea.kind).toBe(masks.length);
      // The pencil never lays a solid line.
      for (const path of drawn) expect(path.getAttribute('stroke-dasharray'), idea.kind).toBeTruthy();
      view.unmount();
    }
  });

  it('gives a grove one pip per tree, standing or offered', () => {
    const { getByTestId } = mount([GROVE]);
    expect(getByTestId('sketch-figure').querySelectorAll('path[mask]')).toHaveLength(3);
  });
});

describe('reduced motion is the complete still', () => {
  it('draws the first idea fully in and starts no animation at all', () => {
    const { getByTestId } = mount([LANE, POND, GROVE], () => {}, true);

    expect(getByTestId('sketch-caption').textContent).toBe(said(LANE, 'capKey'));
    // Every reveal mask is fully retreated.
    const reveals = [...getByTestId('sketch-figure').querySelectorAll('mask path')];
    expect(reveals.length).toBeGreaterThan(0);
    for (const path of reveals) expect(path.getAttribute('stroke-dashoffset')).toBe('0');
    expect(animate, 'nothing moves under reduced motion').not.toHaveBeenCalled();
  });

});

/** The panel seats the card only at rest (not behind a job, an unread record, a question or a
 *  screen), and always last, nearest the composer. */
describe('the panel seats the card', () => {
  const marker = <div data-testid="sketch-marker" />;

  function stand(over: Partial<PanelView> = {}, props: Record<string, unknown> = {}) {
    return render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell {...panelProps({
            view: {
              phase: 'idle', jobs: [], queuedSteers: [], suggestion: null, lastEventAt: 0,
              vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
              ...over,
            },
            connected: true,
            now: 0,
            sketchbook: marker,
            onSend: () => {},
            onStop: () => {},
            onPause: () => {},
            onGateAnswer: () => {},
            ...props,
          })}
          />
        </I18nProvider>
      </MotionConfig>,
    );
  }

  it('stands it LAST in the job zone at rest', () => {
    const { getByTestId } = stand();
    const zone = getByTestId('panel-job-zone');
    const card = getByTestId('sketch-marker');
    expect(zone.contains(card)).toBe(true);
    // The card sits in its seat, the box the docked layout pushes to the zone's foot.
    const seat = getByTestId('sketch-seat');
    expect(seat.contains(card)).toBe(true);
    expect(zone.querySelector('[data-scroll-content]')!.lastElementChild, 'nearest the composer').toBe(seat);
  });

  it('keeps it last with the state\'s own news above it', () => {
    const past = {
      orderSeq: 1, orderText: 'lay the boardwalk', orderAt: 0, outcome: 'done' as const,
      asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    };
    // Filed, so the record is a strip row rather than a standing card, which would withhold the sketch.
    const { getByTestId } = stand({ jobs: [past] }, { filed: new Set([1]) });
    const zone = getByTestId('panel-job-zone');
    expect(zone.contains(getByTestId('history-strip')), 'the news reads first').toBe(true);
    expect(zone.querySelector('[data-scroll-content]')!.lastElementChild).toBe(getByTestId('sketch-seat'));
    expect(getByTestId('sketch-seat').contains(getByTestId('sketch-marker'))).toBe(true);
  });

  it('fills the composer with the pressed order and sends nothing', () => {
    const onSend = vi.fn();
    function Wired() {
      const [fill, setFill] = useState<{ text: string; seq: number } | undefined>(undefined);
      return (
        <MotionConfig reducedMotion="always">
          <I18nProvider>
            <PanelShell {...panelProps({
              view: {
                phase: 'idle', jobs: [], queuedSteers: [], suggestion: null, lastEventAt: 0,
                vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
              },
              connected: true,
              now: 0,
              sketchbook: (
                <Sketchbook
                  ideas={[LANE]}
                  onOrder={(text) => setFill((last) => ({ text, seq: (last?.seq ?? 0) + 1 }))}
                />
              ),
              ...(fill ? { fill } : {}),
              onSend,
              onStop: () => {},
              onPause: () => {},
              onGateAnswer: () => {},
            })}
            />
          </I18nProvider>
        </MotionConfig>
      );
    }
    const { getByTestId } = render(<Wired />);
    const field = () => getByTestId('composer-input') as HTMLInputElement;
    expect(field().value).toBe('');

    fireEvent.click(getByTestId('sketch-card'));
    expect(field().value).toBe(said(LANE, 'orderKey'));
    expect(document.activeElement).toBe(field());
    expect(onSend, 'the sketch suggests, the user sends').not.toHaveBeenCalled();
  });

  it('withholds it while a job is in flight', () => {
    const live = {
      orderSeq: 1, orderText: 'build a village', orderAt: 0,
      asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    };
    const { queryByTestId } = stand({ phase: 'thinking', current: live });
    expect(queryByTestId('sketch-marker')).toBeNull();
  });

  it('withholds it behind the keyless rest, which has its own dressing', () => {
    const { queryByTestId, getByTestId } = stand({}, { connected: false });
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(queryByTestId('sketch-marker')).toBeNull();
  });

  /** A paused job is excluded through `view.current`, not by name, so it gets its own case. */
  it('withholds it behind a paused job, the resume offer', () => {
    const paused = {
      orderSeq: 1, orderText: 'build a village', orderAt: 0,
      asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    };
    const { queryByTestId } = stand({ phase: 'paused', current: paused });
    expect(queryByTestId('sketch-marker')).toBeNull();
  });
});

/** The keyless rest: inert pictures, one Connect press, and a plume published to the character. */
describe('the dreaming office', () => {
  /** The character stands beside the screen, outside the panel, as in the app. */
  function dream(reduced = false, onConnect = () => {}) {
    return render(
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
        <I18nProvider>
          <Character pose="sleeping" size={72} />
          <DreamOffice onConnect={onConnect} />
        </I18nProvider>
      </MotionConfig>,
    );
  }

  /** The plume's state at the character's shoulder, or `off`. */
  const plume = (): string =>
    document.querySelector('[data-part="dream-badge"]')?.getAttribute('data-dream') ?? 'off';

  it('stands three inert order slips and one verb', () => {
    const { getByTestId, getAllByTestId } = dream();
    expect(getAllByTestId('dream-row')).toHaveLength(3);
    // Nothing on the board is pressable.
    for (const row of getAllByTestId('dream-row')) {
      expect(row.querySelector('button')).toBeNull();
      expect(row.tagName).not.toBe('BUTTON');
    }
    expect(getByTestId('dream-connect').textContent).toBe(translations.en['agent.dream_connect']);
  });

  it('answers Connect and nothing else', () => {
    const onConnect = vi.fn();
    const { getByTestId } = dream(false, onConnect);
    fireEvent.click(getByTestId('dream-connect'));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('takes the plume up while it stands and puts it down when it goes', () => {
    const { unmount } = dream();
    expect(plume()).not.toBe('off');
    unmount();
    expect(plume()).toBe('off');
  });

  it('runs no loop under reduced motion, and wears the first order\'s glyph', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { unmount } = dream(true);
    expect(raf).not.toHaveBeenCalled();
    expect(plume()).toBe('pw-object-place');
    unmount();
    raf.mockRestore();
  });

});
