import type { ImageRole, StylizeImage } from './types';

/** The image a call carries in `role`, if any. */
export function roleOf(images: readonly StylizeImage[], role: ImageRole): StylizeImage | undefined {
  return images.find((i) => i.role === role);
}

/** `images` grouped in `order`, each role keeping its own sequence; roles outside `order` are left out. */
export function orderByRole(images: readonly StylizeImage[], order: readonly ImageRole[]): StylizeImage[] {
  return order.flatMap((role) => images.filter((i) => i.role === role));
}
