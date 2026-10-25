import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPages, startPage, excludedTypes } from '../src/lib/local.js';

const pages = [
  { id: 'start', title: 'Start' },
  { id: 'energi', title: 'Energi' },
  { id: 'omsorg', title: 'Omsorg' },
];

test('pages named by id or title, any case', () => {
  assert.deepEqual(localPages(pages, ['Energi', 'OMSORG']).map((p) => p.id), ['energi', 'omsorg']);
  assert.deepEqual(localPages(pages, ['start']).map((p) => p.id), ['start']);
});

test('no pages named, or none that exist: all pages', () => {
  assert.equal(localPages(pages, []), pages);
  assert.equal(localPages(pages, undefined), pages);
  assert.equal(localPages(pages, ['Lager']), pages);
});

test('start page by id or title, else the first', () => {
  assert.equal(startPage(pages, 'omsorg').id, 'omsorg');
  assert.equal(startPage(pages, 'Energi').id, 'energi');
  assert.equal(startPage(pages, '').id, 'start');
  assert.equal(startPage(pages, 'saknas').id, 'start');
});

test('excluded widget types', () => {
  assert.deepEqual([...excludedTypes(['Tracker', ' www ', ''])], ['tracker', 'www']);
  assert.equal(excludedTypes(undefined).size, 0);
});
