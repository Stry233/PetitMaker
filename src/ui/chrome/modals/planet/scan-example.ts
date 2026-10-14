import exampleMp4 from '../../../../assets/planet-scan/example.mp4';
import exampleWebm from '../../../../assets/planet-scan/example.webm';
import examplePoster from '../../../../assets/planet-scan/example-poster.jpg';

/** The guide's example recording's size, which the window frames it at and the clip is encoded to. */
export const SCAN_EXAMPLE_SIZE = { width: 640, height: 400 } as const;

/** The guide's example recording in both encodings and its poster. URL imports only, so the warm
 *  schedule can fetch them without loading the guide. */
export const SCAN_EXAMPLE = { webm: exampleWebm, mp4: exampleMp4, poster: examplePoster } as const;
