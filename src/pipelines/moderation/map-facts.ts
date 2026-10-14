// The map check's files, for the page's prefetch: its data folder and its runtime binaries. Importing
// this emits those binaries as build assets, so only a page that ships the check reads it.
export { MAP_CHECK_DATA, mapCheckAssetBase, mapCheckRuntimeUrls } from './map/assets';
