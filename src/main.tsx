import { APP_FONT_FAMILY } from './assets/fonts/family';
import './assets/fonts/fonts.css';
import './ui/design/animations.css';
import './ui/design/cursors/cursors.css';
import App from './ui/app/App';
import { mountApp } from './ui/app/boot';
import { printConsoleBanner } from './ui/app/console-banner';
import { publishCursorPreference } from './ui/design/cursors/cursor-vars';
import { showToast } from './platform/channels/toast-bus';
import { translate } from './i18n/context';
import { useEditorStore } from './state/store';
import { preloadScene3D } from './view/map3d/scene/preload';

// A chunk whose preload fails never reaches the boundary around its lazy site, because nothing
// rendered it: the module loader raises this instead. Same message, from the one place that hears it.
window.addEventListener('vite:preloadError', () => {
  showToast(translate('boot.chunk_failed'), 'error');
});

// Before the first render: the global `html { cursor: var(…) }` rule falls back to the OS keyword
// until these properties exist, so writing them here is what stops a start-up flash of the system
// arrow. The store is already hydrated from localStorage at module load, so a user who opted out
// never sees a frame of our set either.
publishCursorPreference();

// A session that opens in 3D: start fetching the scene chunk now, in parallel with React's first
// mount. `Editor3DCanvas` cannot start it before its own effect runs, and that effect is a later
// sibling than `PixiCanvas`, whose mount effect builds the entire 2D renderer synchronously ahead
// of it — so the download queued behind a view this session will not show. The store is hydrated
// from localStorage at module load, so the saved view is already readable here.
if (useEditorStore.getState().viewMode === '3d') preloadScene3D();

printConsoleBanner();

document.documentElement.style.fontFamily = APP_FONT_FAMILY;

mountApp(document.getElementById('root')!, <App />);
