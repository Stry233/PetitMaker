// @vitest-environment jsdom
/**
 * A shape changes shape; what is written on it only moves. Framer projects a layout animation as a
 * scale every child inherits, so a box whose shape changes carries `layout` and its content carries
 * `layout="position"`, which corrects the scale. jsdom runs no projection, so `motion` is replaced by
 * plain elements that record the `layout` they were given, and the open panel is read for which
 * projection each word and mark stands under.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  const React = await import('react');
  const MOTION_PROP = /^(?:layout\w*|initial|animate|exit|variants|transition|transformTemplate|custom|while\w+|drag\w*|on(?:Animation|Layout|Hover|Tap|Pan|Drag|ViewportEnter|ViewportLeave)\w*)$/;
  const tags = new Map<string, React.ComponentType>();
  const recorded = (tag: string) => {
    if (!tags.has(tag)) {
      tags.set(tag, React.forwardRef<Element, Record<string, unknown>>(function Recorded(props, ref) {
        const plain = Object.fromEntries(Object.entries(props).filter(([key]) => !MOTION_PROP.test(key) && key !== 'style'));
        const layout = props.layout;
        return React.createElement(tag, { ...plain, ref, 'data-layout': layout === undefined ? undefined : String(layout) });
      }) as unknown as React.ComponentType);
    }
    return tags.get(tag)!;
  };
  return { ...actual, motion: new Proxy({}, { get: (_, tag: string) => recorded(tag) }) };
});

import { EventBus } from '../../../../core/commands/event-bus';
import { TerrainType, type GridState } from '../../../../core/model/types';
import type { EditorEvents } from '../../../../state/editing/events';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { Rail } from '../../../../ui/shell/Rail';
import { makeState, setTerrain } from '../../../_support/map-state';

function stepped(): GridState {
  const state = makeState();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  setTerrain(state, 0, 0, TerrainType.Mountain, 2);
  return state;
}

/** The `layout` of the nearest projected box at or above `node`, or null outside any. */
function projectionOf(node: Node): string | null {
  for (let el: Element | null = node instanceof Element ? node : node.parentElement; el; el = el.parentElement) {
    const layout = el.getAttribute('data-layout');
    if (layout !== null) return layout;
  }
  return null;
}

/** Every word and every drawn mark in `root` that stands under some projection, with that projection. */
function contentUnder(root: Element): { what: string; layout: string }[] {
  const out: { what: string; layout: string }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const layout = projectionOf(text);
    if (text.textContent!.trim() && layout !== null) out.push({ what: `text "${text.textContent!.trim()}"`, layout });
  }
  for (const svg of root.querySelectorAll('svg')) {
    const layout = projectionOf(svg);
    if (layout !== null) out.push({ what: `mark in ${svg.closest('[data-testid]')?.getAttribute('data-testid') ?? 'panel'}`, layout });
  }
  return out;
}

beforeEach(() => {
  window.innerHeight = 900;
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: stepped(), activeLayer: 1, displayLayer: null, layerVisibility: {},
  });
});
afterEach(cleanup);

describe('the layer panel\'s projection', () => {
  it('carries every word and mark on a tile and the head position-only, so the resize cannot stretch them', () => {
    render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
    fireEvent.click(screen.getByTestId('shell-layer-readout').parentElement!);
    const tiles = screen.getAllByTestId(/^shell-layer-row-\d+$/).map((row) => row.parentElement!);
    const content = [screen.getByTestId('shell-layer-head'), ...tiles].flatMap(contentUnder);
    expect(content.filter((c) => c.what.startsWith('text')).length, 'the tiles and the head have words').toBeGreaterThan(0);
    expect(content.filter((c) => c.what.startsWith('mark')).length, 'and marks').toBeGreaterThan(0);
    expect(content.filter((c) => c.layout !== 'position').map((c) => `${c.what} under layout=${c.layout}`)).toEqual([]);
  });
});
