import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'engine.js': 'text/javascript; charset=utf-8', 'evidence.js': 'text/javascript; charset=utf-8', 'real-data.js': 'text/javascript; charset=utf-8', 'styles.css': 'text/css; charset=utf-8', 'type.css': 'text/css; charset=utf-8', 'favicon.svg': 'image/svg+xml', 'robots.txt': 'text/plain; charset=utf-8' };
const assets = {};
for (const [name, type] of Object.entries(files)) {
  const body = await readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8');
  assets[`/${name}`] = { body, type, etag: `"${createHash('sha256').update(body).digest('hex').slice(0,24)}"` };
}
await mkdir(new URL('../dist/server/', import.meta.url), { recursive: true });
await build({ entryPoints: ['worker/index.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js', sourcemap: false, minify: false, plugins: [{ name: 'ai-insight-lab-assets', setup(b) { b.onResolve({ filter: /^ai-insight-lab:assets$/ }, () => ({ path: 'assets', namespace: 'ai-insight-lab' })); b.onLoad({ filter: /.*/, namespace: 'ai-insight-lab' }, () => ({ contents: `export default ${JSON.stringify(assets)};`, loader: 'js' })); } }] });
const manifest = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (!manifest.project_id || manifest.static) throw new Error('A Worker deployment needs the retained project ID and no static.directory.');
console.log('Built self-contained Worker with original assets. No credentials are read during build.');
