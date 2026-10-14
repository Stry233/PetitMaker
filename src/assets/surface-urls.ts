const modules = import.meta.glob('./surfaces/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urls = new Map(Object.entries(modules).map(([path, url]) => [path.split('/').pop()!.replace('.png', ''), url]));

export const surfaceUrl = (name: string): string | undefined => urls.get(name);
