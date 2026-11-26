// @vitest-environment jsdom
/**
 * A menu entry's highlight corners that face the card's outer corners are concentric with them;
 * middle entries keep the entry corner.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FloatMenu } from '../../../ui/primitives/FloatMenu';
import { ContextMenuFace } from '../../../ui/chrome/floating/ContextMenu';
import { UiPreviewProvider } from '../../../ui/design/preview';
import { concentricRadius, radii } from '../../../ui/design/styles';
import { PANEL_EDGE_WIDTH } from '../../../ui/design/tokens';

afterEach(cleanup);

/** The corner concentric with a card's own, for the card padding it is drawn with. */
const rim = (card: HTMLElement) => concentricRadius(radii.lg - PANEL_EDGE_WIDTH, parseFloat(card.style.padding), radii.md);
const px = (n: number) => `${n}px`;

function corners(el: HTMLElement) {
  const s = el.style;
  return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius];
}

function expectCorners(el: HTMLElement, top: number, bottom: number) {
  expect(corners(el)).toEqual([px(top), px(top), px(bottom), px(bottom)]);
}

describe('concentricRadius', () => {
  it('is the outer radius less the inset, never below the entry corner', () => {
    expect(concentricRadius(24, 8, 12)).toBe(16);
    expect(concentricRadius(24, 20, 12)).toBe(12);
  });
});

describe('FloatMenu entries', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: `Row ${i}`, separated: i === 2 }));
  const open = (n: number) => render(
    <UiPreviewProvider>
      <FloatMenu row="x" items={items(n)} open onOpen={() => {}} onClose={() => {}} trigger={{ ref: { current: document.body } }} />
    </UiPreviewProvider>,
  );

  it('rounds the first entry s top and the last entry s bottom concentrically, the middle not at all', () => {
    open(4);
    const rows = screen.getAllByRole('menuitem');
    const RIM = rim(screen.getByRole('menu'));
    expect(RIM, 'the card s corner is rounder than an entry s').toBeGreaterThan(radii.md);
    expectCorners(rows[0]!, RIM, radii.md);
    expectCorners(rows[1]!, radii.md, radii.md);
    expectCorners(rows[2]!, radii.md, radii.md);
    expectCorners(rows[3]!, radii.md, RIM);
  });

  it('rounds all four corners of a sole entry', () => {
    open(1);
    const RIM = rim(screen.getByRole('menu'));
    expectCorners(screen.getByRole('menuitem'), RIM, RIM);
  });
});

describe('ContextMenuFace entries', () => {
  const rows = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', separated: true }, { id: 'c', label: 'C' }];

  it('rounds the first entry s top and the last entry s bottom concentrically', () => {
    render(<ContextMenuFace rows={rows} onPick={() => {}} />);
    const items = screen.getAllByRole('menuitem');
    const RIM = rim(screen.getByRole('menu'));
    expectCorners(items[0]!, RIM, radii.md);
    expectCorners(items[1]!, radii.md, radii.md);
    expectCorners(items[2]!, radii.md, RIM);
  });

  it('keeps the first entry s top corners plain under a header', () => {
    render(<ContextMenuFace rows={rows} onPick={() => {}} header={<div>Head</div>} />);
    expectCorners(screen.getAllByRole('menuitem')[0]!, radii.md, radii.md);
  });
});
