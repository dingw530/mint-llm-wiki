import { rm } from 'node:fs/promises';
import { URL } from 'node:url';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
