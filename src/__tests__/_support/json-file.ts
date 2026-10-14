/** jsdom's File has no text(), which the importer reads; this stands in with the two members it uses. */
export function jsonFile(text: string, type = ''): File {
  return { type, text: async () => text } as unknown as File;
}
