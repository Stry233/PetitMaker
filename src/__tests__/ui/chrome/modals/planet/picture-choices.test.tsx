// @vitest-environment jsdom
/** `PictureChoices`: the maps a window offers as one radio group, by keys as by presses. */
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PictureChoices, type PictureChoice } from '../../../../../ui/chrome/modals/planet/PictureOption';

afterEach(cleanup);

type Way = 'keep' | 'fresh' | 'merge';
const CHOICES: PictureChoice<Way>[] = (['keep', 'fresh', 'merge'] as const).map((value) => ({
  value, testId: `option-${value}`, label: `Map ${value}`, badge: null,
  picture: (onTap) => <span role="img" aria-label={`Picture ${value}`} onClick={onTap} />,
}));

function Group({ columns }: { columns?: 1 | 2 }) {
  const [way, setWay] = useState<Way>('keep');
  return <><h2 id="title">Choose</h2><PictureChoices choices={CHOICES} value={way} onChange={setWay} labelledBy="title" columns={columns} /></>;
}

const option = (name: string) => screen.getByRole('radio', { name });
const checked = () => screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);

describe('PictureChoices', () => {
  it('is one named group with the chosen option its one tab stop', () => {
    render(<Group />);
    expect(screen.getByRole('radiogroup', { name: 'Choose' })).toBeTruthy();
    expect(checked()).toEqual(['Map keep']);
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves the choice and the focus with the arrow keys, wrapping at the ends', () => {
    render(<Group />);
    act(() => { option('Map keep').focus(); });
    fireEvent.keyDown(option('Map keep'), { key: 'ArrowRight' });
    expect(checked()).toEqual(['Map fresh']);
    expect(document.activeElement).toBe(option('Map fresh'));
    fireEvent.keyDown(option('Map fresh'), { key: 'ArrowUp' });
    fireEvent.keyDown(option('Map keep'), { key: 'ArrowLeft' });
    expect(checked()).toEqual(['Map merge']);
    expect(document.activeElement).toBe(option('Map merge'));
  });

  it('chooses by a press on the caption or a tap on the picture', () => {
    render(<Group />);
    fireEvent.click(screen.getByText('Map merge'));
    expect(checked()).toEqual(['Map merge']);
    fireEvent.click(screen.getByRole('img', { name: 'Picture fresh' }));
    expect(checked()).toEqual(['Map fresh']);
  });

  it('stacks its options where the window has one column', () => {
    render(<Group columns={1} />);
    expect(screen.getByRole('radiogroup').getAttribute('data-columns')).toBe('1');
  });
});
