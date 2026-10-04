import { describe, expect, it } from 'vitest';
import { classifyImportFile, sniffVideo } from '../../io/import-kind';
import { writePlanetFile } from '../../io/planet-codec';
import { serialize } from '../../io/json-codec';
import { createGrid } from '../../core/model/grid-model';
import { MAP_TEMPLATES } from '../../config/maps';
import { planetFixture } from '../fixtures/planet';

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
/** An ISO base media file's first box: size, type, then the major brand for `ftyp`. */
const isoBox = (type: string, brand = '') => bytes([0, 0, 0, 0x20], type, brand, [0, 0, 0, 0]);
const file = (content: BlobPart, name: string, type = '') => new File([content], name, { type });

const HEXIA = MAP_TEMPLATES['hexia']!;
const mapJson = () => serialize({ template: HEXIA, cells: createGrid(HEXIA), objects: new Map(), lockedLayers: new Set() });

describe('import file kinds', () => {
  it('reads MP4, QuickTime and Matroska containers by their first bytes', async () => {
    expect(await classifyImportFile(file(isoBox('ftyp', 'isom'), 'clip.bin'))).toBe('video');
    expect(await classifyImportFile(file(isoBox('ftyp', 'qt  '), 'clip'))).toBe('video');
    expect(await classifyImportFile(file(isoBox('moov'), 'old-recording'))).toBe('video');
    expect(await classifyImportFile(file(bytes([0x1a, 0x45, 0xdf, 0xa3], [0x9f, 0x42, 0x86, 0x81]), 'capture.dat'))).toBe('video');
  });

  it('keeps still images in the ISO container out of the videos', () => {
    expect(sniffVideo(isoBox('ftyp', 'heic'))).toBe(false);
    expect(sniffVideo(isoBox('ftyp', 'avif'))).toBe(false);
    expect(sniffVideo(isoBox('ftyp', 'mp42'))).toBe(true);
  });

  it('takes a video type or a recording extension when the bytes say nothing', async () => {
    expect(await classifyImportFile(file(new Uint8Array(16), 'Scan.MKV'))).toBe('video');
    expect(await classifyImportFile(file(new Uint8Array(16), 'clip', 'video/webm'))).toBe('video');
  });

  it('tells a planet file from a map save by its format, whatever the file is called', async () => {
    const planet = writePlanetFile('Bay', planetFixture());
    expect(await classifyImportFile(file(planet, 'Bay.planet.json', 'application/json'))).toBe('planet');
    expect(await classifyImportFile(file(planet, 'Bay.txt'))).toBe('planet');
    expect(await classifyImportFile(file(`﻿  ${planet}`, 'Bay'))).toBe('planet');
    expect(await classifyImportFile(file(mapJson(), 'garden.json'))).toBe('map');
  });

  it('leaves a JSON file that only mentions the planet format to the map reader', async () => {
    expect(await classifyImportFile(file(JSON.stringify({ notes: 'petitmaker.planet' }), 'notes.json'))).toBe('map');
    expect(await classifyImportFile(file('{ not json', 'broken.json'))).toBe('map');
  });

  it('reads a share image as a map', async () => {
    const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await classifyImportFile(file(png, 'share.png', 'image/png'))).toBe('map');
    expect(await classifyImportFile(file(png, 'share.webp'))).toBe('map');
  });

  it('names anything else unknown', async () => {
    expect(await classifyImportFile(file('hello', 'notes.txt', 'text/plain'))).toBe('unknown');
    expect(await classifyImportFile(file(new Uint8Array([1, 2, 3]), 'blob'))).toBe('unknown');
    expect(await classifyImportFile(file('', ''))).toBe('unknown');
  });

  it('tells a source that cannot be sliced by its name and type', async () => {
    const bare = { name: 'map.json', type: 'application/json', size: 2, text: async () => '{}' } as unknown as File;
    expect(await classifyImportFile(bare, 'map.json')).toBe('map');
  });
});
