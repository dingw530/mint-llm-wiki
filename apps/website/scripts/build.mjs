import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all([
  cp(resolve(root, 'index.html'), resolve(dist, 'index.html')),
  cp(resolve(root, 'styles.css'), resolve(dist, 'styles.css')),
  cp(resolve(root, 'main.js'), resolve(dist, 'main.js')),
  cp(resolve(root, 'favicon.svg'), resolve(dist, 'favicon.svg')),
  cp(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true }),
]);
console.log(`Built ${dist}`);
