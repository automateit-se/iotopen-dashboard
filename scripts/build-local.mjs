// Builds the dashboard as one self-contained HTML file for the edge app "Local dashboard"
// (github.com/automateit-se/edge-app-local-dashboard): scripts, styles, icons and logos are inlined, so the app
// only has to download and serve a single file. The same code as the container; the app's /config.json
// switches it to local mode. Output: dist-local/iotopen-dashboard-local.html
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist-local');
await build({
  root,
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, assetsInlineLimit: 1e9, cssCodeSplit: false, modulePreload: false },
});

const dataUri = (file, type) => `data:${type};base64,${readFileSync(join(root, 'public', file)).toString('base64')}`;
const logos = Object.fromEntries(readdirSync(join(root, 'public/branding')).map((f) => [`branding/${f}`, dataUri(`branding/${f}`, 'image/svg+xml')]));
const withLogos = (text) => Object.entries(logos).reduce((t, [path, uri]) => t.split(path).join(uri), text);

let html = readFileSync(join(out, 'index.html'), 'utf8');
const asset = (name) => readFileSync(join(out, name.replace(/^\.\//, '')), 'utf8');
// a "</script" inside the code would end the inline script early
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, (_, src) => `<script type="module">${withLogos(asset(src)).replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, (_, href) => `<style>${asset(href)}</style>`);
html = html.replace('href="favicon.svg"', `href="${dataUri('favicon.svg', 'image/svg+xml')}"`);
html = html.replace('href="apple-touch-icon.png"', `href="${dataUri('apple-touch-icon.png', 'image/png')}"`);
if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('an asset was not inlined');
writeFileSync(join(out, 'iotopen-dashboard-local.html'), html);
console.log(`dist-local/iotopen-dashboard-local.html: ${Math.round(html.length / 1024)} kB`);
