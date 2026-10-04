/*
 * The round-capped line icons that icon buttons on a plate draw in `currentColor`.
 * One 24-unit box and one stroke, so glyphs from different surfaces read as one set.
 */
import type { ReactNode } from 'react';

export const Glyph = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const TrashIcon = () => (
  <Glyph>
    <path d="M4 7h16" />
    <path d="M9.5 7V4.8c0-.4.4-.8.8-.8h3.4c.4 0 .8.4.8.8V7" />
    <path d="M6 7l1 12.1c.1.5.5.9 1 .9h8c.5 0 .9-.4 1-.9L18 7" />
    <path d="M10 11v5.5M14 11v5.5" />
  </Glyph>
);

/** A pencil: change the drawing itself. */
export const EditIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M4.5 19.5l1.1-4.4L15.8 4.9a2.1 2.1 0 0 1 3 3L8.6 18.1z" /><path d="M13.6 7.1l3 3" /></Glyph>;

/** A text cursor beside a line of text: change the name. */
export const RenameIcon = () => <Glyph><path d="M4 6.5h10M9 6.5v12M14.5 12.5h5.5M14.5 17.5h5.5" /></Glyph>;

/** Two overlapping sheets: make a copy. */
export const DuplicateIcon = () => <Glyph><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M4.5 15.5V5.6c0-.6.5-1.1 1.1-1.1h9.9" /></Glyph>;

/** An arrow leaving a tray: save a file out of the app. */
export const ExportFileIcon = () => <Glyph><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M4.5 14v5.5h15V14" /></Glyph>;

/** An arrow entering a tray: bring a file into the app. */
export const ImportFileIcon = () => <Glyph><path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5M4.5 14v5.5h15V14" /></Glyph>;

export const VideoIcon = () => <Glyph><rect x="3.5" y="6.5" width="12" height="11" rx="2.5" /><path d="M15.5 10.5l5-3v9l-5-3" /></Glyph>;

export const PlayIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M8 5.5v13l10.5-6.5z" /></Glyph>;

export const PlusIcon = () => <Glyph><path d="M12 5v14M5 12h14" /></Glyph>;

export const BackIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M14.5 5 7.5 12l7 7" /></Glyph>;

/** A tick: finish and keep what was made. */
export const CheckIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M5 12.5l4.5 4.5L19 7.5" /></Glyph>;
