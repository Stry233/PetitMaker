// @vitest-environment jsdom
/**
 * A tool switch keeps the controls both tools offer, showing the new tool's values, and takes away
 * only what the new tool lacks; a control on its way out takes no press. The glide itself is checked
 * in a browser.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { createDefaultRegistry } from '../../../../rules';
import { EditToolbar } from '../../../../ui/shell/bars/EditToolbar';
import { Shell } from '../../../../ui/shell/Shell';
import { makeTemplate } from '../../../_support/map-state';
import { setStoreState } from '../../../_support/store';

const state = () => useEditorStore.getState();
const slot = (id: string) => document.querySelector<HTMLElement>(`[data-toolbar-slot="${id}"]`);
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === name) ?? null;

beforeEach(() => {
  state().initMap(makeTemplate(20, 20), createDefaultRegistry());
  setStoreState({ locale: 'en' });
  useEditorStore.setState({ annotationTool: 'zone', annotationZoneShape: 'free', eraserShape: 'rect', selectingRegion: false, drawingBrushSize: 2 });
  state().setEditMode({ mode: 'annotate' });
});
afterEach(cleanup);

describe('a tool switch within Notes', () => {
  it('keeps the shape picker and width slider, and the picker shows the new tool\'s shape', async () => {
    render(<I18nProvider><EditToolbar bar="notes"/></I18nProvider>);
    expect(button('Freehand')?.getAttribute('aria-pressed')).toBe('true');

    act(() => { state().toggleAnnotationTool('erase'); });
    expect(slot('shape'), 'the brush and the eraser offer the same picker').not.toBeNull();
    expect(slot('size')).not.toBeNull();
    expect(button('Rectangle')?.getAttribute('aria-pressed'), 'the picker shows the eraser shape').toBe('true');
    await waitFor(() => expect(slot('font-size'), 'only the brush offers a font size').toBeNull());
    expect(slot('dimensions')).toBeNull();
  });

  it('keeps the width slider from brush to route and shows the route width there', () => {
    act(() => { state().setBrushSize(2); state().setAnnotationRouteWidth(4); });
    render(<I18nProvider><EditToolbar bar="notes"/></I18nProvider>);
    const slider = () => slot('size')!.querySelector('[role="slider"]')!;
    expect(slider().getAttribute('aria-valuenow')).toBe('2');
    act(() => { state().toggleAnnotationTool('route'); });
    expect(slider().getAttribute('aria-valuenow')).toBe('4');
    act(() => { state().toggleAnnotationTool('zone'); });
    expect(slider().getAttribute('aria-valuenow'), 'the brush keeps its own width').toBe('2');
  });

  it('disables a departing control while it leaves', () => {
    render(<I18nProvider><EditToolbar bar="notes"/></I18nProvider>);
    act(() => { state().toggleAnnotationTool('erase'); });
    const leaving = slot('font-size');
    expect(leaving?.hasAttribute('inert')).toBe(true);
    for (const b of leaving!.querySelectorAll('button')) expect(b.disabled).toBe(true);
  });

  it('swaps departing and arriving controls at once under reduced motion', () => {
    render(<MotionConfig reducedMotion="always"><I18nProvider><EditToolbar bar="notes"/></I18nProvider></MotionConfig>);
    act(() => { state().toggleAnnotationTool('route'); });
    expect(slot('shape')).toBeNull();
    expect(slot('font-size')).toBeNull();
    expect(slot('route-style')).not.toBeNull();
    act(() => { state().toggleAnnotationTool('zone'); });
    expect(slot('shape')).not.toBeNull();
    expect(slot('route-style')).toBeNull();
  });
});

describe('a switch between toolbars', () => {
  const mount = () => render(<I18nProvider><Shell onRestoreSession={() => {}}><div/></Shell></I18nProvider>);
  beforeEach(() => {
    useEditorStore.getState().setAssistantOpen(false);
    state().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
  });

  it('carries the brush, eraser and shape picker from terrain into Notes and swaps the rest', async () => {
    mount();
    expect(slot('trim')).not.toBeNull();
    act(() => { state().setEditMode({ mode: 'annotate' }); });
    expect(button('Brush')).not.toBeNull();
    expect(slot('eraser')).not.toBeNull();
    expect(slot('shape')).not.toBeNull();
    expect(slot('chip'), 'a Notes-only tool arrives').not.toBeNull();
    await waitFor(() => expect(slot('trim'), 'a terrain-only tool leaves').toBeNull());
    expect(slot('auto-trim')).toBeNull();
  });

  it('keeps one toolbar across the terrain surfaces and adds only the road styles row', async () => {
    mount();
    const bars = () => document.querySelectorAll('[data-tour-target="bar"]');
    act(() => { state().setEditMode({ mode: 'water' }); });
    expect(bars()).toHaveLength(1);
    expect(slot('road-styles')).toBeNull();
    act(() => { state().setEditMode({ mode: 'road' }); });
    expect(bars()).toHaveLength(1);
    expect(slot('road-styles')).not.toBeNull();
  });
});
