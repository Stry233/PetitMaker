import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_FONT_FAMILY } from './assets/fonts/family';
import './assets/fonts/fonts.css';
import './ui/design/animations.css';
import './ui/design/cursors/cursors.css';
import App from './App';
import { printConsoleBanner } from './console-banner';
import { publishCursorPreference } from './ui/design/cursors/cursor-vars';
import { useEditorStore } from './state/store';
import { ensureLocaleStrings } from './i18n/locales';
import { preloadScene3D } from './canvas/map3d/preload';

// Before the first render: the global `html { cursor: var(…) }` rule falls back to the OS keyword
// until these properties exist, so writing them here is what stops a start-up flash of the system
// arrow. The store is already hydrated from localStorage at module load, so a user who opted out
// never sees a frame of our set either.
publishCursorPreference(useEditorStore.getState().systemCursors);

// A session that OPENS in 3D: start fetching the scene chunk now, in parallel with React's first
// mount. `Editor3DCanvas` cannot start it before its own effect runs, and that effect is a later
// sibling than `PixiCanvas`, whose mount effect builds the entire 2D renderer synchronously ahead
// of it — so the download queued behind a view this session will not show. The store is hydrated
// from localStorage at module load, so the saved view is already readable here.
if (useEditorStore.getState().viewMode === '3d') preloadScene3D();

printConsoleBanner();

document.documentElement.style.fontFamily = APP_FONT_FAMILY;

// Render once the interface table for the saved language is in hand. Six of the seven tables are
// their own chunk now (see i18n/locales/index.ts), so a non-English session has one small fetch to
// wait for — and waiting is the point: a frame in the wrong language is a flash, the same reason
// the cursor properties are written above. English resolves without a request, and a table that
// fails to arrive renders anyway rather than leaving the page blank.
const mount = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void ensureLocaleStrings(useEditorStore.getState().locale).catch(() => {}).then(mount);
