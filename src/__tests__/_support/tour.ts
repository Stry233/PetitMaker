/** The tour's offer record as a test seeds it: a browser that has been offered this build's tour, so
 *  the welcome tips do not open over the surface under test. */
import { PREFS } from '../../platform/storage/prefs';
import { TOUR_VERSION } from '../../ui/chrome/tour/version';

export const TOUR_SEEN_KEY = PREFS.tourSeen.key;
/** The stored value of a browser offered this build's tour. */
export const TOUR_OFFERED = String(TOUR_VERSION);
