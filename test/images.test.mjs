import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/images.js reads files through the API client, which looks at the page address when loaded
globalThis.window ??= { location: { href: 'http://localhost/', hash: '', pathname: '/', search: '' } };
const { dataUrl, displayName, findImage, imageFiles, imageType, isImageFile, uploadName } = await import('../src/lib/images.js');

const files = [
  { id: 1, name: 'dashboard-layout.json', mime: 'application/json', updated: 5 },
  { id: 2, name: 'dashboard-logo.png', mime: 'image/png', updated: 6 },
  { id: 3, name: 'dashboard-bg-start.jpg', mime: 'image/jpeg', updated: 7 },
  { id: 4, name: 'planritning.png', mime: 'image/png', updated: 2 },
  { id: 5, name: 'dashboard-image-entre.jpg', mime: 'application/octet-stream', updated: 9 },
  { id: 6, name: 'manual.pdf', mime: 'application/pdf', updated: 3 },
  { id: 7, name: 'planritning.png', mime: 'image/png', updated: 1 },
];

test('only images, without the logo and background images, newest first', () => {
  assert.deepEqual(imageFiles(files).map((f) => f.id), [5, 4, 7]);
  assert.equal(isImageFile({ name: 'x.SVG' }), true);
  assert.equal(isImageFile({ name: 'x.txt', mime: 'text/plain' }), false);
});

test('a widget finds its image by name, else by id', () => {
  assert.equal(findImage(files, { file: 'planritning.png' }).id, 4); // the newest of that name
  assert.equal(findImage(files, { file: 'borttagen.png', fileId: 5 }).id, 5);
  assert.equal(findImage(files, { file: 'borttagen.png' }), null);
  assert.equal(findImage(files, null), null);
});

test('upload names, display names and types', () => {
  assert.equal(uploadName('Entré & Hall (1).PNG'), 'dashboard-image-entre-hall-1.jpg');
  assert.equal(uploadName(''), 'dashboard-image-bild.jpg');
  assert.equal(displayName('dashboard-image-entre-hall.jpg'), 'entre hall');
  assert.equal(displayName('planritning.png'), 'planritning');
  assert.equal(imageType({ name: 'a.svg', mime: 'application/octet-stream' }), 'image/svg+xml');
  assert.equal(imageType({ name: 'a.bin', mime: 'image/webp' }), 'image/webp');
});

test('only known image types reach the browser, and an SVG becomes a data: URL', async () => {
  // the uploader's type is only used when it is a known image type
  assert.equal(imageType({ name: 'a.png', mime: 'image/../text/html' }), 'image/png');
  assert.equal(imageType({ name: 'a.bin', mime: 'image/x-weird' }), 'image/jpeg');
  assert.equal(imageType({ name: 'a.bin', mime: 'text/html' }), 'image/jpeg');
  assert.equal(imageType({ name: 'a.bin', mime: 'IMAGE/SVG+XML; charset=utf-8' }), 'image/svg+xml');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>';
  const url = await dataUrl(new Blob([svg], { type: 'image/svg+xml' }));
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  assert.equal(Buffer.from(url.split(',')[1], 'base64').toString(), svg);
  // larger than one chunk
  const big = new Uint8Array(100000).map((_, i) => i % 251);
  const back = Buffer.from((await dataUrl(new Blob([big], { type: 'image/svg+xml' }))).split(',')[1], 'base64');
  assert.ok(back.equals(Buffer.from(big)));
});
