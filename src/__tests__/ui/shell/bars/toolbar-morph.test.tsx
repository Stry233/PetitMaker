// @vitest-environment jsdom
/**
 * A control two tools both offer is the same node before and after a tool switch, so it can glide
 * rather than fade out and back in; only a control one tool offers mounts or unmounts. jsdom lays
 * nothing out, so the glide itself is checked in a browser; these tests hold the identity it needs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { createDefaultRegistry } from '../../../../rules';
import { EditToolbar } from '../../../../ui/shell/bars/EditToolbar';
import { Shell } from '../../../../ui/shell/Shell';
import { MOTIONS } from '../../../../ui/design/motion/registry';
import { makeTemplate } from '../../../_support/map-state';
import { setStoreState } from '../../../_support/store';

const state = () => useEditorStore.getState();
const slot = (id: string) => document.querySelector<HTMLElement>(`[data-toolbar-slot="${id}"]`);
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === name) ?? null;
const highlights = () => document.querySelectorAll('[data-tool-highlight]');

beforeEach(() => {
  state().initMap(makeTemplate(20, 20), createDefaultRegistry());
  setStoreState({ locale: 'en' });
  useEditorStore.setState({ annotationTool: 'zone', annotationZoneShape: 'free', eraserShape: 'rect', selectingRegion: false, drawingBrushSize: 2 });
  state().setEditMode({ mode: 'annotate' });
});
afterEach(cleanup);

describe('a tool switch within Notes', () => {
  it('keeps the shape picker, width slider and armed plate, and moves the plate to the new shape', async () => {
    render(<I18nProvider><EditToolbar bar="notes"/></I18nProvider>);
    const shape = slot('shape'), size = slot('size'), plate = highlights()[0];
    expect(button('Freehand')?.getAttribute('aria-pressed')).toBe('true');

    act(() => { state().toggleAnnotationTool('erase'); });
    expect(slot('shape'), 'the brush and the eraser offer the same picker').toBe(shape);
    expect(slot('size')).toBe(size);
    expect(highlights()).toHaveLength(1);
    expect(highlights()[0], 'one armed plate travels between the pills').toBe(plate);
    expect(button('Rectangle')?.getAttribute('aria-pressed'), 'the picker shows the eraser shape').toBe('true');
    await waitFor(() => expect(slot('font-size'), 'only the brush offers a font size').toBeNull());
    expect(slot('dimensions')).toBeNull();
  });

  it('keeps the width slider from brush to route and shows the route width there', () => {
    act(() => { state().setBrushSize(2); state().setAnnotationRouteWidth(4); });
    render(<I18nProvider><EditToolbar bar="notes"/></I18nProvider>);
    const size = slot('size');
    const slider = () => size!.querySelector('[role="slider"]')!;
    expect(slider().getAttribute('aria-valuenow')).toBe('2');
    act(() => { state().toggleAnnotationTool('route'); });
    expect(slot('size'), 'brush and route share one slider').toBe(size);
    expect(slider().getAttribute('aria-valuenow')).toBe('4');
    act(() => { state().toggleAnnotationTool('zone'); });
    expect(slot('size')).toBe(size);
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
    const shape = slot('shape');
    act(() => { state().toggleAnnotationTool('route'); });
    expect(slot('shape')).toBeNull();
    expect(slot('font-size')).toBeNull();
    expect(slot('route-style')).not.toBeNull();
    act(() => { state().toggleAnnotationTool('zone'); });
    expect(slot('shape')).not.toBe(shape);
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
    const brush = button('Brush'), eraser = button('Eraser'), shape = slot('shape');
    expect(slot('trim')).not.toBeNull();
    act(() => { state().setEditMode({ mode: 'annotate' }); });
    expect(button('Brush'), 'the same pill, relabelled only where its name differs').toBe(brush);
    expect(slot('eraser')?.contains(eraser)).toBe(true);
    expect(slot('shape')).toBe(shape);
    expect(slot('chip'), 'a Notes-only tool arrives').not.toBeNull();
    await waitFor(() => expect(slot('trim'), 'a terrain-only tool leaves').toBeNull());
    expect(slot('auto-trim')).toBeNull();
  });

  it('keeps one toolbar across the terrain surfaces and adds only the road styles row', async () => {
    mount();
    const bars = () => document.querySelectorAll('[data-tour-target="bar"]');
    const pills = bars()[0];
    act(() => { state().setEditMode({ mode: 'water' }); });
    expect(bars()).toHaveLength(1);
    expect(bars()[0]).toBe(pills);
    expect(slot('road-styles')).toBeNull();
    act(() => { state().setEditMode({ mode: 'road' }); });
    expect(bars()[0]).toBe(pills);
    expect(slot('road-styles')).not.toBeNull();
  });
});

describe('the switch motions', () => {
  it('declares the morph and the plate slide as informing motions', () => {
    for (const id of ['tool.control.morph', 'tool.highlight.slide', 'tool.control.enter', 'tool.control.leave'] as const) {
      expect(MOTIONS[id].tier).toBe('inform');
    }
  });
});
