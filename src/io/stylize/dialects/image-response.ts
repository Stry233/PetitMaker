export async function responseToDataUrl(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  return `data:${mime};base64,${btoa(binary)}`;
}
