import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import {
  GBtn,
  Rail,
  Segs,
  StripeBar,
  TickDot,
  UndoneStamp,
  VerbGlyph,
  prettyModel,
} from '../../../ui/agent/atoms';
import { Wavy } from '../../../ui/primitives/Wavy';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe('Wavy', () => {
  it('renders the traveling yellow wave by default', () => {
    const { container } = render(<Wavy>build</Wavy>);
    const el = container.querySelector('.pw-wavy') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.classList.contains('pw-dimmed')).toBe(false);
    expect(el.style.backgroundImage).toContain('FFDA7E');
    expect(el.textContent).toBe('build');
  });

  it('freezes and greys when dimmed (undone entries)', () => {
    const { container } = render(<Wavy dimmed>14 steps</Wavy>);
    const el = container.querySelector('.pw-wavy') as HTMLElement;
    expect(el.classList.contains('pw-dimmed')).toBe(true);
    expect(el.style.backgroundImage).toContain('C9C2B4');
    expect(el.style.backgroundImage).not.toContain('FFDA7E');
  });
});

describe('StripeBar', () => {
  it('renders the animated 45° yellow/ink stripe field', () => {
    render(<StripeBar />);
    const el = screen.getByTestId('stripebar');
    expect(el.classList.contains('pw-stripes')).toBe(true);
    expect(el.style.backgroundImage).toContain('45deg');
    expect(el.style.backgroundImage).toContain('#FFDA7E');
    expect(el.style.backgroundImage).toContain('#43413F');
  });
});

describe('Segs', () => {
  it('renders one flat pill per stage with the done count green', () => {
    render(<Segs done={2} total={4} />);
    const segs = screen.getAllByTestId('seg');
    expect(segs).toHaveLength(4);
    expect(segs.filter((s) => s.dataset.done === 'true')).toHaveLength(2);
    expect((segs[0] as HTMLElement).style.background).toBe('rgb(76, 164, 42)'); // #4CA42A
    expect((segs[3] as HTMLElement).style.background).toBe('rgba(255, 255, 255, 0.6)');
  });
});

describe('TickDot / Rail', () => {
  it('colors ok / run / revert ticks per state and carries the verb glyph', () => {
    render(
      <Rail
        rail={[
          { s: 'ok', i: 'water', t: 'Painted' },
          { s: 'run', i: 'flower', t: 'Reeds' },
          { s: 'revert', i: 'terrain', t: 'Adjusted' },
        ]}
      />,
    );
    const ticks = screen.getAllByTestId('tick');
    expect(ticks).toHaveLength(3);
    expect(ticks[0]!.dataset.status).toBe('ok');
    expect(ticks[1]!.dataset.status).toBe('run');
    expect(ticks[2]!.dataset.status).toBe('revert');
    expect(ticks[0]!.querySelector('[data-verb="water"]')).toBeTruthy();
    expect(ticks[2]!.querySelector('[data-verb="terrain"]')).toBeTruthy();
  });

  it('renders a lone tick with its status background', () => {
    render(<TickDot tick={{ s: 'revert', i: 'water', t: 'Rolled back' }} />);
    const el = screen.getByTestId('tick');
    // the INNER span carries the tile (the outer owns the mount pop, the inner the float loop)
    const tile = el.firstElementChild as HTMLElement;
    expect(tile.style.background).toBe('rgb(224, 163, 46)'); // #E0A32E amber
    expect(el.title).toBe('Rolled back');
  });
});

describe('GBtn', () => {
  it('fires onClick and distinguishes yes / plain / no kinds', () => {
    const yes = vi.fn();
    const no = vi.fn();
    render(
      <>
        <GBtn label="Allow" kind="yes" onClick={yes} />
        <GBtn label="Always" onClick={() => {}} />
        <GBtn label="Skip it" kind="no" onClick={no} />
      </>,
    );
    const btns = screen.getAllByTestId('gbtn');
    expect(btns.map((b) => b.dataset.kind)).toEqual(['yes', '', 'no']);
    fireEvent.click(screen.getByText('Allow'));
    fireEvent.click(screen.getByText('Skip it'));
    expect(yes).toHaveBeenCalledTimes(1);
    expect(no).toHaveBeenCalledTimes(1);
  });
});

describe('UndoneStamp', () => {
  it('renders the localized UNDONE label', () => {
    render(<UndoneStamp />, { wrapper: Wrapper });
    expect(screen.getByTestId('undone-stamp').textContent).toBe('Undone');
  });
});

describe('VerbGlyph', () => {
  it('renders each verb with a currentColor stroke path', () => {
    const { container } = render(
      <>
        <VerbGlyph icon="terrain" size={24} />
        <VerbGlyph icon="plan" size={24} />
      </>,
    );
    expect(container.querySelector('[data-verb="terrain"] path')?.getAttribute('stroke')).toBe('currentColor');
    expect(container.querySelector('[data-verb="plan"] path')).toBeTruthy();
  });
});

describe('prettyModel', () => {
  // the exhaustive corpus lives in pretty-model.test.ts — these are smoke checks
  it('title-cases ids, fixes acronyms, and joins dash versions', () => {
    expect(prettyModel('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(prettyModel('gpt-5.5')).toBe('GPT 5.5');
    expect(prettyModel('glm-4.6')).toBe('GLM 4.6');
    expect(prettyModel('kimi-k2-turbo-preview')).toBe('Kimi K2 Turbo Preview');
    expect(prettyModel('gpt-oss:120b')).toBe('GPT OSS 120B');
  });

  it('keeps only the last path segment of routed ids', () => {
    expect(prettyModel('anthropic/claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(prettyModel('openrouter/auto')).toBe('Auto');
  });
});
