/**
 * About's graphics diagnostic line.
 *
 * A "the editor is slow" report is only actionable if it says which renderer the machine fell to,
 * so the modal states it: the probe's class in the user's own language, then the renderer string
 * verbatim (a device identifier, never translated) truncated to one line's worth.
 *
 * The probe is mocked rather than driven: jsdom has no GL at all, so the real answer here is a
 * constant and could not tell the two classes apart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TEXT_FLOOR } from '../../../ui/design/text-weight';
import { render, screen } from '@testing-library/react';
import { AboutModal } from '../../../ui/chrome/modals/AboutModal';
import { I18nProvider } from '../../../i18n/context';
import { en } from '../../../i18n/locales/en';
import { setStoreState } from '../../_store';

const gl = vi.hoisted(() => ({ quality: 'lite' as 'full' | 'lite', renderer: '' }));

vi.mock('../../../core/runtime/device-quality', () => ({
  glQuality: () => gl.quality,
  glRendererName: () => gl.renderer,
}));

function renderModal() {
  return render(
    <I18nProvider>
      <AboutModal onClose={() => {}} />
    </I18nProvider>,
  );
}

function line(): string {
  const el = document.querySelector('[data-gl-diagnostic]');
  expect(el).toBeTruthy();
  return el!.textContent ?? '';
}

beforeEach(() => {
  setStoreState({ locale: 'en' });
  gl.quality = 'lite';
  gl.renderer = '';
});

describe('AboutModal — graphics diagnostic', () => {
  it('names software rendering, with the renderer string beside it', () => {
    gl.renderer = 'SwiftShader Device (Subzero)';
    renderModal();
    expect(line()).toBe(`${en['about.renderer_lite']}, SwiftShader Device (Subzero)`);
  });

  it('names hardware acceleration on a healthy GPU', () => {
    gl.quality = 'full';
    gl.renderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)';
    renderModal();
    expect(line()).toContain(en['about.renderer_full']);
    expect(line()).toContain('NVIDIA GeForce RTX 3060');
  });

  it('truncates a renderer string too long for the line', () => {
    gl.quality = 'full';
    gl.renderer = 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.2111)';
    renderModal();
    const text = line();
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThan(gl.renderer.length);
  });

  it('states the class alone where there is no renderer to name', () => {
    renderModal();
    expect(line()).toBe(en['about.renderer_lite']);
  });

  it('speaks the active locale', () => {
    setStoreState({ locale: 'zh' });
    renderModal();
    expect(line()).toContain('软件渲染');
  });

  /** Both lines stand at the small-print rung, which is the floor — there is nothing under it to
   *  recede to, so what separates them is opacity. */
  it('recedes below the version line it sits under', () => {
    renderModal();
    const diag = document.querySelector<HTMLElement>('[data-gl-diagnostic]')!;
    const version = screen.getByLabelText(en['about.copy_build'] as string) as HTMLElement;
    expect(parseFloat(diag.style.fontSize)).toBe(TEXT_FLOOR);
    expect(parseFloat(version.style.fontSize)).toBe(TEXT_FLOOR);
    expect(parseFloat(diag.style.opacity)).toBeLessThan(parseFloat(version.style.opacity));
  });
});
