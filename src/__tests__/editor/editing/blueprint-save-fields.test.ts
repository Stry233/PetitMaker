/** What the save step makes of its fields as typed, and which names a folder may take. */
import { describe, expect, it } from 'vitest';
import { draftOf, fieldsAuthor, folderNameProblem, saveAllowed, type SaveFields } from '../../../editor/editing/blueprint';
import { EXAMPLES_FOLDER } from '../../../io/blueprint';

const FRAME = { x: 2, y: 3, w: 4, h: 5 };
const typed = (over: Partial<SaveFields> = {}): SaveFields => ({ name: '', author: '', anonymous: false, folder: null, ...over });
const approved = { name: true, author: true };

describe('the save step\'s fields', () => {
  it('saves a blank name under the placeholder, and a name typed trimmed', () => {
    expect(draftOf(FRAME, typed({ name: '   ' }), 'Blueprint 4').name).toBe('Blueprint 4');
    expect(draftOf(FRAME, typed({ name: '  Terrace ' }), 'Blueprint 4').name).toBe('Terrace');
  });

  it('names the author typed, trimmed, and no one when anonymous', () => {
    expect(fieldsAuthor(typed({ author: ' Mei ' }))).toBe('Mei');
    expect(fieldsAuthor(typed({ author: 'Mei', anonymous: true }))).toBeNull();
    expect(draftOf(FRAME, typed({ author: 'Mei', anonymous: true, folder: 'Gardens' }), 'Blueprint 1'))
      .toEqual({ frame: FRAME, name: 'Blueprint 1', author: null, folder: 'Gardens', framing: undefined });
  });

  it('saves only once a name typed and the author named have passed the text check, and never while a save lands', () => {
    expect(saveAllowed(typed({ name: 'Terrace', author: 'Mei' }), approved, false)).toBe(true);
    expect(saveAllowed(typed({ name: 'Terrace', author: 'Mei' }), { name: false, author: true }, false)).toBe(false);
    expect(saveAllowed(typed({ name: 'Terrace', author: 'Mei' }), { name: true, author: false }, false)).toBe(false);
    expect(saveAllowed(typed({ name: '  ', author: 'Mei' }), { name: false, author: true }, false)).toBe(true);
    expect(saveAllowed(typed({ name: 'Terrace', anonymous: true }), { name: true, author: false }, false)).toBe(true);
    expect(saveAllowed(typed({ name: 'Terrace', author: 'Mei' }), approved, true)).toBe(false);
  });
});

describe('a folder\'s name', () => {
  const folders = ['Gardens', 'Docks', EXAMPLES_FOLDER];

  it('cannot be blank', () => {
    expect(folderNameProblem('', null, folders)).toBe('blank');
  });

  it('cannot be a name another folder shows, the app\'s own folder by the name it shows', () => {
    expect(folderNameProblem('Docks', null, folders)).toBe('taken');
    expect(folderNameProblem('Docks', 'Gardens', folders)).toBe('taken');
    expect(folderNameProblem('Examples', 'Gardens', folders)).toBe('taken');
  });

  it('may keep its own name or take a free one', () => {
    expect(folderNameProblem('Gardens', 'Gardens', folders)).toBeNull();
    expect(folderNameProblem('Orchards', 'Gardens', folders)).toBeNull();
  });
});
