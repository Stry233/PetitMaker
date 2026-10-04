import type { DialectConfig, StylizeImage } from './types';

/** The endpoint a call goes to: the configured base URL, or the dialect's own default. */
export function baseOf(cfg: DialectConfig, fallback: string): string {
  return cfg.baseUrl || fallback;
}

/** The image a call carries in `role`, if any. */
export function roleOf(images: readonly StylizeImage[], role: StylizeImage['role']): StylizeImage | undefined {
  return images.find((i) => i.role === role);
}

/** `images` grouped in `order`, each role keeping its own sequence. With `rest` 'keep' the roles
 *  outside `order` follow in their original sequence; with 'drop' they are left out. */
export function orderByRole(
  images: readonly StylizeImage[], order: readonly StylizeImage['role'][], rest: 'keep' | 'drop' = 'drop',
): StylizeImage[] {
  const listed = order.flatMap((role) => images.filter((i) => i.role === role));
  return rest === 'keep' ? [...listed, ...images.filter((i) => !order.includes(i.role))] : listed;
}
