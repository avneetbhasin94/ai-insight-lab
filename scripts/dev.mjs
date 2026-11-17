import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApplication } from '../server/application.mjs';
import { getLocalRuntime } from '../server/local-config.mjs';

// No secret is read by the asset build or inserted into a browser module.
// Managed preview remains keyless; local mode forwards only the NBA secret.
const runtime = getLocalRuntime(process.argv.slice(2), process.env);
const port = Number(process.env.PORT) || 4173;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a valid local port.');
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8' };
const files = ['index.html','app.js','engine.js','evidence.js','real-data.js','styles.css','type.css','favicon.svg','robots.txt'];
const assets = {};
for (const file of files) {
  assets['/' + file] = { body: await readFile('dist/' + file,'utf8'), type: types[file.slice(file.lastIndexOf('.'))], etag:'"development"' };
}
const app = createApplication({ assets });
createServer(async (req, res) => {
  try {
    // Local mode has no public access gate: bind to loopback and reject foreign
    // Host headers, including DNS-rebinding requests to a nonlocal domain.
    const target = new URL('http://' + req.headers.host + req.url);
    if (runtime.host === '127.0.0.1' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
      res.writeHead(403); res.end('Local requests only'); return;
    }
    let bytes = 0; const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 4096) { res.writeHead(413); res.end('Request too large'); return; }
      chunks.push(chunk);
    }
    const method = req.method || 'GET';
    const request = new Request(target, { method, headers: req.headers, ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks) } : {}) });
    const response = await app.fetch(request, runtime.bindings);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500); res.end('Local request unavailable');
  }
}).listen(port, runtime.host, () => console.log('AI Insight Lab at http://' + runtime.host + ':' + port + ' (no credentials logged)'));
