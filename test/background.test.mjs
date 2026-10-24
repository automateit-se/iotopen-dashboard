import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundFile, backgroundOf, fitSize, suggestDim, meanLuminance, BG_DEFAULTS } from '../src/lib/background.js';

test('file name per page', () => {
  assert.equal(backgroundFile('energi'), 'dashboard-bg-energi.jpg');
});

test('settings: none without an entry, defaults and limits otherwise', () => {
  assert.equal(backgroundOf({ id: 'start' }), null);
  assert.equal(backgroundOf(null), null);
  assert.deepEqual(backgroundOf({ background: {} }), BG_DEFAULTS);
  assert.deepEqual(backgroundOf({ background: { dim: 95, opacity: 2, blur: true, glass: false } }), { dim: 80, opacity: 10, blur: true, glass: false });
  assert.deepEqual(backgroundOf({ background: { dim: 'x', opacity: 42.4 } }), { ...BG_DEFAULTS, opacity: 42 });
});

test('images are scaled down, never up', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 1920, height: 1440 });
  assert.deepEqual(fitSize(1000, 3000), { width: 640, height: 1920 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
});

test('darkening suggestion follows the brightness', () => {
  assert.equal(suggestDim(0.05), 10);
  assert.equal(suggestDim(0.3), 40);
  assert.equal(suggestDim(0.9), 70);
  assert.ok(suggestDim(0.2) <= suggestDim(0.6));
});

test('mean luminance of pixels', () => {
  assert.equal(meanLuminance(new Uint8ClampedArray([0, 0, 0, 255])), 0);
  assert.equal(meanLuminance(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])), 0.5);
});
