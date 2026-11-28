// Servidor para las pruebas de pantallas: sirve la app tal cual, pero sin Firebase
// (config.js sin clave), así la app arranca en modo "solo en este dispositivo".
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 5180;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path === '/' ? 'index.html' : normalize(path).replace(/^[/\\]+/, '');
  if (file.startsWith('..') || /^(\.git|claves-privadas|tools)/.test(file)) { res.writeHead(404).end(); return; }
  try {
    let body = await readFile(join(root, file));
    if (file === 'config.js') body = String(body).replace(/apiKey:\s*'[^']*'/, "apiKey: 'PEGA'");
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(port, () => console.log(`Pruebas en http://localhost:${port}`));
