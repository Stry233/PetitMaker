import { installLiteLandscape } from './ui/lite/landscape';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_FONT_FAMILY } from './assets/fonts/family';
import './ui/design/animations.css';
import './ui/design/cursors/cursors.css';
import LiteApp from './ui/lite/LiteApp';
import { useEditorStore } from './state/store';
import { publishCursorPreference } from './ui/design/cursors/cursor-vars';
import { brandName } from './version';

installLiteLandscape();
publishCursorPreference(useEditorStore.getState().systemCursors);
document.documentElement.style.fontFamily = APP_FONT_FAMILY;
document.title = brandName(useEditorStore.getState().locale);
createRoot(document.getElementById('root')!).render(<StrictMode><LiteApp /></StrictMode>);
