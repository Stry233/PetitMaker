/**
 * A document's words for one edition: `<!-- web -->…<!-- /web -->` encloses what only the web edition says,
 * and `<!-- lite: … -->` what the offline edition says in its place, a comment the web edition and Markdown
 * viewers hide. The Lite build applies this as it loads a document (`scripts/lite-build-plugin.mts`), so the
 * web edition's words, which may name a platform, never reach a Lite package.
 */
export function editionWording(source: string, lite: boolean): string {
  return lite
    ? source.replace(/<!-- web -->[\s\S]*?<!-- \/web -->/g, '').replace(/<!-- lite: ([\s\S]*?) -->/g, '$1')
    : source.replace(/<!-- lite: [\s\S]*? -->/g, '').replace(/<!-- \/?web -->/g, '');
}
