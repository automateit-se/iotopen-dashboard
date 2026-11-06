import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// the container's start check (nginx/entrypoint/05-validate-lynx-url.sh), run with a given environment
const dir = mkdtempSync(join(tmpdir(), 'dash-entry-'));
const conf = join(dir, 'real-ip.conf');
function start(env) {
  const r = spawnSync('sh', ['nginx/entrypoint/05-validate-lynx-url.sh'], { env: { PATH: process.env.PATH, LYNX_URL: 'https://lynx.iotopen.se', REAL_IP_CONF: conf, ...env }, encoding: 'utf8' });
  return { ok: r.status === 0, err: r.stderr };
}

test('APP_TITLE and LIVE_UPDATES are checked before they reach config.json', () => {
  assert.ok(start({ APP_TITLE: 'Kontor & lager' }).ok);
  assert.ok(start({ APP_TITLE: 'Dashboard för gården' }).ok);
  for (const t of ['A"b', "Anna's", 'a\\b', '$x', '<b>', 'rad 1\nrad 2']) assert.equal(start({ APP_TITLE: t }).ok, false, t);
  assert.equal(start({ LIVE_UPDATES: 'yes' }).ok, false);
  assert.ok(start({ LIVE_UPDATES: 'false' }).ok);
});

test('TRUSTED_PROXIES becomes nginx real_ip settings, and only IPs or CIDRs are accepted', () => {
  assert.ok(start({ TRUSTED_PROXIES: '10.0.0.0/8, 192.168.1.10,fd00::/8' }).ok);
  assert.equal(readFileSync(conf, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).join('\n'), ['set_real_ip_from 10.0.0.0/8;', 'set_real_ip_from 192.168.1.10;', 'set_real_ip_from fd00::/8;', 'real_ip_header X-Forwarded-For;', 'real_ip_recursive on;'].join('\n'));
  for (const p of ['all', '10.0.0.0/8;evil', 'proxy.example.com', '0.0.0.0/0 ; include x']) assert.equal(start({ TRUSTED_PROXIES: p }).ok, false, p);
  // none: an empty file, every connection is a client
  assert.ok(start({}).ok);
  assert.doesNotMatch(readFileSync(conf, 'utf8'), /set_real_ip_from/);
});
