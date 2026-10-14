/** Prints the generation matrix's digests as one JSON line, for a test comparing processes. */
import { generationDigests } from './_generation-digest';

console.log(JSON.stringify(generationDigests()));
