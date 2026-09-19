import { prepareImageFormat } from './assets/image-format';

// Dynamic import keeps artwork URL evaluation after the decoder probe.
void prepareImageFormat().then(() => import('./main')).catch(() => {
  window.dispatchEvent(new Event('petit:boot-failed'));
});
