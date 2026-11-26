/** The tour this build offers (`ui/chrome/tour/deck.ts` is its definition). Raising it offers the
 *  tour once more to every browser offered an older one (`tour-offer.ts`, which hands it on). It
 *  imports nothing, so a browser rig seeding a profile reads the same number. */
export const TOUR_VERSION = 3;
