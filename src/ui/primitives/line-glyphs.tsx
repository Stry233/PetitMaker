/*
 * The interface's one set of line icons, drawn in `currentColor`: one 24-unit box and one stroke,
 * so glyphs from different surfaces read as one set. A filled mark shares the box and fills where a
 * line icon strokes. A control needing a mark the set lacks adds it here.
 */
import type { CSSProperties, ReactNode } from 'react';

const Glyph = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

/** A filled disc with a lowercase i knocked out of it: the line beside it describes, it does not warn.
 *  The knockout shows the plate through, so the mark reads on a light or a dark plate alike. `size`
 *  takes a CSS length, so a line can size it in `em`. */
export const InfoIcon = ({ size = 22, style }: { size?: number | string; style?: CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" style={style}>
    <path d="M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6.1a1.45 1.45 0 1 0 0 2.9a1.45 1.45 0 1 0 0-2.9zM10.75 11.75a1.25 1.25 0 0 1 2.5 0v4.75a1.25 1.25 0 0 1-2.5 0z" />
  </svg>
);

/** The info disc's twin with an exclamation knocked out of it: something here did not work. */
export const AlertIcon = ({ size = 22, style }: { size?: number | string; style?: CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" style={style}>
    <path d="M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM10.75 7.5a1.25 1.25 0 0 1 2.5 0v5a1.25 1.25 0 0 1-2.5 0zM12 15.45a1.45 1.45 0 1 0 0 2.9a1.45 1.45 0 1 0 0-2.9z" />
  </svg>
);

/** A triangle with an exclamation: read this before going on. */
export const WarningIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M10.3 4.2 2.7 17.5a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 17h.01" /></Glyph>
);

/** Three slabs stacked in fixed places, as many solid from the bottom as `layers` and the rest faint:
 *  how many layers one terrain stroke builds or takes, out of the most it can. */
export const LayersIcon = ({ layers, size }: { layers: number; size?: number }) => (
  <Glyph size={size}>{[17, 11.6, 6.2].map((y, i) => (
    <rect key={y} x="3.3" y={y} width="17.4" height="4.2" rx="2.1" fill="currentColor" stroke="none" opacity={i < layers ? 1 : 0.2} />
  ))}</Glyph>
);

/** A question mark: ask what something is, or a question waiting for an answer. */
export const QuestionIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M9 9.2a3 3 0 1 1 4.3 2.7c-.9.45-1.3 1.2-1.3 2.1v.4M12 18.2h.01" /></Glyph>
);

/** A heart: support the people who make this. */
export const HeartIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M12 20 4.5 12.5a5 5 0 0 1 7.5-6.6 5 5 0 0 1 7.5 6.6z" /></Glyph>
);

/** An arrow leaving a box: this opens somewhere outside the app. */
export const ExternalLinkIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M14 4.5h5.5V10M19.5 4.5 11 13" /><path d="M17.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5" /></Glyph>
);

/** A bin: discard the thing, rather than erase a stroke. */
export const TrashIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 7h16" />
    <path d="M9.5 7V4.8c0-.4.4-.8.8-.8h3.4c.4 0 .8.4.8.8V7" />
    <path d="M6 7l1 12.1c.1.5.5.9 1 .9h8c.5 0 .9-.4 1-.9L18 7" />
    <path d="M10 11v5.5M14 11v5.5" />
  </Glyph>
);

/** Three dots in a row, the list mark's dots: more actions on this thing, in a menu. */
export const MoreIcon = ({ size }: { size?: number }) => <Glyph size={size}><circle cx="5.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18.5" cy="12" r="1" /></Glyph>;

/** A pencil: change the drawing itself. */
export const EditIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M4.5 19.5l1.1-4.4L15.8 4.9a2.1 2.1 0 0 1 3 3L8.6 18.1z" /><path d="M13.6 7.1l3 3" /></Glyph>;

/** A text cursor beside a line of text: change the name. */
export const RenameIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M4 6.5h10M9 6.5v12M14.5 12.5h5.5M14.5 17.5h5.5" /></Glyph>;

/** Two overlapping sheets: make a copy. */
export const DuplicateIcon = ({ size }: { size?: number }) => <Glyph size={size}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M4.5 15.5V5.6c0-.6.5-1.1 1.1-1.1h9.9" /></Glyph>;

/** A clipboard with a sheet on it: paste. */
export const PasteIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M9 4.5H6.6c-.6 0-1.1.5-1.1 1.1v13.8c0 .6.5 1.1 1.1 1.1h10.8c.6 0 1.1-.5 1.1-1.1V5.6c0-.6-.5-1.1-1.1-1.1H15" /><rect x="9" y="3" width="6" height="3.2" rx="1.2" /><path d="M9 11h6M9 15h4" /></Glyph>;

/** An arrow leaving a tray: save a file out of the app. */
export const ExportFileIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M4.5 14v5.5h15V14" /></Glyph>;

