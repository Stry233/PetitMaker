/*
 * models.ts — the weights, one file per style, as URLs the worker fetches on first use.
 *
 * Each is a ~4 MB fp16 ONNX graph distilled in the project's own training studio; a style's file
 * is requested only when that style is first drawn, so the app bundle carries these URLs and nothing
 * else of the models.
 */
import watercolor from '../../../assets/stylize/models/watercolor.onnx?url';
import inkwash from '../../../assets/stylize/models/inkwash.onnx?url';
import night from '../../../assets/stylize/models/night.onnx?url';
import crayon from '../../../assets/stylize/models/crayon.onnx?url';
import vintage from '../../../assets/stylize/models/vintage.onnx?url';

export type NeuralStyle = 'watercolor' | 'inkwash' | 'night' | 'crayon' | 'vintage';

export const MODEL_URLS: Record<NeuralStyle, string> = { watercolor, inkwash, night, crayon, vintage };
