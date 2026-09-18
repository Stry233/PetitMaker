import { setViewportSpace } from '../../core/runtime/viewport-space';

/** Rotate the page, including body portals, without changing native event or DOM APIs. */
export function installLiteLandscape(): void {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:0;padding-top:var(--safe-area-inset-top,0px);padding-right:var(--safe-area-inset-right,0px);padding-bottom:var(--safe-area-inset-bottom,0px);padding-left:var(--safe-area-inset-left,0px)';
  if (CSS.supports('padding-top', 'env(safe-area-inset-top)')) {
    for (const side of ['top', 'right', 'bottom', 'left']) probe.style.setProperty(`padding-${side}`, `var(--safe-area-inset-${side},env(safe-area-inset-${side},0px))`);
  }
  document.documentElement.appendChild(probe);
  let rotated = window.innerHeight > window.innerWidth;
  const update = () => {
    const active = document.activeElement;
    const editing = active instanceof HTMLElement && (active.matches('input,textarea') || active.isContentEditable);
    if (!editing) rotated = window.innerHeight > window.innerWidth;
    const viewport = window.visualViewport;
    const safe = getComputedStyle(probe);
    const top = parseFloat(safe.paddingTop) || 0, right = parseFloat(safe.paddingRight) || 0;
    const bottom = parseFloat(safe.paddingBottom) || 0, left = parseFloat(safe.paddingLeft) || 0;
    const availableW = Math.max(1, (viewport?.width ?? window.innerWidth) - left - right);
    const availableH = Math.max(1, (viewport?.height ?? window.innerHeight) - top - bottom);
    const height = rotated ? availableW : Math.min(availableH, availableW - 1);
    const width = rotated ? Math.max(availableH, height * 1.25) : availableW;
    const scale = rotated ? Math.min(availableW / height, availableH / width) : 1;
    const x = (viewport?.offsetLeft ?? 0) + left + (availableW - (rotated ? height : width) * scale) / 2;
    const y = (viewport?.offsetTop ?? 0) + top;
    setViewportSpace({ width, height, scale, rotated, left: x, top: y });
    Object.assign(document.body.style, {
      position: 'fixed', top: '0', left: '0', width: `${width}px`, height: `${height}px`, transformOrigin: '0 0',
      transform: rotated ? `translate(${x + height * scale}px,${y}px) rotate(90deg) scale(${scale})` : `translate(${x}px,${y}px)`,
    });
    document.documentElement.setAttribute('data-lite-rotated', String(rotated));
  };
  update();
  window.addEventListener('resize', update);
  // The layout listeners follow this handler, so they read the newly sized editor.
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  document.addEventListener('focusout', () => { requestAnimationFrame(() => { update(); window.dispatchEvent(new Event('resize')); }); });
}
