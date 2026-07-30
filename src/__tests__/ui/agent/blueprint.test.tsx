import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { SketchCard } from '../../../ui/menu/agent/entries/SketchCard';
import { BlueprintCard } from '../../../ui/menu/agent/entries/BlueprintCard';
import { HelpersBlock } from '../../../ui/menu/agent/entries/HelpersBlock';
import type { BlueprintEntry, Helper, SketchesEntry } from '../../../agent/session';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

const ACCENT = '#D97757';

const sketches = (over: Partial<SketchesEntry> = {}): SketchesEntry => ({
  id: 3,
  kind: 'sketches',
  opts: [
    { icon: 'terrain', tile: '#CED779', name: 'Gentle knolls', sub: 'two soft summits, meadow between' },
    { icon: 'terrain', tile: '#FFE196', name: 'Walkable ridge', sub: 'every tier reachable by ramps' },
    { icon: 'terrain', tile: '#FFDA7E', name: 'Steep spire', sub: 'dramatic skyline, summit stays scenic' },
  ],
  picked: null,
  ...over,
});

const bp = (over: Partial<BlueprintEntry> = {}): BlueprintEntry => ({
  id: 5,
  kind: 'bp',
  goal: 'A cozy village with a stream',
  stages: ['Shape the land', 'Water and paths', 'Raise the buildings', 'Dress the scene'],
  draft: false,
  paused: false,
  done: false,
  doneCount: 0,
  currentIdx: -1,
  notes: {},
  steps: 14,
  checkpoints: [],
  ...over,
});

const noops = {
    onGate: () => {},
  onResume: () => {},
  onRewind: () => {},
  onUndo: () => {},
};

