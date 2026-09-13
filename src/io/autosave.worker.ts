import { gzipSync } from 'fflate';

const scope = self as unknown as {
  onmessage: (event: MessageEvent<Uint8Array>) => void;
  postMessage: (bytes: Uint8Array, transfer: Transferable[]) => void;
};
scope.onmessage = ({ data }) => {
  const bytes = gzipSync(data, { level: 1 });
  scope.postMessage(bytes, [bytes.buffer]);
};
