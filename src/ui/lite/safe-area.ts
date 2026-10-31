import { setViewportSpace } from '../../platform/device/viewport-space';

/** Fit the page, including body portals, inside the container's safe areas and visual viewport. */
export function installLiteSafeArea(): void {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:0;padding-top:var(--safe-area-inset-top,0px);padding-right:var(--safe-area-inset-right,0px);padding-bottom:var(--safe-area-inset-bottom,0px);padding-left:var(--safe-area-inset-left,0px)';
  if (CSS.supports('padding-top', 'env(safe-area-inset-top)')) {
    for (const side of ['top', 'right', 'bottom', 'left']) probe.style.setProperty(`padding-${side}`, `var(--safe-area-inset-${side},env(safe-area-inset-${side},0px))`);
  }
  document.documentElement.appendChild(probe);
  let fitted = '';
  /** Refits the body; false when nothing moved. */
  const update = (): boolean => {
    const viewport = window.visualViewport;
    const safe = getComputedStyle(probe);
    const top = parseFloat(safe.paddingTop) || 0, right = parseFloat(safe.paddingRight) || 0;
    const bottom = parseFloat(safe.paddingBottom) || 0, left = parseFloat(safe.paddingLeft) || 0;
    const width = Math.max(1, (viewport?.width ?? window.innerWidth) - left - right);
    const height = Math.max(1, (viewport?.height ?? window.innerHeight) - top - bottom);
    const x = (viewport?.offsetLeft ?? 0) + left, y = (viewport?.offsetTop ?? 0) + top;
    const key = `${width},${height},${x},${y}`;
    if (key === fitted) return false;
    fitted = key;
    setViewportSpace({ width, height, left: x, top: y });
    // The transform makes the body the containing block of its fixed descendants.
    Object.assign(document.body.style, {
      position: 'fixed', top: '0', left: '0', width: `${width}px`, height: `${height}px`, transformOrigin: '0 0',
      transform: `translate(${x}px,${y}px)`,
    });
    return true;
  };
  update();
  // Fixed chrome parked outside the window overflows the transformed body, which focus and
  // scrollIntoView then scroll despite `overflow: hidden`; the editor never scrolls the page.
  document.body.addEventListener('scroll', () => { document.body.scrollTop = 0; document.body.scrollLeft = 0; });
  // Registered before the layout listeners, so they read the newly fitted body.
  window.addEventListener('resize', update);
  // A software keyboard can move only the visual viewport; the layout listeners hear it as a resize.
  const onVisualViewport = () => { if (update()) window.dispatchEvent(new Event('resize')); };
  window.visualViewport?.addEventListener('resize', onVisualViewport);
  window.visualViewport?.addEventListener('scroll', onVisualViewport);
}
