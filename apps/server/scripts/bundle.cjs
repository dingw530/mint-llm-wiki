/**
 * esbuild wrapper: bundle electron-bundle.ts -> electron-dist/index.js
 * 然后在文件头部注入 createRequire shim，确保动态 require() 在 ESM 环境下可用。
 */
const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

const outdir = path.join(__dirname, '..', 'electron-dist');
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

buildSync({
  entryPoints: [path.join(__dirname, '..', 'electron-bundle.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(outdir, 'index.js'),
  external: ['better-sqlite3', 'pdfjs-dist', 'sharp'],
});

// 在文件头部注入 createRequire shim
const outFile = path.join(outdir, 'index.js');
const shim = 'import{createRequire as _cr}from"module";const require=_cr(import.meta.url);\n';
const content = fs.readFileSync(outFile, 'utf-8');
fs.writeFileSync(outFile, shim + content, 'utf-8');

console.log(`Bundled with require shim (${(content.length / 1024 / 1024).toFixed(1)}MB)`);