describe('SketchCard', () => {
  it('renders the kicker in the provider accent, options and the hint', () => {
    render(<SketchCard entry={sketches()} accent={ACCENT} onPick={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText(/drafted off the map, nothing applied yet/).style.color).toBe('rgb(217, 119, 87)');
    expect(screen.getAllByTestId('sketch-opt')).toHaveLength(3);
    expect(screen.getByText(/Tap one to build it/)).toBeTruthy();
  });

  it('fires onPick with the entry id and option index', () => {
    const onPick = vi.fn();
    render(<SketchCard entry={sketches()} accent={ACCENT} onPick={onPick} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Walkable ridge'));
    expect(onPick).toHaveBeenCalledWith(3, 1);
  });

  it('decided: picked row gets check + green border, others fade, hint gone', () => {
    render(<SketchCard entry={sketches({ picked: 1 })} accent={ACCENT} onPick={() => {}} />, { wrapper: Wrapper });
    const opts = screen.getAllByTestId('sketch-opt');
    expect(opts[1]!.dataset.picked).toBe('true');
    expect(opts[1]!.style.opacity).toBe('1');
    expect(screen.getAllByTestId('sketch-check')[1]!.style.display).toBe('grid');
    expect(opts[0]!.style.opacity).toBe('0.38');
    expect(opts[0]!.style.pointerEvents).toBe('none');
    expect(screen.queryByText(/Tap one to build it/)).toBeNull();
  });
});

describe('BlueprintCard — draft', () => {
  it('shows the draft chip, gate buttons and hint (no per-stage drop affordance)', () => {
    const onGate = vi.fn();
    render(<BlueprintCard entry={bp({ draft: true })} accent={ACCENT} {...noops} onGate={onGate} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId('bp-state').textContent).toBe('draft');
    expect(screen.queryAllByTestId('stage-drop')).toHaveLength(0);
    fireEvent.click(screen.getByText('Looks right, go'));
    expect(onGate).toHaveBeenCalledWith(5, true);
    fireEvent.click(screen.getByText('Not now'));
    expect(onGate).toHaveBeenCalledWith(5, false);
  });
});

describe('BlueprintCard — running', () => {
  it('marks done/current/pending stages and renders the current-stage curtail', () => {
    render(
      <BlueprintCard
        entry={bp({
          doneCount: 1,
          currentIdx: 1,
          notes: { 0: 'Three tiers, rounded cliffs' },
          rail: [{ s: 'run', i: 'water', t: 'Stream' }],
          now: 'Carving the stream around the hill…',
        })}
        accent={ACCENT}
        {...noops}
      />,
      { wrapper: Wrapper },
    );
    const stages = screen.getAllByTestId('stage');
    expect(stages.map((s) => s.dataset.state)).toEqual(['done', 'current', 'pending', 'pending']);
    expect(screen.getByTestId('stage-dot')).toBeTruthy(); // pulsing accent dot
    expect(screen.getByTestId('stage-note').textContent).toBe('Three tiers, rounded cliffs');
    const curtail = screen.getByTestId('curtail');
    expect(curtail.querySelector('[data-testid="tick"]')).toBeTruthy();
    expect(screen.getByText(/Carving the stream/)).toBeTruthy();
    // no gates, no rewinds while running
    expect(screen.queryByTestId('draft-gate')).toBeNull();
    expect(screen.queryAllByTestId('stage-rewind')).toHaveLength(0);
  });

  it('per-stage narration is collapsed by default and expands on click (not a loose note)', () => {
    render(
      <BlueprintCard
        entry={bp({
          doneCount: 1,
          currentIdx: 1,
          stageProse: { 1: 'Routing the stream around the north face to keep the slope gentle.' },
          rail: [{ s: 'run', i: 'water', t: 'Stream' }],
        })}
        accent={ACCENT}
        {...noops}
      />,
      { wrapper: Wrapper },
    );
    const toggle = screen.getByTestId('stage-prose-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('stage-prose-body')).toBeNull(); // collapsed by default
    fireEvent.click(toggle);
    expect(screen.getByTestId('stage-prose-body').textContent).toContain('north face');
  });

  it('shows the amber revertnote and helpers under the current stage', () => {
    const helpers: Helper[] = [
      { icon: 'build', color: '#C98A5B', name: 'Helper · Homes', task: 'placing 4 cabins around the square', done: false },
      { icon: 'road', color: '#8FB98B', name: 'Helper · Paths', task: 'linking every door to the lane', done: true },
    ];
    render(
      <BlueprintCard
        entry={bp({ doneCount: 2, currentIdx: 2, helpers, revertnote: 'One basin rolled back, water needs a capped edge to hold.' })}
        accent={ACCENT}
        {...noops}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('helpers')).toBeTruthy();
    expect(screen.getByText(/capped edge to hold/)).toBeTruthy();
  });
});

describe('BlueprintCard — paused / done / undone', () => {
  it('paused: state chip + Resume / Abandon gate + per-stage rewind on done stages', () => {
    const onResume = vi.fn();
    const onRewind = vi.fn();
    render(
      <BlueprintCard entry={bp({ paused: true, doneCount: 2, currentIdx: -1 })} accent={ACCENT} {...noops} onResume={onResume} onRewind={onRewind} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('bp-state').textContent).toBe('paused');
    expect(screen.getByTestId('paused-gate')).toBeTruthy();
    fireEvent.click(screen.getByText('▶ Resume'));
    expect(onResume).toHaveBeenCalledWith(5);
    expect(screen.getByText('Abandon and undo')).toBeTruthy();
    const rewinds = screen.getAllByTestId('stage-rewind');
    expect(rewinds).toHaveLength(2); // the two done stages
    fireEvent.click(rewinds[1]!);
    expect(onRewind).toHaveBeenCalledWith(5, 1);
  });

  it('done: watermark, wavy recap, rewind points and Undo all', () => {
    const onUndo = vi.fn();
    const { container } = render(
      <BlueprintCard entry={bp({ done: true, doneCount: 4, currentIdx: -1, steps: 14 })} accent={ACCENT} {...noops} onUndo={onUndo} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('bp-watermark')).toBeTruthy();
    const wavy = container.querySelector('.pw-wavy') as HTMLElement;
    expect(wavy.textContent).toBe('14 steps');
    expect(wavy.classList.contains('pw-dimmed')).toBe(false);
    expect(screen.getByText('Each stage above is a rewind point')).toBeTruthy();
    expect(screen.getAllByTestId('stage-rewind')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('undochip'));
    expect(onUndo).toHaveBeenCalledWith(5);
    // no state chip on a finished card
    expect(screen.queryByTestId('bp-state')).toBeNull();
  });

  it('undone: stamp, dimmed wave, undo chip gone', () => {
    const { container } = render(
      <BlueprintCard entry={bp({ done: true, doneCount: 4, currentIdx: -1, undone: true })} accent={ACCENT} {...noops} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('undone-stamp')).toBeTruthy();
    expect((container.querySelector('.pw-wavy') as HTMLElement).classList.contains('pw-dimmed')).toBe(true);
    expect(screen.queryByTestId('undochip')).toBeNull();
  });
});

describe('HelpersBlock', () => {
  it('renders the kicker and one row per helper, check only when done', () => {
    const helpers: Helper[] = [
      { icon: 'build', color: '#C98A5B', name: 'Helper · Homes', task: 'placing 4 cabins around the square', done: false },
      { icon: 'road', color: '#8FB98B', name: 'Helper · Paths', task: 'linking every door to the lane', done: true },
    ];
    render(<HelpersBlock helpers={helpers} />, { wrapper: Wrapper });
    expect(screen.getByText('Helpers on it together')).toBeTruthy();
    const rows = screen.getAllByTestId('helper');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('[data-testid="helper-check"]')).toBeNull();
    expect(rows[1]!.querySelector('[data-testid="helper-check"]')).toBeTruthy();
    expect(rows[1]!.querySelector('[data-verb="road"]')).toBeTruthy();
  });
});
