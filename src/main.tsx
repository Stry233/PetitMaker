import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './assets/fonts/fonts.css';
import './ui/animations.css';
import './ui/cursors/cursors.css';
import App from './App';
import { publishCursorPreference } from './ui/cursors/cursor-vars';
import { useEditorStore } from './state/store';

// Before the first render: the global `html { cursor: var(…) }` rule falls back to the OS keyword
// until these properties exist, so writing them here is what stops a start-up flash of the system
// arrow. The store is already hydrated from localStorage at module load, so a user who opted out
// never sees a frame of our set either.
publishCursorPreference(useEditorStore.getState().systemCursors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
