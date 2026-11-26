/** Thrown where a picture would pass the limit of the container it is sent to; nothing was sent.
 *  `length` and `limit` are in the container's own unit, the same for both. */
export class DeliveryLimitError extends Error {
  constructor(readonly length: number, readonly limit: number) {
    super(`Picture of ${length} exceeds the container limit of ${limit}`);
    this.name = 'DeliveryLimitError';
  }
}
