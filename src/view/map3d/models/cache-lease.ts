/** The model and archetype caches are shared by every live scene (the editor's, an export still's,
 *  the shot editor's): each scene holds a lease, and the cached geometry is freed when the last
 *  lease ends. */
import { disposeArchetypes } from './object-archetypes';
import { disposeModels } from './build-model';

let leases = 0;

/** Holds the caches until the returned release runs; releasing twice is a no-op. */
export function leaseModelCaches(): () => void {
  leases++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    leases--;
    if (leases > 0) return;
    disposeArchetypes();
    disposeModels();
  };
}
