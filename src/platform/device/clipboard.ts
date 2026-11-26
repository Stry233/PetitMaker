/** The system clipboard's one text write and the edition's gate over it. */
import { SUPPORTS_CLIPBOARD } from '../build/edition';

/** Writes `text` to the system clipboard and answers whether it landed: false in an edition without
 *  clipboard support, where the page has no clipboard (an insecure context) and when the browser
 *  refuses. The write starts in the caller's own turn, so a press's activation still covers it. */
export async function copyText(text: string): Promise<boolean> {
  if (!SUPPORTS_CLIPBOARD) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
