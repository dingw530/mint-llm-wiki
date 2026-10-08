import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../viewer'); const port = Number(process.env.EVAL_VIEWER_PORT || 4174);
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer((req, res) => { const requested = req.url === '/' ? '/index.html' : req.url || '/index.html'; const file = path.resolve(root, `.${requested}`); if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; } fs.readFile(file, (error, data) => { if (error) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); }); }).listen(port, () => console.log(`Agent eval viewer: http://localhost:${port}`));