/** An arrow entering a tray: bring a file into the app. */
export const ImportFileIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5M4.5 14v5.5h15V14" /></Glyph>;

export const VideoIcon = () => <Glyph><rect x="3.5" y="6.5" width="12" height="11" rx="2.5" /><path d="M15.5 10.5l5-3v9l-5-3" /></Glyph>;

export const PlayIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M8 5.5v13l10.5-6.5z" /></Glyph>;

export const PlusIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M12 5v14M5 12h14" /></Glyph>;

/** The plus's crossbar alone: take away. */
export const MinusIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M5 12h14" /></Glyph>;

/** A cross: close the window. */
export const CloseIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M6 6l12 12M18 6 6 18" /></Glyph>;

export const BackIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M14.5 5 7.5 12l7 7" /></Glyph>;

/** A monitor on a short stand: the device decides. */
export const DeviceIcon = ({ size }: { size?: number }) => <Glyph size={size}><rect x="3" y="4.5" width="18" height="12" rx="2.5" /><path d="M12 16.5v3.4M8 19.9h8" /></Glyph>;

/** A tick: finish and keep what was made. */
export const CheckIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M5 12.5l4.5 4.5L19 7.5" /></Glyph>;

/** Two opposed arrows: switch between related sets. */
export const SwapIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M4 7h16l-4-4M20 17H4l4 4" /></Glyph>;

/** A chevron pointing down: a list that opens below. Turn it with a wrapper to point elsewhere. */
export const ChevronIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M6 9l6 6.4 6-6.4" /></Glyph>;

export const ChevronLeftIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M15 5l-7 7 7 7" /></Glyph>;

export const ChevronRightIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="M9 5l7 7-7 7" /></Glyph>;

/** Four corner brackets framing the map: fit the map to the view. */
export const FitIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4" />
    <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
    <path d="M4 15v4a1 1 0 0 0 1 1h4" />
    <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
  </Glyph>
);

/** Four corner brackets turned inward: bring something enlarged back to its place. */
export const ShrinkIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 9h4a1 1 0 0 0 1-1V4" />
    <path d="M20 9h-4a1 1 0 0 1-1-1V4" />
    <path d="M4 15h4a1 1 0 0 1 1 1v4" />
    <path d="M20 15h-4a1 1 0 0 0-1 1v4" />
  </Glyph>
);

/** A lens with its handle: look for something by name. */
export const SearchIcon = ({ size }: { size?: number }) => <Glyph size={size}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20 20" /></Glyph>;

/** A block with a quarter-turn arrow over it: this item turns 90 degrees clockwise. */
export const RotateIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <rect x="3.5" y="9.5" width="10.5" height="10.5" rx="2.5" />
    <path d="M8 5A10.5 10.5 0 0 1 18.6 14.6" />
    <path d="M15.7 12.5l2.9 2.3 2.1-3" />
  </Glyph>
);

/** Two triangles facing each other across a dashed axis: mirror the thing, as Rotate turns it. */
export const FlipIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M12 3.5v2M12 8.5v2M12 13.5v2M12 18.5v2" />
    <path d="M8.5 6.5 3.5 17.5h5z" />
    <path d="M15.5 6.5l5 11h-5z" />
  </Glyph>
);

/** An arrow turning back on itself: return a setting to its default. */
export const ResetIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4.5 12a7.5 7.5 0 1 0 7.5-7.5c-2.1 0-4 .9-5.4 2.3L4.5 8.6" />
    <path d="M4.5 4.5v4.1h4.1" />
  </Glyph>
);

/** A dropper: arm what the selection is made of. */
export const PickIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d="m14 6 2.5-2.5a3 3 0 0 1 4 4L18 10" /><path d="m12 5 7 7M14 7l-9 9-1 4 4-1 9-9" /></Glyph>;

/** Four arrows out of a cross: move the thing. */
export const MoveIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></Glyph>
);

/** A folder's outline, which every folder glyph draws. */
const FOLDER = 'M3.5 7a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z';

/** A folder: a place things are filed under. */
export const FolderIcon = ({ size }: { size?: number }) => <Glyph size={size}><path d={FOLDER} /></Glyph>;

/** A folder with a plus in it: make a new folder. */
export const NewFolderIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d={FOLDER} /><path d="M12 10v6M9 13h6" /></Glyph>
);


/** Four tiles: things shown as large pictures, or all of them. */
export const GridIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Glyph>
);

/** Lines with a dot before each: things shown as a list of details. */
export const ListIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Glyph>
);

/** Two blocks and a plus: add more things to the selection. */
export const MultiSelectIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /><path d="M13 7h8M17 3v8" /></Glyph>
);

/** A framed patch with its corners marked: a region kept as a blueprint. */
export const SaveBlueprintIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" /><path d="M12 8.5v7M8.5 12h7" /></Glyph>
);

/** A dashed square: a region of the map kept as one, a blueprint laid on the map. */
export const RegionIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><rect x="3.5" y="3.5" width="17" height="17" rx="3" strokeDasharray="4 3" /></Glyph>
);

