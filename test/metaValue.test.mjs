import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStorable, checkMetaValue, metaProblem, META_MAX_LENGTH } from '../src/lib/metaValue.js';

test('Swedish and West European text, and Windows-1252 punctuation, can be stored', () => {
  for (const v of ['Lägenhet Åsa & Örjan', 'Café Müller', 'Pris 12 € – “bra” … ™', '#0d3e53', 'a@example.com, b@example.com', '']) {
    assert.equal(metaProblem('dashboard.title', v), null, v);
  }
});

test('emoji, arrows and non-Latin scripts cannot', () => {
  assert.deepEqual(checkMetaValue('Hem 🏠 → 2').badChars, ['🏠', '→']);
  assert.match(metaProblem('dashboard.title', 'Hem 🏠'), /^Titeln innehåller tecken som IoT Open inte kan spara: 🏠/);
  assert.match(metaProblem('dashboard.nickname', '温度'), /^Namnet innehåller tecken/);
  assert.match(metaProblem('custom.key', 'Ω'), /^Värdet för custom.key/);
});

test('at most 1024 characters, counted as characters', () => {
  assert.equal(metaProblem('dashboard.admins', 'å'.repeat(META_MAX_LENGTH)), null);
  assert.match(metaProblem('dashboard.admins', 'x'.repeat(META_MAX_LENGTH + 1)), /är 1025 tecken långt; IoT Open sparar högst 1024/);
});

test('the first problem stops the whole write', () => {
  assert.doesNotThrow(() => assertStorable([['dashboard.title', 'Hemma'], ['dashboard.color', '#fff']]));
  assert.throws(() => assertStorable([['dashboard.title', 'Hemma'], ['dashboard.icon', '⚡']]), /Ikonen innehåller/);
});
