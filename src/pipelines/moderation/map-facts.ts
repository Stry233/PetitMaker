// The content check's files, for the page's prefetch: its workers' entries, its data folder and its
// runtime binaries. Importing this emits those binaries as build assets, so only a page that ships
// the check reads it.
export { CONTENT_CHECK_WORKER_ENTRIES, mapCheckWarmUrls } from './map/warm';