/** A capital T standing on the baseline, `cap` of the box's 24 units tall: a size of lettering.
 *  `struck` fades it and crosses it out: no lettering. */
export const LetterIcon = ({ size, cap, struck = false }: { size?: number; cap: number; struck?: boolean }) => (
  <Glyph size={size}>
    <path d={`M${12 - cap * 0.43} ${18 - cap}h${cap * 0.86}M12 ${18 - cap}V18`} strokeWidth="2.6" opacity={struck ? 0.45 : 1} />
    {struck && <path d="M5 19 19 5" strokeWidth="2.4" />}
  </Glyph>
);

/** A dashed frame: everything in reach. */
export const SelectAllIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="4 3" /></Glyph>
);

/** A ruler's edge with its ticks: show the measures. `hidden` strikes it out: the measures stay hidden. */
export const MeasureIcon = ({ size, hidden = false }: { size?: number; hidden?: boolean }) => (
  <Glyph size={size}><path d="M4.5 6h15v12h-15zM8.5 6v4.5M12 6v2.5M15.5 6v4.5" />{hidden && <path d="M3.5 20.5 20.5 3.5" />}</Glyph>
);

/** A line that bends across the box, `dashed` or solid: how a drawn route is stroked. */
export const RouteIcon = ({ size, dashed = false }: { size?: number; dashed?: boolean }) => (
  <Glyph size={size}><path d="M3 17C8 17 8 7 13 7c3.5 0 4.5 3 8 3.6" strokeWidth="2.4" strokeDasharray={dashed ? '4 3.4' : undefined} /></Glyph>
);

/** The teeth of the gear the ring's rim stands among, one per eighth of a turn. */
const GEAR_TEETH = Array.from({ length: 8 }, (_, i) => {
  const cos = Math.cos((i * Math.PI) / 4), sin = Math.sin((i * Math.PI) / 4);
  return `M${12 + 8.2 * cos} ${12 + 8.2 * sin}L${12 + 10.4 * cos} ${12 + 10.4 * sin}`;
}).join('');

/** A ring with eight teeth: settings for how something is made. */
export const GearIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><circle cx="12" cy="12" r="5.4" strokeWidth="2.6" /><path d={GEAR_TEETH} strokeWidth="2.6" /></Glyph>
);

/** A shield with a check: what is kept private. */
export const ShieldIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M12 3 5 6v5.5c0 4.2 2.9 7.2 7 8.5 4.1-1.3 7-4.3 7-8.5V6l-7-3Z" /><path d="m9.2 11.7 2 2 3.6-3.8" /></Glyph>
);

/** A page with a folded corner and lines of text: a document to read. */
export const DocumentIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z" />
    <path d="M13.5 3v4A1.5 1.5 0 0 0 15 8.5h3.5" /><path d="M9 12.5h6M9 16h6" />
  </Glyph>
);

/** A pair of scales: the terms something is licensed under. */
export const ScalesIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M12 4v16M7 20h10" /><path d="M5 7h14M8 5.5 5 7l7-1.5L19 7l-3-1.5" />
    <path d="M5 7 2.8 11.5a2.2 2.2 0 0 0 4.4 0L5 7ZM19 7l-2.2 4.5a2.2 2.2 0 0 0 4.4 0L19 7Z" />
  </Glyph>
);

/** A box tied shut: something made by others and shipped inside. */
export const PackageIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><path d="M12 3.2 4.5 7.1v9.8L12 20.8l7.5-3.9V7.1L12 3.2Z" /><path d="M4.7 7.2 12 11l7.3-3.8M12 11v9.6" /><path d="m8.2 5.1 7.4 3.9" /></Glyph>
);

/** A painter's palette: pictures and art. */
export const PaletteIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M12 3.5c-4.7 0-8.5 3.5-8.5 8s3.8 6.7 6 6.7c1.4 0 1.8-1 1.4-1.9-.5-1 .2-2.1 1.4-2.1H15c3 0 5.5-2.1 5.5-5.2 0-3.4-3.8-5.5-8.5-5.5Z" />
    <circle cx="7.5" cy="10.5" r="1" /><circle cx="11" cy="7.5" r="1" /><circle cx="15" cy="8.5" r="1" />
  </Glyph>
);

/** A ring around an i, drawn as a line where `InfoIcon` fills: what this is and who made it. */
export const AboutIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></Glyph>
);

/** A padlock: how something is kept safe. */
export const LockIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><rect x="4.5" y="10.5" width="15" height="10" rx="2.2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" /></Glyph>
);

/** An envelope: write to someone. */
export const MailIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><rect x="3.5" y="5.5" width="17" height="13" rx="2.2" /><path d="m4.5 7 6.4 5a1.8 1.8 0 0 0 2.2 0l6.4-5" /></Glyph>
);

/** A clock face: what changed over time. */
export const ClockIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Glyph>
);
