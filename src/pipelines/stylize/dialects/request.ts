import type { ImageRole, StylizeImage } from './types';

/** `images` grouped in `order`, each role keeping its own sequence; roles outside `order` are left out. */
export function orderByRole(images: readonly StylizeImage[], order: readonly ImageRole[]): StylizeImage[] {
  return order.flatMap((role) => images.filter((i) => i.role === role));
}
